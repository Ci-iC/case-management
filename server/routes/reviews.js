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
import { requireAuth, requireSuperAdmin, isAdminOrAbove } from '../auth.js'
import { chatCompletion } from '../openai.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink } from '../storage.js'
import { createContractWithCode } from './contracts.js'

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

// 整合阶段的 system prompt：所有审核模型共用、写死，admin 不可改。
// 各节点并行产出的初稿可能有重复 / 同一条款被多角度点名 / 表述不一，
// 整合阶段把它们去重 + 合并相似项 + 层级内重排，输出最终版。
const CONSOLIDATION_SYSTEM_PROMPT = `你是一名资深合同法务，正在对一份合同的多角度初步审核结果做最终整合。

输入包含：
1. 合同原文
2. 多个审核角度产出的初步审核意见（已按"重大风险条款 / 一般风险条款 / 优化完善条款"三层级分类，但可能存在重复或表述差异）

你的任务：
1. 去重：针对同一条款的多条意见，合并为一条；如多条意见从不同角度指出同一问题，整合为更完整、更具操作性的一条
2. 统一表述：保留最准确、最专业的修改建议；revised_text 必须仍是可以直接替换原条款的完整版本
3. 层级合理化：如同一条款在不同角度被归入不同层级，统一归入更严重的层级
4. 层级内排序：每个层级内部，按对我方影响的严重程度从高到低排序

严格约束：
- 不得新增初稿中未提及的意见（不要自由发挥再审一遍）
- 不得遗漏初稿中的实质性意见（同义合并不算遗漏）
- 不得降低风险等级（"重大风险"→"一般风险"、"高"→"中"/"低" 均不允许；提升允许）
- original_text 必须仍是合同原文中的句子，不得改写或概括
- risk_level 仅可为 "高"、"中"、"低"

${SCHEMA_INSTRUCTION}`

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

/** 整合阶段：把初稿（多节点合并结果）+ 合同原文 再喂给 AI，做去重 / 合并相似项 / 层级内重排。
 *  prompt 写死，不带任何 admin 可配置项。失败时由调用方退化使用初稿。 */
async function consolidateReviewOpinions({ text, draft, contextPrompt, model, originalName }) {
  const userMsg = [
    '【我方立场与审核幅度（初稿生成时使用的视角，整合时保持一致）】',
    contextPrompt || '（未指定）',
    '',
    `【合同原文 — 文件名】${originalName || '未命名'}`,
    text,
    '',
    '【各角度初步审核意见（待整合）】',
    JSON.stringify(draft, null, 2),
  ].join('\n')

  const result = await chatCompletion({
    system: CONSOLIDATION_SYSTEM_PROMPT,
    user: userMsg,
    model,
    responseFormat: 'json_object',
  })

  let parsed
  try {
    parsed = JSON.parse(result.content)
  } catch {
    throw new Error('整合结果不是合法 JSON')
  }
  if (!Array.isArray(parsed?.review_opinions)) {
    throw new Error('整合结果缺少 review_opinions 数组')
  }

  // 复用 normalizeItem + 三层级分桶兜底，保证前端拿到的结构与 mergeReviewOpinions 一致
  const buckets = new Map(LEVELS.map(l => [l, []]))
  for (const layer of parsed.review_opinions) {
    const level = String(layer?.level || '').trim()
    if (!buckets.has(level)) continue
    const items = Array.isArray(layer?.items) ? layer.items : []
    for (const it of items) buckets.get(level).push(normalizeItem(it))
  }
  return {
    review_opinions: LEVELS.map(level => ({
      level,
      items: buckets.get(level).map((it, idx) => ({ ...it, serial_no: idx + 1 })),
    })),
  }
}

// ─── multer 配置：上传到 server/data/reviews/<userId>/<timestamp>_<filename> ───

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const REVIEWS_ROOT = path.join(DATA_ROOT, 'reviews')
const ATTACHMENTS_ROOT = path.join(DATA_ROOT, 'attachments')
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')

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

