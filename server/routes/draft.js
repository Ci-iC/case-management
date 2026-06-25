// 合同起草 v2.2：聊天式起草模块（独立于合同台账）
//
// 设计要点：
//   - 后端无状态：前端持有完整对话历史，每次请求带上 messages
//   - 对话 / 上传文件不做长期存储；生成的草稿落到 draft-tmp/<userId>/，每日清理
//   - 上传文件只读取文本，绝不修改原文件；模板库只读
//   - 任意有公司角色的用户都能用（requireCompanyContext 即可，无额外角色限制）
//
// 接口：
//   POST /api/draft/chat       引导对话一轮 → { reply, readyToDraft }
//   POST /api/draft/upload     上传参考文件 → 抽取文本 { filename, text, chars }
//   POST /api/draft/generate   生成合同草稿 → { downloadId, filename, title, sections, templateUsed }
//   GET  /api/draft/download/:id  下载生成的 .docx

import path from 'node:path'
import fs from 'node:fs/promises'
import { Router } from 'express'
import multer from 'multer'
import { requireAuth, requireCompanyContext } from '../auth.js'
import { db } from '../db.js'
import { DATA_ROOT, ensureDir, safeFilename, safeUnlink } from '../storage.js'
import { extractTextFromFile } from '../textExtract.js'
import {
  chatDraft, pickTemplate, draftContract, conversationToText,
} from '../contractDraft.js'
import { listTemplateFiles, readManifest, readTemplateText } from '../draftTemplates.js'
import { renderContractDocx } from '../docxGen.js'

const r = Router()
r.use(requireAuth, requireCompanyContext)

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')
const DRAFT_OUT_ROOT = path.join(DATA_ROOT, 'draft-tmp')

// 上传：只收 Word / txt，落到 tmp，抽完文本即删
function draftFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (ext === '.doc' || ext === '.docx' || ext === '.txt') return cb(null, true)
  const err = new Error('参考文件只支持 Word（.doc/.docx）或文本（.txt）')
  err.status = 400
  cb(err)
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(TMP_ROOT); cb(null, TMP_ROOT) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: draftFileFilter,
})

// 取我方公司名（用于 AI 判断我方主体）；superadmin / 无公司时为 null
async function getCompanyName(req) {
  if (!req.user?.currentCompanyId) return null
  const company = await db('companies').where({ id: req.user.currentCompanyId }).first()
  return company?.name || null
}

// messages 入参校验 + 清洗（只保留 role/content，限制条数与长度）
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null
  const msgs = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 40000) }))
    .slice(-40)            // 最多保留最近 40 条
  return msgs.length ? msgs : null
}

// ─── POST /chat ────────────────────────────────────────────────────────────────
r.post('/chat', async (req, res, next) => {
  try {
    const messages = sanitizeMessages(req.body?.messages)
    if (!messages) return res.status(400).json({ error: '对话内容为空' })
    const companyName = await getCompanyName(req)

    // 模板：前端可带 templateFile（首轮由后端选好后回传，后续直接复用，避免每轮重选浪费 token）
    const [templateFiles, manifest] = await Promise.all([listTemplateFiles(), readManifest()])
    let templateFile = typeof req.body?.templateFile === 'string' ? req.body.templateFile : null
    if (templateFile && !templateFiles.includes(templateFile)) templateFile = null
    if (!templateFile) {
      const picked = await pickTemplate({ conversationText: conversationToText(messages), manifest, templateFiles })
      templateFile = picked.templateFile
    }
    const templateText = templateFile ? await readTemplateText(templateFile) : null

    const out = await chatDraft({ messages, companyName, templateText })
    res.json({ ...out, templateFile })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  }
})

