// 站内消息：收发、附件上传/下载、未读数
//
// 权限：
//   - 任何登录用户都能发消息
//   - 收件人必须是已存在的用户
//   - caseId 关联只在发送方有案件权限时生效（无权限就忽略）
//   - 详情/附件下载：仅 sender 或 receiver
//   - 删除：sender 或 receiver 都可以删（物理删除，连同附件）

import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { db, writeAudit } from '../db.js'
import { requireAuth } from '../auth.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink } from '../storage.js'
import fs from 'node:fs/promises'

const r = Router()
r.use(requireAuth)

// ─── multer：附件先存到临时目录，发送时统一搬到 attachments/<message_id>/ ──

const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const ATTACHMENTS_ROOT = path.join(DATA_ROOT, 'attachments')
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')

const upload = multer({
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

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function rowToMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    senderId: row.sender_id,
    senderUsername: row.sender_username,
    senderDisplayName: row.sender_display_name,
    receiverId: row.receiver_id,
    receiverUsername: row.receiver_username,
    receiverDisplayName: row.receiver_display_name,
    body: row.body,
    caseId: row.case_id,
    caseNumber: row.case_number ?? undefined,
    caseName: row.case_name ?? undefined,
    reviewId: row.review_id,
    isRead: !!row.is_read,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    attachmentCount: row.attachment_count != null ? Number(row.attachment_count) : 0,
  }
}

const MSG_SELECT = [
  'm.id', 'm.sender_id', 'm.receiver_id', 'm.body', 'm.case_id', 'm.review_id',
  'm.is_read', 'm.read_at', 'm.created_at',
  's.username as sender_username', 's.display_name as sender_display_name',
  'rcv.username as receiver_username', 'rcv.display_name as receiver_display_name',
  'c.case_number', 'c.case_name',
  db.raw('(SELECT count(*) FROM message_attachments a WHERE a.message_id = m.id) AS attachment_count'),
]

function joinMsg(q) {
  return q
    .from('messages as m')
    .leftJoin('users as s', 'm.sender_id', 's.id')
    .leftJoin('users as rcv', 'm.receiver_id', 'rcv.id')
    .leftJoin('cases as c', 'm.case_id', 'c.id')
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/messages — 发送（multipart）
r.post('/', upload.array('attachments', 10), async (req, res, next) => {
  const tmpFiles = (req.files || []).map(f => f.path)
  try {
    const { receiverId, body, caseId, reviewId } = req.body || {}
    if (!receiverId) return res.status(400).json({ error: '请选择收件人' })
    if (!body || !String(body).trim()) return res.status(400).json({ error: '请填写留言' })
    if (receiverId === req.user.id) return res.status(400).json({ error: '不能给自己发消息' })

    const receiver = await db('users').select('id').where({ id: receiverId }).first()
    if (!receiver) return res.status(404).json({ error: '收件人不存在' })

    // caseId：发送方需要案件权限
    let normalizedCaseId = null
    if (caseId) {
      if (req.user.role === 'admin' || req.user.canViewCases) {
        const c = await db('cases').select('id').where({ id: caseId }).first()
        if (c) normalizedCaseId = c.id
      }
    }

    // reviewId：必须是自己的或 admin
    let normalizedReviewId = null
    if (reviewId) {
      const rv = await db('case_reviews').select('id', 'created_by').where({ id: reviewId }).first()
      if (rv && (req.user.role === 'admin' || rv.created_by === req.user.id)) {
        normalizedReviewId = rv.id
      }
    }

    // 入库
    const result = await db.transaction(async (trx) => {
      const [inserted] = await trx('messages').insert({
        sender_id: req.user.id,
        receiver_id: receiverId,
        body: String(body).trim(),
        case_id: normalizedCaseId,
        review_id: normalizedReviewId,
        is_read: false,
      }, ['id'])

      const messageId = inserted.id

      // 1) 用户上传的附件：从 tmp 搬到 attachments/<message_id>/
      if (req.files && req.files.length > 0) {
        const dir = path.join(ATTACHMENTS_ROOT, messageId)
        await ensureDir(dir)
        for (const f of req.files) {
          const original = Buffer.from(f.originalname, 'latin1').toString('utf8')
          const target = path.join(dir, `${Date.now()}_${safeFilename(original)}`)
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

      // 2) 如果是从 review 回传的消息，把审核的原文件作为"引用"附件
      //    不复制物理文件，只在 message_attachments 写一条 review_id 引用 —— 省磁盘
      //    下载时实时从 case_reviews 拿 storage_path
      if (normalizedReviewId) {
        const rv = await trx('case_reviews')
          .select('uploaded_filename', 'uploaded_storage_path', 'uploaded_size_bytes', 'uploaded_mime_type')
          .where({ id: normalizedReviewId })
          .first()
        if (rv?.uploaded_storage_path) {
          await trx('message_attachments').insert({
            message_id: messageId,
            review_id: normalizedReviewId,
            filename: rv.uploaded_filename,
            storage_path: null,  // 没有自己的物理文件
            size_bytes: rv.uploaded_size_bytes,
            mime_type: rv.uploaded_mime_type,
          })
        }
      }

      return messageId
    })

    const row = await joinMsg(db.select(MSG_SELECT)).where('m.id', result).first()
    await writeAudit({
      actorId: req.user.id, action: 'message.send',
      targetType: 'message', targetId: result,
      payload: {
        receiverId, hasAttachments: (req.files || []).length > 0,
        caseId: normalizedCaseId, reviewId: normalizedReviewId,
      },
    })
    res.status(201).json({ message: rowToMessage(row) })
  } catch (e) {
    // 清理 tmp
    for (const p of tmpFiles) await safeUnlink(p)
    next(e)
  }
})

// GET /api/messages?folder=inbox|sent
r.get('/', async (req, res, next) => {
  try {
    const folder = req.query.folder === 'sent' ? 'sent' : 'inbox'
    let q = joinMsg(db.select(MSG_SELECT)).orderBy('m.created_at', 'desc')
    if (folder === 'inbox') q = q.where('m.receiver_id', req.user.id)
    else q = q.where('m.sender_id', req.user.id)
    const rows = await q.limit(500)
    res.json({ messages: rows.map(rowToMessage) })
  } catch (e) { next(e) }
})

// GET /api/messages/unread-count
r.get('/unread-count', async (req, res, next) => {
  try {
    const { count } = await db('messages').count({ count: '*' })
      .where({ receiver_id: req.user.id, is_read: false })
      .first()
    res.json({ count: Number(count) })
  } catch (e) { next(e) }
})

// GET /api/messages/:id — 详情（含附件 + review 全文）
r.get('/:id', async (req, res, next) => {
  try {
    const row = await joinMsg(db.select(MSG_SELECT)).where('m.id', req.params.id).first()
    if (!row) return res.status(404).json({ error: '消息不存在' })
    if (row.sender_id !== req.user.id && row.receiver_id !== req.user.id) {
      return res.status(403).json({ error: '无权查看该消息' })
    }

    const attachments = await db('message_attachments')
      .select('id', 'filename', 'size_bytes', 'mime_type', 'created_at')
      .where({ message_id: row.id })
      .orderBy('created_at', 'asc')

    let review = null
    if (row.review_id) {
      const rv = await db('case_reviews')
        .select('id', 'uploaded_filename', 'review_text', 'model', 'created_at')
        .where({ id: row.review_id }).first()
      if (rv) {
        review = {
          id: rv.id,
          uploadedFilename: rv.uploaded_filename,
          reviewText: rv.review_text,
          model: rv.model,
          createdAt: rv.created_at instanceof Date ? rv.created_at.toISOString() : rv.created_at,
        }
      }
    }

    res.json({
      message: {
        ...rowToMessage(row),
        attachments: attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          sizeBytes: a.size_bytes != null ? Number(a.size_bytes) : null,
          mimeType: a.mime_type,
          createdAt: a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at,
        })),
        review,
      },
    })
  } catch (e) { next(e) }
})

