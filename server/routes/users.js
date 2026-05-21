import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, cryptoId, writeAudit } from '../db.js'
import { requireAuth, requireSuperAdmin, isAdminOrAbove } from '../auth.js'

const r = Router()

const ALLOWED_ROLES = new Set(['superadmin', 'admin', 'user'])

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
      .whereNull('deleted_at')  // v1.3.2: 已删除用户不出现在联系人列表
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

// GET /api/users — superadmin only（用户管理是系统级配置）
r.get('/', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const rows = await db('users')
      .select('id', 'username', 'role', 'display_name', 'can_view_cases', 'can_view_contracts', 'created_at', 'created_by')
      .whereNull('deleted_at')  // v1.3.2: 用户管理界面不展示已删除用户
      .orderBy('created_at', 'desc')
    res.json({ users: rows.map(rowToUser) })
  } catch (e) { next(e) }
})

// POST /api/users — superadmin only
r.post('/', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { username, password, role, displayName, canViewCases, canViewContracts } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: '请填写账号和密码' })
    if (username.length < 2 || username.length > 32) return res.status(400).json({ error: '账号长度应为 2-32 个字符' })
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' })

    const normalizedRole = ALLOWED_ROLES.has(role) ? role : 'user'
    // admin/superadmin 自动有所有台账权限；user 由 superadmin 创建时勾选
    const isAdminish = normalizedRole === 'admin' || normalizedRole === 'superadmin'
    const normalizedCanViewCases = isAdminish ? true : !!canViewCases
    const normalizedCanViewContracts = isAdminish ? true : !!canViewContracts

    // v1.3.2: 重名检查只看未删除的用户；已删除用户的 username 允许复用
    const exists = await db('users').select('id').where({ username }).whereNull('deleted_at').first()
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

// PATCH /api/users/:id — superadmin only：改权限开关，可改 role（升降级）
r.patch('/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const body = req.body || {}
    const update = {}
    if (typeof body.canViewCases === 'boolean') update.can_view_cases = body.canViewCases
    if (typeof body.canViewContracts === 'boolean') update.can_view_contracts = body.canViewContracts
    if (typeof body.role === 'string' && ALLOWED_ROLES.has(body.role)) update.role = body.role
    if (typeof body.displayName === 'string') {
      const trimmed = body.displayName.trim()
      if (trimmed.length > 64) return res.status(400).json({ error: '昵称最多 64 个字符' })
      update.display_name = trimmed || null
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: '请提供 canViewCases / canViewContracts / role / displayName' })
    }

    const target = await db('users').select('id', 'role').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    // 不能把自己降级为非 superadmin（避免锁死系统：superadmin 操作完发现自己没权限）
    if (id === req.user.id && update.role && update.role !== 'superadmin') {
      return res.status(400).json({ error: '不能把自己的角色降级，请先指派其他超级管理员' })
    }

    // admin/superadmin 强制保留台账权限，避免误关
    const finalRole = update.role || target.role
    if (finalRole === 'admin' || finalRole === 'superadmin') {
      if (update.can_view_cases === false) return res.status(400).json({ error: '管理员/超级管理员的案件管理权限不可关闭' })
      if (update.can_view_contracts === false) return res.status(400).json({ error: '管理员/超级管理员的合同台账权限不可关闭' })
      // 升级到 admin/superadmin 时自动补满权限
      if (update.role && (target.role !== 'admin' && target.role !== 'superadmin')) {
        update.can_view_cases = true
        update.can_view_contracts = true
      }
    }

    // 系统至少保留一个 superadmin（按未删除用户计数）
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

// DELETE /api/users/:id — superadmin only
//
// v1.3.2 改造：软删除 + 清在途审批
//   - 不真的从 users 表删行：所有历史记录里"经办人/审批人"仍能 JOIN 出原 username/display_name
//   - 把 target 参与的所有 pending approvals 整体删除，对应 contracts 退回 drafting
//     （产品决策：在途审批整体作废重走，无论 target 是发起人 / 审批人 / 加签人）
//   - 已完结（completed / rejected）的审批保留不动
//   - target 的 deleted_at 设为当前时刻，token_version+1 立即踢下线
r.delete('/:id', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    if (id === req.user.id) return res.status(400).json({ error: '不能删除自己的账号' })

    const target = await db('users').select('role', 'username').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    // 不能删掉最后一个 superadmin（按未删除用户计数）
    if (target.role === 'superadmin') {
      const { count } = await db('users')
        .count({ count: '*' })
        .where({ role: 'superadmin' })
        .whereNull('deleted_at')
        .first()
      if (Number(count) <= 1) return res.status(400).json({ error: '系统必须保留至少一个超级管理员' })
    }

    const affected = await db.transaction(async (trx) => {
      // 1) 找出 target 参与的所有在途 approvals
      //    "参与" = 发起人 OR 任一步骤的 assignee（含 consultee 加签节点）
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
        // 2) 对应 contracts 退回 drafting；approval_id 清空
        await trx('contracts')
          .whereIn('approval_id', approvalIds)
          .update({ status: 'drafting', approval_id: null, updated_at: trx.fn.now() })

        // 3) 删 approvals（approval_steps / approval_actions 通过 CASCADE 自动连删）
        await trx('approvals').whereIn('id', approvalIds).delete()
      }

      // 4) 软删除 + 踢下线
      await trx('users').where({ id }).update({
        deleted_at: trx.fn.now(),
        token_version: trx.raw('token_version + 1'),
      })

      return { cancelledApprovals: approvalIds.length }
    })

    await writeAudit({
      actorId: req.user.id, action: 'user.delete',
      targetType: 'user', targetId: id,
      payload: {
        username: target.username,
        role: target.role,
        cancelledApprovals: affected.cancelledApprovals,
      },
    })
    res.json({ ok: true, cancelledApprovals: affected.cancelledApprovals })
  } catch (e) { next(e) }
})

// POST /api/users/:id/reset-password — superadmin only
r.post('/:id/reset-password', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body || {}
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '新密码至少 6 位' })

    const target = await db('users').select('id').where({ id }).whereNull('deleted_at').first()
    if (!target) return res.status(404).json({ error: '用户不存在' })

    const hash = bcrypt.hashSync(newPassword, 10)
    // 重置密码后顺手 increment token_version，把该用户已登录的会话踢下来
    await db('users').where({ id }).update({
      password_hash: hash,
      token_version: db.raw('token_version + 1'),
    })
    await writeAudit({
      actorId: req.user.id, action: 'user.reset_password',
      targetType: 'user', targetId: id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default r
