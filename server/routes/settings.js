// 系统设置：admin 后台修改 review_prompt 等运行时配置（存在 app_settings 表里）

import { Router } from 'express'
import { db, writeAudit } from '../db.js'
import { requireAuth, requireAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth, requireAdmin)

// 白名单：哪些 key 允许通过这个 API 改
const ALLOWED_KEYS = new Set(['review_prompt'])

// GET /api/settings — 列出所有可读 key
r.get('/', async (_req, res, next) => {
  try {
    const rows = await db('app_settings').select('key', 'value', 'updated_at', 'updated_by')
    res.json({
      settings: rows
        .filter(r => ALLOWED_KEYS.has(r.key))
        .map(r => ({
          key: r.key,
          value: r.value,
          updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
          updatedBy: r.updated_by,
        })),
    })
  } catch (e) { next(e) }
})

// GET /api/settings/:key
r.get('/:key', async (req, res, next) => {
  try {
    if (!ALLOWED_KEYS.has(req.params.key)) return res.status(404).json({ error: '配置项不存在' })
    const row = await db('app_settings').where({ key: req.params.key }).first()
    if (!row) return res.status(404).json({ error: '配置项不存在' })
    res.json({
      setting: {
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        updatedBy: row.updated_by,
      },
    })
  } catch (e) { next(e) }
})

// PUT /api/settings/:key — body: { value }
r.put('/:key', async (req, res, next) => {
  try {
    const { key } = req.params
    if (!ALLOWED_KEYS.has(key)) return res.status(404).json({ error: '配置项不存在' })
    const { value } = req.body || {}
    if (typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'value 必须是非空字符串' })
    }
    if (value.length > 50_000) {
      return res.status(400).json({ error: '配置内容超过 5 万字' })
    }

    const existing = await db('app_settings').where({ key }).first()
    if (existing) {
      await db('app_settings').where({ key }).update({
        value, updated_at: new Date(), updated_by: req.user.id,
      })
    } else {
      await db('app_settings').insert({
        key, value, updated_at: new Date(), updated_by: req.user.id,
      })
    }

    await writeAudit({
      actorId: req.user.id, action: 'settings.update',
      targetType: 'settings', targetId: key,
      payload: { length: value.length },
    })

    const row = await db('app_settings').where({ key }).first()
    res.json({
      setting: {
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        updatedBy: row.updated_by,
      },
    })
  } catch (e) { next(e) }
})

export default r
