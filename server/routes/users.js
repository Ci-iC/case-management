// v2.0 账号管理（仅平台超管）：
//   - users 表 role 只有 'superadmin' / 'platform_user'
//   - 公司角色在 user_company_roles 关联表
//   - 创建账号时可一并分配公司+角色（一次性多公司多角色）
//   - 软删除沿用 v1.3.2（cascade 清在途审批）
//
// 联系人接口 GET /api/users/contacts —— 任何登录用户调，按当前公司过滤：
//   - superadmin: 不允许（超管不参与业务，没"发消息"语义）
//   - 在公司里：返回该公司有角色的所有用户

import { Router } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import { db, cryptoId, writeAudit } from '../db.js'
import { requireAuth, requirePlatformAdmin, requireCompanyContext } from '../auth.js'

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },   // 5MB 足够几千行用户
})

const r = Router()

const PLATFORM_ROLE_SET = new Set(['superadmin', 'platform_user'])

// ─── 工具：把一行 users 转 API 形态（含公司角色列表） ────────────────────────
async function buildUserDetail(userRow) {
  if (!userRow) return null
  // v2.1+: leftJoin company_roles 取角色中文名（含自定义角色），key 与 (company_id, role) 对应
  const roleRows = await db('user_company_roles as ucr')
    .innerJoin('companies as c', 'ucr.company_id', 'c.id')
    .leftJoin('company_roles as cr', function () {
      this.on('cr.company_id', '=', 'ucr.company_id').andOn('cr.key', '=', 'ucr.role')
    })
    .select(
      'ucr.id as assignment_id', 'ucr.company_id',
      'c.name as company_name', 'c.code as company_code', 'c.status as company_status',
      'ucr.role', 'cr.name as role_name',
    )
    .where('ucr.user_id', userRow.id)
    .orderBy('c.name', 'asc')

  return {
    id: userRow.id,
    username: userRow.username,
    role: userRow.role,
    displayName: userRow.display_name,
    createdAt: userRow.created_at instanceof Date ? userRow.created_at.toISOString() : userRow.created_at,
    createdBy: userRow.created_by,
    mustChangePassword: !!userRow.must_change_password,
    companyAssignments: roleRows.map(row => ({
      assignmentId: row.assignment_id,
      companyId: row.company_id,
      companyName: row.company_name,
      companyCode: row.company_code || null,
      companyStatus: row.company_status,
      role: row.role,
      roleName: row.role_name || row.role,   // v2.1+: 自定义角色显示名
    })),
  }
}

// v2.1+: 校验 (companyId, roleKey) 是否是该公司已配置的角色
async function companyRoleExists(companyId, roleKey) {
  if (!companyId || !roleKey) return false
  const row = await db('company_roles').where({ company_id: companyId, key: roleKey }).first()
  return !!row
}

// ─── 联系人（公司内） ────────────────────────────────────────────────────────
// GET /api/users/contacts — 列出当前公司内所有有角色的用户（除自己）
//   superadmin 没有公司上下文 → 不允许
r.get('/contacts', requireAuth, requireCompanyContext, async (req, res, next) => {
  try {
    if (req.user.isSuperAdmin) return res.status(403).json({ error: '平台超管没有公司联系人' })
    if (req.user.isAllCompaniesView) return res.status(400).json({ error: '"全部公司"模式下不能选联系人，请切换到具体公司' })

    const rows = await db('users as u')
      .innerJoin('user_company_roles as ucr', 'ucr.user_id', 'u.id')
      .where('ucr.company_id', req.user.currentCompanyId)
      .whereNot('u.id', req.user.id)
      .whereNull('u.deleted_at')
      .distinct('u.id', 'u.username', 'u.display_name')
      .orderBy('u.username', 'asc')

    // 顺手把每个用户在当前公司的角色聚合一下
    const ids = rows.map(r => r.id)
    let rolesByUser = new Map()
    if (ids.length > 0) {
      const rs = await db('user_company_roles')
        .select('user_id', 'role')
        .whereIn('user_id', ids)
        .where('company_id', req.user.currentCompanyId)
      for (const r2 of rs) {
        if (!rolesByUser.has(r2.user_id)) rolesByUser.set(r2.user_id, [])
        rolesByUser.get(r2.user_id).push(r2.role)
      }
    }

    res.json({
      contacts: rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        roles: rolesByUser.get(r.id) || [],
      })),
    })
  } catch (e) { next(e) }
})

// ─── 平台超管：账号管理 ──────────────────────────────────────────────────────
r.use(requireAuth, requirePlatformAdmin)

