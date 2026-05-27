// 审核模型 v2.0：多租户
//
// 模型归属规则：
//   - company_id=NULL → 全平台共享模板（出厂的"通用合同审核"等）
//   - company_id=具体公司 → 该公司专属模板
//
// 权限：
//   - 列表/详情：当前公司用户能看自己公司的 + 全平台共享的
//   - 平台超管：能看全部、CRUD 全部（控制台里管）
//   - 新建/编辑/删除：仅平台超管；body.companyId 缺省 = NULL（全平台共享）
//
// 关于 is_default：v2.0 弃用此语义，前端取"列表第一条"作为默认。字段保留不删，避免破坏 v1.x 数据。

import { Router } from 'express'
import { db, writeAudit } from '../db.js'
import { requireAuth, requireCompanyContext, requirePlatformAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth)

function pipelineToJSON(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isDefault: !!p.is_default,
    companyId: p.company_id || null,
    companyName: p.company_name || null,
    createdBy: p.created_by,
    createdAt: p.created_at instanceof Date ? p.created_at.toISOString() : p.created_at,
    updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : p.updated_at,
  }
}

function stepToJSON(s) {
  return {
    id: s.id,
    pipelineId: s.pipeline_id,
    position: s.position,
    name: s.name,
    prompt: s.prompt,
    enabled: !!s.enabled,
  }
}

async function loadFull(id) {
  const p = await db('pipelines as p')
    .leftJoin('companies as c', 'p.company_id', 'c.id')
    .select('p.*', 'c.name as company_name')
    .where('p.id', id)
    .first()
  if (!p) return null
  const steps = await db('pipeline_steps').where({ pipeline_id: id }).orderBy('position', 'asc')
  return { ...pipelineToJSON(p), steps: steps.map(stepToJSON) }
}

// GET /api/pipelines — 列表
//   平台超管：全部
//   公司用户：当前公司 + 共享（NULL）
r.get('/', async (req, res, next) => {
  try {
    let q = db('pipelines as p')
      .leftJoin('companies as c', 'p.company_id', 'c.id')
      .select('p.*', 'c.name as company_name')
      .orderBy([{ column: 'p.company_id', order: 'desc' }, { column: 'p.name', order: 'asc' }])

    if (!req.user.isSuperAdmin) {
      // 必须有当前公司上下文才能看公司私有模板
      if (!req.user.currentCompanyId && !req.user.isAllCompaniesView) {
        return res.status(400).json({ error: '请先选择公司', needCompanySelect: true })
      }
      if (req.user.isAllCompaniesView) {
        // 全部公司模式：拿用户所有 manager 公司的合并 + NULL 共享
        q = q.where(function () {
          this.whereNull('p.company_id').orWhereIn('p.company_id',
            db('user_company_roles').select('company_id').where({ user_id: req.user.id, role: 'manager' }))
        })
      } else {
        q = q.where(function () {
          this.whereNull('p.company_id').orWhere('p.company_id', req.user.currentCompanyId)
        })
      }
    }

    const ps = await q
    const ids = ps.map(p => p.id)
    let stepsAll = []
    if (ids.length > 0) {
      stepsAll = await db('pipeline_steps').whereIn('pipeline_id', ids).orderBy('position', 'asc')
    }
    const stepsByPipeline = new Map()
    for (const s of stepsAll) {
      if (!stepsByPipeline.has(s.pipeline_id)) stepsByPipeline.set(s.pipeline_id, [])
      stepsByPipeline.get(s.pipeline_id).push(stepToJSON(s))
    }
    res.json({
      pipelines: ps.map(p => ({ ...pipelineToJSON(p), steps: stepsByPipeline.get(p.id) || [] })),
    })
  } catch (e) { next(e) }
})

// GET /api/pipelines/:id
r.get('/:id', async (req, res, next) => {
  try {
    const full = await loadFull(req.params.id)
    if (!full) return res.status(404).json({ error: '审核模型不存在' })

    // 权限：公司用户只能看自己公司的 + 共享
    if (!req.user.isSuperAdmin) {
      if (full.companyId && full.companyId !== req.user.currentCompanyId) {
        return res.status(403).json({ error: '该模型不属于当前公司' })
      }
    }
    res.json({ pipeline: full })
  } catch (e) { next(e) }
})

