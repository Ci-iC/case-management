import { apiFetch, apiFetchForm, downloadFile } from './client'
import type { MessageRecord, Contact } from '@/types'

export const messagesApi = {
  list(folder: 'inbox' | 'sent') {
    return apiFetch<{ messages: MessageRecord[] }>(`/api/messages?folder=${folder}`)
  },

  get(id: string) {
    return apiFetch<{ message: MessageRecord }>(`/api/messages/${id}`)
  },

  unreadCount() {
    return apiFetch<{ count: number }>(`/api/messages/unread-count`)
  },

  /** 发送消息（multipart） */
  send(data: {
    receiverId: string
    body: string
    caseId?: string
    reviewId?: string
    attachments?: File[]
  }) {
    const form = new FormData()
    form.append('receiverId', data.receiverId)
    form.append('body', data.body)
    if (data.caseId) form.append('caseId', data.caseId)
    if (data.reviewId) form.append('reviewId', data.reviewId)
    for (const f of data.attachments || []) form.append('attachments', f)
    return apiFetchForm<{ message: MessageRecord }>('/api/messages', form)
  },

  markRead(id: string) {
    return apiFetch<{ ok: true }>(`/api/messages/${id}/read`, { method: 'POST' })
  },

  remove(id: string) {
    return apiFetch<{ ok: true }>(`/api/messages/${id}`, { method: 'DELETE' })
  },

  downloadAttachment(messageId: string, attachmentId: string, filename: string) {
    return downloadFile(`/api/messages/${messageId}/attachments/${attachmentId}`, filename)
  },

  contacts() {
    return apiFetch<{ contacts: Contact[] }>(`/api/users/contacts`)
  },
}
