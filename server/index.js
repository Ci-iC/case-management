import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import './db.js'

import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import companyRoutes from './routes/companies.js'      // v2.0
import caseRoutes from './routes/cases.js'
import reviewRoutes, { cleanupStaleDrafts } from './routes/reviews.js'
import messageRoutes from './routes/messages.js'
import settingsRoutes from './routes/settings.js'
import pipelineRoutes from './routes/pipelines.js'
import contractRoutes from './routes/contracts.js'
import approvalRoutes from './routes/approvals.js'
import draftRoutes, { cleanupDraftFiles } from './routes/draft.js'   // v2.2 合同起草
import assistantRoutes from './routes/assistant.js'                  // v2.3 AI 工作台
import contractTemplateRoutes from './routes/contractTemplates.js'   // 合同模板库管理（超管）
import { cleanupAssistantData } from './assistantStore.js'           // v2.3
import { runContractTermNotify } from './contractTermNotify.js'   // v1.4

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT) || 3000

app.set('trust proxy', 1)

const corsOriginEnv = (process.env.CORS_ORIGIN || '').trim()
if (corsOriginEnv) {
  const allowList = corsOriginEnv.split(',').map(s => s.trim()).filter(Boolean)
  app.use(cors({ origin: allowList, credentials: false }))
} else {
  app.use(cors({ origin: false }))
}
app.use(express.json({ limit: '2mb' }))

// ─── API ───────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/companies', companyRoutes)        // v2.0
app.use('/api/cases', caseRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/pipelines', pipelineRoutes)
app.use('/api/contracts', contractRoutes)
app.use('/api/approvals', approvalRoutes)
app.use('/api/draft', draftRoutes)              // v2.2 合同起草（聊天式）
app.use('/api/assistant', assistantRoutes)      // v2.3 AI 工作台
app.use('/api/contract-templates', contractTemplateRoutes)   // 合同模板库管理（超管）

// ─── Static frontend (prod) ────────────────────────────────────────────────────

const distDir = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// ─── Error handling ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[error]', err)
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' })
})

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)

  // 启动时清一次 24h+ 的草稿审核，之后每小时跑一次
  const runDraftCleanup = async () => {
    try {
      const { count } = await cleanupStaleDrafts({ maxAgeHours: 24 })
      if (count > 0) console.log(`[draft-cleanup] removed ${count} stale draft review(s)`)
    } catch (e) {
      console.error('[draft-cleanup] failed:', e?.message || e)
    }
  }
  runDraftCleanup()
  setInterval(runDraftCleanup, 60 * 60 * 1000)

  // v1.4: 合同到期提醒，启动跑一次 + 每 6 小时跑一次
  const runTermNotify = async () => {
    try {
      const { sent } = await runContractTermNotify()
      if (sent > 0) console.log(`[term-notify] sent ${sent} contract expiry notice(s)`)
    } catch (e) {
      console.error('[term-notify] failed:', e?.message || e)
    }
  }
  runTermNotify()
  setInterval(runTermNotify, 6 * 60 * 60 * 1000)

  // v2.2: 合同起草生成的草稿文件不做长期存储，启动跑一次 + 每 6 小时清理超过 24h 的
  const runDraftCleanup2 = async () => {
    try {
      const { count } = await cleanupDraftFiles({ maxAgeHours: 24 })
      if (count > 0) console.log(`[draft-files-cleanup] removed ${count} stale draft file(s)`)
    } catch (e) {
      console.error('[draft-files-cleanup] failed:', e?.message || e)
    }
  }
  runDraftCleanup2()
  setInterval(runDraftCleanup2, 6 * 60 * 60 * 1000)

  // v2.3: AI 工作台对话/附件，当天保留次日清空，启动跑一次 + 每 6 小时清理
  const runAssistantCleanup = async () => {
    try {
      const { count } = await cleanupAssistantData()
      if (count > 0) console.log(`[assistant-cleanup] removed ${count} stale assistant record(s)`)
    } catch (e) {
      console.error('[assistant-cleanup] failed:', e?.message || e)
    }
  }
  runAssistantCleanup()
  setInterval(runAssistantCleanup, 6 * 60 * 60 * 1000)
})

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})
