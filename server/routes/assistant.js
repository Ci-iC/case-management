// AI 工作台 v2.3：/api/assistant
//   - 会话/附件存 DB（按用户维度，跨公司不清空，次日清空）
//   - JSON 协议工具循环：只读工具后端执行；写工具提议 → 前端确认后调现有接口执行
//   - 进入工作台主动推送待办

import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requireCompanyContext, canReadContractRow } from '../auth.js'
import { db } from '../db.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename } from '../storage.js'
import { extractTextFromFile } from '../textExtract.js'
import {
  getTodayMessages, appendMessage, saveAttachment, getAttachment, clearTodayMessages,
} from '../assistantStore.js'
import { runTurn, generateTodoPush } from '../assistantOrchestrator.js'
import { buildCatalogForUser, userParticipatesInContract } from '../assistantTools.js'

const r = Router()
r.use(requireAuth, requireCompanyContext)

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const ATT_ROOT = path.join(DATA_ROOT, 'assistant-att')

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (ext === '.doc' || ext === '.docx' || ext === '.txt' || ext === '.pdf') return cb(null, true)
  const err = new Error('参考文件只支持 Word（.doc/.docx）、PDF（.pdf）或文本（.txt）'); err.status = 400; cb(err)
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const dir = path.join(ATT_ROOT, String(req.user.id))
      try { await ensureDir(dir); cb(null, dir) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter,
})

// 写工具结果回灌后再让 AI 收尾；统一的"跑一轮并落库"流程
async function runAndPersist(reqUser) {
  const history = await getTodayMessages(reqUser.id)
  const turn = await runTurn({ reqUser, history })
  if (turn.type === 'pending_action') {
    return appendMessage({
      userId: reqUser.id, role: 'assistant', kind: 'pending_action',
      content: turn.autoConfirm ? `正在打开：${turn.label}` : `请确认操作：${turn.label}`,
      data: {
        tool: turn.tool, label: turn.label, executor: turn.executor,
        args: turn.args, summary: turn.summary, fields: turn.fields || null,
        autoConfirm: turn.autoConfirm === true,
      },
      companyId: reqUser.currentCompanyId,
    })
  }
  return appendMessage({
    userId: reqUser.id, role: 'assistant', kind: 'text',
    content: turn.reply,
    data: turn.fileLinks?.length ? { fileLinks: turn.fileLinks } : null,
    companyId: reqUser.currentCompanyId,
  })
}

// ─── GET /history ───────────────────────────────────────────────────────────
r.get('/history', async (req, res, next) => {
  try {
    let messages = await getTodayMessages(req.user.id)
    if (messages.length === 0) {
      const push = await generateTodoPush(req.user)
      await appendMessage({
        userId: req.user.id, role: 'assistant', kind: 'todo',
        content: push.content, data: push.data, companyId: req.user.currentCompanyId,
      })
      messages = await getTodayMessages(req.user.id)
    }
    res.json({ messages })
  } catch (e) { next(e) }
})

// ─── POST /clear ──────────────────────────────────────────────────────────────
// 手动清空当天对话 + 附件，并重新生成开场待办推送
r.post('/clear', async (req, res, next) => {
  try {
    await clearTodayMessages(req.user.id)
    const push = await generateTodoPush(req.user)
    await appendMessage({
      userId: req.user.id, role: 'assistant', kind: 'todo',
      content: push.content, data: push.data, companyId: req.user.currentCompanyId,
    })
    const messages = await getTodayMessages(req.user.id)
    res.json({ messages })
  } catch (e) { next(e) }
})

// ─── POST /message ────────────────────────────────────────────────────────────
r.post('/message', async (req, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    // 允许"只发文件、不带文字"：此时刚上传的 file 消息已在当天历史里，
    // 直接跑一轮让 AI 阅读并回应；只有当既无文字、当天又没有任何消息时才报空。
    if (!text) {
      const today = await getTodayMessages(req.user.id)
      const hasMaterial = today.some((m) => m.kind === 'file' || m.role === 'user')
      if (!hasMaterial) return res.status(400).json({ error: '消息为空' })
    }
    let userMsg = null
    if (text) {
      userMsg = await appendMessage({
        userId: req.user.id, role: 'user', kind: 'text', content: text.slice(0, 8000),
        companyId: req.user.currentCompanyId,
      })
    }
    const assistantMsg = await runAndPersist(req.user)
    res.json({ messages: userMsg ? [userMsg, assistantMsg] : [assistantMsg] })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  }
})