// ─── POST /upload ────────────────────────────────────────────────────────────
r.post('/upload', upload.single('file'), async (req, res, next) => {
  const tmpPath = req.file?.path || null
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' })
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    let text = ''
    try {
      text = await extractTextFromFile(req.file.path, req.file.mimetype, filename)
    } catch {
      return res.status(400).json({ error: '文件解析失败，请确认是有效的 Word / 文本文件' })
    }
    if (text.length > 60000) text = text.slice(0, 60000)
    res.json({ filename, text, chars: text.length })
  } catch (e) {
    next(e)
  } finally {
    if (tmpPath) await safeUnlink(tmpPath)   // 参考文件只读取文本，用完即删
  }
})

// ─── POST /generate ────────────────────────────────────────────────────────────
r.post('/generate', async (req, res, next) => {
  try {
    const messages = sanitizeMessages(req.body?.messages)
    if (!messages) return res.status(400).json({ error: '对话内容为空，无法起草' })
    const companyName = await getCompanyName(req)

    // 1) 选模板：前端在引导阶段已选好并回传 templateFile，直接复用；没有才现选（向后兼容）
    const [templateFiles, manifest] = await Promise.all([listTemplateFiles(), readManifest()])
    let templateFile = typeof req.body?.templateFile === 'string' ? req.body.templateFile : null
    if (templateFile && !templateFiles.includes(templateFile)) templateFile = null
    if (!templateFile) {
      const picked = await pickTemplate({ conversationText: conversationToText(messages), manifest, templateFiles })
      templateFile = picked.templateFile
    }
    const templateText = templateFile ? await readTemplateText(templateFile) : null

    // 2) 生成结构化正文
    const draft = await draftContract({ messages, templateText, companyName })

    // 3) 渲染 .docx
    const buffer = await renderContractDocx(draft)

    // 4) 文件名：{合同类型}_{乙方简称}_{日期}_草稿.docx
    const d = new Date()
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const rawName = `${draft.fileMeta.contractType}_${draft.fileMeta.counterShortName}_${dateStr}_草稿.docx`
    const filename = safeFilename(rawName)

    // 5) 落到 draft-tmp/<userId>/<id>.docx（按用户隔离，每日清理）
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    const userDir = path.join(DRAFT_OUT_ROOT, String(req.user.id))
    await ensureDir(userDir)
    await fs.writeFile(path.join(userDir, `${id}.docx`), buffer)

    res.json({
      downloadId: id,
      filename,
      title: draft.title,
      sections: draft.sections,
      templateUsed: templateFile,
    })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  }
})

// ─── GET /download/:id ──────────────────────────────────────────────────────────
r.get('/download/:id', async (req, res, next) => {
  try {
    const id = path.basename(String(req.params.id || ''))   // 防目录穿越
    const abs = path.join(DRAFT_OUT_ROOT, String(req.user.id), `${id}.docx`)
    try {
      await fs.access(abs)
    } catch {
      return res.status(404).json({ error: '草稿不存在或已过期（生成的草稿当天有效，请重新生成）' })
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.sendFile(abs)
  } catch (e) {
    next(e)
  }
})

/** 每日清理：删除 draft-tmp 下超过 maxAgeHours 的草稿文件，并清掉空的用户目录。
 *  由 index.js 启动时 + 定时调用。 */
export async function cleanupDraftFiles({ maxAgeHours = 24 } = {}) {
  let count = 0
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000
  let userDirs
  try {
    userDirs = await fs.readdir(DRAFT_OUT_ROOT)
  } catch {
    return { count: 0 }   // 目录还不存在
  }
  for (const ud of userDirs) {
    const dir = path.join(DRAFT_OUT_ROOT, ud)
    let files
    try { files = await fs.readdir(dir) } catch { continue }
    for (const f of files) {
      const fp = path.join(dir, f)
      try {
        const st = await fs.stat(fp)
        if (st.mtimeMs < cutoff) { await fs.unlink(fp); count++ }
      } catch { /* ignore */ }
    }
    try {
      const left = await fs.readdir(dir)
      if (left.length === 0) await fs.rmdir(dir)
    } catch { /* ignore */ }
  }
  return { count }
}

export default r