// GET /api/users — 列出所有未删除用户（含公司角色）
r.get('/', async (_req, res, next) => {
  try {
    const rows = await db('users')
      .select('id', 'username', 'role', 'display_name', 'created_at', 'created_by', 'must_change_password')
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
    const users = []
    for (const row of rows) users.push(await buildUserDetail(row))
    res.json({ users })
  } catch (e) { next(e) }
})

// ─── Excel 批量导入用户 ──────────────────────────────────────────────────────
// 模板列：账号、初始密码、昵称、平台角色、公司1、角色1、公司2、角色2、公司3、角色3
const ROLE_LABEL_TO_KEY = {
  '企业管理人员': 'manager',
  '法务岗': 'legal',
  '印章管理岗': 'seal_admin',
  '财务人员': 'finance',
  '普通员工': 'staff',
  // 兼容直接填英文
  'manager': 'manager', 'legal': 'legal', 'seal_admin': 'seal_admin', 'finance': 'finance', 'staff': 'staff',
}
const PLATFORM_LABEL_TO_KEY = {
  '平台超管': 'superadmin', '超管': 'superadmin', 'superadmin': 'superadmin',
  '普通用户': 'platform_user', '平台用户': 'platform_user', 'platform_user': 'platform_user', '': 'platform_user',
}