// POST /api/pipelines — 平台超管创建
//   body: { name, description?, isDefault?, companyId?: string|null, steps }
r.post('/', requirePlatformAdmin, async (req, res, next) => {
  try {
    const { name, description, isDefault, companyId, steps } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写审核模型名称' })
    if (!Array.isArray(steps) || steps.length === 0) return res.status(400).json({ error: '请至少添加一个节点' })

    // companyId 校验（缺省 / null = 全平台共享）
    let normalizedCompanyId = null
    if (companyId) {
      const co = await db('companies').where({ id: companyId, status: 'active' }).first()
      if (!co) return res.status(400).json({ error: '所选公司不存在或已停用' })
      normalizedCompanyId = co.id
    }

    const result = await db.transaction(async (trx) => {
      if (isDefault) {
        // v2.0: is_default 已弃用，但保留兼容；这里若设置则把同 company 范围的旧 default 关掉
        await trx('pipelines').where({ is_default: true })
          .modify((q) => normalizedCompanyId ? q.where('company_id', normalizedCompanyId) : q.whereNull('company_id'))
          .update({ is_default: false })
      }
      const [created] = await trx('pipelines').insert({
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        is_default: !!isDefault,
        company_id: normalizedCompanyId,
        created_by: req.user.id,
      }, ['id'])
      await insertStepsForPipeline(trx, created.id, steps, normalizedCompanyId)
      return created.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'pipeline.create', targetType: 'pipeline', targetId: result,
      payload: { name, isDefault: !!isDefault, companyId: normalizedCompanyId, stepsCount: steps.length },
      companyId: normalizedCompanyId,
    })
    res.status(201).json({ pipeline: await loadFull(result) })
  } catch (e) { next(e) }
})

// PUT /api/pipelines/:id — 平台超管
r.put('/:id', requirePlatformAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await db('pipelines').where({ id }).first()
    if (!existing) return res.status(404).json({ error: '审核模型不存在' })

    const { name, description, isDefault, companyId, steps } = req.body || {}
    if (name !== undefined && (!name || !String(name).trim())) {
      return res.status(400).json({ error: '名称不能为空' })
    }
    if (steps !== undefined && (!Array.isArray(steps) || steps.length === 0)) {
      return res.status(400).json({ error: '请至少保留一个节点' })
    }

    let normalizedCompanyId = existing.company_id
    if (companyId !== undefined) {
      if (companyId === null) normalizedCompanyId = null
      else {
        const co = await db('companies').where({ id: companyId, status: 'active' }).first()
        if (!co) return res.status(400).json({ error: '所选公司不存在或已停用' })
        normalizedCompanyId = co.id
      }
    }

    await db.transaction(async (trx) => {
      const update = {}
      if (name !== undefined) update.name = String(name).trim()
      if (description !== undefined) update.description = description ? String(description).trim() : null
      if (companyId !== undefined) update.company_id = normalizedCompanyId
      if (isDefault !== undefined) {
        if (isDefault === true) {
          await trx('pipelines').where({ is_default: true })
            .modify((q) => normalizedCompanyId ? q.where('company_id', normalizedCompanyId) : q.whereNull('company_id'))
            .update({ is_default: false })
          update.is_default = true
        } else if (isDefault === false) {
          update.is_default = false
        }
      }
      update.updated_at = new Date()
      await trx('pipelines').where({ id }).update(update)

      if (steps !== undefined) {
        await trx('pipeline_steps').where({ pipeline_id: id }).delete()
        await insertStepsForPipeline(trx, id, steps, normalizedCompanyId)
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'pipeline.update', targetType: 'pipeline', targetId: id,
      companyId: normalizedCompanyId,
    })
    res.json({ pipeline: await loadFull(id) })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// DELETE /api/pipelines/:id — 平台超管
r.delete('/:id', requirePlatformAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await db('pipelines').where({ id }).first()
    if (!existing) return res.status(404).json({ error: '审核模型不存在' })

    await db('pipelines').where({ id }).delete()
    await writeAudit({
      actorId: req.user.id, action: 'pipeline.delete', targetType: 'pipeline', targetId: id,
      payload: { name: existing.name },
      companyId: existing.company_id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

async function insertStepsForPipeline(trx, pipelineId, steps, companyId) {
  const rows = steps.map((s, i) => {
    const name = String(s?.name || '').trim()
    const prompt = String(s?.prompt || '').trim()
    if (!name) throw Object.assign(new Error(`第 ${i + 1} 个节点：名称不能为空`), { status: 400 })
    if (!prompt) throw Object.assign(new Error(`第 ${i + 1} 个节点：提示词不能为空`), { status: 400 })
    return {
      pipeline_id: pipelineId,
      position: i,
      name,
      prompt,
      enabled: s?.enabled === false ? false : true,
      company_id: companyId || null,
    }
  })
  await trx('pipeline_steps').insert(rows)
}

export default r
