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
import { ensureContractByName } from './contracts.js'

const r = Router()
r.use(requireAuth)

// ─── 统一审核结果 JSON Schema ─────────────────────────────────────────────────
// 所有审核模型节点的 prompt 后面都会追加这段，强制模型按统一格式输出。
// 每节点的 prompt 决定"审什么角度"，schema 决定"用什么形式输出"。

const LEVELS = ['重大风险条款', '一般风险条款', '优化完善条款']

// 上传时用户可指定"我方立场"和"审核幅度"，拼成一段附加指令引导 AI

const INTENSITY_GUIDE = {
  strict:
    '【审核幅度】严格的审核标准，尽可能争取我方利益。' +
    '所有对我方可能不利的条款都要识别，争取每一处对我方更有利的修改空间。',
  medium:
    '【审核幅度】中等审核标准，按常规企业法务标准识别明显的风险条款和需优化的条款。',
  lenient:
    '【审核幅度】宽松审核标准，只标记明显的、严重的法律风险或商业损失条款。' +
    '次要的表述瑕疵、约定俗成的标准条款不必挑剔。',
}

function buildContextPrompt({ ourRole, reviewIntensity }) {
  const lines = []
  // ourRole 是 freeform 字符串：前端可填"甲方"/"乙方"/自定义角色（如"第三方"/"赞助方"）
  const role = String(ourRole || '').trim().slice(0, 50)
  if (role) {
    lines.push(
      `【我方立场】我方在本合同中的角色是：${role}。` +
      `请优先识别对我方（${role}）不利的条款、潜在不公平待遇、过度义务，以及对方的免责或权利扩张。`
    )
  }
  const intensityKey = reviewIntensity && INTENSITY_GUIDE[reviewIntensity] ? reviewIntensity : 'medium'
  lines.push(INTENSITY_GUIDE[intensityKey])
  return lines.join('\n')
}

const SCHEMA_INSTRUCTION = `请严格按以下 JSON 格式输出（仅输出合法 JSON 对象，不要 Markdown、不要解释、不要代码块包裹）：

{
  "review_opinions": [
    {
      "level": "重大风险条款",
      "items": [
        {
          "serial_no": 1,
          "clause_no": "第 X.X 条",
          "original_text": "合同原文（不要自行概括，引用原句）",
          "revised_text": "可以直接替换原条款的修改版本",
          "comment": "修改意见，简要说明问题、风险和修改理由",
          "risk_level": "高"
        }
      ]
    },
    { "level": "一般风险条款", "items": [] },
    { "level": "优化完善条款", "items": [] }
  ]
}

字段约束：
- review_opinions 必须固定包含上述三个 level 对象，顺序固定
- items 是数组；该层级没意见时返回 []
- clause_no：合同有编号就引原编号（如"第 2.3 条"）；没有则填"未编号条款"
- original_text 必须引用合同原文，不要自行概括
- revised_text 必须是可以直接替换原条款的完整修改版本
- risk_level 只能是 "高"、"中"、"低" 三选一
- 如果你这次审核的角度不涉及某个层级，把那个层级的 items 留空即可`

/** 把多个节点的 JSON 合并成一份；按 level 拼 items，serial_no 重新编号 */
function mergeReviewOpinions(steps, results) {
  const buckets = new Map(LEVELS.map(l => [l, []]))
  for (let i = 0; i < steps.length; i++) {
    const r = results[i]
    if (r.status !== 'fulfilled') continue
    let parsed
    try {
      parsed = JSON.parse(r.value.content)
    } catch {
      continue  // 单节点 JSON 解析失败：跳过它的贡献，不阻塞其他节点
    }
    if (!Array.isArray(parsed?.review_opinions)) continue
    for (const layer of parsed.review_opinions) {
      const level = String(layer?.level || '').trim()
      if (!buckets.has(level)) continue
      const items = Array.isArray(layer?.items) ? layer.items : []
      for (const it of items) {
        buckets.get(level).push(normalizeItem(it))
      }
    }
  }
  // 重新编号 serial_no（按 level 内的顺序），输出固定三层级
  return {
    review_opinions: LEVELS.map(level => ({
      level,
      items: buckets.get(level).map((it, idx) => ({ ...it, serial_no: idx + 1 })),
    })),
  }
}

function normalizeItem(it) {
  const allowedRisk = new Set(['高', '中', '低'])
  const risk = String(it?.risk_level || '').trim()
  return {
    serial_no: 0,  // 合并时重排
    clause_no: String(it?.clause_no || '未编号条款').trim() || '未编号条款',
    original_text: String(it?.original_text || '').trim(),
    revised_text: String(it?.revised_text || '').trim(),
    comment: String(it?.comment || '').trim(),
    risk_level: allowedRisk.has(risk) ? risk : '中',
  }
}

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
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default
    const buf = await fs.readFile(absPath)
    const result = await mammoth.extractRawText({ buffer: buf })
    return (result.value || '').trim()
  }
  if (ext === '.doc') {
    // 老版 .doc 是 OLE 二进制，用 word-extractor 读取
    const WordExtractor = (await import('word-extractor')).default
    const extractor = new WordExtractor()
    const doc = await extractor.extract(absPath)
    return (doc.getBody() || '').trim()
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    // pdfjs-dist legacy 是 Mozilla 官方维护，比 pdf-parse 内置的老 pdfjs 兼容性好
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const buf = await fs.readFile(absPath)
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise
    const parts = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      // PDF 里每个 textItem 可能跨多行，str 合并即可
      parts.push(content.items.map(it => ('str' in it) ? it.str : '').join(' '))
    }
    await doc.destroy()
    return parts.join('\n').trim()
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

