// 合同台账：所有审核过的合同 + 每份合同的历史版本（review）
//
// v1.2 改动：
//   - 合同有自动编号 code（YYYY-HT-NNNN，年内序号、全表 UNIQUE），由系统生成
//   - 名称允许重复，靠编号区分
//   - 合同创建时机迁到"发送给法务审核"那一步（reviews.js submit 接口里调 createContractWithCode）
//   - 加 approval_started_at（审批阶段进入时间），列表可按 onlyUnapproved 过滤
//
// 权限：
//   - 任何登录用户能看自己创建的合同 + admin 能看全部
//   - 任何登录用户能新建合同（POST /api/contracts 或通过 submit 流程）
//   - 不允许删除（保留审计完整性）

import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, isAdminOrAbove } from '../auth.js'
import { toAbsolutePath } from '../storage.js'

const r = Router()
r.use(requireAuth)

function canSeeAll(user) {
  return isAdminOrAbove(user) || user?.canViewContracts
}

function rowToContract(row) {
  if (!row) return null
  const toIso = (v) => v instanceof Date ? v.toISOString() : (v || null)
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status || 'drafting',                       // v1.3：drafting/approving/pending_seal/sealed
    approvalId: row.approval_id || null,                    // 当前活跃审批 id
    summary: row.summary || null,                           // AI 合同摘要
    summaryGeneratedAt: toIso(row.summary_generated_at),
    sealedFilename: row.sealed_filename || null,
    sealedSizeBytes: row.sealed_size_bytes != null ? Number(row.sealed_size_bytes) : null,
    sealedMimeType: row.sealed_mime_type || null,
    sealedAt: toIso(row.sealed_at),
    sealedBy: row.sealed_by || null,
    // v1.3.1 清洁版
    cleanFilename: row.clean_filename || null,
    cleanSizeBytes: row.clean_size_bytes != null ? Number(row.clean_size_bytes) : null,
    cleanMimeType: row.clean_mime_type || null,
    cleanUploadedAt: toIso(row.clean_uploaded_at),
    cleanUploadedBy: row.clean_uploaded_by || null,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdByDisplayName: row.created_by_display_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    approvalStartedAt: toIso(row.approval_started_at),
    versionCount: row.version_count != null ? Number(row.version_count) : 0,
    lastReviewedAt: toIso(row.last_reviewed_at),
  }
}

const CONTRACT_SELECT = [
  'c.id', 'c.code', 'c.name', 'c.description',
  'c.status', 'c.approval_id', 'c.summary', 'c.summary_generated_at',
  'c.sealed_filename', 'c.sealed_size_bytes', 'c.sealed_mime_type', 'c.sealed_at', 'c.sealed_by',
  'c.clean_filename', 'c.clean_size_bytes', 'c.clean_mime_type', 'c.clean_uploaded_at', 'c.clean_uploaded_by',
  'c.created_by', 'c.created_at', 'c.updated_at', 'c.approval_started_at',
  'u.username as created_by_username', 'u.display_name as created_by_display_name',
  // 只统计已提交（非 draft）的 review 作为版本
  db.raw('(SELECT count(*) FROM case_reviews r WHERE r.contract_id = c.id AND r.is_draft = false) AS version_count'),
  db.raw('(SELECT max(created_at) FROM case_reviews r WHERE r.contract_id = c.id AND r.is_draft = false) AS last_reviewed_at'),
]

// GET /api/contracts?status=...&onlyUnapproved=1 — 列表
//   status: 'drafting' | 'approving' | 'pending_seal' | 'sealed'（v1.3 状态过滤）
//   onlyUnapproved=1：兼容 v1.2 用法，只列"还没进过审批"的合同（status='drafting'）
r.get('/', async (req, res, next) => {
  try {
    let q = db('contracts as c')
      .leftJoin('users as u', 'c.created_by', 'u.id')
      .select(CONTRACT_SELECT)
      .orderBy('c.updated_at', 'desc')
    if (!canSeeAll(req.user)) q = q.where('c.created_by', req.user.id)

    const status = String(req.query?.status || '').trim()
    if (status && ['drafting', 'approving', 'pending_seal', 'sealed'].includes(status)) {
      q = q.where('c.status', status)
    }
    // v1.2 兼容：onlyUnapproved=1 等价于 status='drafting'
    if (req.query?.onlyUnapproved === '1' || req.query?.onlyUnapproved === 'true') {
      q = q.where('c.status', 'drafting')
    }

    const rows = await q
    res.json({ contracts: rows.map(rowToContract) })
  } catch (e) { next(e) }
})