// 普通附件 multer：先存到 tmp，submit 创建消息后搬到 attachments/<message_id>/
// 跟 messages.js 里那份保持一致的策略
const tmpUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(TMP_ROOT); cb(null, TMP_ROOT) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 10 },
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
    contractId: row.contract_id || null,
    isDraft: !!row.is_draft,
    legalApproved: !!row.legal_approved,
    uploadedFilename: row.uploaded_filename,
    uploadedSizeBytes: row.uploaded_size_bytes != null ? Number(row.uploaded_size_bytes) : null,
    uploadedMimeType: row.uploaded_mime_type,
    reviewText: row.review_text,
    model: row.model,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    reviewedFilename: row.reviewed_filename || null,
    reviewedSizeBytes: row.reviewed_size_bytes != null ? Number(row.reviewed_size_bytes) : null,
    reviewedMimeType: row.reviewed_mime_type || null,
    reviewedBy: row.reviewed_by || null,
    reviewedByUsername: row.reviewed_by_username || null,
    reviewedByDisplayName: row.reviewed_by_display_name || null,
    reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : (row.reviewed_at || null),
  }
}

const REVIEW_SELECT = [
  'r.id', 'r.case_id', 'r.contract_id', 'r.is_draft', 'r.legal_approved',
  'r.uploaded_filename', 'r.uploaded_size_bytes', 'r.uploaded_mime_type',
  'r.review_text', 'r.model', 'r.created_by', 'r.created_at',
  'r.reviewed_filename', 'r.reviewed_size_bytes', 'r.reviewed_mime_type',
  'r.reviewed_by', 'r.reviewed_at',
  'u.username as created_by_username', 'u.display_name as created_by_display_name',
  'rv.username as reviewed_by_username', 'rv.display_name as reviewed_by_display_name',
]

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/reviews — 上传文件 + 触发 AI 审核（走审核模型，并行节点）
r.post('/', upload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' })
    savedAbsPath = req.file.path

    // 限制 Word 格式：源头保证整条链路（上传→AI→法务修订）都是可编辑文档
    {
      const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      const ext = path.extname(original).toLowerCase()
      if (ext !== '.doc' && ext !== '.docx') {
        await safeUnlink(savedAbsPath)
        return res.status(400).json({ error: '请上传 Word（.doc / .docx 格式）文档' })
      }
    }

    // case_id 仅当用户有案件权限时生效
    let caseId = null
    if (req.body?.caseId) {
      if (isAdminOrAbove(req.user) || req.user.canViewCases) {
        const caseRow = await db('cases').select('id').where({ id: req.body.caseId }).first()
        if (caseRow) caseId = caseRow.id
      }
    }

    // v1.2：合同关联推迟到"发送给法务审核"那一步（POST /api/reviews/:id/submit）
    // 本接口创建的 review 默认是草稿（is_draft=true），24h 内未提交会被清理

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
    const draft = mergeReviewOpinions(steps, stepResults)
    let usedModel = null
    for (const r2 of stepResults) {
      if (r2.status === 'fulfilled') { usedModel = r2.value.model; break }
    }
    // 全部节点失败才整体报错
    if (stepResults.every(r2 => r2.status === 'rejected')) {
      const firstError = stepResults[0].reason?.message || String(stepResults[0].reason)
      throw new Error(`所有节点都执行失败：${firstError}`)
    }

    // 整合：把初稿 + 合同原文再喂给 AI，做去重 / 合并相似项 / 层级内重排。
    // 整合失败不阻塞整次审核，退化使用初稿（保证可用性）。
    // 跳过整合的情况：初稿为空、或有效节点数 ≤ 1（无东西可去重，省一次 API 调用）
    const fulfilledCount = stepResults.filter(r2 => r2.status === 'fulfilled').length
    const draftItems = draft.review_opinions.reduce((n, layer) => n + layer.items.length, 0)
    let merged = draft
    let consolidationStatus = 'skipped'
    let consolidationSkipReason = null
    let consolidationError = null
    if (draftItems === 0) {
      consolidationSkipReason = 'empty-draft'
    } else if (fulfilledCount <= 1) {
      consolidationSkipReason = 'single-node'
    } else {
      try {
        merged = await consolidateReviewOpinions({
          text,
          draft,
          contextPrompt,
          model: req.body?.model,
          originalName,
        })
        consolidationStatus = 'success'
      } catch (e) {
        consolidationStatus = 'failed'
        consolidationError = e?.message || String(e)
      }
    }
    const reviewText = JSON.stringify(merged)

    const storagePath = toStoragePath(savedAbsPath)
    const [inserted] = await db('case_reviews').insert({
      case_id: caseId,
      contract_id: null,        // 草稿阶段不关联合同；发送给法务时再关联（submit 接口里）
      is_draft: true,           // 草稿态：24h 内若未发送给法务，会被定时清理
      uploaded_filename: originalName,
      uploaded_storage_path: storagePath,
      uploaded_size_bytes: req.file.size,
      uploaded_mime_type: req.file.mimetype,
      review_text: reviewText,
      model: usedModel,
      pipeline_id: pipeline.id,
      created_by: req.user.id,
    }, ['id'])

    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(REVIEW_SELECT)
      .where('r.id', inserted.id)
      .first()

    await writeAudit({
      actorId: req.user.id, action: 'review.create',
      targetType: 'review', targetId: inserted.id,
      payload: {
        caseId, filename: originalName, model: usedModel,
        pipeline: pipeline.name, steps: steps.length, textChars: text.length,
        draftItems,
        finalItems: merged.review_opinions.reduce((n, l) => n + l.items.length, 0),
        consolidation: consolidationStatus,
        ...(consolidationSkipReason ? { consolidationSkipReason } : {}),
        ...(consolidationError ? { consolidationError } : {}),
      },
    })

    res.status(201).json({ review: rowToReview(row) })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// GET /api/reviews?caseId=xxx&includeDrafts=1 — admin 看全部，普通用户只看自己
//   默认过滤掉草稿；本人需要看自己的草稿（合同审核页"历史审核"），可传 includeDrafts=1
r.get('/', async (req, res, next) => {
  try {
    let q = db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(REVIEW_SELECT)
      .orderBy('r.created_at', 'desc')

    if (req.query.caseId) q = q.where('r.case_id', String(req.query.caseId))
    if (!isAdminOrAbove(req.user)) q = q.where('r.created_by', req.user.id)

    // 默认隐藏草稿；草稿仅本人能看到（admin 也不看别人的草稿）
    const includeDrafts = req.query.includeDrafts === '1' || req.query.includeDrafts === 'true'
    if (!includeDrafts) {
      q = q.where('r.is_draft', false)
    } else {
      q = q.where(function () {
        this.where('r.is_draft', false).orWhere('r.created_by', req.user.id)
      })
    }

    const rows = await q.limit(200)
    res.json({ reviews: rows.map(rowToReview) })
  } catch (e) { next(e) }
})

// GET /api/reviews/:id — 详情
r.get('/:id', async (req, res, next) => {
  try {
    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(REVIEW_SELECT)
      .where('r.id', req.params.id)
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (!isAdminOrAbove(req.user) && row.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权访问该审核记录' })
    }
    res.json({ review: rowToReview(row) })
  } catch (e) { next(e) }
})

// POST /api/reviews/:id/submit — 把草稿审核提交并发送给法务审核
//   一次完成：自动建合同（或挂到已有合同）+ 转正 review（is_draft=false）+ 创建发法务的消息
//   仅创建人可调；review 必须仍是 draft
//   multipart：
//     - contractMode: 'new' | 'existing'
//     - contractName / contractDescription: 当 'new' 时必填 / 可选
//     - contractId: 当 'existing' 时必填，且必须未进入审批
//     - receiverId: 法务（admin）id
//     - body: 给法务的留言
//     - attachments: 普通附件（最多 10 个，可空）
r.post('/:id/submit', tmpUpload.array('attachments', 10), async (req, res, next) => {
  const tmpFiles = (req.files || []).map(f => f.path)
  try {
    // 1) 校验 review
    const reviewRow = await db('case_reviews')
      .where({ id: req.params.id })
      .first()
    if (!reviewRow) return res.status(404).json({ error: '审核记录不存在' })
    if (reviewRow.created_by !== req.user.id) {
      return res.status(403).json({ error: '只有审核创建人可以提交' })
    }
    if (!reviewRow.is_draft) {
      return res.status(400).json({ error: '该审核已经提交过，不能重复提交' })
    }

    // 2) 校验合同入参
    const contractMode = String(req.body?.contractMode || '').trim()
    if (contractMode !== 'new' && contractMode !== 'existing') {
      return res.status(400).json({ error: '请指定 contractMode（new 或 existing）' })
    }
    const contractName = String(req.body?.contractName || '').trim()
    const contractDescription = req.body?.contractDescription
      ? String(req.body.contractDescription).trim()
      : null
    const givenContractId = req.body?.contractId ? String(req.body.contractId) : null

    if (contractMode === 'new' && !contractName) {
      return res.status(400).json({ error: '请填写新合同名称' })
    }
    if (contractMode === 'existing' && !givenContractId) {
      return res.status(400).json({ error: '请选择已有合同' })
    }

    // 3) 校验 existing 合同的归属和"未审批"状态
    let existingContract = null
    if (contractMode === 'existing') {
      existingContract = await db('contracts').where({ id: givenContractId }).first()
      if (!existingContract) return res.status(404).json({ error: '指定的合同不存在' })
      const owner = existingContract.created_by === req.user.id
      if (!isAdminOrAbove(req.user) && !owner) {
        return res.status(403).json({ error: '无权关联该合同' })
      }
      if (existingContract.approval_started_at) {
        return res.status(400).json({ error: '该合同已进入审批流程，不能再添加新版本' })
      }
    }

    // 4) 校验收件人
    const receiverId = String(req.body?.receiverId || '').trim()
    if (!receiverId) return res.status(400).json({ error: '请选择收件人（法务）' })
    if (receiverId === req.user.id) return res.status(400).json({ error: '不能给自己发消息' })
    const receiver = await db('users').select('id').where({ id: receiverId }).first()
    if (!receiver) return res.status(404).json({ error: '收件人不存在' })

    const messageBody = String(req.body?.body || '').trim()
    if (!messageBody) return res.status(400).json({ error: '请填写留言' })

    // 5) 事务：建/挂合同 + 转正 review + 创建消息 + 写附件
    const result = await db.transaction(async (trx) => {
      let contractRow
      if (contractMode === 'new') {
        const created = await createContractWithCode(trx, {
          name: contractName,
          description: contractDescription,
          ownerId: req.user.id,
        })
        contractRow = await trx('contracts').where({ id: created.id }).first()
      } else {
        // 蹭一下 updated_at 让它排在台账顶部
        await trx('contracts').where({ id: existingContract.id }).update({ updated_at: new Date() })
        contractRow = await trx('contracts').where({ id: existingContract.id }).first()
      }

      // 转正 review
      await trx('case_reviews').where({ id: reviewRow.id }).update({
        contract_id: contractRow.id,
        is_draft: false,
      })

      // 创建消息
      const [msgInserted] = await trx('messages').insert({
        sender_id: req.user.id,
        receiver_id: receiverId,
        body: messageBody,
        case_id: reviewRow.case_id || null,
        review_id: reviewRow.id,
        is_read: false,
      }, ['id'])
      const messageId = msgInserted.id

      // 引用附件：合同原文（kind=original，不复制物理文件）
      await trx('message_attachments').insert({
        message_id: messageId,
        review_id: reviewRow.id,
        review_file_kind: 'original',
        filename: reviewRow.uploaded_filename,
        storage_path: null,
        size_bytes: reviewRow.uploaded_size_bytes,
        mime_type: reviewRow.uploaded_mime_type,
      })

      // 普通附件：从 tmp 搬到 attachments/<message_id>/
      if (req.files && req.files.length > 0) {
        const attDir = path.join(ATTACHMENTS_ROOT, messageId)
        await ensureDir(attDir)
        for (const f of req.files) {
          const original = Buffer.from(f.originalname, 'latin1').toString('utf8')
          const target = path.join(attDir, `${Date.now()}_${safeFilename(original)}`)
          await fs.rename(f.path, target)
          await trx('message_attachments').insert({
            message_id: messageId,
            filename: original,
            storage_path: toStoragePath(target),
            size_bytes: f.size,
            mime_type: f.mimetype,
          })
        }
      }

      return { contractId: contractRow.id, messageId }
    })

    // 6) 审计
    await writeAudit({
      actorId: req.user.id, action: 'review.submit',
      targetType: 'review', targetId: reviewRow.id,
      payload: {
        contractMode, contractId: result.contractId,
        receiverId, messageId: result.messageId,
        attachmentCount: (req.files || []).length,
      },
    })

    // 7) 返回最新 review（含 contract_id + is_draft=false）
    const fresh = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(REVIEW_SELECT)
      .where('r.id', reviewRow.id)
      .first()

    res.status(201).json({
      review: rowToReview(fresh),
      contractId: result.contractId,
      messageId: result.messageId,
    })
  } catch (e) {
    // 失败时清理 tmp（messages 创建里搬走的部分会留下来——但搬之前事务回滚了 messages，所以不会有孤儿）
    for (const p of tmpFiles) await safeUnlink(p)
    next(e)
  }
})

// GET /api/reviews/:id/file — 下载原始文件
r.get('/:id/file', async (req, res, next) => {
  try {
    const row = await db('case_reviews')
      .select('uploaded_filename', 'uploaded_storage_path', 'uploaded_mime_type', 'created_by')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (!isAdminOrAbove(req.user) && row.created_by !== req.user.id) {
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

// ─── 法务审核版：法务（superadmin）上传修订稿，业务人员能下载 ──────────────────

// POST /api/reviews/:id/legal-revision —— 仅 superadmin 上传修订版（限 Word 文档）
// v1.3.2 起：法务工作只允许 superadmin（admin 是高管/业务方角色，不参与法务工作）
r.post('/:id/legal-revision', requireSuperAdmin, upload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传修订版文件' })
    savedAbsPath = req.file.path

    // 法务审核版必须是 Word 文档，方便业务人员后续继续修订
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const ext = path.extname(original).toLowerCase()
    if (ext !== '.doc' && ext !== '.docx') {
      await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '法务审核版必须是 Word 文档（.doc 或 .docx）' })
    }

    const review = await db('case_reviews').where({ id: req.params.id }).first()
    if (!review) {
      await safeUnlink(savedAbsPath)
      return res.status(404).json({ error: '审核记录不存在' })
    }

    // 旧的法务版（如果有）先删除文件，再用新的覆盖
    if (review.reviewed_storage_path) {
      await safeUnlink(toAbsolutePath(review.reviewed_storage_path))
    }

    const storagePath = toStoragePath(savedAbsPath)

    await db('case_reviews').where({ id: review.id }).update({
      reviewed_filename: original,
      reviewed_storage_path: storagePath,
      reviewed_size_bytes: req.file.size,
      reviewed_mime_type: req.file.mimetype,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    })

    // 自动给业务方（review 的 created_by）发一条站内信：
    //   - 不依赖合同台账权限，业务方在消息中心就能直接下载法务版
    //   - 附件用 review-legal 引用，不复制物理文件
    //   - 发件失败不阻塞接口返回（修订版主流程已成功）
    let notifyMessageId = null
    let notifyError = null
    // v1.3.1: 法务可附带留言，拼进消息正文
    const legalComment = req.body?.comment ? String(req.body.comment).trim() : ''

    if (review.created_by && review.created_by !== req.user.id) {
      try {
        await db.transaction(async (trx) => {
          const baseBody =
            `您提交审核的合同《${review.uploaded_filename}》法务审核版已上传，` +
            `请在本消息附件中下载查阅。如需继续修订，可下载后在 Word 中编辑。`
          const finalBody = legalComment
            ? `${baseBody}\n\n【法务留言】\n${legalComment}`
            : baseBody
          const [msgRow] = await trx('messages').insert({
            sender_id: req.user.id,
            receiver_id: review.created_by,
            body: finalBody,
            review_id: review.id,
            is_read: false,
          }, ['id'])
          notifyMessageId = msgRow.id

          await trx('message_attachments').insert({
            message_id: notifyMessageId,
            review_id: review.id,
            review_file_kind: 'legal',
            filename: original,
            storage_path: null,  // 引用 case_reviews.reviewed_storage_path
            size_bytes: req.file.size,
            mime_type: req.file.mimetype,
          })
        })
      } catch (e) {
        notifyError = e?.message || String(e)
      }
    }

    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(REVIEW_SELECT)
      .where('r.id', review.id)
      .first()

    await writeAudit({
      actorId: req.user.id, action: 'review.legal_revision',
      targetType: 'review', targetId: review.id,
      payload: {
        filename: original, size: req.file.size,
        notifyMessageId,
        ...(notifyError ? { notifyError } : {}),
      },
    })

    res.json({ review: rowToReview(row), notified: !!notifyMessageId })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// POST /api/reviews/:id/legal-approve —— 法务"无需修订，直接通过"
//   不上传修订版，只标记 case_reviews.legal_approved=true，给业务方发站内信告知
//   业务方可以选择继续自己改材料，也可以直接拿当前版本去发起合同审批
//   body: { comment? }
// v1.3.2 起：法务工作只允许 superadmin（admin 是高管/业务方角色，不参与法务工作）
r.post('/:id/legal-approve', requireSuperAdmin, async (req, res, next) => {
  try {
    const review = await db('case_reviews').where({ id: req.params.id }).first()
    if (!review) return res.status(404).json({ error: '审核记录不存在' })
    if (review.is_draft) {
      return res.status(400).json({ error: '该审核还是草稿，不能直接通过' })
    }

    const legalComment = req.body?.comment ? String(req.body.comment).trim() : ''

    // 标记法务通过
    await db('case_reviews').where({ id: review.id }).update({
      legal_approved: true,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    })

    // 给业务方发站内信，并把原合同作为引用附件挂上（跟 legal-revision 行为对齐）
    let notifyMessageId = null
    let notifyError = null
    if (review.created_by && review.created_by !== req.user.id) {
      try {
        await db.transaction(async (trx) => {
          const baseBody =
            `您提交审核的合同《${review.uploaded_filename}》法务无修订意见，` +
            `当前版本可直接用于发起合同审批。如需继续修订也可自行调整后再发起。`
          const finalBody = legalComment
            ? `${baseBody}\n\n【法务留言】\n${legalComment}`
            : baseBody
          const [msgRow] = await trx('messages').insert({
            sender_id: req.user.id,
            receiver_id: review.created_by,
            body: finalBody,
            review_id: review.id,
            is_read: false,
          }, ['id'])
          notifyMessageId = msgRow.id

          // 引用附件：原合同（review_file_kind='original'，下载时跟到 case_reviews.uploaded_storage_path）
          if (review.uploaded_storage_path) {
            await trx('message_attachments').insert({
              message_id: notifyMessageId,
              review_id: review.id,
              review_file_kind: 'original',
              filename: review.uploaded_filename,
              storage_path: null,
              size_bytes: review.uploaded_size_bytes,
              mime_type: review.uploaded_mime_type,
            })
          }
        })
      } catch (e) {
        notifyError = e?.message || String(e)
      }
    }

    const row = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(REVIEW_SELECT)
      .where('r.id', review.id)
      .first()

    await writeAudit({
      actorId: req.user.id, action: 'review.legal_approve',
      targetType: 'review', targetId: review.id,
      payload: { notifyMessageId, ...(notifyError ? { notifyError } : {}) },
    })

    res.json({ review: rowToReview(row), notified: !!notifyMessageId })
  } catch (e) { next(e) }
})

// GET /api/reviews/:id/legal-file —— 下载法务版
// 权限：admin / 创建人 / 有合同台账权限的用户
r.get('/:id/legal-file', async (req, res, next) => {
  try {
    const row = await db('case_reviews')
      .select('reviewed_filename', 'reviewed_storage_path', 'reviewed_mime_type', 'created_by')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (!row.reviewed_storage_path) return res.status(404).json({ error: '该版本还没有法务审核版' })

    const allowed =
      isAdminOrAbove(req.user) ||
      req.user.canViewContracts ||
      row.created_by === req.user.id
    if (!allowed) return res.status(403).json({ error: '无权下载法务审核版' })

    res.setHeader('Content-Type', row.reviewed_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.reviewed_filename)}`)
    res.sendFile(toAbsolutePath(row.reviewed_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

export default r

// ─── 草稿清理：删除 24h 前未提交的 draft（DB 行 + 磁盘文件） ──────────────────
//   服务启动时调一次，之后每小时跑一次（在 server/index.js 里调度）
//   draft 的 review 不会被消息引用（消息只在 submit 时创建），删除安全
export async function cleanupStaleDrafts({ maxAgeHours = 24 } = {}) {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000)
  const stale = await db('case_reviews')
    .select('id', 'uploaded_storage_path')
    .where('is_draft', true)
    .where('created_at', '<', cutoff)
  if (stale.length === 0) return { count: 0 }

  for (const row of stale) {
    if (row.uploaded_storage_path) {
      await safeUnlink(toAbsolutePath(row.uploaded_storage_path))
    }
  }
  await db('case_reviews').whereIn('id', stale.map(r => r.id)).delete()
  return { count: stale.length }
}