// POST /api/reviews — 上传文件 + 触发 AI 审核（走审核模型，并行节点）
r.post('/', upload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' })
    savedAbsPath = req.file.path

    // case_id 仅当用户有案件权限时生效
    let caseId = null
    if (req.body?.caseId) {
      if (req.user.role === 'admin' || req.user.canViewCases) {
        const caseRow = await db('cases').select('id').where({ id: req.body.caseId }).first()
        if (caseRow) caseId = caseRow.id
      }
    }

    // 合同台账关联：优先 contractId，没传就用 contractName 找/建
    let contractId = null
    if (req.body?.contractId) {
      const cRow = await db('contracts').select('id', 'created_by').where({ id: req.body.contractId }).first()
      if (cRow && (req.user.role === 'admin' || cRow.created_by === req.user.id)) {
        contractId = cRow.id
      }
    }
    if (!contractId && req.body?.contractName) {
      contractId = await ensureContractByName(req.user.id, req.body.contractName)
    }

    // 选审核模型：用户传了 pipelineId 则用之，否则用 is_default
    let pipeline
    if (req.body?.pipelineId) {
      pipeline = await db('pipelines').where({ id: req.body.pipelineId }).first()
      if (!pipeline) throw new Error('指定的审核模型不存在')
    } else {
      pipeline = await db('pipelines').where({ is_default: true }).first()
      if (!pipeline) throw new Error('系统未配置默认审核模型')
    }

    const steps = await db('pipeline_steps')
      .where({ pipeline_id: pipeline.id, enabled: true })
      .orderBy('position', 'asc')
    if (steps.length === 0) throw new Error('审核模型没有启用的节点')

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const text = await extractText(req.file.path, req.file.mimetype, originalName)
    if (!text) throw new Error('文件中提取不到任何文字')
    if (text.length > 200_000) {
      throw new Error('文件文字超过 20 万字，请分片审核')
    }

    // 我方立场 + 审核幅度（用户上传时指定，拼到每节点 system 顶部）
    const contextPrompt = buildContextPrompt({
      ourRole: req.body?.ourRole,
      reviewIntensity: req.body?.reviewIntensity,
    })

    // 并行调 AI：每个 step 独立提示词；每节点都强制返回统一的三层级 JSON Schema
    const userMsg = `【文件名】${originalName}\n\n【文件全文】\n${text}`
    const stepResults = await Promise.allSettled(
      steps.map(s => chatCompletion({
        system: `${contextPrompt}\n\n${s.prompt}\n\n${SCHEMA_INSTRUCTION}`,
        user: userMsg,
        model: req.body?.model,
        responseFormat: 'json_object',
      }))
    )

    // 解析 + 合并：按层级把各节点的 items 拼起来，serial_no 重新编号
    const merged = mergeReviewOpinions(steps, stepResults)
    let usedModel = null
    for (const r2 of stepResults) {
      if (r2.status === 'fulfilled') { usedModel = r2.value.model; break }
    }
    // 全部节点失败才整体报错
    if (stepResults.every(r2 => r2.status === 'rejected')) {
      const firstError = stepResults[0].reason?.message || String(stepResults[0].reason)
      throw new Error(`所有节点都执行失败：${firstError}`)
    }
    const reviewText = JSON.stringify(merged)

    const storagePath = toStoragePath(savedAbsPath)
    const [inserted] = await db('case_reviews').insert({
      case_id: caseId,
      contract_id: contractId,
      uploaded_filename: originalName,
      uploaded_storage_path: storagePath,
      uploaded_size_bytes: req.file.size,
      uploaded_mime_type: req.file.mimetype,
      review_text: reviewText,
      model: usedModel,
      pipeline_id: pipeline.id,
      created_by: req.user.id,
    }, ['id'])

    // 更新合同的 updated_at（让最新审核的合同排在台账顶部）
    if (contractId) {
      await db('contracts').where({ id: contractId }).update({ updated_at: new Date() })
    }

    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .select(REVIEW_SELECT)
      .where('r.id', inserted.id)
      .first()

    await writeAudit({
      actorId: req.user.id, action: 'review.create',
      targetType: 'review', targetId: inserted.id,
      payload: { caseId, filename: originalName, model: usedModel, pipeline: pipeline.name, steps: steps.length, textChars: text.length },
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

// DELETE /api/reviews/:id —— 禁用：审核记录是合同台账追溯的依据，不允许删除
// 如需真的清理（如误上传敏感文件），由 DBA 直接操作数据库
r.delete('/:id', async (_req, res) => {
  return res.status(403).json({
    error: '审核记录不允许删除（合同台账需要完整追溯）',
  })
})

export default r
