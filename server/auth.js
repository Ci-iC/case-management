import jwt from 'jsonwebtoken'
import { db } from './db.js'

// v1.3.2 安全加固：JWT_SECRET 必须由环境变量提供，且不能是历史默认值
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET === 'dev-secret-change-me' || JWT_SECRET === 'change-me-to-a-long-random-string') {
  throw new Error('JWT_SECRET is required (set a long random value in .env, do not use the placeholder)')
}
const TOKEN_TTL = '1d'
// "记住我"长效 token（可用 env 覆盖，如 '7d' / '90d'）
const REMEMBER_TOKEN_TTL = process.env.REMEMBER_TOKEN_TTL || '30d'

// v2.0: 平台层 vs 公司层
// 平台层角色（users.role）：
//   - superadmin：平台超管，不归属任何公司，做平台管理
//   - platform_user：普通平台用户，公司角色看 user_company_roles 关联表
// 公司层角色（user_company_roles.role）：
//   - manager（企业管理人员）
//   - legal（法务岗）
//   - seal_admin（印章管理岗）
//   - finance（财务人员）
//   - staff（普通员工）

export const COMPANY_ROLES = ['manager', 'legal', 'seal_admin', 'finance', 'staff']

export function isSuperAdmin(user) {
  return user?.role === 'superadmin'
}

/** 签 token。payload:
 *    sub: user.id, role: users.role (superadmin / platform_user),
 *    tv: token_version, cc: current_company_id (可选)
 *    rm: true 表示"记住我"长效会话（重签 token 的接口据此延续 30 天有效期）
 *  cc 为 null/undefined 时表示：
 *    - superadmin（不归属公司）
 *    - 多公司用户登录后还没选公司
 *    - manager 多公司用户切到"全部公司"视图（cc='ALL'）
 *  opts.remember=true → TTL 30 天 + payload 带 rm，否则维持 1 天
 */
export function signToken(user, tokenVersion, currentCompanyId, opts = {}) {
  const remember = !!opts.remember
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      tv: tokenVersion,
      cc: currentCompanyId ?? null,
      ...(remember ? { rm: true } : {}),
    },
    JWT_SECRET,
    { expiresIn: remember ? REMEMBER_TOKEN_TTL : TOKEN_TTL },
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

// v1.4: 用户 must_change_password=true 时，除以下白名单外其他请求一律 423，前端跳到改密页
const PWD_CHANGE_WHITELIST = [
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/companies',          // v2.0: 公司列表（用于"选公司"页，不影响安全）
  '/api/auth/switch-company',     // v2.0: 切换公司
]
function isPwdChangeWhitelisted(req) {
  const url = req.originalUrl || req.url || ''
  return PWD_CHANGE_WHITELIST.some((p) => url === p || url.startsWith(p + '?'))
}

/** Express middleware: extracts Bearer token and attaches req.user.
 *  v1.2 起：除了验签，还要校验 token 里的 tv 等于 users.token_version。
 *  不匹配 → 旧设备被新设备顶掉了 → 401 + sessionRevoked，前端据此自动登出 + 提示
 *  v1.4 起：用户 must_change_password=true 时，除白名单外返回 423 + mustChangePassword=true
 *  v2.0 起：req.user 上挂 currentCompanyId（可能为 null）+ companyRoles（数组，当前公司的角色列表）
 */
