import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, cryptoId, writeAudit } from '../db.js'
import { requireAuth, requireAdmin } from '../auth.js'

const r = Router()

function rowToUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    canViewCases: !!row.can_view_cases,
    canViewContracts: !!row.can_view_contracts,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdBy: row.created_by,
  }
}

// GET /api/users/contacts — 任何登录用户都能调，用于选收件人（仅基本字段，不含权限/创建人）
r.get('/contacts', requireAuth, async (req, res, next) => {
  try {
    const rows = await db('users')
      .select('id', 'username', 'display_name', 'role')
      .whereNot({ id: req.user.id })
      .orderBy('username', 'asc')
    res.json({
      contacts: rows.map(r => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        role: r.role,
      })),
    })
  } catch (e) { next(e) }
})

// GET /api/users — admin only
r.get('/', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await db('users')
      .select('id', 'username', 'role', 'display_name', 'can_view_cases', 'can_view_contracts', 'created_at', 'created_by')
      .orderBy('created_at', 'desc')
    res.json({ users: rows.map(rowToUser) })
  } catch (e) { next(e) }
})

// POST /api/users — admin only
r.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role, displayName, canViewCases, canViewContracts } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' })
    if (username.length < 2 || username.length > 32) return res.status(400).json({ error: '账号长度应为 2-32 个字符' })
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' })
    const normalizedRole = role === 'admin' ? 'admin' : 'user'
    // admin 自动有所有管理权限；普通用户由 admin 创建时勾选
    const normalizedCanViewCases = normalizedRole === 'admin' ? true : !!canViewCases
    const normalizedCanViewContracts = normalizedRole === 'admin' ? true : !!canViewContracts

    const exists = await db('users').select('id').where({ username }).first()
    if (exists) return res.status(409).json({ error: '该账号已存在' })

    const id = cryptoId()
    const hash = bcrypt.hashSync(password, 10)
    await db('users').insert({
      id,
      username,
      password_hash: hash,
      role: normalizedRole,
      display_name: displayName || null,
      can_view_cases: normalizedCanViewCases,
      can_view_contracts: normalizedCanViewContracts,
      created_at: new Date(),
      created_by: req.user.id,
    })

    const created = await db('users')
      .select('id', 'username', 'role', 'display_name', 'can_view_cases', 'can_view_contracts', 'created_at', 'created_by')
      .where({ id }).first()

    await writeAudit({
      actorId: req.user.id, action: 'user.create',
      targetType: 'user', targetId: id,
      payload: { username, role: normalizedRole, canViewCases: normalizedCanViewCases, canViewContracts: normalizedCanViewContracts },
    })
    res.status(201).json({ user: rowToUser(created) })
  } catch (e) { next(e) }
})

// PATCH /api/users/:id — admin only：支持改 canViewCases / canViewContracts
r.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const body = req.body || {}
    const update = {}
    if (typeof body.canViewCases === 'boolean') update.can_view_cases = body.canViewCases
    if (typeof body.canViewContracts === 'boolean') update.can_view_contracts = body.canViewContracts
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: '请提供 canViewCases 或 canViewContracts (boolean)' })
    }

    const target = await db('users').select('id', 'role').where({ id }).first()
    if (!target) return res.status(404).json({ error: '用户不存在' })
    // admin 强制保留权限，避免误关
    if (target.role === 'admin') {
      if (update.can_view_cases === false) return res.status(400).json({ error: '管理员的案件管理权限不可关闭' })
      if (update.can_view_contracts === false) return res.status(400).json({ error: '管理员的合同台账权限不可关闭' })
    }

    await db('users').where({ id }).update(update)
    const updated = await db('users')
      .select('id', 'username', 'role', 'display_name', 'can_view_cases', 'can_view_contracts', 'created_at', 'created_by')
      .where({ id }).first()

    await writeAudit({
      actorId: req.user.id, action: 'user.update_permission',
      targetType: 'user', targetId: id,
      payload: body,
    })
    res.json({ user: rowToUser(updated) })
  } catch (e) { next(e) }
})

// DELETE /api/users/:id — admin only
r.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    if (id === req.user.id) return res.status(400).json({ error: '不能删除自己的账号' })

    const target = await db('users').select('role', 'username').where({ id }).first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    if (target.role === 'admin') {
      const { count } = await db('users').count({ count: '*' }).where({ role: 'admin' }).first()
      if (Number(count) <= 1) return res.status(400).json({ error: '系统必须保留至少一个管理员' })
    }

    await db('users').where({ id }).delete()
    await writeAudit({
      actorId: req.user.id, action: 'user.delete',
      targetType: 'user', targetId: id,
      payload: { username: target.username, role: target.role },
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// POST /api/users/:id/reset-password — admin only
r.post('/:id/reset-password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body || {}
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })

    const target = await db('users').select('id').where({ id }).first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    const hash = bcrypt.hashSync(newPassword, 10)
    await db('users').where({ id }).update({ password_hash: hash })
    await writeAudit({
      actorId: req.user.id, action: 'user.reset_password',
      targetType: 'user', targetId: id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default r
