// AI 合同审核 v2.0：上传文件 → 提取文本 → 调 OpenAI → 存 case_reviews（多租户）
//
// 权限：
//   - 列表/详情：当前公司里创建人能看自己的，manager/legal/seal_admin/finance 看全部
//   - POST：当前公司任何角色都能上传审核
//   - submit：仅创建人（把草稿转正、挂合同、发法务）
//   - legal-revision / legal-approve：当前公司里的 legal 角色（"法务岗"）
//   - 下载文件：合同台账可读权限（即 canReadContractRow 的对应）

import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { db, writeAudit } from '../db.js'
import {
  requireAuth, requireCompanyContext, requireCompanyRole, hasCompanyRole,
} from '../auth.js'
import { chatCompletion } from '../openai.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink } from '../storage.js'
import { createContractWithCode } from './contracts.js'

const r = Router()
r.use(requireAuth, requireCompanyContext)

const LEVELS = ['重大风险条款', '一般风险条款', '优化完善条款']

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
    { "level": "重大风险条款", "items": [
      { "serial_no": 1, "clause_no": "第 X.X 条", "original_text": "...", "revised_text": "...", "comment": "...", "risk_level": "高" }
    ]},
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
- 不得新增初稿中未提及的意见
- 不得遗漏初稿中的实质性意见
- 不得降低风险等级
- original_text 必须仍是合同原文中的句子
- risk_level 仅可为 "高"、"中"、"低"

