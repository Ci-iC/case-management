// 公司管理（v2.0 新增）：仅平台超管可 CRUD
//
// 路由：
//   GET    /api/companies           列表（含成员数 / 合同数统计）
//   GET    /api/companies/:id       详情（含成员列表）
//   POST   /api/companies           新建
//   PATCH  /api/companies/:id       改名 / 简称 / 描述 / 启停
//   DELETE /api/companies/:id       软停用（status=inactive；不能真删，业务数据会丢）

import { Router } from 'express'
import crypto from 'node:crypto'
import { db, writeAudit } from '../db.js'
import { requireAuth, requirePlatformAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth, requirePlatformAdmin)

// v2.1+: 公司创建时自动 seed 这 5 个系统角色（与 migration 021 中保持一致）
const SYSTEM_ROLE_SEED = [
  { key: 'manager',    name: '企业管理人员', can_view_all_contracts: true,  sort_order: 1 },
  { key: 'legal',      name: '法务岗',       can_view_all_contracts: true,  sort_order: 2 },
  { key: 'finance',    name: '财务人员',     can_view_all_contracts: true,  sort_order: 3 },
  { key: 'seal_admin', name: '印章管理岗',   can_view_all_contracts: false, sort_order: 4 },
  { key: 'staff',      name: '普通员工',     can_view_all_contracts: false, sort_order: 5 },
]

async function seedSystemRoles(trx, companyId) {
  await trx('company_roles').insert(SYSTEM_ROLE_SEED.map(r => ({
    company_id: companyId,
    key: r.key,
    name: r.name,
    can_view_all_contracts: r.can_view_all_contracts,
    is_system: true,
    sort_order: r.sort_order,
  })))
}

// v2.1+: 公司简称（合同编号前缀）
//   - 强制 2-8 位大写字母数字
//   - 必填（合同编号生成要用）
//   - 唯一性"含历史"：该 code 不能出现在任何其他公司的"现役 + 历史"清单里
//
// 校验通过返回规整后的字符串，失败抛错（带 status）
function normalizeCompanyCode(input) {
  const raw = String(input || '').trim().toUpperCase()
  if (!raw) {
    throw Object.assign(new Error('请填写公司简称（用于合同编号前缀）'), { status: 400 })
  }
  if (!/^[A-Z0-9]{2,8}$/.test(raw)) {
    throw Object.assign(new Error('公司简称必须是 2-8 位大写字母或数字（输入会自动转大写）'), { status: 400 })
  }
  return raw
}

// 检查 code 在系统范围（现役 + 历史）是否被"非自己"的公司占用
//   ownCompanyId 表示当前操作的公司，传 null 代表新建
async function assertCodeNotTaken(trx, code, ownCompanyId) {
  // 1. 现役 companies.code 撞了 → 拒
  const activeOwner = await trx('companies')
    .where({ code })
    .first()
  if (activeOwner && activeOwner.id !== ownCompanyId) {
    throw Object.assign(new Error(
      `简称 ${code} 已被公司「${activeOwner.name}」占用`
    ), { status: 409 })
  }
  // 2. 历史里被别家公司用过 → 拒
  const hist = await trx('company_code_history')
    .where({ code })
    .whereNot('company_id', ownCompanyId || '00000000-0000-0000-0000-000000000000')
    .first()
  if (hist) {
    const owner = await trx('companies').where({ id: hist.company_id }).first()
    throw Object.assign(new Error(
      `简称 ${code} 是其他公司${owner ? `「${owner.name}」` : ''}的历史简称，无法占用`
    ), { status: 409 })
  }
}

// 改动 company.code 时记录历史：把旧 valid_until 关闭，开新行
async function recordCodeChange(trx, { companyId, newCode, actorId }) {
  const now = new Date()
  await trx('company_code_history')
    .where({ company_id: companyId, valid_until: null })
    .update({ valid_until: now })
  await trx('company_code_history').insert({
    company_id: companyId,
    code: newCode,
    valid_from: now,
    changed_by: actorId,
  })
}

