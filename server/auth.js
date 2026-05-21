import jwt from 'jsonwebtoken'
import { db } from './db.js'

// v1.3.2 安全加固：JWT_SECRET 必须由环境变量提供，且不能是历史默认值
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET === 'dev-secret-change-me' || JWT_SECRET === 'change-me-to-a-long-random-string') {
  throw new Error('JWT_SECRET is required (set a long random value in .env, do not use the placeholder)')
}
const TOKEN_TTL = '1d'

/** 三层角色：superadmin > admin > user
 *  - superadmin：系统管理员（改设置、增删账号、管审核模型）
 *  - admin：法务（看全部台账、上传修订版、接收业务发的审核）
 *  - user：业务人员（按 can_view_cases / can_view_contracts 看自己的）
 */
export function isSuperAdmin(user) {
  return user?.role === 'superadmin'
}
export function isAdminOrAbove(user) {
  return user?.role === 'admin' || user?.role === 'superadmin'
}

/** 签 token：payload 带 tv（token_version），用于单设备登录踢人 */
export function signToken(user, tokenVersion) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, tv: tokenVersion },
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

/** Express middleware: extracts Bearer token and attaches req.user.
 *  v1.2 起：除了验签，还要校验 token 里的 tv 等于 users.token_version。
 *  不匹配 → 旧设备被新设备顶掉了 → 401 + sessionRevoked，前端据此自动登出 + 提示
 */
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || ''
    const m = h.match(/^Bearer\s+(.+)$/i)
    if (!m) return res.status(401).json({ error: '未登录' })
    const payload = verifyToken(m[1])
    if (!payload) return res.status(401).json({ error: '登录已过期，请重新登录' })

    const user = await db('users')
      .select('id', 'username', 'role', 'display_name', 'can_view_cases', 'can_view_contracts', 'token_version', 'created_at')
      .where({ id: payload.sub })
      .whereNull('deleted_at')  // v1.3.2: 已软删除的用户即便 token 未过期也不能继续使用
      .first()
    if (!user) return res.status(401).json({ error: '用户不存在或已被删除' })

    // 单设备登录：token 的 tv 必须等于 DB 当前 token_version
    // 不带 tv 的旧 token（升级前签发）也按踢下处理，强制重新登录
    if (typeof payload.tv !== 'number' || payload.tv !== user.token_version) {
      return res.status(401).json({
        error: '您的账号已在其他设备登录，本设备已自动退出。如果不是您本人操作，请立即修改密码。',
        sessionRevoked: true,
      })
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      canViewCases: !!user.can_view_cases,
      canViewContracts: !!user.can_view_contracts,
      createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
    }
    next()
  } catch (e) {
    next(e)
  }
}

/** 仅超级管理员（系统配置 / 账号管理） */
export function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '需要超级管理员权限' })
  next()
}

/** 管理员或以上（法务工作 + 看全部台账） */
export function requireAdminOrAbove(req, res, next) {
  if (!isAdminOrAbove(req.user)) return res.status(403).json({ error: '需要管理员权限' })
  next()
}

/** v1.1 兼容别名：保留 requireAdmin 给还没改过的接口 */
export const requireAdmin = requireAdminOrAbove

/** admin/superadmin 自动通过；其他用户看 can_view_cases。 */
export function requireCaseAccess(req, res, next) {
  if (isAdminOrAbove(req.user) || req.user?.canViewCases) return next()
  return res.status(403).json({ error: '无案件管理权限' })
}

/** admin/superadmin 自动通过；其他用户看 can_view_contracts。 */
export function requireContractAccess(req, res, next) {
  if (isAdminOrAbove(req.user) || req.user?.canViewContracts) return next()
  return res.status(403).json({ error: '无合同台账权限' })
}