${SCHEMA_INSTRUCTION}`

function mergeReviewOpinions(steps, results) {
  const buckets = new Map(LEVELS.map(l => [l, []]))
  for (let i = 0; i < steps.length; i++) {
    const r2 = results[i]
    if (r2.status !== 'fulfilled') continue
    let parsed
    try { parsed = JSON.parse(r2.value.content) } catch { continue }
    if (!Array.isArray(parsed?.review_opinions)) continue
    for (const layer of parsed.review_opinions) {
      const level = String(layer?.level || '').trim()
      if (!buckets.has(level)) continue
      const items = Array.isArray(layer?.items) ? layer.items : []
      for (const it of items) buckets.get(level).push(normalizeItem(it))
    }
  }
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
    serial_no: 0,
    clause_no: String(it?.clause_no || '未编号条款').trim() || '未编号条款',
    original_text: String(it?.original_text || '').trim(),
    revised_text: String(it?.revised_text || '').trim(),
    comment: String(it?.comment || '').trim(),
    risk_level: allowedRisk.has(risk) ? risk : '中',
  }
}

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
  try { parsed = JSON.parse(result.content) } catch { throw new Error('整合结果不是合法 JSON') }
  if (!Array.isArray(parsed?.review_opinions)) throw new Error('整合结果缺少 review_opinions 数组')

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
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
})

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
    const WordExtractor = (await import('word-extractor')).default
    const extractor = new WordExtractor()
    const doc = await extractor.extract(absPath)
    return (doc.getBody() || '').trim()
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const buf = await fs.readFile(absPath)
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise
    const parts = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map(it => ('str' in it) ? it.str : '').join(' '))
    }
    await doc.destroy()
    return parts.join('\n').trim()
  }
  throw new Error(`暂不支持的文件类型：${ext || mimeType}（仅支持 .pdf/.docx/.doc/.txt）`)
}

function rowToReview(row) {
  if (!row) return null
  return {
    id: row.id,
    caseId: row.case_id,
    contractId: row.contract_id || null,
    companyId: row.company_id,
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
  'r.id', 'r.case_id', 'r.contract_id', 'r.company_id', 'r.is_draft', 'r.legal_approved',
  'r.uploaded_filename', 'r.uploaded_size_bytes', 'r.uploaded_mime_type',
  'r.review_text', 'r.model', 'r.created_by', 'r.created_at',
  'r.reviewed_filename', 'r.reviewed_size_bytes', 'r.reviewed_mime_type',
  'r.reviewed_by', 'r.reviewed_at',
  'u.username as created_by_username', 'u.display_name as created_by_display_name',
  'rv.username as reviewed_by_username', 'rv.display_name as reviewed_by_display_name',
]

function selectReviewBase() {
  return db('case_reviews as r')
    .leftJoin('users as u', 'r.created_by', 'u.id')
    .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
    .select(REVIEW_SELECT)
}

function canSeeAllReviews(reqUser) {
  return reqUser.companyRoles?.some(r => ['manager', 'legal', 'seal_admin', 'finance'].includes(r))
}

// POST /api/reviews — 上传 + AI 审核
r.post('/', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'),
  upload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' })
    savedAbsPath = req.file.path

    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const ext = path.extname(original).toLowerCase()
    if (ext !== '.doc' && ext !== '.docx') {
      await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '请上传 Word（.doc / .docx 格式）文档' })
    }

    // case_id 仅当用户有 manager/legal 时生效（v2.0: 案件跨公司共享，无 company_id）
    let caseId = null
    if (req.body?.caseId && (hasCompanyRole(req, 'manager') || hasCompanyRole(req, 'legal'))) {
      const caseRow = await db('cases').select('id').where({ id: req.body.caseId }).first()
      if (caseRow) caseId = caseRow.id
    }

    // 选审核模型：传 pipelineId 则用；否则取当前公司的第一条 / 全平台共享的第一条
    let pipeline
    if (req.body?.pipelineId) {
      pipeline = await db('pipelines').where({ id: req.body.pipelineId }).first()
      if (!pipeline) throw new Error('指定的审核模型不存在')
      // 校验可见性（当前公司 或 共享 NULL）
      if (pipeline.company_id && pipeline.company_id !== req.user.currentCompanyId) {
        throw new Error('该审核模型不属于当前公司')
      }
    } else {
      pipeline = await db('pipelines')
        .where(function () {
          this.where('company_id', req.user.currentCompanyId).orWhereNull('company_id')
        })
        .orderBy([{ column: 'company_id', order: 'desc' }, { column: 'name', order: 'asc' }])
        .first()
      if (!pipeline) throw new Error('当前公司没有可用的审核模型')
    }

    const steps = await db('pipeline_steps')
      .where({ pipeline_id: pipeline.id, enabled: true })
      .orderBy('position', 'asc')
    if (steps.length === 0) throw new Error('审核模型没有启用的节点')

    const text = await extractText(req.file.path, req.file.mimetype, original)
    if (!text) throw new Error('文件中提取不到任何文字')
    if (text.length > 200_000) throw new Error('文件文字超过 20 万字，请分片审核')

    const contextPrompt = buildContextPrompt({
      ourRole: req.body?.ourRole,
      reviewIntensity: req.body?.reviewIntensity,
    })

    const userMsg = `【文件名】${original}\n\n【文件全文】\n${text}`
    const stepResults = await Promise.allSettled(
      steps.map(s => chatCompletion({
        system: `${contextPrompt}\n\n${s.prompt}\n\n${SCHEMA_INSTRUCTION}`,
        user: userMsg,
        model: req.body?.model,
        responseFormat: 'json_object',
      }))
    )

    const draft = mergeReviewOpinions(steps, stepResults)
    let usedModel = null
    for (const r2 of stepResults) {
      if (r2.status === 'fulfilled') { usedModel = r2.value.model; break }
    }
    if (stepResults.every(r2 => r2.status === 'rejected')) {
      const firstError = stepResults[0].reason?.message || String(stepResults[0].reason)
      throw new Error(`所有节点都执行失败：${firstError}`)
    }

    const fulfilledCount = stepResults.filter(r2 => r2.status === 'fulfilled').length
    const draftItems = draft.review_opinions.reduce((n, layer) => n + layer.items.length, 0)
    let merged = draft
    let consolidationStatus = 'skipped'
    let consolidationSkipReason = null
    let consolidationError = null
    if (draftItems === 0) consolidationSkipReason = 'empty-draft'
    else if (fulfilledCount <= 1) consolidationSkipReason = 'single-node'
    else {
      try {
        merged = await consolidateReviewOpinions({
          text, draft, contextPrompt, model: req.body?.model, originalName: original,
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
      contract_id: null,
      is_draft: true,
      company_id: req.user.currentCompanyId,
      uploaded_filename: original,
      uploaded_storage_path: storagePath,
      uploaded_size_bytes: req.file.size,
      uploaded_mime_type: req.file.mimetype,
      review_text: reviewText,
      model: usedModel,
      pipeline_id: pipeline.id,
      created_by: req.user.id,
    }, ['id'])

    const row = await selectReviewBase().where('r.id', inserted.id).first()

    await writeAudit({
      actorId: req.user.id, action: 'review.create',
      targetType: 'review', targetId: inserted.id,
      payload: {
        caseId, filename: original, model: usedModel,
        pipeline: pipeline.name, steps: steps.length, textChars: text.length,
        draftItems,
        finalItems: merged.review_opinions.reduce((n, l) => n + l.items.length, 0),
        consolidation: consolidationStatus,
        ...(consolidationSkipReason ? { consolidationSkipReason } : {}),
        ...(consolidationError ? { consolidationError } : {}),
      },
      companyId: req.user.currentCompanyId,
    })

    res.status(201).json({ review: rowToReview(row) })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// GET /api/reviews?caseId=xxx&includeDrafts=1
r.get('/', async (req, res, next) => {
  try {
    let q = selectReviewBase().orderBy('r.created_at', 'desc')
    q = q.where('r.company_id', req.user.currentCompanyId)

    if (req.query.caseId) q = q.where('r.case_id', String(req.query.caseId))
    if (!canSeeAllReviews(req.user)) q = q.where('r.created_by', req.user.id)

    const includeDrafts = req.query.includeDrafts === '1' || req.query.includeDrafts === 'true'
    if (!includeDrafts) q = q.where('r.is_draft', false)
    else q = q.where(function () {
      this.where('r.is_draft', false).orWhere('r.created_by', req.user.id)
    })

    const rows = await q.limit(200)
    res.json({ reviews: rows.map(rowToReview) })
  } catch (e) { next(e) }
})

// GET /api/reviews/:id
r.get('/:id', async (req, res, next) => {
  try {
    const row = await selectReviewBase().where('r.id', req.params.id).first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (row.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该记录不属于当前公司' })
    if (!canSeeAllReviews(req.user) && row.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权访问该审核记录' })
    }
    res.json({ review: rowToReview(row) })
  } catch (e) { next(e) }
})

// POST /api/reviews/:id/submit
r.post('/:id/submit', tmpUpload.array('attachments', 10), async (req, res, next) => {
  const tmpFiles = (req.files || []).map(f => f.path)
  try {
    const reviewRow = await db('case_reviews').where({ id: req.params.id }).first()
    if (!reviewRow) return res.status(404).json({ error: '审核记录不存在' })
    if (reviewRow.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该记录不属于当前公司' })
    if (reviewRow.created_by !== req.user.id) return res.status(403).json({ error: '只有审核创建人可以提交' })
    if (!reviewRow.is_draft) return res.status(400).json({ error: '该审核已经提交过，不能重复提交' })

    const contractMode = String(req.body?.contractMode || '').trim()
    if (contractMode !== 'new' && contractMode !== 'existing') {
      return res.status(400).json({ error: '请指定 contractMode（new 或 existing）' })
    }
    const contractName = String(req.body?.contractName || '').trim()
    const contractDescription = req.body?.contractDescription ? String(req.body.contractDescription).trim() : null
    const givenContractId = req.body?.contractId ? String(req.body.contractId) : null

    if (contractMode === 'new' && !contractName) return res.status(400).json({ error: '请填写新合同名称' })
    if (contractMode === 'existing' && !givenContractId) return res.status(400).json({ error: '请选择已有合同' })

    let existingContract = null
    if (contractMode === 'existing') {
      existingContract = await db('contracts').where({ id: givenContractId }).first()
      if (!existingContract) return res.status(404).json({ error: '指定的合同不存在' })
      if (existingContract.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该合同不属于当前公司' })
      if (existingContract.approval_started_at) return res.status(400).json({ error: '该合同已进入审批流程，不能再添加新版本' })
    }

    // 收件人必须是当前公司里的 legal 角色（"法务岗"）。
    //   v2.1+: 允许法务把审核提交给自己（自己审自己）—— 法务发起的合同也要走审核，
    //   通常自审即可（职权不同时可指派给其他法务）。下面的 legal 角色校验已能兜底。
    const receiverId = String(req.body?.receiverId || '').trim()
    if (!receiverId) return res.status(400).json({ error: '请选择收件人（法务）' })
    const legalOk = await db('user_company_roles')
      .where({ user_id: receiverId, company_id: req.user.currentCompanyId, role: 'legal' })
      .first()
    if (!legalOk) return res.status(400).json({ error: '收件人必须是本公司的法务岗用户' })

    const messageBody = String(req.body?.body || '').trim()
    if (!messageBody) return res.status(400).json({ error: '请填写留言' })

    const result = await db.transaction(async (trx) => {
      let contractRow
      if (contractMode === 'new') {
        const created = await createContractWithCode(trx, {
          name: contractName,
          description: contractDescription,
          ownerId: req.user.id,
          companyId: req.user.currentCompanyId,
        })
        contractRow = await trx('contracts').where({ id: created.id }).first()
      } else {
        await trx('contracts').where({ id: existingContract.id }).update({ updated_at: new Date() })
        contractRow = await trx('contracts').where({ id: existingContract.id }).first()
      }

      await trx('case_reviews').where({ id: reviewRow.id }).update({
        contract_id: contractRow.id,
        is_draft: false,
      })

      const [msgInserted] = await trx('messages').insert({
        sender_id: req.user.id,
        receiver_id: receiverId,
        body: messageBody,
        case_id: reviewRow.case_id || null,
        review_id: reviewRow.id,
        company_id: req.user.currentCompanyId,
        is_read: false,
      }, ['id'])
      const messageId = msgInserted.id

      await trx('message_attachments').insert({
        message_id: messageId,
        review_id: reviewRow.id,
        review_file_kind: 'original',
        filename: reviewRow.uploaded_filename,
        storage_path: null,
        size_bytes: reviewRow.uploaded_size_bytes,
        mime_type: reviewRow.uploaded_mime_type,
      })

      if (req.files && req.files.length > 0) {
        const attDir = path.join(ATTACHMENTS_ROOT, messageId)
        await ensureDir(attDir)
        for (const f of req.files) {
          const originalAtt = Buffer.from(f.originalname, 'latin1').toString('utf8')
          const target = path.join(attDir, `${Date.now()}_${safeFilename(originalAtt)}`)
          await fs.rename(f.path, target)
          await trx('message_attachments').insert({
            message_id: messageId,
            filename: originalAtt,
            storage_path: toStoragePath(target),
            size_bytes: f.size,
            mime_type: f.mimetype,
          })
        }
      }

      return { contractId: contractRow.id, messageId }
    })

    await writeAudit({
      actorId: req.user.id, action: 'review.submit',
      targetType: 'review', targetId: reviewRow.id,
      payload: {
        contractMode, contractId: result.contractId,
        receiverId, messageId: result.messageId,
        attachmentCount: (req.files || []).length,
      },
      companyId: req.user.currentCompanyId,
    })

    const fresh = await selectReviewBase().where('r.id', reviewRow.id).first()
    res.status(201).json({
      review: rowToReview(fresh),
      contractId: result.contractId,
      messageId: result.messageId,
    })
  } catch (e) {
    for (const p of tmpFiles) await safeUnlink(p)
    next(e)
  }
})

// GET /api/reviews/:id/file
r.get('/:id/file', async (req, res, next) => {
  try {
    const row = await db('case_reviews')
      .select('uploaded_filename', 'uploaded_storage_path', 'uploaded_mime_type', 'created_by', 'company_id')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (row.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该记录不属于当前公司' })
    if (!canSeeAllReviews(req.user) && row.created_by !== req.user.id) {
      return res.status(403).json({ error: '无权下载该文件' })
    }
    res.setHeader('Content-Type', row.uploaded_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.uploaded_filename)}`)
    res.sendFile(toAbsolutePath(row.uploaded_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

// 不允许 DELETE
r.delete('/:id', async (_req, res) => {
  return res.status(403).json({ error: '审核记录不允许删除（合同台账需要完整追溯）' })
})

// ─── 法务（legal 角色）：上传修订版 ──────────────────────────────────────────
r.post('/:id/legal-revision', requireCompanyRole('legal'), upload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传修订版文件' })
    savedAbsPath = req.file.path

    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const ext = path.extname(original).toLowerCase()
    if (ext !== '.doc' && ext !== '.docx') {
      await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '法务审核版必须是 Word 文档（.doc 或 .docx）' })
    }

    const review = await db('case_reviews').where({ id: req.params.id }).first()
    if (!review) { await safeUnlink(savedAbsPath); return res.status(404).json({ error: '审核记录不存在' }) }
    if (review.company_id !== req.user.currentCompanyId) {
      await safeUnlink(savedAbsPath); return res.status(403).json({ error: '该记录不属于当前公司' })
    }

    if (review.reviewed_storage_path) await safeUnlink(toAbsolutePath(review.reviewed_storage_path))

    const storagePath = toStoragePath(savedAbsPath)
    await db('case_reviews').where({ id: review.id }).update({
      reviewed_filename: original,
      reviewed_storage_path: storagePath,
      reviewed_size_bytes: req.file.size,
      reviewed_mime_type: req.file.mimetype,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    })

    let notifyMessageId = null
    let notifyError = null
    const legalComment = req.body?.comment ? String(req.body.comment).trim() : ''
    if (review.created_by && review.created_by !== req.user.id) {
      try {
        await db.transaction(async (trx) => {
          const baseBody =
            `您提交审核的合同《${review.uploaded_filename}》法务审核版已上传，请在本消息附件中下载查阅。`
          const finalBody = legalComment ? `${baseBody}\n\n【法务留言】\n${legalComment}` : baseBody
          const [msgRow] = await trx('messages').insert({
            sender_id: req.user.id,
            receiver_id: review.created_by,
            body: finalBody,
            review_id: review.id,
            company_id: req.user.currentCompanyId,
            is_read: false,
          }, ['id'])
          notifyMessageId = msgRow.id

          await trx('message_attachments').insert({
            message_id: notifyMessageId,
            review_id: review.id,
            review_file_kind: 'legal',
            filename: original,
            storage_path: null,
            size_bytes: req.file.size,
            mime_type: req.file.mimetype,
          })
        })
      } catch (e) { notifyError = e?.message || String(e) }
    }

    const row = await selectReviewBase().where('r.id', review.id).first()
    await writeAudit({
      actorId: req.user.id, action: 'review.legal_revision',
      targetType: 'review', targetId: review.id,
      payload: { filename: original, size: req.file.size, notifyMessageId, ...(notifyError ? { notifyError } : {}) },
      companyId: req.user.currentCompanyId,
    })
    res.json({ review: rowToReview(row), notified: !!notifyMessageId })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// POST /api/reviews/:id/legal-approve — legal 直通
r.post('/:id/legal-approve', requireCompanyRole('legal'), async (req, res, next) => {
  try {
    const review = await db('case_reviews').where({ id: req.params.id }).first()
    if (!review) return res.status(404).json({ error: '审核记录不存在' })
    if (review.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该记录不属于当前公司' })
    if (review.is_draft) return res.status(400).json({ error: '该审核还是草稿，不能直接通过' })

    const legalComment = req.body?.comment ? String(req.body.comment).trim() : ''

    await db('case_reviews').where({ id: review.id }).update({
      legal_approved: true,
      reviewed_by: req.user.id,
      reviewed_at: new Date(),
    })

    let notifyMessageId = null
    let notifyError = null
    if (review.created_by && review.created_by !== req.user.id) {
      try {
        await db.transaction(async (trx) => {
          const baseBody =
            `您提交审核的合同《${review.uploaded_filename}》法务无修订意见，` +
            `当前版本可直接用于发起合同审批。`
          const finalBody = legalComment ? `${baseBody}\n\n【法务留言】\n${legalComment}` : baseBody
          const [msgRow] = await trx('messages').insert({
            sender_id: req.user.id,
            receiver_id: review.created_by,
            body: finalBody,
            review_id: review.id,
            company_id: req.user.currentCompanyId,
            is_read: false,
          }, ['id'])
          notifyMessageId = msgRow.id
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
      } catch (e) { notifyError = e?.message || String(e) }
    }

    const row = await selectReviewBase().where('r.id', review.id).first()
    await writeAudit({
      actorId: req.user.id, action: 'review.legal_approve',
      targetType: 'review', targetId: review.id,
      payload: { notifyMessageId, ...(notifyError ? { notifyError } : {}) },
      companyId: req.user.currentCompanyId,
    })
    res.json({ review: rowToReview(row), notified: !!notifyMessageId })
  } catch (e) { next(e) }
})

// GET /api/reviews/:id/legal-file
r.get('/:id/legal-file', async (req, res, next) => {
  try {
    const row = await db('case_reviews')
      .select('reviewed_filename', 'reviewed_storage_path', 'reviewed_mime_type', 'created_by', 'company_id')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '审核记录不存在' })
    if (!row.reviewed_storage_path) return res.status(404).json({ error: '该版本还没有法务审核版' })
    if (row.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该记录不属于当前公司' })

    const allowed = canSeeAllReviews(req.user) || row.created_by === req.user.id
    if (!allowed) return res.status(403).json({ error: '无权下载法务审核版' })

    res.setHeader('Content-Type', row.reviewed_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.reviewed_filename)}`)
    res.sendFile(toAbsolutePath(row.reviewed_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

export default r

// ─── 草稿清理：删除 24h 前未提交的 draft ─────────────────────────────────────
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
