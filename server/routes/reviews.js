// AI 合同审核：上传文件 → 提取文本 → 调 OpenAI → 存 case_reviews
//
// 权限：
//   - 任何登录用户都能创建/查看自己的审核
//   - admin 能查看所有人的审核
//   - 关联 case_id 需要案件管理权限（无权限的用户不能挂到具体案件）
//   - 删除：仅创建人或 admin

import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { db, writeAudit } from '../db.js'
import { requireAuth } from '../auth.js'
import { chatCompletion } from '../openai.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink } from '../storage.js'

const r = Router()
r.use(requireAuth)

// ─── multer 配置：上传到 server/data/reviews/<userId>/<timestamp>_<filename> ───

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const REVIEWS_ROOT = path.join(DATA_ROOT, 'reviews')

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const dir = path.join(REVIEWS_ROOT, req.user.id)
      try { await ensureDir(dir); cb(null, dir) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      // 修复 multer 默认 latin1 文件名为 UTF-8（前端 fetch FormData 走 utf-8）
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
})

// ─── 文本提取 ─────────────────────────────────────────────────────────────────

async function extractText(absPath, mimeType, originalName) {
  const ext = path.extname(originalName).toLowerCase()

  if (ext === '.txt' || mimeType === 'text/plain') {
    return (await fs.readFile(absPath, 'utf8')).trim()
  }
  if (ext === '.docx' || ext === '.doc' || mimeType?.includes('word')) {
    const mammoth = (await import('mammoth')).default
    const buf = await fs.readFile(absPath)
    const result = await mammoth.extractRawText({ buffer: buf })
    return (result.value || '').trim()
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js')
    const buf = await fs.readFile(absPath)
    const result = await pdfParse(buf)
    return (result.text || '').trim()
  }
  throw new Error(`暂不支持的文件类型：${ext || mimeType}（仅支持 .pdf/.docx/.doc/.txt）`)
}

// ─── 行列映射 ─────────────────────────────────────────────────────────────────

function rowToReview(row) {
  if (!row) return null
  return {
    id: row.id,
    caseId: row.case_id,
    uploadedFilename: row.uploaded_filename,
    uploadedSizeBytes: row.uploaded_size_bytes != null ? Number(row.uploaded_size_bytes) : null,
    uploadedMimeType: row.uploaded_mime_type,
    reviewText: row.review_text,
    model: row.model,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }
}

const REVIEW_SELECT = [
  'r.id', 'r.case_id', 'r.uploaded_filename', 'r.uploaded_size_bytes', 'r.uploaded_mime_type',
  'r.review_text', 'r.model', 'r.created_by', 'r.created_at',
  'u.username as created_by_username', 'u.display_name as created_by_display_name',
]

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/reviews — 上传文件 + 触发 AI 审核
r.post('/', upload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' })
    savedAbsPath = req.file.path

    // case_id 仅当用户有案件权限时生效
    let caseId = null
    if (req.body?.caseId) {
      if (req.user.role !== 'admin' && !req.user.canViewCases) {
        // 静默忽略（无权限就不让挂案件，不报错）
      } else {
        const caseRow = await db('cases').select('id').where({ id: req.body.caseId }).first()
        if (caseRow) caseId = caseRow.id
      }
    }

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const text = await extractText(req.file.path, req.file.mimetype, originalName)
    if (!text) throw new Error('文件中提取不到任何文字')
    if (text.length > 200_000) {
      throw new Error('文件文字超过 20 万字，请分片审核')
    }

    // 取系统提示词
    const promptRow = await db('app_settings').where({ key: 'review_prompt' }).first()
    const systemPrompt = promptRow?.value || '你是一名企业法务，请审核以下文件并给出修改建议。'

    const userMsg = `【文件名】${originalName}\n\n【文件全文】\n${text}`
    const ai = await chatCompletion({ system: systemPrompt, user: userMsg, model: req.body?.model })

    const storagePath = toStoragePath(savedAbsPath)
    const [inserted] = await db('case_reviews').insert({
      case_id: caseId,
      uploaded_filename: originalName,
      uploaded_storage_path: storagePath,
      uploaded_size_bytes: req.file.size,
      uploaded_mime_type: req.file.mimetype,
      review_text: ai.content,
      model: ai.model,
      created_by: req.user.id,
    }, ['id'])

    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .select(REVIEW_SELECT)
      .where('r.id', inserted.id)
      .first()

    await writeAudit({
      actorId: req.user.id, action: 'review.create',
      targetType: 'review', targetId: inserted.id,
      payload: { caseId, filename: originalName, model: ai.model, textChars: text.length },
    })

    res.status(201).json({ review: rowToReview(row) })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// GET /api/reviews?caseId=xxx — admin 看全部，普通用户只看自己
r.get('/', async (req, res, next) => {
  try {
    let q = db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .select(REVIEW_SELECT)
      .orderBy('r.created_at', 'desc')

    if (req.query.caseId) q = q.where('r.case_id', String(req.query.caseId))
    if (req.user.role !== 'admin') q = q.where('r.created_by', req.user.id)

    const rows = await q.limit(200)
    res.json({ reviews: rows.map(rowToReview) })
  } catch (e) { next(e) }
})

// GET /api/reviews/:id — 详情
r.get('/:id', async (req, res, next) => {
  try {
    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .select(REVIEW_SELECT)
      .where('r.id', req.params.id)
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (req.user.role !== 'admin' && row.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权访问该审核记录' })
    }
    res.json({ review: rowToReview(row) })
  } catch (e) { next(e) }
})

// GET /api/reviews/:id/file — 下载原始文件
r.get('/:id/file', async (req, res, next) => {
  try {
    const row = await db('case_reviews')
      .select('uploaded_filename', 'uploaded_storage_path', 'uploaded_mime_type', 'created_by')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (req.user.role !== 'admin' && row.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权下载该文件' })
    }
    const abs = toAbsolutePath(row.uploaded_storage_path)
    res.setHeader('Content-Type', row.uploaded_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.uploaded_filename)}`)
    res.sendFile(abs, (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

// DELETE /api/reviews/:id
r.delete('/:id', async (req, res, next) => {
  try {
    const row = await db('case_reviews')
      .select('id', 'uploaded_storage_path', 'created_by', 'uploaded_filename')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (req.user.role !== 'admin' && row.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权删除该审核记录' })
    }
    await db('case_reviews').where({ id: row.id }).delete()
    await safeUnlink(toAbsolutePath(row.uploaded_storage_path))
    await writeAudit({
      actorId: req.user.id, action: 'review.delete',
      targetType: 'review', targetId: row.id,
      payload: { filename: row.uploaded_filename },
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

export default r
