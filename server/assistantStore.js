// AI 工作台对话存储（DB 持久化 + 每日清理）。
//   - 按用户维度（跨公司不清空）；当天保留、次日清空（以服务器本地零点为界）
//   - 附件抽取的文本随附件存，AI 读文件内容直接取，不二次解析

import { db } from './db.js'
import { toAbsolutePath, safeUnlink } from './storage.js'

/** 今天本地零点（用于"次日清空"边界） */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function toIso(v) {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : v
}

function rowToMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    content: row.content || '',
    data: row.data || null,           // jsonb 已由 pg 解析成对象
    createdAt: toIso(row.created_at),
  }
}

/** 取当天该用户的全部消息（升序） */
export async function getTodayMessages(userId) {
  const rows = await db('assistant_messages')
    .where('user_id', userId)
    .where('created_at', '>=', startOfToday())
    .orderBy('created_at', 'asc')
    .limit(500)
  return rows.map(rowToMessage)
}

/** 追加一条消息，返回落库后的消息（含 id） */
export async function appendMessage({ userId, role, kind = 'text', content = '', data = null, companyId = null }) {
  const [row] = await db('assistant_messages')
    .insert({
      user_id: userId,
      role,
      kind,
      content,
      data: data ? JSON.stringify(data) : null,
      company_id: companyId || null,
    })
    .returning('*')
  return rowToMessage(row)
}

/** 存一个附件（聊天上传），返回落库记录 */
export async function saveAttachment({ userId, messageId = null, filename, storagePath, sizeBytes, mimeType, extractedText }) {
  const [row] = await db('assistant_attachments')
    .insert({
      user_id: userId,
      message_id: messageId,
      filename,
      storage_path: storagePath,
      size_bytes: sizeBytes ?? null,
      mime_type: mimeType || null,
      extracted_text: extractedText || null,
    })
    .returning('*')
  return row
}

/** 取单个附件（按 userId 隔离） */
export async function getAttachment(id, userId) {
  return db('assistant_attachments').where({ id, user_id: userId }).first()
}

/** 按 id 列表取当天附件（按 userId 隔离） */
export async function getAttachmentsByIds(ids, userId) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  return db('assistant_attachments')
    .whereIn('id', ids)
    .where('user_id', userId)
    .where('created_at', '>=', startOfToday())
}

/** 手动清空：删除该用户「当天」的全部消息与附件（含磁盘文件）。返回删除条数。 */
export async function clearTodayMessages(userId) {
  const cutoff = startOfToday()
  // 先删磁盘文件（删消息会级联删附件行，但磁盘文件需手动清）
  const atts = await db('assistant_attachments')
    .where('user_id', userId).where('created_at', '>=', cutoff).select('storage_path')
  for (const a of atts) {
    if (a.storage_path) await safeUnlink(toAbsolutePath(a.storage_path))
  }
  const attCount = await db('assistant_attachments')
    .where('user_id', userId).where('created_at', '>=', cutoff).del()
  const msgCount = await db('assistant_messages')
    .where('user_id', userId).where('created_at', '>=', cutoff).del()
  return { messages: msgCount, attachments: attCount }
}

/** 每日清理：删除昨天及更早的消息与附件（含磁盘文件）。返回删除条数。 */
export async function cleanupAssistantData() {
  const cutoff = startOfToday()
  // 先删磁盘文件
  const oldAtts = await db('assistant_attachments').where('created_at', '<', cutoff).select('storage_path')
  for (const a of oldAtts) {
    if (a.storage_path) await safeUnlink(toAbsolutePath(a.storage_path))
  }
  const attCount = await db('assistant_attachments').where('created_at', '<', cutoff).del()
  const msgCount = await db('assistant_messages').where('created_at', '<', cutoff).del()
  return { count: msgCount + attCount, messages: msgCount, attachments: attCount }
}