function rowToCompany(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    code: row.code || null,
    status: row.status,
    description: row.description || null,
    memberCount: row.member_count != null ? Number(row.member_count) : 0,
    contractCount: row.contract_count != null ? Number(row.contract_count) : 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    createdBy: row.created_by,
  }
}

// GET /api/companies
r.get('/', async (_req, res, next) => {
  try {
    const rows = await db('companies as c')
      .select([
        'c.id', 'c.name', 'c.code', 'c.status', 'c.description',
        'c.created_at', 'c.updated_at', 'c.created_by',
        db.raw('(SELECT count(DISTINCT user_id) FROM user_company_roles WHERE company_id = c.id) AS member_count'),
        db.raw('(SELECT count(*) FROM contracts WHERE company_id = c.id) AS contract_count'),
      ])
      .orderBy([{ column: 'c.status', order: 'asc' }, { column: 'c.created_at', order: 'desc' }])
    res.json({ companies: rows.map(rowToCompany) })
  } catch (e) { next(e) }
})

// GET /api/companies/:id — 含成员列表
r.get('/:id', async (req, res, next) => {
  try {
    const row = await db('companies as c')
      .select([
        'c.id', 'c.name', 'c.code', 'c.status', 'c.description',
        'c.created_at', 'c.updated_at', 'c.created_by',
        db.raw('(SELECT count(DISTINCT user_id) FROM user_company_roles WHERE company_id = c.id) AS member_count'),
        db.raw('(SELECT count(*) FROM contracts WHERE company_id = c.id) AS contract_count'),
      ])
      .where('c.id', req.params.id)
      .first()
    if (!row) return res.status(404).json({ error: '公司不存在' })

    const members = await db('user_company_roles as ucr')
      .innerJoin('users as u', 'ucr.user_id', 'u.id')
      .whereNull('u.deleted_at')
      .where('ucr.company_id', req.params.id)
      .select('u.id', 'u.username', 'u.display_name', 'ucr.role', 'ucr.id as assignment_id')
      .orderBy('u.username', 'asc')

    const byUser = new Map()
    for (const m of members) {
      if (!byUser.has(m.id)) byUser.set(m.id, {
        userId: m.id,
        username: m.username,
        displayName: m.display_name,
        roles: [],
        assignments: [],
      })
      const u = byUser.get(m.id)
      u.roles.push(m.role)
      u.assignments.push({ assignmentId: m.assignment_id, role: m.role })
    }

    res.json({
      company: rowToCompany(row),
      members: [...byUser.values()],
    })
  } catch (e) { next(e) }
})