export async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || ''
    const m = h.match(/^Bearer\s+(.+)$/i)
    if (!m) return res.status(401).json({ error: '未登录' })
    const payload = verifyToken(m[1])
    if (!payload) return res.status(401).json({ error: '登录已过期，请重新登录' })
    // "记住我"会话标记：switch-company / change-password 重签 token 时据此延续长效 TTL
    req.tokenRemember = payload.rm === true

    const user = await db('users')
      .select('id', 'username', 'role', 'display_name', 'token_version', 'must_change_password', 'created_at',
        'notification_email', 'email_notify_enabled', 'email_feature_notice_seen')
      .where({ id: payload.sub })
      .whereNull('deleted_at')  // v1.3.2: 已软删除的用户即便 token 未过期也不能继续使用
      .first()
    if (!user) return res.status(401).json({ error: '用户不存在或已被删除' })

    // 单设备登录：token 的 tv 必须等于 DB 当前 token_version
    if (typeof payload.tv !== 'number' || payload.tv !== user.token_version) {
      return res.status(401).json({
        error: '您的账号已在其他设备登录，本设备已自动退出。如果不是您本人操作，请立即修改密码。',
        sessionRevoked: true,
      })
    }

    // v2.0: 解析 currentCompanyId + 该公司下的角色列表
    let currentCompanyId = null
    let companyRoles = []         // 当前公司下的角色（一个用户可能同时是 manager + legal）
    const isAllCompaniesView = payload.cc === 'ALL'  // manager 多公司用户的"全部公司"模式

    // v2.1+: 用户在当前公司是否能"看全部合同"（任意角色 can_view_all_contracts=true 则为 true）
    let canViewAllContracts = false

    if (user.role !== 'superadmin') {
      if (payload.cc && payload.cc !== 'ALL') {
        // 单公司模式：校验用户在该公司确实有角色，且公司是 active
        const company = await db('companies').where({ id: payload.cc }).first()
        if (!company) {
          return res.status(401).json({ error: '所选公司不存在或已删除', companyInvalid: true })
        }
        if (company.status !== 'active') {
          return res.status(401).json({ error: '所选公司已停用', companyInvalid: true })
        }
        // 联表 company_roles 拿到每个角色的"看全部合同"开关
        const roleRows = await db('user_company_roles as ucr')
          .leftJoin('company_roles as cr', function () {
            this.on('cr.company_id', '=', 'ucr.company_id')
              .andOn('cr.key', '=', 'ucr.role')
          })
          .where({ 'ucr.user_id': user.id, 'ucr.company_id': payload.cc })
          .select('ucr.role', 'cr.can_view_all_contracts')
        if (roleRows.length === 0) {
          return res.status(401).json({ error: '您在该公司没有任何角色', companyInvalid: true })
        }
        currentCompanyId = payload.cc
        companyRoles = roleRows.map(r => r.role)
        canViewAllContracts = roleRows.some(r => r.can_view_all_contracts === true)
      }
      // payload.cc 为空 / 'ALL'：仍允许访问 /auth/* 白名单（用于选公司、切换公司）
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      mustChangePassword: !!user.must_change_password,
      createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.created_at,
      // 邮件通知
      notificationEmail: user.notification_email || null,
      emailNotifyEnabled: user.email_notify_enabled !== false,
      emailFeatureNoticeSeen: !!user.email_feature_notice_seen,
      // v2.0 公司上下文
      currentCompanyId,
      companyRoles,
      canViewAllContracts,   // v2.1+: 用于合同可见性判断
      isAllCompaniesView,
      isSuperAdmin: user.role === 'superadmin',
    }

    // v1.4: 强制改密拦截（白名单外的请求一律 423）
    if (req.user.mustChangePassword && !isPwdChangeWhitelisted(req)) {
      return res.status(423).json({
        error: '请先修改初始密码后再使用其他功能',
        mustChangePassword: true,
      })
    }
    next()
  } catch (e) {
    next(e)
  }
}

/** 仅平台超级管理员（建公司 / 分配账号 / 管模板等） */
export function requirePlatformAdmin(req, res, next) {
  if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '需要平台超级管理员权限' })
  next()
}

/** 必须已选定具体公司（公司层业务接口的前置）；superadmin 也允许只读穿透，但写入接口要叠加 requireCompanyRole */
export function requireCompanyContext(req, res, next) {
  if (req.user?.isSuperAdmin) return next()        // 超管走只读通道
  if (req.user?.isAllCompaniesView) return next()  // "全部公司"模式允许 list 读
  if (!req.user?.currentCompanyId) {
    return res.status(400).json({ error: '请先选择公司', needCompanySelect: true })
  }
  next()
}

/** 必须在当前公司有指定角色之一。
 *  superadmin 在公司层做"操作"动作时禁止（只能只读）—— 业务接口要求传 currentCompanyId。
 *  "全部公司"汇总视图禁止任何写操作（强制切到具体公司）。
 */
export function requireCompanyRole(...roles) {
  return function (req, res, next) {
    if (req.user?.isSuperAdmin) {
      return res.status(403).json({ error: '平台超管不参与业务操作，请用普通账号' })
    }
    if (req.user?.isAllCompaniesView) {
      return res.status(403).json({ error: '"全部公司"汇总视图为只读，请先切换到具体公司再操作' })
    }
    if (!req.user?.currentCompanyId) {
      return res.status(400).json({ error: '请先选择公司', needCompanySelect: true })
    }
    const userRoles = req.user.companyRoles || []
    const ok = roles.some((r) => userRoles.includes(r))
    if (!ok) {
      return res.status(403).json({ error: `需要以下角色之一：${roles.join(' / ')}` })
    }
    next()
  }
}

/** 是否当前公司里的 manager（企业管理人员） */
export function hasCompanyRole(req, role) {
  return (req.user?.companyRoles || []).includes(role)
}

/**
 * v2.1+ 工具：判断当前用户在指定 contract 上是否有读权限。
 *   - superadmin 全读
 *   - 不在该 contract 的 company 里 → 拒
 *   - 在 company 里：用户任意一个角色 can_view_all_contracts=true → 看本公司全部
 *                  否则 → 只看自己创建 / 自己经办的
 */
export function canReadContractRow(reqUser, contractRow) {
  if (reqUser?.isSuperAdmin) return true
  if (!contractRow) return false
  if (reqUser?.currentCompanyId !== contractRow.company_id) return false
  if (reqUser?.canViewAllContracts) return true
  return contractRow.created_by === reqUser.id || contractRow.handler_id === reqUser.id
}

/**
 * v2.0 工具：在 case 上的可读判断
 *   - manager / legal → 看本公司全部案件
 *   - 其他角色 → 暂无案件权限（v1.x 的 can_view_cases 改造为 legal/manager 角色）
 */
export function canReadCaseRow(reqUser, caseRow) {
  if (reqUser?.isSuperAdmin) return true
  if (!caseRow) return false
  if (reqUser?.currentCompanyId !== caseRow.company_id) return false
  const roles = reqUser.companyRoles || []
  return roles.some((r) => ['manager', 'legal'].includes(r))
}

