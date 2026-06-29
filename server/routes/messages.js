// 站内消息 v2.0：限定在同一公司内流转
//
// 权限：
//   - 任何在当前公司有角色的用户都可以发/收消息
//   - 收件人必须在当前公司有角色
//   - caseId / reviewId / approvalId 关联必须属于当前公司
//   - 详情/附件：sender 或 receiver
//   - 删除：sender 或 receiver

import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { db, writeAudit } from '../db.js'
import { requireAuth, requireCompanyContext, hasCompanyRole } from '../auth.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink } from '../storage.js'
import { notifyNewMessageEmail } from '../emailService.js'
import fs from 'node:fs/promises'

const r = Router()
r.use(requireAuth, requireCompanyContext)

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
    approvalId: row.approval_id || null,
    hasLegalRevision: !!row.review_legal_path,
    isRead: !!row.is_read,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    attachmentCount: row.attachment_count != null ? Number(row.attachment_count) : 0,
  }
}

const MSG_SELECT = [
  'm.id', 'm.sender_id', 'm.receiver_id', 'm.body', 'm.case_id', 'm.review_id', 'm.approval_id', 'm.company_id',
  'm.is_read', 'm.read_at', 'm.created_at',
  's.username as sender_username', 's.display_name as sender_display_name',
  'rcv.username as receiver_username', 'rcv.display_name as receiver_display_name',
  'c.case_number', 'c.case_name',
  'rv.reviewed_storage_path as review_legal_path',
  db.raw('(SELECT count(*) FROM message_attachments a WHERE a.message_id = m.id) AS attachment_count'),
]

function joinMsg(q) {
  return q
    .from('messages as m')
    .leftJoin('users as s', 'm.sender_id', 's.id')
    .leftJoin('users as rcv', 'm.receiver_id', 'rcv.id')
    .leftJoin('cases as c', 'm.case_id', 'c.id')
    .leftJoin('case_reviews as rv', 'm.review_id', 'rv.id')
}

// 限定在当前公司的范围
function applyCompanyScope(q, reqUser) {
  return q.where('m.company_id', reqUser.currentCompanyId)
}

