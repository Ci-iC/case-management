import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Importing db.js opens the Knex pool. Schema + admin seed are out-of-band:
//   npx knex migrate:latest
//   node server/seed.js
import './db.js'

import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import caseRoutes from './routes/cases.js'
import reviewRoutes, { cleanupStaleDrafts } from './routes/reviews.js'
import messageRoutes from './routes/messages.js'
import settingsRoutes from './routes/settings.js'
import pipelineRoutes from './routes/pipelines.js'
import contractRoutes from './routes/contracts.js'
import approvalRoutes from './routes/approvals.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT) || 3000

// v1.3.2: 信任 nginx 等前置代理转发的 X-Forwarded-* 头，rate-limit 才能拿到真实 IP
app.set('trust proxy', 1)

// v1.3.2: CORS 从全开放改成白名单。CORS_ORIGIN 留空 = 同源（前后端一起部署的常规情形）
//   多个域名用英文逗号分隔，如：CORS_ORIGIN=https://a.example.com,https://b.example.com
const corsOriginEnv = (process.env.CORS_ORIGIN || '').trim()
if (corsOriginEnv) {
  const allowList = corsOriginEnv.split(',').map(s => s.trim()).filter(Boolean)
  app.use(cors({ origin: allowList, credentials: false }))
} else {
  // 同源部署：不放任何跨域来源
  app.use(cors({ origin: false }))
}
app.use(express.json({ limit: '2mb' }))

// ─── API ───────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/cases', caseRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/pipelines', pipelineRoutes)
app.use('/api/contracts', contractRoutes)
app.use('/api/approvals', approvalRoutes)

// ─── Static frontend (prod) ────────────────────────────────────────────────────

const distDir = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  // SPA fallback — any non-/api route goes to index.html
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

  // 启动时清一次 24h+ 的草稿审核（DB 行 + 磁盘文件），之后每小时跑一次
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
})

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})