// POST /api/companies
r.post('/', async (req, res, next) => {
  try {
    const { name, code, description } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写公司名称' })

    // v2.1+: 简称必填，校验格式 + 唯一性（含历史）
    const normalizedCode = normalizeCompanyCode(code)

    const exists = await db('companies').where({ name: String(name).trim(), status: 'active' }).first()
    if (exists) return res.status(409).json({ error: '该公司名称已存在' })

    const companyId = await db.transaction(async (trx) => {
      await assertCodeNotTaken(trx, normalizedCode, null)

      const [created] = await trx('companies').insert({
        name: String(name).trim(),
        code: normalizedCode,
        description: description ? String(description).trim() : null,
        status: 'active',
        created_by: req.user.id,
      }, ['id'])

      // v2.1+: 记入简称历史 + 配齐 5 个系统角色
      await recordCodeChange(trx, { companyId: created.id, newCode: normalizedCode, actorId: req.user.id })
      await seedSystemRoles(trx, created.id)
      return created.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'company.create',
      targetType: 'company', targetId: companyId,
      payload: { name, code: normalizedCode },
    })
    res.status(201).json({ companyId })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// PATCH /api/companies/:id — name / code / description / status
r.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await db('companies').where({ id }).first()
    if (!existing) return res.status(404).json({ error: '公司不存在' })

    const body = req.body || {}
    const update = { updated_at: new Date() }
    let codeChangedTo = null

    if (body.name !== undefined) {
      const n = String(body.name).trim()
      if (!n) return res.status(400).json({ error: '公司名称不能为空' })
      update.name = n
    }
    if (body.code !== undefined) {
      // 简称变更：必须满足格式 + 不撞别家（含历史）
      const newCode = normalizeCompanyCode(body.code)
      if (newCode !== existing.code) {
        codeChangedTo = newCode
        update.code = newCode
      }
    }
    if (body.description !== undefined) update.description = body.description ? String(body.description).trim() : null
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'inactive') {
        return res.status(400).json({ error: 'status 必须是 active 或 inactive' })
      }
      update.status = body.status
    }

    await db.transaction(async (trx) => {
      if (codeChangedTo) {
        await assertCodeNotTaken(trx, codeChangedTo, id)
      }
      await trx('companies').where({ id }).update(update)
      if (codeChangedTo) {
        await recordCodeChange(trx, { companyId: id, newCode: codeChangedTo, actorId: req.user.id })
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'company.update',
      targetType: 'company', targetId: id,
      payload: body,
    })
    res.json({ ok: true })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// DELETE /api/companies/:id — 软停用（status=inactive），不能真删
r.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await db('companies').where({ id }).first()
    if (!existing) return res.status(404).json({ error: '公司不存在' })
    if (existing.status === 'inactive') return res.json({ ok: true })

    await db('companies').where({ id }).update({ status: 'inactive', updated_at: new Date() })
    await writeAudit({
      actorId: req.user.id, action: 'company.deactivate',
      targetType: 'company', targetId: id,
      payload: { name: existing.name },
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── v2.1+: 公司简称历史（仅 superadmin） ────────────────────────────────────
//
// GET /api/companies/:id/code-history
//   返回该公司用过的所有简称（按时间倒序）；当前在用的 valid_until=null
r.get('/:id/code-history', async (req, res, next) => {
  try {
    const co = await db('companies').where({ id: req.params.id }).first()
    if (!co) return res.status(404).json({ error: '公司不存在' })

    const rows = await db('company_code_history as h')
      .leftJoin('users as u', 'h.changed_by', 'u.id')
      .where('h.company_id', req.params.id)
      .select(
        'h.id', 'h.code', 'h.valid_from', 'h.valid_until',
        'u.username as changed_by_username', 'u.display_name as changed_by_display_name',
      )
      .orderBy('h.valid_from', 'desc')

    res.json({
      currentCode: co.code || null,
      history: rows.map(h => ({
        id: h.id,
        code: h.code,
        validFrom: h.valid_from instanceof Date ? h.valid_from.toISOString() : h.valid_from,
        validUntil: h.valid_until instanceof Date ? h.valid_until.toISOString() : h.valid_until,
        isCurrent: h.valid_until === null,
        changedByUsername: h.changed_by_username || null,
        changedByDisplayName: h.changed_by_display_name || null,
      })),
    })
  } catch (e) { next(e) }
})

// ─── v2.1+: 公司角色管理（仅 superadmin） ────────────────────────────────────
//
// 路由：
//   GET    /api/companies/:id/roles          列表（含 memberCount / templateRefCount）
//   POST   /api/companies/:id/roles          新建自定义角色（key 由系统自动生成）
//   PATCH  /api/companies/:id/roles/:rid     改名 / 改开关
//                                            （系统角色 is_system=true 只能改开关，不能改名）
//   DELETE /api/companies/:id/roles/:rid     删除（系统角色拒删；有人/模板在用也拒删）

function roleRowToJSON(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    key: row.key,
    name: row.name,
    canViewAllContracts: !!row.can_view_all_contracts,
    isSystem: !!row.is_system,
    sortOrder: row.sort_order,
    memberCount: row.member_count != null ? Number(row.member_count) : 0,
    templateRefCount: row.template_ref_count != null ? Number(row.template_ref_count) : 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}

// GET /api/companies/:id/roles
r.get('/:id/roles', async (req, res, next) => {
  try {
    const co = await db('companies').where({ id: req.params.id }).first()
    if (!co) return res.status(404).json({ error: '公司不存在' })

    const rows = await db('company_roles as cr')
      .select([
        'cr.*',
        db.raw(`(SELECT count(DISTINCT user_id) FROM user_company_roles
                 WHERE company_id = cr.company_id AND role = cr.key) AS member_count`),
        db.raw(`(SELECT count(*) FROM approval_template_steps
                 WHERE company_id = cr.company_id AND role = cr.key) AS template_ref_count`),
      ])
      .where('cr.company_id', req.params.id)
      .orderBy([
        { column: 'cr.is_system', order: 'desc' },
        { column: 'cr.sort_order', order: 'asc' },
        { column: 'cr.created_at', order: 'asc' },
      ])
    res.json({ roles: rows.map(roleRowToJSON) })
  } catch (e) { next(e) }
})

// POST /api/companies/:id/roles  body: { name, canViewAllContracts? }
r.post('/:id/roles', async (req, res, next) => {
  try {
    const co = await db('companies').where({ id: req.params.id }).first()
    if (!co) return res.status(404).json({ error: '公司不存在' })

    const { name, canViewAllContracts } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写角色名称' })
    const trimmedName = String(name).trim().slice(0, 50)

    // 同公司角色名不能重名（包括系统角色）
    const dup = await db('company_roles').where({ company_id: req.params.id, name: trimmedName }).first()
    if (dup) return res.status(409).json({ error: '该角色名称已存在' })

    // 自动生成 key（8 位 hex），重试到唯一
    let key = null
    for (let i = 0; i < 5; i++) {
      const candidate = `role_${crypto.randomBytes(4).toString('hex')}`
      const exists = await db('company_roles').where({ company_id: req.params.id, key: candidate }).first()
      if (!exists) { key = candidate; break }
    }
    if (!key) return res.status(500).json({ error: '生成角色 key 失败，请重试' })

    const { max } = await db('company_roles').max({ max: 'sort_order' })
      .where({ company_id: req.params.id }).first()
    const sortOrder = (Number(max) || 0) + 10

    const [created] = await db('company_roles').insert({
      company_id: req.params.id,
      key,
      name: trimmedName,
      can_view_all_contracts: !!canViewAllContracts,
      is_system: false,
      sort_order: sortOrder,
    }, ['id'])

    await writeAudit({
      actorId: req.user.id, action: 'company_role.create',
      targetType: 'company_role', targetId: created.id,
      payload: { companyId: req.params.id, key, name: trimmedName, canViewAllContracts: !!canViewAllContracts },
      companyId: req.params.id,
    })
    res.status(201).json({ roleId: created.id, key })
  } catch (e) { next(e) }
})

// PATCH /api/companies/:id/roles/:rid  body: { name?, canViewAllContracts? }
r.patch('/:id/roles/:rid', async (req, res, next) => {
  try {
    const existing = await db('company_roles')
      .where({ id: req.params.rid, company_id: req.params.id }).first()
    if (!existing) return res.status(404).json({ error: '角色不存在' })

    const { name, canViewAllContracts } = req.body || {}
    const update = { updated_at: new Date() }

    if (name !== undefined) {
      if (existing.is_system) {
        return res.status(400).json({ error: '系统内置角色的名称不能修改' })
      }
      const trimmed = String(name).trim().slice(0, 50)
      if (!trimmed) return res.status(400).json({ error: '角色名称不能为空' })
      const dup = await db('company_roles')
        .where({ company_id: req.params.id, name: trimmed })
        .whereNot('id', existing.id)
        .first()
      if (dup) return res.status(409).json({ error: '该角色名称已存在' })
      update.name = trimmed
    }
    if (canViewAllContracts !== undefined) {
      update.can_view_all_contracts = !!canViewAllContracts
    }

    if (Object.keys(update).length === 1) {
      return res.status(400).json({ error: '没有要更新的字段' })
    }

    await db('company_roles').where({ id: existing.id }).update(update)
    await writeAudit({
      actorId: req.user.id, action: 'company_role.update',
      targetType: 'company_role', targetId: existing.id,
      payload: { companyId: req.params.id, ...update },
      companyId: req.params.id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// DELETE /api/companies/:id/roles/:rid
//   v2.1+: 自定义角色允许删，删除时级联清理：
//     1. 用该角色的账号 → 转为"普通员工(staff)"（已有 staff 则直接去掉该自定义角色关联）
//     2. 审批流模板里引用该角色的步骤 → 删除；剩余步骤重排 step_index；模板被删空则停用
//     3. 删角色本身
//   系统内置 5 个角色仍不允许删。
r.delete('/:id/roles/:rid', async (req, res, next) => {
  try {
    const companyId = req.params.id
    const existing = await db('company_roles')
      .where({ id: req.params.rid, company_id: companyId }).first()
    if (!existing) return res.status(404).json({ error: '角色不存在' })
    if (existing.is_system) {
      return res.status(400).json({ error: '系统内置角色不能删除' })
    }

    const summary = await db.transaction(async (trx) => {
      // 1) 账号转 staff —— 找出在用该角色的用户
      const holders = await trx('user_company_roles')
        .where({ company_id: companyId, role: existing.key })
        .select('id', 'user_id')
      let convertedToStaff = 0
      for (const h of holders) {
        // 该用户在本公司是否已经有 staff 角色？
        const hasStaff = await trx('user_company_roles')
          .where({ company_id: companyId, user_id: h.user_id, role: 'staff' })
          .first()
        if (hasStaff) {
          // 已有 staff → 直接删掉这条自定义角色关联，避免唯一约束冲突
          await trx('user_company_roles').where({ id: h.id }).delete()
        } else {
          // 没有 staff → 把这条关联改成 staff
          await trx('user_company_roles').where({ id: h.id }).update({ role: 'staff' })
          convertedToStaff++
        }
      }

      // 2) 删审批模板里引用该角色的步骤
      const affectedSteps = await trx('approval_template_steps')
        .where({ company_id: companyId, role: existing.key })
        .select('id', 'template_id')
      const affectedTemplateIds = [...new Set(affectedSteps.map(s => s.template_id))]
      if (affectedSteps.length > 0) {
        await trx('approval_template_steps')
          .whereIn('id', affectedSteps.map(s => s.id))
          .delete()
      }
      // 对受影响的模板：重排剩余步骤 step_index 为 1..M；若空则停用
      let emptiedTemplates = 0
      for (const tid of affectedTemplateIds) {
        const remaining = await trx('approval_template_steps')
          .where({ template_id: tid })
          .orderBy('step_index', 'asc')
        if (remaining.length === 0) {
          await trx('approval_templates').where({ id: tid }).update({ is_active: false, updated_at: new Date() })
          emptiedTemplates++
        } else {
          // 先挪到高位避免唯一约束冲突，再依次落位（step_index 唯一索引）
          for (let i = 0; i < remaining.length; i++) {
            await trx('approval_template_steps').where({ id: remaining[i].id }).update({ step_index: 1000 + i })
          }
          for (let i = 0; i < remaining.length; i++) {
            await trx('approval_template_steps').where({ id: remaining[i].id }).update({ step_index: i + 1 })
          }
        }
      }

      // 3) 删角色（此时已无 user_company_roles / approval_template_steps 引用，FK 不再阻挡）
      await trx('company_roles').where({ id: existing.id }).delete()

      return {
        convertedToStaff,
        removedFromUsers: holders.length,
        removedTemplateSteps: affectedSteps.length,
        emptiedTemplates,
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'company_role.delete',
      targetType: 'company_role', targetId: existing.id,
      payload: { companyId, key: existing.key, name: existing.name, ...summary },
      companyId,
    })
    res.json({ ok: true, ...summary })
  } catch (e) { next(e) }
})

// ─── v2.1: 审批流模板（仅 superadmin） ───────────────────────────────────────
//
// 路由：
//   GET    /api/companies/:id/approval-templates           列表（含步骤）
//   POST   /api/companies/:id/approval-templates           新建
//   PUT    /api/companies/:id/approval-templates/:tid      编辑（名称+步骤全量替换）
//   PATCH  /api/companies/:id/approval-templates/:tid/activate  启用并停用其他
//   DELETE /api/companies/:id/approval-templates/:tid      删除（active / 仅剩一个 / 公司有进行中审批 → 拒）

function templateToJSON(row, steps, roleNameByKey) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    isActive: !!row.is_active,
    createdBy: row.created_by || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    steps: (steps || []).map((s) => ({
      id: s.id,
      stepIndex: s.step_index,
      role: s.role,
      roleName: roleNameByKey ? (roleNameByKey.get(s.role) || s.role) : s.role,
      stepLabel: s.step_label || null,
    })),
  }
}

// 校验模板步骤的 role —— role 必须存在于该公司的 company_roles 中且不是 'staff'
// （员工是经办人首尾固定节点，模板不该包含）
async function normalizeSteps(rawSteps, companyId) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw Object.assign(new Error('请至少添加一个审批步骤'), { status: 400 })
  }
  const companyRoles = await db('company_roles')
    .where({ company_id: companyId })
    .select('key', 'name')
  const validKeys = new Set(companyRoles.map(r => r.key))
  validKeys.delete('staff') // 员工不能作为审批步骤

  return rawSteps.map((s, i) => {
    const role = String(s?.role || '').trim()
    if (!validKeys.has(role)) {
      throw Object.assign(new Error(
        `第 ${i + 1} 个步骤角色无效：必须是本公司已配置的非"普通员工"角色`
      ), { status: 400 })
    }
    const stepLabel = s?.stepLabel ? String(s.stepLabel).trim().slice(0, 100) : null
    return { stepIndex: i + 1, role, stepLabel }
  })
}

async function ensureCompany(companyId) {
  const co = await db('companies').where({ id: companyId }).first()
  if (!co) {
    throw Object.assign(new Error('公司不存在'), { status: 404 })
  }
  return co
}

// GET /api/companies/:id/approval-templates
r.get('/:id/approval-templates', async (req, res, next) => {
  try {
    await ensureCompany(req.params.id)
    const templates = await db('approval_templates')
      .where({ company_id: req.params.id })
      .orderBy([
        { column: 'is_active', order: 'desc' },
        { column: 'created_at', order: 'asc' },
      ])
    const ids = templates.map(t => t.id)
    let stepsAll = []
    if (ids.length > 0) {
      stepsAll = await db('approval_template_steps')
        .whereIn('template_id', ids)
        .orderBy('step_index', 'asc')
    }
    const stepsByTemplate = new Map()
    for (const s of stepsAll) {
      if (!stepsByTemplate.has(s.template_id)) stepsByTemplate.set(s.template_id, [])
      stepsByTemplate.get(s.template_id).push(s)
    }
    // 公司角色 key → name 映射（用于前端显示步骤角色中文名）
    const companyRoles = await db('company_roles')
      .where({ company_id: req.params.id })
      .select('key', 'name')
    const roleNameByKey = new Map(companyRoles.map(r => [r.key, r.name]))
    res.json({
      templates: templates.map(t => templateToJSON(t, stepsByTemplate.get(t.id) || [], roleNameByKey)),
    })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// POST /api/companies/:id/approval-templates
//   body: { name, steps: [{ role, stepLabel? }], isActive? }
r.post('/:id/approval-templates', async (req, res, next) => {
  try {
    await ensureCompany(req.params.id)
    const { name, steps, isActive } = req.body || {}
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '请填写模板名称' })
    }
    const normalizedSteps = await normalizeSteps(steps, req.params.id)

    const templateId = await db.transaction(async (trx) => {
      if (isActive) {
        await trx('approval_templates')
          .where({ company_id: req.params.id, is_active: true })
          .update({ is_active: false, updated_at: new Date() })
      }
      const [created] = await trx('approval_templates').insert({
        company_id: req.params.id,
        name: String(name).trim().slice(0, 100),
        is_active: !!isActive,
        created_by: req.user.id,
      }, ['id'])
      const rows = normalizedSteps.map((s) => ({
        template_id: created.id,
        company_id: req.params.id,
        step_index: s.stepIndex,
        role: s.role,
        step_label: s.stepLabel,
      }))
      await trx('approval_template_steps').insert(rows)
      return created.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval_template.create',
      targetType: 'approval_template', targetId: templateId,
      payload: { companyId: req.params.id, name, stepsCount: normalizedSteps.length, isActive: !!isActive },
      companyId: req.params.id,
    })
    res.status(201).json({ templateId })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// PUT /api/companies/:id/approval-templates/:tid
//   body: { name?, steps? }
r.put('/:id/approval-templates/:tid', async (req, res, next) => {
  try {
    await ensureCompany(req.params.id)
    const existing = await db('approval_templates')
      .where({ id: req.params.tid, company_id: req.params.id })
      .first()
    if (!existing) return res.status(404).json({ error: '模板不存在' })

    const { name, steps } = req.body || {}
    let normalizedSteps = null
    if (steps !== undefined) normalizedSteps = await normalizeSteps(steps, req.params.id)
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: '模板名称不能为空' })
    }

    await db.transaction(async (trx) => {
      const update = { updated_at: new Date() }
      if (name !== undefined) update.name = String(name).trim().slice(0, 100)
      await trx('approval_templates').where({ id: existing.id }).update(update)

      if (normalizedSteps) {
        await trx('approval_template_steps').where({ template_id: existing.id }).delete()
        const rows = normalizedSteps.map((s) => ({
          template_id: existing.id,
          company_id: req.params.id,
          step_index: s.stepIndex,
          role: s.role,
          step_label: s.stepLabel,
        }))
        await trx('approval_template_steps').insert(rows)
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval_template.update',
      targetType: 'approval_template', targetId: existing.id,
      payload: {
        companyId: req.params.id,
        nameChanged: name !== undefined,
        stepsChanged: normalizedSteps !== null,
      },
      companyId: req.params.id,
    })
    res.json({ ok: true })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// PATCH /api/companies/:id/approval-templates/:tid/activate — 启用并停用其他
r.patch('/:id/approval-templates/:tid/activate', async (req, res, next) => {
  try {
    await ensureCompany(req.params.id)
    const existing = await db('approval_templates')
      .where({ id: req.params.tid, company_id: req.params.id })
      .first()
    if (!existing) return res.status(404).json({ error: '模板不存在' })

    await db.transaction(async (trx) => {
      await trx('approval_templates')
        .where({ company_id: req.params.id, is_active: true })
        .whereNot('id', existing.id)
        .update({ is_active: false, updated_at: new Date() })
      await trx('approval_templates')
        .where({ id: existing.id })
        .update({ is_active: true, updated_at: new Date() })
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval_template.activate',
      targetType: 'approval_template', targetId: existing.id,
      payload: { companyId: req.params.id, name: existing.name },
      companyId: req.params.id,
    })
    res.json({ ok: true })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// DELETE /api/companies/:id/approval-templates/:tid
//   规则：
//     1. 公司只剩 1 个模板 → 不允许删
//     2. 公司有进行中审批（status='pending'）→ 不允许删
//        （进行中审批本身不依赖模板，但保留此约束避免误删导致重启时无可用模板）
r.delete('/:id/approval-templates/:tid', async (req, res, next) => {
  try {
    await ensureCompany(req.params.id)
    const existing = await db('approval_templates')
      .where({ id: req.params.tid, company_id: req.params.id })
      .first()
    if (!existing) return res.status(404).json({ error: '模板不存在' })

    const { count: total } = await db('approval_templates')
      .where({ company_id: req.params.id })
      .count({ count: '*' })
      .first()
    if (Number(total) <= 1) {
      return res.status(400).json({ error: '该公司只剩一个模板，删除后将无法发起新审批，请先新增其他模板' })
    }

    const { count: activeCount } = await db('approvals')
      .where({ company_id: req.params.id, status: 'pending' })
      .count({ count: '*' })
      .first()
    if (Number(activeCount) > 0) {
      return res.status(400).json({
        error: '该公司有进行中的审批，暂不允许删除模板，请等待审批走完或先驳回到经办人',
      })
    }

    await db('approval_templates').where({ id: existing.id }).delete()
    await writeAudit({
      actorId: req.user.id, action: 'approval_template.delete',
      targetType: 'approval_template', targetId: existing.id,
      payload: { companyId: req.params.id, name: existing.name },
      companyId: req.params.id,
    })
    res.json({ ok: true })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

export default r
