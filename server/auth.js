import jwt from 'jsonwebtoken'
import { db } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const TOKEN_TTL = '7d'

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

/** Express middleware: extracts Bearer token and attaches req.user. */
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || ''
    const m = h.match(/^Bearer\s+(.+)$/i)
    if (!m) return res.status(401).json({ error: '未登录' })
    const payload = verifyToken(m[1])
    if (!payload) return res.status(401).json({ error: '登录已过期，请重新登录' })

    const user = await db('users')
      .select('id', 'username', 'role', 'display_name', 'can_view_cases', 'created_at')
      .where({ id: payload.sub })
      .first()
    if (!user) return res.status(401).json({ error: '用户不存在' })

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      canViewCases: !!user.can_view_cases,
      createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
    }
    next()
  } catch (e) {
    next(e)
  }
}

/** Express middleware: must be admin (use after requireAuth). */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' })
  next()
}

/** admin 自动通过；其他用户看 can_view_cases。 */
export function requireCaseAccess(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.canViewCases) return next()
  return res.status(403).json({ error: '无案件管理权限' })
}