// GET /api/users/import-template — 下载 .xlsx 模板（带表头 + 一行示例 + 角色枚举说明）
r.get('/import-template', async (_req, res, next) => {
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('用户名单')
    ws.columns = [
      { header: '账号*', key: 'username', width: 16 },
      { header: '初始密码*', key: 'password', width: 16 },
      { header: '昵称', key: 'displayName', width: 16 },
      { header: '平台角色', key: 'platformRole', width: 14 },
      { header: '公司 1', key: 'company1', width: 18 },
      { header: '角色 1', key: 'role1', width: 14 },
      { header: '公司 2', key: 'company2', width: 18 },
      { header: '角色 2', key: 'role2', width: 14 },
      { header: '公司 3', key: 'company3', width: 18 },
      { header: '角色 3', key: 'role3', width: 14 },
    ]
    // 表头加粗 + 浅色背景
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }

    // 示例行（用户照着填）
    ws.addRow({
      username: 'zhangsan',
      password: 'Welcome2026',
      displayName: '张三',
      platformRole: '普通用户',
      company1: '总部',
      role1: '法务岗',
      company2: '上海分公司',
      role2: '企业管理人员',
      company3: '',
      role3: '',
    })

    // 说明 sheet
    const help = wb.addWorksheet('填写说明')
    help.columns = [{ width: 22 }, { width: 80 }]
    const rows = [
      ['字段', '说明'],
      ['账号*', '必填，2-32 个字符，全局唯一'],
      ['初始密码*', '必填，至少 6 位；用户首次登录会被强制改密码'],
      ['昵称', '可选，最长 64 字'],
      ['平台角色', '可选，默认"普通用户"。可选值：平台超管 / 普通用户'],
      ['公司 1 / 角色 1', '可选。公司必须是平台已创建的 active 公司；公司名要完全匹配'],
      ['角色枚举', '企业管理人员 / 法务岗 / 印章管理岗 / 财务人员 / 普通员工'],
      ['公司 2-3', '同上，最多支持一个用户分配 3 家公司的角色（如需更多请用界面里"角色"按钮补充）'],
      ['', ''],
      ['注意', '1. 平台超管（superadmin）不归属任何公司，公司 1-3 列留空即可'],
      ['', '2. 已存在的账号会被跳过（用户名重复）'],
      ['', '3. 不指定平台角色 = 普通用户'],
      ['', '4. 一行 = 一个用户。一个用户在多家公司有角色时，在同一行里填 公司1/角色1、公司2/角色2…'],
    ]
    rows.forEach((r, i) => {
      const row = help.addRow(r)
      if (i === 0) row.font = { bold: true }
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('用户导入模板.xlsx')}`)
    await wb.xlsx.write(res)
    res.end()
  } catch (e) { next(e) }
})

// POST /api/users/bulk-import — multipart 上传 .xlsx，批量创建用户
//   返回 { imported, skipped, errors: [{ row, username, error }] }
r.post('/bulk-import', xlsxUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传 .xlsx 文件' })

    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(req.file.buffer)
    const ws = wb.getWorksheet('用户名单') || wb.worksheets[0]
    if (!ws) return res.status(400).json({ error: '工作表为空' })

    // 预加载所有 active 公司，按名称匹配
    const activeCompanies = await db('companies').select('id', 'name').where('status', 'active')
    const companyByName = new Map(activeCompanies.map(c => [c.name.trim(), c.id]))

    // v2.1+: 预加载所有公司角色，支持按"角色中文名 / key"匹配（含自定义角色）
    //   rolesByCompany: companyId -> Map(中文名或key -> key)
    const allRoles = await db('company_roles').select('company_id', 'key', 'name')
    const rolesByCompany = new Map()
    for (const rr of allRoles) {
      if (!rolesByCompany.has(rr.company_id)) rolesByCompany.set(rr.company_id, new Map())
      const m = rolesByCompany.get(rr.company_id)
      m.set(rr.name, rr.key)
      m.set(rr.key, rr.key)
    }

    // 解析行（跳过表头，第一行 = 表头）
    const results = { imported: 0, skipped: 0, errors: [] }
    const rowsToProcess = []
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return  // 表头
      const cell = (i) => {
        const v = row.getCell(i).value
        if (v == null) return ''
        if (typeof v === 'object') return String(v.text || v.result || v.toString() || '').trim()
        return String(v).trim()
      }
      const data = {
        rowNumber,
        username: cell(1),
        password: cell(2),
        displayName: cell(3),
        platformRoleRaw: cell(4),
        assignments: [
          { companyName: cell(5), roleRaw: cell(6) },
          { companyName: cell(7), roleRaw: cell(8) },
          { companyName: cell(9), roleRaw: cell(10) },
        ].filter(a => a.companyName || a.roleRaw),
      }
      if (!data.username && !data.password) return  // 空行跳过
      rowsToProcess.push(data)
    })

    for (const row of rowsToProcess) {
      try {
        // 校验
        if (!row.username || row.username.length < 2 || row.username.length > 32) {
          throw new Error('账号长度应为 2-32 个字符')
        }
        if (!row.password || row.password.length < 6) {
          throw new Error('密码至少 6 位')
        }
        const platformRole = PLATFORM_LABEL_TO_KEY[row.platformRoleRaw] || 'platform_user'

        // 公司角色解析
        const parsedAssignments = []
        if (platformRole === 'platform_user') {
          for (const a of row.assignments) {
            if (!a.companyName) continue
            const companyId = companyByName.get(a.companyName.trim())
            if (!companyId) throw new Error(`公司「${a.companyName}」不存在或已停用`)
            // 先按固定中文/英文映射；再 fallback 到该公司的角色清单（支持自定义角色名）
            let roleKey = ROLE_LABEL_TO_KEY[a.roleRaw]
            if (!roleKey) roleKey = rolesByCompany.get(companyId)?.get(a.roleRaw)
            if (!roleKey || !rolesByCompany.get(companyId)?.has(roleKey)) {
              throw new Error(`角色「${a.roleRaw}」不是公司「${a.companyName}」的有效角色`)
            }
            // 去重
            const dup = parsedAssignments.find(x => x.companyId === companyId && x.role === roleKey)
            if (!dup) parsedAssignments.push({ companyId, role: roleKey })
          }
        }

        // 重名检查
        const exists = await db('users').select('id').where({ username: row.username }).whereNull('deleted_at').first()
        if (exists) {
          results.skipped++
          results.errors.push({ row: row.rowNumber, username: row.username, error: '账号已存在，已跳过' })
          continue
        }

        // 创建
        const id = cryptoId()
        const hash = bcrypt.hashSync(row.password, 10)
        await db.transaction(async (trx) => {
          await trx('users').insert({
            id,
            username: row.username,
            password_hash: hash,
            role: platformRole,
            display_name: row.displayName || null,
            can_view_cases: false,
            can_view_contracts: false,
            must_change_password: true,
            created_at: new Date(),
            created_by: req.user.id,
          })
          if (parsedAssignments.length > 0) {
            await trx('user_company_roles').insert(parsedAssignments.map(a => ({
              user_id: id,
              company_id: a.companyId,
              role: a.role,
              created_by: req.user.id,
            })))
          }
        })
        results.imported++
      } catch (e) {
        results.skipped++
        results.errors.push({
          row: row.rowNumber,
          username: row.username || '(空)',
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    await writeAudit({
      actorId: req.user.id, action: 'user.bulk_import',
      targetType: 'user', targetId: null,
      payload: { imported: results.imported, skipped: results.skipped },
    })
    res.json(results)
  } catch (e) { next(e) }
})

// POST /api/users — 创建用户
//   body: { username, password, displayName?, role: 'superadmin'|'platform_user',
//           assignments?: [{ companyId, role }, ...]  // 仅 platform_user 可带 }
r.post('/', async (req, res, next) => {
  try {
    const { username, password, displayName, role, assignments } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' })
    if (username.length < 2 || username.length > 32) return res.status(400).json({ error: '账号长度应为 2-32 个字符' })
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' })

    const normalizedRole = PLATFORM_ROLE_SET.has(role) ? role : 'platform_user'

    const exists = await db('users').select('id').where({ username }).whereNull('deleted_at').first()
    if (exists) return res.status(409).json({ error: '该账号已存在' })

    // 校验 assignments
    let parsedAssignments = []
    if (normalizedRole === 'platform_user' && Array.isArray(assignments)) {
      for (const a of assignments) {
        if (!a?.companyId || !a?.role) {
          return res.status(400).json({ error: '公司角色分配格式错误（companyId + role）' })
        }
        parsedAssignments.push({ companyId: a.companyId, role: a.role })
      }
      // 公司必须 active
      const cids = [...new Set(parsedAssignments.map(a => a.companyId))]
      if (cids.length > 0) {
        const active = await db('companies').whereIn('id', cids).where('status', 'active').pluck('id')
        const activeSet = new Set(active)
        for (const a of parsedAssignments) {
          if (!activeSet.has(a.companyId)) return res.status(400).json({ error: '所选公司不存在或已停用' })
        }
      }
      // v2.1+: 每个 role 必须是该公司已配置的角色（含自定义角色）
      for (const a of parsedAssignments) {
        if (!(await companyRoleExists(a.companyId, a.role))) {
          return res.status(400).json({ error: `角色「${a.role}」不是所选公司的有效角色` })
        }
      }
    }

    const id = cryptoId()
    const hash = bcrypt.hashSync(password, 10)
    await db.transaction(async (trx) => {
      await trx('users').insert({
        id,
        username,
        password_hash: hash,
        role: normalizedRole,
        display_name: displayName || null,
        // v2.0: can_view_cases / can_view_contracts 字段保留兼容，但不再用作权限判断
        can_view_cases: false,
        can_view_contracts: false,
        must_change_password: true,
        created_at: new Date(),
        created_by: req.user.id,
      })
      if (parsedAssignments.length > 0) {
        await trx('user_company_roles').insert(parsedAssignments.map(a => ({
          user_id: id,
          company_id: a.companyId,
          role: a.role,
          created_by: req.user.id,
        })))
      }
    })

    const created = await db('users')
      .select('id', 'username', 'role', 'display_name', 'created_at', 'created_by', 'must_change_password')
      .where({ id }).first()

    await writeAudit({
      actorId: req.user.id, action: 'user.create',
      targetType: 'user', targetId: id,
      payload: { username, role: normalizedRole, assignmentsCount: parsedAssignments.length },
    })
    res.status(201).json({ user: await buildUserDetail(created) })
  } catch (e) { next(e) }
})

// PATCH /api/users/:id — 改用户基础信息（displayName / role）
r.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const body = req.body || {}
    const update = {}
    if (typeof body.role === 'string' && PLATFORM_ROLE_SET.has(body.role)) update.role = body.role
    if (typeof body.displayName === 'string') {
      const trimmed = body.displayName.trim()
      if (trimmed.length > 64) return res.status(400).json({ error: '昵称最多 64 个字符' })
      update.display_name = trimmed || null
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: '请提供 role / displayName' })
    }

    const target = await db('users').select('id', 'role').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    // 不能把自己降级为非 superadmin
    if (id === req.user.id && update.role && update.role !== 'superadmin') {
      return res.status(400).json({ error: '不能把自己的角色降级，请先指派其他超级管理员' })
    }

    // 系统至少保留一个 superadmin
    if (target.role === 'superadmin' && update.role && update.role !== 'superadmin') {
      const { count } = await db('users')
        .count({ count: '*' })
        .where({ role: 'superadmin' })
        .whereNull('deleted_at')
        .first()
      if (Number(count) <= 1) return res.status(400).json({ error: '系统必须保留至少一个超级管理员' })
    }

    await db('users').where({ id }).update(update)
    const updated = await db('users')
      .select('id', 'username', 'role', 'display_name', 'created_at', 'created_by', 'must_change_password')
      .where({ id }).first()

    await writeAudit({
      actorId: req.user.id, action: 'user.update',
      targetType: 'user', targetId: id,
      payload: body,
    })
    res.json({ user: await buildUserDetail(updated) })
  } catch (e) { next(e) }
})

// POST /api/users/:id/company-roles — 给用户加一条公司角色
//   body: { companyId, role }
r.post('/:id/company-roles', async (req, res, next) => {
  try {
    const { id } = req.params
    const { companyId, role } = req.body || {}
    if (!companyId || !role) {
      return res.status(400).json({ error: 'companyId 与 role 必填' })
    }
    const target = await db('users').select('id', 'role').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })
    if (target.role === 'superadmin') {
      return res.status(400).json({ error: '平台超管不归属公司，不能分配公司角色' })
    }
    const co = await db('companies').where({ id: companyId, status: 'active' }).first()
    if (!co) return res.status(404).json({ error: '公司不存在或已停用' })
    // v2.1+: role 必须是该公司已配置的角色（含自定义角色）
    if (!(await companyRoleExists(companyId, role))) {
      return res.status(400).json({ error: `角色「${role}」不是该公司的有效角色` })
    }

    // 唯一约束：(user_id, company_id, role)
    const dup = await db('user_company_roles').where({ user_id: id, company_id: companyId, role }).first()
    if (dup) return res.status(409).json({ error: '该用户在该公司已有该角色' })

    const [inserted] = await db('user_company_roles').insert({
      user_id: id,
      company_id: companyId,
      role,
      created_by: req.user.id,
    }, ['id'])

    await writeAudit({
      actorId: req.user.id, action: 'user.add_company_role',
      targetType: 'user', targetId: id,
      payload: { companyId, role },
    })
    res.status(201).json({ assignmentId: inserted.id })
  } catch (e) { next(e) }
})

// DELETE /api/users/:id/company-roles/:assignmentId — 移除公司角色
r.delete('/:id/company-roles/:assignmentId', async (req, res, next) => {
  try {
    const { id, assignmentId } = req.params
    const row = await db('user_company_roles').where({ id: assignmentId, user_id: id }).first()
    if (!row) return res.status(404).json({ error: '角色分配不存在' })

    await db('user_company_roles').where({ id: assignmentId }).delete()

    await writeAudit({
      actorId: req.user.id, action: 'user.remove_company_role',
      targetType: 'user', targetId: id,
      payload: { companyId: row.company_id, role: row.role },
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// DELETE /api/users/:id — 软删除（沿用 v1.3.2）
//   1) 清掉所有 pending approvals（CASCADE 删 steps/actions）+ 对应合同退回 drafting
//   2) 删 user_company_roles 关联（CASCADE 在 schema 上未配，这里手动清）
//   3) users.deleted_at + token_version+1
r.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    if (id === req.user.id) return res.status(400).json({ error: '不能删除自己的账号' })

    const target = await db('users').select('role', 'username').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    if (target.role === 'superadmin') {
      const { count } = await db('users')
        .count({ count: '*' })
        .where({ role: 'superadmin' })
        .whereNull('deleted_at')
        .first()
      if (Number(count) <= 1) return res.status(400).json({ error: '系统必须保留至少一个超级管理员' })
    }

    const affected = await db.transaction(async (trx) => {
      // 1) 在途 approvals
      const approvalIds = await trx('approvals')
        .distinct('approvals.id')
        .leftJoin('approval_steps', 'approval_steps.approval_id', 'approvals.id')
        .where('approvals.status', 'pending')
        .where(function () {
          this.where('approvals.initiator_id', id)
              .orWhere('approval_steps.assignee_id', id)
        })
        .pluck('approvals.id')
      if (approvalIds.length > 0) {
        await trx('contracts')
          .whereIn('approval_id', approvalIds)
          .update({ status: 'drafting', approval_id: null, updated_at: trx.fn.now() })
        await trx('approvals').whereIn('id', approvalIds).delete()
      }

      // 2) 公司角色关联（schema 是 CASCADE on users，但 users 这里不真删，所以手动清）
      await trx('user_company_roles').where({ user_id: id }).delete()

      // 3) 软删除 + 踢下线
      await trx('users').where({ id }).update({
        deleted_at: trx.fn.now(),
        token_version: trx.raw('token_version + 1'),
      })

      return { cancelledApprovals: approvalIds.length }
    })

    await writeAudit({
      actorId: req.user.id, action: 'user.delete',
      targetType: 'user', targetId: id,
      payload: { username: target.username, cancelledApprovals: affected.cancelledApprovals },
    })
    res.json({ ok: true, cancelledApprovals: affected.cancelledApprovals })
  } catch (e) { next(e) }
})

// POST /api/users/:id/reset-password
r.post('/:id/reset-password', async (req, res, next) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body || {}
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })

    const target = await db('users').select('id').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    const hash = bcrypt.hashSync(newPassword, 10)
    await db('users').where({ id }).update({
      password_hash: hash,
      token_version: db.raw('token_version + 1'),
      must_change_password: true,
    })
    await writeAudit({
      actorId: req.user.id, action: 'user.reset_password',
      targetType: 'user', targetId: id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default r