// ─── POST /upload ─────────────────────────────────────────────────────────────
r.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' })
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    let text = ''
    try { text = await extractTextFromFile(req.file.path, req.file.mimetype, filename) } catch { /* ignore */ }
    const full = text.length > 60000 ? text.slice(0, 60000) : text
    // 落库一条 file 消息（content 含文件名 + 正文摘要，供模型读）
    const snippet = full ? `\n${full.slice(0, 8000)}` : '（未能提取到文本内容）'
    const msg = await appendMessage({
      userId: req.user.id, role: 'user', kind: 'file',
      content: `【参考文件：${filename}】${snippet}`,
      data: { filename }, companyId: req.user.currentCompanyId,
    })
    const att = await saveAttachment({
      userId: req.user.id, messageId: msg.id, filename,
      storagePath: toStoragePath(req.file.path),
      sizeBytes: req.file.size, mimeType: req.file.mimetype, extractedText: full,
    })
    // 把 attachmentId 写回消息 data（便于前端写操作引用）
    msg.data = { filename, attachmentId: att.id }
    res.json({ message: { ...msg }, attachmentId: att.id, filename })
  } catch (e) { next(e) }
})

// ─── POST /action-result ──────────────────────────────────────────────────────
// 前端执行写操作后回报结果；非取消则再让 AI 收尾
r.post('/action-result', async (req, res, next) => {
  try {
    const { ok, cancelled, summary, error, resultData } = req.body || {}

    // 取消
    if (cancelled) {
      await appendMessage({
        userId: req.user.id, role: 'user', kind: 'action_result',
        content: '用户取消了该操作，未执行。', companyId: req.user.currentCompanyId,
      })
      const note = await appendMessage({
        userId: req.user.id, role: 'assistant', kind: 'text',
        content: '好的，已取消该操作。还需要我做什么？', companyId: req.user.currentCompanyId,
      })
      return res.json({ messages: [note] })
    }

    // 记录一条 action_result（供模型了解操作已发生 + 串联 reviewId；前端不展示）
    const actionData = ok && resultData?.reviewId ? { reviewId: resultData.reviewId } : null
    const resultContent = ok ? (summary ? String(summary) : '操作已执行成功。') : `操作执行失败：${error || '未知错误'}`
    await appendMessage({
      userId: req.user.id, role: 'user', kind: 'action_result',
      content: resultContent, data: actionData, companyId: req.user.currentCompanyId,
    })

    // 失败：给一条确定性的助手说明（不跑自由回合）
    if (!ok) {
      const failMsg = await appendMessage({
        userId: req.user.id, role: 'assistant', kind: 'text',
        content: `抱歉，这个操作没有成功：${error || '未知错误'}。你可以调整后再试。`,
        companyId: req.user.currentCompanyId,
      })
      return res.json({ messages: [failMsg] })
    }

    const out = []
    if (resultData?.reviewResult?.reviewText) {
      // AI 审核：结构化意见表 + 固定的下一步指引（这一步要让用户先读意见再决定，不自动续跑）
      const rr = resultData.reviewResult
      const reviewMsg = await appendMessage({
        userId: req.user.id, role: 'assistant', kind: 'review_result',
        content: 'AI 审核意见如下：',
        data: { reviewId: rr.reviewId, filename: rr.filename, ourRole: rr.ourRole, reviewText: rr.reviewText },
        companyId: req.user.currentCompanyId,
      })
      out.push(reviewMsg)
      const guide = await appendMessage({
        userId: req.user.id, role: 'assistant', kind: 'text',
        content: '以上是 AI 审核意见（仅供参考，不能替代法务正式审核）。你可以：① 根据建议修改合同后重新上传、让我再审一次；② 或者直接告诉我「提交法务审核」，我来帮你正式提交给本公司法务（约 1~2 个工作日回复）。如果这份是某既有合同的修订版，提交时告诉我原合同名称，我会作为它的新版本（V2/V3）关联归档，不另建合同。',
        companyId: req.user.currentCompanyId,
      })
      out.push(guide)
    } else {
      // 其它写操作：再跑一轮，让 AI 接手"批量指令的下一个对象"（连续确认），
      // 或在没有后续时给出收尾回执。模型已被约束：只处理用户最初要求的批量对象，不擅自发起新操作。
      let followUp
      try {
        followUp = await runAndPersist(req.user)
      } catch {
        // 续跑失败（如 AI 未配置）：退回确定性回执，至少让用户看到这一步已成功
        followUp = await appendMessage({
          userId: req.user.id, role: 'assistant', kind: 'text',
          content: resultContent, companyId: req.user.currentCompanyId,
        })
      }
      out.push(followUp)
    }
    res.json({ messages: out })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  }
})

