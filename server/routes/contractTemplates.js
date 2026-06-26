// 合同模板库管理（仅平台超管）：
//   - 编辑「模板说明.md」(给 AI 选模板用的指引)
//   - 增 / 删 / 替换 / 下载 .docx 模板文件
// 模板库跨公司共享，存 server/data/contract-templates/，由合同起草模块只读使用。
//
// 接口：
//   GET    /api/contract-templates           → { manifest, files:[{name,sizeBytes,updatedAt}] }
//   PUT    /api/contract-templates/manifest  → 保存指引 { content }
//   POST   /api/contract-templates/files     → 上传/替换模板（multipart file）
//   DELETE /api/contract-templates/files/:name → 删除模板
//   GET    /api/contract-templates/files/:name → 下载模板

import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requirePlatformAdmin } from '../auth.js'
import { DATA_ROOT, ensureDir, safeUnlink } from '../storage.js'
import {
  listTemplateFileStats, readManifest, writeManifest,
  saveTemplateFile, deleteTemplateFile, templateFileAbsPath,
} from '../draftTemplates.js'

const r = Router()
r.use(requireAuth, requirePlatformAdmin)

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')

function tplFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (ext === '.docx' || ext === '.doc') return cb(null, true)
  const err = new Error('模板文件只支持 Word（.docx/.doc）'); err.status = 400; cb(err)
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(TMP_ROOT); cb(null, TMP_ROOT) } catch (e) { cb(e) }
    },
    filename: (_req, _file, cb) => cb(null, `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: tplFileFilter,
})

// ─── GET / ───────────────────────────────────────────────────────────────────
r.get('/', async (_req, res, next) => {
  try {
    const [manifest, files] = await Promise.all([readManifest(), listTemplateFileStats()])
    res.json({ manifest: manifest || '', files })
  } catch (e) {
    next(e)
  }
})

// ─── PUT /manifest ─────────────────────────────────────────────────────────────
r.put('/manifest', async (req, res, next) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    if (content.length > 100000) return res.status(400).json({ error: '内容过长（上限约 10 万字符）' })
    await writeManifest(content)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// ─── POST /files（上传/替换） ───────────────────────────────────────────────────
r.post('/files', upload.single('file'), async (req, res, next) => {
  const tmpPath = req.file?.path || null
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' })
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const filename = await saveTemplateFile(req.file.path, originalName)   // rename 成功后 tmp 已移走
    res.status(201).json({ ok: true, filename })
  } catch (e) {
    if (tmpPath) await safeUnlink(tmpPath)
    if (e?.status === 400) return res.status(400).json({ error: e.message })
    next(e)
  }
})

// ─── DELETE /files/:name ────────────────────────────────────────────────────────
r.delete('/files/:name', async (req, res, next) => {
  try {
    await deleteTemplateFile(req.params.name)
    res.json({ ok: true })
  } catch (e) {
    if (e?.status === 404) return res.status(404).json({ error: e.message })
    next(e)
  }
})

// ─── GET /files/:name（下载） ───────────────────────────────────────────────────
r.get('/files/:name', async (req, res, next) => {
  try {
    const abs = await templateFileAbsPath(req.params.name)
    if (!abs) return res.status(404).json({ error: '模板文件不存在' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`)
    res.sendFile(abs)
  } catch (e) {
    next(e)
  }
})

export default r
