// AI 审核模型管理（admin only）
//
// 一条审核模型 = N 个节点。每个节点独立提示词。运行时 Promise.all 并行调 OpenAI，
// 输出按 position 顺序拼接成最终审核意见。

import { Router } from 'express'
import { db, writeAudit } from '../db.js'
import { requireAuth, requireSuperAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth)

// 列表/详情：所有登录用户能读（业务人员上传时要选用哪条）
// 写操作：admin only

function pipelineToJSON(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isDefault: !!p.is_default,
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
  const p = await db('pipelines').where({ id }).first()
  if (!p) return null
  const steps = await db('pipeline_steps').where({ pipeline_id: id }).orderBy('position', 'asc')
  return { ...pipelineToJSON(p), steps: steps.map(stepToJSON) }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

// GET /api/pipelines — 列表（含每条的 steps）
r.get('/', async (_req, res, next) => {
  try {
    const ps = await db('pipelines').orderBy([{ column: 'is_default', order: 'desc' }, { column: 'name', order: 'asc' }])
    const stepsAll = await db('pipeline_steps').orderBy('position', 'asc')
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

// GET /api/pipelines/:id — 详情
r.get('/:id', async (req, res, next) => {
  try {
    const full = await loadFull(req.params.id)
    if (!full) return res.status(404).json({ error: '审核模型不存在' })
    res.json({ pipeline: full })
  } catch (e) { next(e) }
})

// ─── Write (admin only) ──────────────────────────────────────────────────────

// POST /api/pipelines — 新建（可一并提交 steps）
r.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, description, isDefault, steps } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写审核模型名称' })
    if (!Array.isArray(steps) || steps.length === 0) return res.status(400).json({ error: '请至少添加一个节点' })

    const result = await db.transaction(async (trx) => {
      if (isDefault) {
        await trx('pipelines').update({ is_default: false }).where({ is_default: true })
      }
      const [created] = await trx('pipelines').insert({
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        is_default: !!isDefault,
        created_by: req.user.id,
      }, ['id'])
      await insertStepsForPipeline(trx, created.id, steps)
      return created.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'pipeline.create', targetType: 'pipeline', targetId: result,
      payload: { name, isDefault: !!isDefault, steps: steps.length },
    })
    res.status(201).json({ pipeline: await loadFull(result) })
  } catch (e) { next(e) }
})

// PUT /api/pipelines/:id — 改 name / description / isDefault / steps（一次性提交全部 steps）
r.put('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await db('pipelines').where({ id }).first()
    if (!existing) return res.status(404).json({ error: '审核模型不存在' })

    const { name, description, isDefault, steps } = req.body || {}
    if (name !== undefined && (!name || !String(name).trim())) {
      return res.status(400).json({ error: '名称不能为空' })
    }
    if (steps !== undefined && (!Array.isArray(steps) || steps.length === 0)) {
      return res.status(400).json({ error: '请至少保留一个节点' })
    }

    await db.transaction(async (trx) => {
      const update = {}
      if (name !== undefined) update.name = String(name).trim()
      if (description !== undefined) update.description = description ? String(description).trim() : null
      if (isDefault !== undefined) {
        if (isDefault === true) {
          await trx('pipelines').update({ is_default: false }).where({ is_default: true })
          update.is_default = true
        } else if (isDefault === false && existing.is_default) {
          // 不允许直接关掉默认（必须先把 default 切到别的），否则系统会没默认审核模型
          throw Object.assign(new Error('请把"默认"先切到其他审核模型再保存'), { status: 400 })
        }
      }
      update.updated_at = new Date()
      await trx('pipelines').where({ id }).update(update)

      if (steps !== undefined) {
        await trx('pipeline_steps').where({ pipeline_id: id }).delete()
        await insertStepsForPipeline(trx, id, steps)
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'pipeline.update', targetType: 'pipeline', targetId: id,
    })
    res.json({ pipeline: await loadFull(id) })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// DELETE /api/pipelines/:id — 不能删唯一一条 / 不能删 is_default
r.delete('/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const existing = await db('pipelines').where({ id }).first()
    if (!existing) return res.status(404).json({ error: '审核模型不存在' })
    if (existing.is_default) return res.status(400).json({ error: '不能删除默认审核模型，请先切换默认' })

    const { count } = await db('pipelines').count({ count: '*' }).first()
    if (Number(count) <= 1) return res.status(400).json({ error: '系统至少保留一条审核模型' })

    await db('pipelines').where({ id }).delete()
    await writeAudit({
      actorId: req.user.id, action: 'pipeline.delete', targetType: 'pipeline', targetId: id,
      payload: { name: existing.name },
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function insertStepsForPipeline(trx, pipelineId, steps) {
  // steps: [{ name, prompt, enabled }]，按数组顺序写入 position 0..N-1
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
    }
  })
  await trx('pipeline_steps').insert(rows)
}

export default r