// ─── POST /draft-result ───────────────────────────────────────────────────────
// 起草草稿生成后，把"已生成 + 下载按钮"记进主对话（独立弹窗关掉后仍能在对话里下载，当天有效）
r.post('/draft-result', async (req, res, next) => {
  try {
    const downloadId = String(req.body?.downloadId || '').trim()
    const filename = String(req.body?.filename || '合同草稿.docx').trim()
    const title = String(req.body?.title || '').trim()
    if (!downloadId) return res.status(400).json({ error: '缺少 downloadId' })
    const content = title ? `合同草稿《${title}》已生成，可点击下方按钮下载（当天有效）：` : '合同草稿已生成，可点击下方按钮下载（当天有效）：'
    const msg = await appendMessage({
      userId: req.user.id, role: 'assistant', kind: 'text',
      content,
      data: { fileLinks: [{ kind: 'draft', downloadId, filename, label: `下载 ${filename}` }] },
      companyId: req.user.currentCompanyId,
    })
    res.json({ messages: [msg] })
  } catch (e) { next(e) }
})

// ─── GET /attachment/:id ──────────────────────────────────────────────────────
r.get('/attachment/:id', async (req, res, next) => {
  try {
    const att = await getAttachment(req.params.id, req.user.id)
    if (!att) return res.status(404).json({ error: '附件不存在或已过期' })
    res.setHeader('Content-Type', att.mime_type || 'application/octet-stream')
    res.sendFile(toAbsolutePath(att.storage_path))
  } catch (e) { next(e) }
})

// ─── GET /contract-file/:contractId ───────────────────────────────────────────
// AI 工作台"发文件给用户"的下载入口。权限：对该合同可读 或 参与了它的审批流程。
//   ?kind=clean（清洁版，默认）| sealed（用印版）
r.get('/contract-file/:contractId', async (req, res, next) => {
  try {
    const kind = req.query.kind === 'sealed' ? 'sealed' : 'clean'
    const c = await db('contracts').where({ id: req.params.contractId }).first()
    if (!c) return res.status(404).json({ error: '合同不存在' })
    if (c.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该合同不属于当前公司' })
    const allowed = canReadContractRow(req.user, c) || await userParticipatesInContract(req.user, c.id)
    if (!allowed) return res.status(403).json({ error: '你无权下载该合同文件' })

    const storagePath = kind === 'sealed' ? c.sealed_storage_path : c.clean_storage_path
    const filename = kind === 'sealed' ? c.sealed_filename : c.clean_filename
    const mime = kind === 'sealed' ? c.sealed_mime_type : c.clean_mime_type
    if (!storagePath) {
      return res.status(404).json({ error: kind === 'sealed' ? '该合同还没有用印版' : '该合同还没有清洁版' })
    }
    res.setHeader('Content-Type', mime || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename || 'contract')}`)
    res.sendFile(toAbsolutePath(storagePath))
  } catch (e) { next(e) }
})

// ─── GET /quick-actions ───────────────────────────────────────────────────────
// 按角色返回快捷按钮（前端据此动态渲染）
r.get('/quick-actions', (req, res) => {
  const catalog = buildCatalogForUser(req.user)
  const writeNames = new Set(catalog.filter((t) => t.kind === 'write').map((t) => t.name))
  const actions = []
  // 起草合同：始终有（复用现有 /api/draft 管线，前端打开起草表单）
  actions.push({ id: 'draft_contract', label: '合同起草', icon: 'FileSignature', kind: 'draft' })
  // 待办：始终有
  actions.push({ id: 'my_todos', label: '我的待办', icon: 'CheckSquare', kind: 'prompt', prompt: '帮我看看我的待办事项' })
  if (writeNames.has('submit_review')) actions.push({ id: 'submit_review', label: '提交审核', icon: 'FileSearch', kind: 'prompt', prompt: '我要审核一份合同' })
  if (writeNames.has('initiate_approval')) actions.push({ id: 'initiate_approval', label: '发起审批', icon: 'Send', kind: 'prompt', prompt: '我要发起一份合同的审批流程' })
  res.json({ actions })
})

export default r