// POST /api/messages — 发送（multipart）
r.post('/', upload.array('attachments', 10), async (req, res, next) => {
  const tmpFiles = (req.files || []).map(f => f.path)
  try {
    if (req.user.isAllCompaniesView) {
      return res.status(400).json({ error: '"全部公司"模式不能发消息，请先切换到具体公司' })
    }
    const { receiverId, body, caseId, reviewId } = req.body || {}
    if (!receiverId) return res.status(400).json({ error: '请选择收件人' })
    if (!body || !String(body).trim()) return res.status(400).json({ error: '请填写留言' })
    if (receiverId === req.user.id) return res.status(400).json({ error: '不能给自己发消息' })

    // 收件人必须在当前公司有角色
    const recvOk = await db('user_company_roles')
      .where({ user_id: receiverId, company_id: req.user.currentCompanyId })
      .first()
    if (!recvOk) return res.status(400).json({ error: '收件人不在当前公司' })

    // v2.0: 案件跨公司共享，只要用户在任意公司有 legal/manager 即可关联（这里简化只检查当前公司）
    const canSeeCases = hasCompanyRole(req, 'manager') || hasCompanyRole(req, 'legal')
    let normalizedCaseId = null
    if (caseId && canSeeCases) {
      const c = await db('cases').select('id').where({ id: caseId }).first()
      if (c) normalizedCaseId = c.id
    }

    // review 必须属于当前公司
    let normalizedReviewId = null
    if (reviewId) {
      const rv = await db('case_reviews').select('id', 'created_by', 'company_id').where({ id: reviewId }).first()
      if (rv && rv.company_id === req.user.currentCompanyId) {
        // 只有 review 创建人 / 当前公司 manager/legal 能附 review
        if (rv.created_by === req.user.id || canSeeCases) normalizedReviewId = rv.id
      }
    }

    const result = await db.transaction(async (trx) => {
      const [inserted] = await trx('messages').insert({
        sender_id: req.user.id,
        receiver_id: receiverId,
        body: String(body).trim(),
        case_id: normalizedCaseId,
        review_id: normalizedReviewId,
        company_id: req.user.currentCompanyId,
        is_read: false,
      }, ['id'])

      const messageId = inserted.id

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

      if (normalizedReviewId) {
        const rv = await trx('case_reviews')
          .select('uploaded_filename', 'uploaded_storage_path', 'uploaded_size_bytes', 'uploaded_mime_type')
          .where({ id: normalizedReviewId })
          .first()
        if (rv?.uploaded_storage_path) {
          await trx('message_attachments').insert({
            message_id: messageId,
            review_id: normalizedReviewId,
            review_file_kind: 'original',
            filename: rv.uploaded_filename,
            storage_path: null,
            size_bytes: rv.uploaded_size_bytes,
            mime_type: rv.uploaded_mime_type,
          })
        }
      }
      return messageId
    })

    // 站内信已提交，异步邮件通知（fire-and-forget，失败只记日志）
    void notifyNewMessageEmail({ receiverId, title: '你有一条新留言', body: String(body).trim() })

    const row = await joinMsg(db.select(MSG_SELECT)).where('m.id', result).first()
    await writeAudit({
      actorId: req.user.id, action: 'message.send',
      targetType: 'message', targetId: result,
      payload: {
        receiverId, hasAttachments: (req.files || []).length > 0,
        caseId: normalizedCaseId, reviewId: normalizedReviewId,
      },
      companyId: req.user.currentCompanyId,
    })
    res.status(201).json({ message: rowToMessage(row) })
  } catch (e) {
    for (const p of tmpFiles) await safeUnlink(p)
    next(e)
  }
})

// GET /api/messages?folder=inbox|sent — 当前公司内
r.get('/', async (req, res, next) => {
  try {
    const folder = req.query.folder === 'sent' ? 'sent' : 'inbox'
    let q = applyCompanyScope(joinMsg(db.select(MSG_SELECT)), req.user).orderBy('m.created_at', 'desc')
    if (folder === 'inbox') q = q.where('m.receiver_id', req.user.id)
    else q = q.where('m.sender_id', req.user.id)
    const rows = await q.limit(500)
    res.json({ messages: rows.map(rowToMessage) })
  } catch (e) { next(e) }
})

// GET /api/messages/unread-count — 当前公司内
r.get('/unread-count', async (req, res, next) => {
  try {
    const { count } = await db('messages').count({ count: '*' })
      .where({ receiver_id: req.user.id, is_read: false, company_id: req.user.currentCompanyId })
      .first()
    res.json({ count: Number(count) })
  } catch (e) { next(e) }
})

// GET /api/messages/:id — 详情
r.get('/:id', async (req, res, next) => {
  try {
    const row = await joinMsg(db.select(MSG_SELECT)).where('m.id', req.params.id).first()
    if (!row) return res.status(404).json({ error: '消息不存在' })
    if (row.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该消息不属于当前公司' })
    if (row.sender_id !== req.user.id && row.receiver_id !== req.user.id) {
      return res.status(403).json({ error: '无权查看该消息' })
    }

    const attachments = await db('message_attachments')
      .select('id', 'filename', 'size_bytes', 'mime_type', 'created_at', 'review_id', 'review_file_kind')
      .where({ message_id: row.id })
      .orderBy('created_at', 'asc')

    let review = null
    if (row.review_id) {
      const rv = await db('case_reviews as r')
        .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
        .select(
          'r.id', 'r.uploaded_filename', 'r.review_text', 'r.model', 'r.created_at',
          'r.reviewed_filename', 'r.reviewed_size_bytes', 'r.reviewed_at',
          'rv.username as reviewed_by_username', 'rv.display_name as reviewed_by_display_name',
        )
        .where('r.id', row.review_id).first()
      if (rv) {
        review = {
          id: rv.id,
          uploadedFilename: rv.uploaded_filename,
          reviewText: rv.review_text,
          model: rv.model,
          createdAt: rv.created_at instanceof Date ? rv.created_at.toISOString() : rv.created_at,
          reviewedFilename: rv.reviewed_filename || null,
          reviewedSizeBytes: rv.reviewed_size_bytes != null ? Number(rv.reviewed_size_bytes) : null,
          reviewedAt: rv.reviewed_at instanceof Date ? rv.reviewed_at.toISOString() : (rv.reviewed_at || null),
          reviewedByUsername: rv.reviewed_by_username || null,
          reviewedByDisplayName: rv.reviewed_by_display_name || null,
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
          reviewId: a.review_id || null,
          reviewFileKind: a.review_file_kind || null,
        })),
        review,
      },
    })
  } catch (e) { next(e) }
})