// GET /api/contracts/:id — 单个合同详情 + 所有 review 版本（仅显示已提交，不含 draft）
r.get('/:id', async (req, res, next) => {
  try {
    const cRow = await db('contracts as c')
      .leftJoin('users as u', 'c.created_by', 'u.id')
      .select(CONTRACT_SELECT)
      .where('c.id', req.params.id)
      .first()
    if (!cRow) return res.status(404).json({ error: '合同不存在' })
    if (!canSeeAll(req.user) && cRow.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权查看该合同' })
    }

    const reviews = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(
        'r.id', 'r.uploaded_filename', 'r.uploaded_size_bytes', 'r.uploaded_mime_type',
        'r.review_text', 'r.model', 'r.pipeline_id', 'r.created_by', 'r.created_at',
        'r.reviewed_filename', 'r.reviewed_size_bytes', 'r.reviewed_mime_type',
        'r.reviewed_by', 'r.reviewed_at',
        'u.username as created_by_username', 'u.display_name as created_by_display_name',
        'rv.username as reviewed_by_username', 'rv.display_name as reviewed_by_display_name',
      )
      .where('r.contract_id', req.params.id)
      .where('r.is_draft', false)
      .orderBy('r.created_at', 'asc')

    // v1.3.1: 取该合同最近一条 approval（用于"跳转到审批详情"按钮）
    //   优先返回当前活跃的（contracts.approval_id），否则取最新的（已完成 / 已驳回都行）
    let latestApprovalId = cRow.approval_id || null
    if (!latestApprovalId) {
      const latest = await db('approvals')
        .select('id')
        .where({ contract_id: req.params.id })
        .orderBy('created_at', 'desc')
        .first()
      latestApprovalId = latest?.id || null
    }

    res.json({
      contract: {
        ...rowToContract(cRow),
        latestApprovalId,
        reviews: reviews.map((rv, idx) => ({
          id: rv.id,
          version: idx + 1,
          uploadedFilename: rv.uploaded_filename,
          uploadedSizeBytes: rv.uploaded_size_bytes != null ? Number(rv.uploaded_size_bytes) : null,
          uploadedMimeType: rv.uploaded_mime_type,
          reviewText: rv.review_text,
          model: rv.model,
          pipelineId: rv.pipeline_id,
          createdBy: rv.created_by,
          createdByUsername: rv.created_by_username,
          createdByDisplayName: rv.created_by_display_name,
          createdAt: rv.created_at instanceof Date ? rv.created_at.toISOString() : rv.created_at,
          reviewedFilename: rv.reviewed_filename || null,
          reviewedSizeBytes: rv.reviewed_size_bytes != null ? Number(rv.reviewed_size_bytes) : null,
          reviewedMimeType: rv.reviewed_mime_type || null,
          reviewedBy: rv.reviewed_by || null,
          reviewedByUsername: rv.reviewed_by_username || null,
          reviewedByDisplayName: rv.reviewed_by_display_name || null,
          reviewedAt: rv.reviewed_at instanceof Date ? rv.reviewed_at.toISOString() : (rv.reviewed_at || null),
        })),
      },
    })
  } catch (e) { next(e) }
})

// POST /api/contracts — 直接新建合同（不通过 submit 流程，比如手动建一份占位）
//   必须传 name；编号由系统生成；不允许传 code
r.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写合同名称' })

    const created = await db.transaction(async (trx) => {
      return await createContractWithCode(trx, {
        name,
        description,
        ownerId: req.user.id,
      })
    })

    const row = await db('contracts as c')
      .leftJoin('users as u', 'c.created_by', 'u.id')
      .select(CONTRACT_SELECT)
      .where('c.id', created.id)
      .first()
    res.status(201).json({ contract: rowToContract(row) })
  } catch (e) { next(e) }
})