// POST /api/messages/:id/read
r.post('/:id/read', async (req, res, next) => {
  try {
    const row = await db('messages').select('id', 'receiver_id', 'is_read').where({ id: req.params.id }).first()
    if (!row) return res.status(404).json({ error: '消息不存在' })
    if (row.receiver_id !== req.user.id) return res.status(403).json({ error: '只有收件人可以标记已读' })
    if (row.is_read) return res.json({ ok: true })
    await db('messages').where({ id: row.id }).update({ is_read: true, read_at: new Date() })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// DELETE /api/messages/:id — 物理删除（只清自己上传的文件，引用 review 的不动）
r.delete('/:id', async (req, res, next) => {
  try {
    const row = await db('messages').select('id', 'sender_id', 'receiver_id').where({ id: req.params.id }).first()
    if (!row) return res.status(404).json({ error: '消息不存在' })
    if (row.sender_id !== req.user.id && row.receiver_id !== req.user.id) {
      return res.status(403).json({ error: '无权删除该消息' })
    }

    // 只 unlink 这条消息自己上传的附件（storage_path 非空）
    // review_id 引用的附件不动 — 物理文件归审核记录所有
    const ownAtts = await db('message_attachments')
      .select('storage_path')
      .where({ message_id: row.id })
      .whereNotNull('storage_path')
    await db('messages').where({ id: row.id }).delete()  // CASCADE 删 message_attachments 行
    for (const a of ownAtts) await safeUnlink(toAbsolutePath(a.storage_path))
    try { await fs.rmdir(path.join(ATTACHMENTS_ROOT, row.id)) } catch { /* ignore */ }

    await writeAudit({
      actorId: req.user.id, action: 'message.delete',
      targetType: 'message', targetId: row.id,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// GET /api/messages/:id/attachments/:aid — 下载附件
// 优先用自己的 storage_path；如果是 review 引用，跟到 case_reviews 拿
r.get('/:id/attachments/:aid', async (req, res, next) => {
  try {
    const m = await db('messages').select('id', 'sender_id', 'receiver_id').where({ id: req.params.id }).first()
    if (!m) return res.status(404).json({ error: '消息不存在' })
    if (m.sender_id !== req.user.id && m.receiver_id !== req.user.id) {
      return res.status(403).json({ error: '无权下载该附件' })
    }
    const a = await db('message_attachments')
      .select('filename', 'storage_path', 'mime_type', 'review_id')
      .where({ id: req.params.aid, message_id: m.id })
      .first()
    if (!a) return res.status(404).json({ error: '附件不存在' })

    let resolvedPath = a.storage_path
    if (!resolvedPath && a.review_id) {
      const rv = await db('case_reviews').select('uploaded_storage_path').where({ id: a.review_id }).first()
      resolvedPath = rv?.uploaded_storage_path || null
    }
    if (!resolvedPath) {
      return res.status(404).json({ error: '原文件已被删除（关联的审核记录已清除）' })
    }

    res.setHeader('Content-Type', a.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`)
    res.sendFile(toAbsolutePath(resolvedPath), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

export default r
