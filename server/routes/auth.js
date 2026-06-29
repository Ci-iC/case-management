import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { db, writeAudit } from '../db.js'
import { signToken, requireAuth } from '../auth.js'

const r = Router()

// v1.3.2: 登录限流，防暴力破解。同 IP 15 分钟内最多 10 次。
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
})

// v2.0: 工具 — 取用户在所有 active 公司的角色聚合
//   返回 [{ companyId, companyName, companyCode, roles: ['manager', 'legal', ...] }, ...]
async function loadUserCompanies(userId) {
  const rows = await db('user_company_roles as ucr')
    .innerJoin('companies as c', 'ucr.company_id', 'c.id')
    .select(
      'ucr.company_id',
      'c.name as company_name',
      'c.code as company_code',
      'c.status as company_status',
      'ucr.role',
    )
    .where('ucr.user_id', userId)
    .where('c.status', 'active')

  // 聚合 role
  const byCompany = new Map()
  for (const row of rows) {
    const key = row.company_id
    if (!byCompany.has(key)) {
      byCompany.set(key, {
        companyId: row.company_id,
        companyName: row.company_name,
        companyCode: row.company_code || null,
        roles: [],
      })
    }
    byCompany.get(key).roles.push(row.role)
  }
  return [...byCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'zh-CN'))
}

// POST /api/auth/login
//
// 登录流程（v2.0）：
//   1) 用户名 + 密码校验通过
//   2) increment token_version
//   3) 查 user 关联的所有 active 公司及角色
//   4) 分支：
//      - role=superadmin → token 不带 cc（平台超管），companies 列表也返回（用于"以平台身份只读查看公司数据"，超管不归属公司）
//      - 普通用户：
//          a) 没有任何 active 公司角色 → 401（"您未被分配任何公司，请联系平台管理员"）
//          b) 只有 1 家公司 → token 自动带 cc=该公司，前端直接进
//          c) 多家公司 → token 不带 cc，前端进入"选公司"页，选完调 switch-company 重签
r.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' })

    const row = await db('users')
      .select('id', 'username', 'password_hash', 'role', 'display_name', 'token_version', 'must_change_password', 'created_at',
        'notification_email', 'email_notify_enabled', 'email_feature_notice_seen')
      .where({ username })
      .whereNull('deleted_at')
      .first()
    if (!row) return res.status(401).json({ error: '账号或密码错误' })

    if (!bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: '账号或密码错误' })
    }

    const newTokenVersion = (row.token_version || 1) + 1
    await db('users').where({ id: row.id }).update({ token_version: newTokenVersion })

    const companies = await loadUserCompanies(row.id)

    let currentCompanyId = null
    if (row.role === 'superadmin') {
      // 平台超管不归属公司，token 不带 cc
      currentCompanyId = null
    } else {
      if (companies.length === 0) {
        return res.status(403).json({
          error: '您未被分配任何公司，请联系平台管理员',
          unassigned: true,
        })
      } else if (companies.length === 1) {
        currentCompanyId = companies[0].companyId
      } else {
        // 多公司，前端选公司
        currentCompanyId = null
      }
    }

    const userPayload = {
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name,
      mustChangePassword: !!row.must_change_password,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      companies,
      currentCompanyId,
      currentCompany: currentCompanyId ? companies.find(c => c.companyId === currentCompanyId) || null : null,
      isAllCompaniesView: false,
      // 邮件通知（首登介绍弹窗依赖 emailFeatureNoticeSeen）
      notificationEmail: row.notification_email || null,
      emailNotifyEnabled: row.email_notify_enabled !== false,
      emailFeatureNoticeSeen: !!row.email_feature_notice_seen,
    }
    const token = signToken({ id: row.id, username: row.username, role: row.role }, newTokenVersion, currentCompanyId)
    await writeAudit({ actorId: userPayload.id, action: 'auth.login', targetType: 'user', targetId: userPayload.id })
    res.json({ token, user: userPayload })
  } catch (e) { next(e) }
})

// GET /api/auth/me — 返回当前用户 + companies + currentCompany
r.get('/me', requireAuth, async (req, res, next) => {
  try {
    const companies = await loadUserCompanies(req.user.id)
    const currentCompany = req.user.currentCompanyId
      ? companies.find(c => c.companyId === req.user.currentCompanyId) || null
      : null
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        displayName: req.user.displayName,
        mustChangePassword: req.user.mustChangePassword,
        createdAt: req.user.createdAt,
        companies,
        currentCompanyId: req.user.currentCompanyId,
        currentCompany,
        companyRoles: req.user.companyRoles,
        isAllCompaniesView: req.user.isAllCompaniesView,
        // 邮件通知（个人设置 + 首登介绍弹窗）
        notificationEmail: req.user.notificationEmail,
        emailNotifyEnabled: req.user.emailNotifyEnabled,
        emailFeatureNoticeSeen: req.user.emailFeatureNoticeSeen,
      },
    })
  } catch (e) { next(e) }
})

// PATCH /api/auth/me — 用户自助更新个人设置（通知邮箱 + 个人邮件通知开关）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
r.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const update = {}
    if ('notificationEmail' in (req.body || {})) {
      const raw = req.body.notificationEmail
      const email = typeof raw === 'string' ? raw.trim() : ''
      if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: '邮箱格式不正确' })
      if (email.length > 254) return res.status(400).json({ error: '邮箱过长' })
      update.notification_email = email || null
    }
    if ('emailNotifyEnabled' in (req.body || {})) {
      update.email_notify_enabled = !!req.body.emailNotifyEnabled
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' })
    }
    await db('users').where({ id: req.user.id }).update(update)
    const row = await db('users')
      .select('notification_email', 'email_notify_enabled')
      .where({ id: req.user.id }).first()
    res.json({
      notificationEmail: row.notification_email || null,
      emailNotifyEnabled: row.email_notify_enabled !== false,
    })
  } catch (e) { next(e) }
})