// PUT /api/contracts/:id — 改名 / 描述（编号 code 不可改）
r.put('/:id', async (req, res, next) => {
  try {
    const existing = await db('contracts').where({ id: req.params.id }).first()
    if (!existing) return res.status(404).json({ error: '合同不存在' })
    if (!canSeeAll(req.user) && existing.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权修改该合同' })
    }
    const { name, description } = req.body || {}
    const update = { updated_at: new Date() }
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: '合同名称不能为空' })
      update.name = String(name).trim()
    }
    if (description !== undefined) {
      update.description = description ? String(description).trim() : null
    }
    await db('contracts').where({ id: existing.id }).update(update)
    const row = await db('contracts as c')
      .leftJoin('users as u', 'c.created_by', 'u.id')
      .select(CONTRACT_SELECT)
      .where('c.id', existing.id)
      .first()
    res.json({ contract: rowToContract(row) })
  } catch (e) { next(e) }
})

// GET /api/contracts/:id/clean-file — 下载清洁版（发起审批时上传的最终版本）
//   权限：合同创建人 / admin / superadmin / 有合同台账权限的 user
r.get('/:id/clean-file', async (req, res, next) => {
  try {
    const row = await db('contracts')
      .select('clean_filename', 'clean_storage_path', 'clean_mime_type', 'created_by')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '合同不存在' })
    if (!row.clean_storage_path) return res.status(404).json({ error: '该合同还没有清洁版' })

    const allowed =
      isAdminOrAbove(req.user) ||
      req.user.canViewContracts ||
      row.created_by === req.user.id
    if (!allowed) return res.status(403).json({ error: '无权下载清洁版' })

    res.setHeader('Content-Type', row.clean_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.clean_filename)}`)
    res.sendFile(toAbsolutePath(row.clean_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

// GET /api/contracts/:id/sealed-file — 下载用印版（仅 sealed 状态）
//   权限：合同创建人 / admin / superadmin / 有合同台账权限的 user
r.get('/:id/sealed-file', async (req, res, next) => {
  try {
    const row = await db('contracts')
      .select('sealed_filename', 'sealed_storage_path', 'sealed_mime_type', 'created_by', 'status')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '合同不存在' })
    if (!row.sealed_storage_path) return res.status(404).json({ error: '该合同还没有用印版' })

    const allowed =
      isAdminOrAbove(req.user) ||
      req.user.canViewContracts ||
      row.created_by === req.user.id
    if (!allowed) return res.status(403).json({ error: '无权下载用印版' })

    res.setHeader('Content-Type', row.sealed_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.sealed_filename)}`)
    res.sendFile(toAbsolutePath(row.sealed_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

// 不提供 DELETE：合同台账是审计依据，不允许删除

export default r

// ─── 工具：自动生成编号并创建合同（供 reviews.js 的 submit 流程复用） ──────
//
// 编号规则：YYYY-HT-NNNN（年份 + HT + 4 位序号）
//   - 序号在年份内递增，每年从 0001 开始
//   - 全表 UNIQUE，跨用户全局唯一
//
// 并发安全：
//   - 用 PG advisory lock (pg_advisory_xact_lock(year)) 串行化同一年份的并发创建
//   - 锁在事务结束时自动释放
//   - 加上 unique 约束兜底（极端情况下也能保证不重复）
export async function createContractWithCode(trx, { name, description, ownerId }) {
  const year = new Date().getFullYear()
  await trx.raw('SELECT pg_advisory_xact_lock(?)', [year])

  const prefix = `${year}-HT-`
  const last = await trx('contracts')
    .where('code', 'like', `${prefix}%`)
    .orderBy('code', 'desc')
    .limit(1)
    .first()

  let nextSeq = 1
  if (last?.code) {
    const parts = last.code.split('-')
    const lastSeq = parseInt(parts[2], 10)
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1
  }
  const code = `${prefix}${String(nextSeq).padStart(4, '0')}`

  const [inserted] = await trx('contracts').insert({
    code,
    name: String(name).trim(),
    description: description ? String(description).trim() : null,
    created_by: ownerId,
  }, ['id', 'code'])

  return inserted
}
