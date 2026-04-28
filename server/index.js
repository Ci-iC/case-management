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
import reviewRoutes from './routes/reviews.js'
import messageRoutes from './routes/messages.js'
import settingsRoutes from './routes/settings.js'
import pipelineRoutes from './routes/pipelines.js'
import contractRoutes from './routes/contracts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = Number(process.env.PORT) || 3000

app.use(cors())
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
})

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})
