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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdBy: row.created_by,
  }
}

// GET /api/users — admin only
r.get('/', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await db('users')
      .select('id', 'username', 'role', 'display_name', 'created_at', 'created_by')
      .orderBy('created_at', 'desc')
    res.json({ users: rows.map(rowToUser) })
  } catch (e) { next(e) }
})

// POST /api/users — admin only
r.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role, displayName } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' })
    if (username.length < 2 || username.length > 32) return res.status(400).json({ error: '账号长度应为 2-32 个字符' })
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' })
    const normalizedRole = role === 'admin' ? 'admin' : 'user'

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
      created_at: new Date(),
      created_by: req.user.id,
    })

    const created = await db('users')
      .select('id', 'username', 'role', 'display_name', 'created_at', 'created_by')
      .where({ id }).first()

    await writeAudit({
      actorId: req.user.id, action: 'user.create',
      targetType: 'user', targetId: id,
      payload: { username, role: normalizedRole },
    })
    res.status(201).json({ user: rowToUser(created) })
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
