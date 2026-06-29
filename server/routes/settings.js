// 系统设置：admin 后台修改 review_prompt 等运行时配置（存在 app_settings 表里）

import { Router } from 'express'
import { db, writeAudit } from '../db.js'
import { requireAuth, requirePlatformAdmin } from '../auth.js'
import { encryptSecret } from '../appSettings.js'

const r = Router()
// v2.0: 系统设置（OpenAI Key、合同摘要 prompt 等）是平台级配置，仅平台超管可读写
r.use(requireAuth, requirePlatformAdmin)

// 白名单：哪些 key 允许通过这个 API 改
// 注：review_prompt 在 v1.1 后由"审核模型"取代，不再通过系统设置编辑
const ALLOWED_KEYS = new Set([
  'openai_api_key',
  'openai_base_url',
  'openai_model_default',
  // v1.3：合同审批界面 AI 摘要的 system prompt（超管可调）
  'contract_summary_prompt',
  // 邮件通知配置（全部存 DB，不走 .env）
  'email_enabled',     // '1' / '0'
  'email_from',        // 发信邮箱
  'smtp_host',         // SMTP 服务器
  'smtp_port',         // 端口
  'smtp_auth_code',    // SMTP 授权码（AES 加密存储）
  'app_base_url',      // 系统访问域名，用于邮件跳转链接
])

// 敏感字段：GET 时返回 mask；PUT 时如果还是 mask 则不更新
const SECRET_KEYS = new Set(['openai_api_key', 'smtp_auth_code'])
// 需 AES 加密存储的字段（区别于仅 mask 显示的 openai_api_key——后者为兼容历史仍明文存）
const ENCRYPTED_KEYS = new Set(['smtp_auth_code'])
const MASK_PLACEHOLDER = '__MASKED__'

function maskIfSecret(key, value) {
  if (!SECRET_KEYS.has(key) || !value) return value
  if (value.length <= 8) return '***'
  return value.slice(0, 4) + '***' + value.slice(-4)
}

function settingPayload(row) {
  return {
    key: row.key,
    value: maskIfSecret(row.key, row.value),
    isSecret: SECRET_KEYS.has(row.key),
    isSet: !!row.value,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    updatedBy: row.updated_by,
  }
}

// GET /api/settings — 列出所有可读 key（敏感值已 mask）
r.get('/', async (_req, res, next) => {
  try {
    const rows = await db('app_settings').select('key', 'value', 'updated_at', 'updated_by')
    const map = new Map(rows.map(r => [r.key, r]))
    const out = []
    for (const k of ALLOWED_KEYS) {
      const r2 = map.get(k) || { key: k, value: null, updated_at: null, updated_by: null }
      out.push(settingPayload(r2))
    }
    res.json({ settings: out })
  } catch (e) { next(e) }
})

// GET /api/settings/:key
r.get('/:key', async (req, res, next) => {
  try {
    if (!ALLOWED_KEYS.has(req.params.key)) return res.status(404).json({ error: '配置项不存在' })
    const row = await db('app_settings').where({ key: req.params.key }).first()
    if (!row) {
      return res.json({ setting: { key: req.params.key, value: '', isSecret: SECRET_KEYS.has(req.params.key), isSet: false, updatedAt: null, updatedBy: null } })
    }
    res.json({ setting: settingPayload(row) })
  } catch (e) { next(e) }
})

// PUT /api/settings/:key — body: { value }
// 对敏感字段，如果 value 是 mask 占位（前端没改）则忽略不更新
r.put('/:key', async (req, res, next) => {
  try {
    const { key } = req.params
    if (!ALLOWED_KEYS.has(key)) return res.status(404).json({ error: '配置项不存在' })
    const { value } = req.body || {}
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'value 必须是字符串' })
    }
    if (value.length > 50_000) {
      return res.status(400).json({ error: '配置内容超过 5 万字' })
    }
    // 敏感字段：value 是 mask 占位 → 跳过更新
    if (SECRET_KEYS.has(key) && value === MASK_PLACEHOLDER) {
      const row = await db('app_settings').where({ key }).first()
      return res.json({ setting: row ? settingPayload(row) : settingPayload({ key, value: '' }) })
    }

    // 加密字段：明文进来 → AES 加密后入库（DB 里绝不出现明文授权码）
    const storedValue = ENCRYPTED_KEYS.has(key) ? encryptSecret(value) : value

    const existing = await db('app_settings').where({ key }).first()
    if (existing) {
      await db('app_settings').where({ key }).update({
        value: storedValue, updated_at: new Date(), updated_by: req.user.id,
      })
    } else {
      await db('app_settings').insert({
        key, value: storedValue, updated_at: new Date(), updated_by: req.user.id,
      })
    }

    await writeAudit({
      actorId: req.user.id, action: 'settings.update',
      targetType: 'settings', targetId: key,
      payload: { length: value.length, isSecret: SECRET_KEYS.has(key) },
    })

    const row = await db('app_settings').where({ key }).first()
    res.json({ setting: settingPayload(row) })
  } catch (e) { next(e) }
})

// POST /api/settings/test-openai — 用当前 DB 配置发一个最小请求，验证 Key 通不通
r.post('/test-openai', async (_req, res, next) => {
  try {
    const { chatCompletion } = await import('../openai.js')
    await chatCompletion({
      system: 'You are a connection test bot. Reply with exactly "ok".',
      user: 'ping',
    })
    res.json({ ok: true, message: '连接成功' })
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})

// POST /api/settings/test-email — body: { to } 用当前 DB 邮件配置发一封测试邮件
r.post('/test-email', async (req, res) => {
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : ''
    const { sendTestEmail } = await import('../emailService.js')
    await sendTestEmail(to)
    res.json({ ok: true, message: `测试邮件已发送至 ${to}，请查收（含垃圾箱）` })
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})

export default r
