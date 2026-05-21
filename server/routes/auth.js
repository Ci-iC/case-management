import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { db, writeAudit } from '../db.js'
import { signToken, requireAuth } from '../auth.js'

const r = Router()

// v1.3.2: 登录限流，防暴力破解。同 IP 15 分钟内最多 10 次。
//   命中限流后返回标准 429，前端不需要特殊处理（鉴权失败一样的提示即可）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
})

// POST /api/auth/login
r.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' })

    const row = await db('users')
      .select('id', 'username', 'password_hash', 'role', 'display_name', 'token_version', 'created_at')
      .where({ username })
      .whereNull('deleted_at')  // v1.3.2: 已删除的账号不能登录（即便用户名被复用，新账号是新行）
      .first()
    if (!row) return res.status(401).json({ error: '账号或密码错误' })

    if (!bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: '账号或密码错误' })
    }

    // v1.2 单设备登录：每次登录把 token_version 加 1，使该用户之前所有 token 失效
    const newTokenVersion = (row.token_version || 1) + 1
    await db('users').where({ id: row.id }).update({ token_version: newTokenVersion })

    const user = {
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }
    const token = signToken(user, newTokenVersion)
    await writeAudit({ actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id })
    res.json({ token, user })
  } catch (e) { next(e) }
})

// GET /api/auth/me
r.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

// POST /api/auth/change-password
r.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    if (!currentPassword || !newPassword) return res.status(400).json({ error: '请输入当前密码和新密码' })
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })

    const row = await db('users').select('password_hash').where({ id: req.user.id }).first()
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      return res.status(400).json({ error: '当前密码错误' })
    }
    const hash = bcrypt.hashSync(newPassword, 10)
    await db('users').where({ id: req.user.id }).update({ password_hash: hash })
    await writeAudit({ actorId: req.user.id, action: 'auth.change_password', targetType: 'user', targetId: req.user.id })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default r