// POST /api/messages/:id/read
r.post('/:id/read', async (req, res, next) => {
  try {
    const row = await db('messages').select('id', 'receiver_id', 'is_read', 'company_id').where({ id: req.params.id }).first()
    if (!row) return res.status(404).json({ error: '消息不存在' })
    if (row.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该消息不属于当前公司' })
    if (row.receiver_id !== req.user.id) return res.status(403).json({ error: '只有收件人可以标记已读' })
    if (row.is_read) return res.json({ ok: true })
    await db('messages').where({ id: row.id }).update({ is_read: true, read_at: new Date() })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// DELETE /api/messages/:id
r.delete('/:id', async (req, res, next) => {
  try {
    const row = await db('messages').select('id', 'sender_id', 'receiver_id', 'company_id').where({ id: req.params.id }).first()
    if (!row) return res.status(404).json({ error: '消息不存在' })
    if (row.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该消息不属于当前公司' })
    if (row.sender_id !== req.user.id && row.receiver_id !== req.user.id) {
      return res.status(403).json({ error: '无权删除该消息' })
    }

    const ownAtts = await db('message_attachments')
      .select('storage_path')
      .where({ message_id: row.id })
      .whereNotNull('storage_path')
    await db('messages').where({ id: row.id }).delete()
    for (const a of ownAtts) await safeUnlink(toAbsolutePath(a.storage_path))
    try { await fs.rmdir(path.join(ATTACHMENTS_ROOT, row.id)) } catch { /* ignore */ }

    await writeAudit({
      actorId: req.user.id, action: 'message.delete',
      targetType: 'message', targetId: row.id,
      companyId: req.user.currentCompanyId,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// GET /api/messages/:id/attachments/:aid — 下载附件
r.get('/:id/attachments/:aid', async (req, res, next) => {
  try {
    const m = await db('messages').select('id', 'sender_id', 'receiver_id', 'company_id').where({ id: req.params.id }).first()
    if (!m) return res.status(404).json({ error: '消息不存在' })
    if (m.company_id !== req.user.currentCompanyId) return res.status(403).json({ error: '该消息不属于当前公司' })
    if (m.sender_id !== req.user.id && m.receiver_id !== req.user.id) {
      return res.status(403).json({ error: '无权下载该附件' })
    }
    const a = await db('message_attachments')
      .select('filename', 'storage_path', 'mime_type', 'review_id', 'review_file_kind')
      .where({ id: req.params.aid, message_id: m.id })
      .first()
    if (!a) return res.status(404).json({ error: '附件不存在' })

    let resolvedPath = a.storage_path
    if (!resolvedPath && a.review_id) {
      const rv = await db('case_reviews')
        .select('uploaded_storage_path', 'reviewed_storage_path')
        .where({ id: a.review_id }).first()
      resolvedPath = a.review_file_kind === 'legal'
        ? (rv?.reviewed_storage_path || null)
        : (rv?.uploaded_storage_path || null)
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
