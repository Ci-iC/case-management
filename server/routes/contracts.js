// 合同台账：所有审核过的合同 + 每份合同的历史版本（review）
//
// 权限：
//   - 任何登录用户能看自己创建的合同 + admin 能看全部
//   - 任何登录用户能新建合同（上传审核时自动调用 ensureByName）
//   - 不允许删除（保留审计完整性）

import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

const r = Router()
r.use(requireAuth)

// 业务人员（无合同台账权限）也能调本路由：列表只看自己上传的、详情/编辑也只能动自己的。
// 这样他们在「合同审核」页能选"已有合同的新版本"。
// 前端菜单层面会隐藏合同台账入口给无权限用户。

function canSeeAll(user) {
  return user?.role === 'admin' || user?.canViewContracts
}

function rowToContract(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    versionCount: row.version_count != null ? Number(row.version_count) : 0,
    lastReviewedAt: row.last_reviewed_at instanceof Date
      ? row.last_reviewed_at.toISOString()
      : (row.last_reviewed_at || null),
  }
}

const CONTRACT_SELECT = [
  'c.id', 'c.name', 'c.description', 'c.created_by', 'c.created_at', 'c.updated_at',
  'u.username as created_by_username', 'u.display_name as created_by_display_name',
  db.raw('(SELECT count(*) FROM case_reviews r WHERE r.contract_id = c.id) AS version_count'),
  db.raw('(SELECT max(created_at) FROM case_reviews r WHERE r.contract_id = c.id) AS last_reviewed_at'),
]

// GET /api/contracts — 列表（admin 看全部，普通用户看自己的）
r.get('/', async (req, res, next) => {
  try {
    let q = db('contracts as c')
      .leftJoin('users as u', 'c.created_by', 'u.id')
      .select(CONTRACT_SELECT)
      .orderBy('c.updated_at', 'desc')
    if (!canSeeAll(req.user)) q = q.where('c.created_by', req.user.id)
    const rows = await q
    res.json({ contracts: rows.map(rowToContract) })
  } catch (e) { next(e) }
})

// GET /api/contracts/:id — 单个合同详情 + 所有 review 版本
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

    // 该合同所有 review 版本（时间正序，方便看 v1/v2/v3）
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
      .orderBy('r.created_at', 'asc')

    res.json({
      contract: {
        ...rowToContract(cRow),
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

// POST /api/contracts — 新建合同（同名+同 owner 视为已存在，幂等返回）
r.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写合同名称' })
    const trimmed = String(name).trim()
    const desc = description ? String(description).trim() : null

    // 同 owner 同名 → 复用已有
    const existing = await db('contracts')
      .where({ name: trimmed, created_by: req.user.id })
      .first()
    if (existing) {
      const row = await db('contracts as c')
        .leftJoin('users as u', 'c.created_by', 'u.id')
        .select(CONTRACT_SELECT)
        .where('c.id', existing.id)
        .first()
      return res.json({ contract: rowToContract(row) })
    }

    const [inserted] = await db('contracts').insert({
      name: trimmed,
      description: desc,
      created_by: req.user.id,
    }, ['id'])

    const row = await db('contracts as c')
      .leftJoin('users as u', 'c.created_by', 'u.id')
      .select(CONTRACT_SELECT)
      .where('c.id', inserted.id)
      .first()
    res.status(201).json({ contract: rowToContract(row) })
  } catch (e) { next(e) }
})

// PUT /api/contracts/:id — 改名 / 描述
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

// 不提供 DELETE：合同台账是审计依据，不允许删除

export default r

// ─── 复用工具：发起审核时根据 name 找/建合同 ─────────────────────────────────

export async function ensureContractByName(userId, name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return null
  const existing = await db('contracts').where({ name: trimmed, created_by: userId }).first()
  if (existing) {
    // 蹭一下 updated_at 让它排在前面
    await db('contracts').where({ id: existing.id }).update({ updated_at: new Date() })
    return existing.id
  }
  const [inserted] = await db('contracts').insert({
    name: trimmed,
    created_by: userId,
  }, ['id'])
  return inserted.id
}