// POST /api/auth/dismiss-email-notice — 标记"邮件通知功能介绍弹窗"已看过（首登只弹一次）
r.post('/dismiss-email-notice', requireAuth, async (req, res, next) => {
  try {
    await db('users').where({ id: req.user.id }).update({ email_feature_notice_seen: true })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// GET /api/auth/companies — 用户当前可选公司列表（用于"选公司"页 + 顶部切换器）
r.get('/companies', requireAuth, async (req, res, next) => {
  try {
    if (req.user.isSuperAdmin) {
      // 超管能看所有 active 公司（用于"以只读身份切换查看"）
      const rows = await db('companies')
        .select('id as companyId', 'name as companyName', 'code as companyCode')
        .where('status', 'active')
        .orderBy('name', 'asc')
      return res.json({ companies: rows.map(r => ({ ...r, roles: ['superadmin_readonly'] })) })
    }
    const companies = await loadUserCompanies(req.user.id)
    res.json({ companies })
  } catch (e) { next(e) }
})

// POST /api/auth/switch-company — 切换当前公司，重签 token
//   body: { companyId: string | 'ALL' }
//   'ALL' 仅允许：用户在 ≥2 家公司是 manager 角色（manager 多公司汇总视图）
r.post('/switch-company', requireAuth, async (req, res, next) => {
  try {
    const { companyId } = req.body || {}
    if (!companyId) return res.status(400).json({ error: '请选择公司' })

    if (req.user.isSuperAdmin) {
      // 超管不应该切公司（超管不归属公司）；但为了让超管能"以只读视角观察某公司"，允许带 cc
      const co = await db('companies').where({ id: companyId, status: 'active' }).first()
      if (!co) return res.status(404).json({ error: '公司不存在或已停用' })
      const token = signToken({ id: req.user.id, username: req.user.username, role: req.user.role }, await getCurrentTV(req.user.id), companyId)
      return res.json({ token })
    }

    if (companyId === 'ALL') {
      // 必须在 ≥2 家公司是 manager 角色
      const managerCompanies = await db('user_company_roles as ucr')
        .innerJoin('companies as c', 'ucr.company_id', 'c.id')
        .where('ucr.user_id', req.user.id)
        .where('ucr.role', 'manager')
        .where('c.status', 'active')
        .countDistinct({ n: 'ucr.company_id' })
        .first()
      if (!managerCompanies || Number(managerCompanies.n) < 2) {
        return res.status(403).json({ error: '仅在 2 家及以上公司担任企业管理人员的用户可进入"全部公司"视图' })
      }
      const token = signToken({ id: req.user.id, username: req.user.username, role: req.user.role }, await getCurrentTV(req.user.id), 'ALL')
      return res.json({ token })
    }

    // 单公司切换：校验该公司用户有角色 + active
    const co = await db('companies').where({ id: companyId, status: 'active' }).first()
    if (!co) return res.status(404).json({ error: '公司不存在或已停用' })
    const roles = await db('user_company_roles')
      .where({ user_id: req.user.id, company_id: companyId })
      .pluck('role')
    if (roles.length === 0) return res.status(403).json({ error: '您在该公司没有任何角色' })

    const token = signToken(
      { id: req.user.id, username: req.user.username, role: req.user.role },
      await getCurrentTV(req.user.id),
      companyId,
    )
    res.json({ token })
  } catch (e) { next(e) }
})

async function getCurrentTV(userId) {
  // 切公司不改 token_version（不算"新登录"，避免踢其他设备）
  const row = await db('users').select('token_version').where({ id: userId }).first()
  return row?.token_version || 1
}

// POST /api/auth/change-password
// v1.4: 成功后 must_change_password=false + token_version+1（踢其他设备）+ 重签新 token 返回（保留当前公司选择）
r.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {}
    if (!currentPassword || !newPassword) return res.status(400).json({ error: '请输入当前密码和新密码' })
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })
    if (typeof confirmPassword === 'string' && confirmPassword !== newPassword) {
      return res.status(400).json({ error: '两次输入的新密码不一致' })
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: '新密码不能与当前密码相同' })
    }

    const row = await db('users')
      .select('password_hash', 'token_version', 'username', 'role', 'display_name', 'created_at')
      .where({ id: req.user.id }).first()
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(400).json({ error: '当前密码错误' })
    }
    const hash = bcrypt.hashSync(newPassword, 10)
    const newTokenVersion = (row.token_version || 1) + 1
    await db('users').where({ id: req.user.id }).update({
      password_hash: hash,
      must_change_password: false,
      token_version: newTokenVersion,
    })
    await writeAudit({ actorId: req.user.id, action: 'auth.change_password', targetType: 'user', targetId: req.user.id })

    const companies = await loadUserCompanies(req.user.id)
    const userPayload = {
      id: req.user.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name,
      mustChangePassword: false,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      companies,
      currentCompanyId: req.user.currentCompanyId,
      currentCompany: req.user.currentCompanyId
        ? companies.find(c => c.companyId === req.user.currentCompanyId) || null : null,
      isAllCompaniesView: req.user.isAllCompaniesView,
      notificationEmail: req.user.notificationEmail,
      emailNotifyEnabled: req.user.emailNotifyEnabled,
      emailFeatureNoticeSeen: req.user.emailFeatureNoticeSeen,
    }
    const token = signToken(
      { id: req.user.id, username: row.username, role: row.role },
      newTokenVersion,
      req.user.isAllCompaniesView ? 'ALL' : req.user.currentCompanyId,
    )
    res.json({ ok: true, token, user: userPayload })
  } catch (e) { next(e) }
})

export default r
