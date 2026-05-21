import { apiFetch, apiFetchForm, downloadFile } from './client'
import type { ReviewRecord } from '@/types'

export const reviewsApi = {
  list(opts?: { caseId?: string; includeDrafts?: boolean }) {
    const params = new URLSearchParams()
    if (opts?.caseId) params.set('caseId', opts.caseId)
    if (opts?.includeDrafts) params.set('includeDrafts', '1')
    const q = params.toString() ? `?${params.toString()}` : ''
    return apiFetch<{ reviews: ReviewRecord[] }>(`/api/reviews${q}`)
  },

  get(id: string) {
    return apiFetch<{ review: ReviewRecord }>(`/api/reviews/${id}`)
  },

  /** 上传文件并触发 AI 审核（草稿态，is_draft=true）
   *  v1.2 起：合同关联推迟到 submitToLegal；这里不再传 contractId/contractName
   */
  create(file: File, opts?: {
    caseId?: string; model?: string; pipelineId?: string;
    ourRole?: string  // freeform：可填"甲方"/"乙方"/或自定义角色（如"第三方"/"赞助方"）
    reviewIntensity?: 'strict' | 'medium' | 'lenient'
  }) {
    const form = new FormData()
    form.append('file', file)
    if (opts?.caseId) form.append('caseId', opts.caseId)
    if (opts?.model) form.append('model', opts.model)
    if (opts?.pipelineId) form.append('pipelineId', opts.pipelineId)
    if (opts?.ourRole) form.append('ourRole', opts.ourRole)
    if (opts?.reviewIntensity) form.append('reviewIntensity', opts.reviewIntensity)
    return apiFetchForm<{ review: ReviewRecord }>('/api/reviews', form)
  },

  /** 提交草稿审核：自动建合同 / 挂到已有合同 + 转正 review + 创建发法务的消息 */
  submitToLegal(reviewId: string, payload: {
    contractMode: 'new' | 'existing'
    contractName?: string
    contractDescription?: string
    contractId?: string
    receiverId: string
    body: string
    attachments?: File[]
  }) {
    const form = new FormData()
    form.append('contractMode', payload.contractMode)
    if (payload.contractName) form.append('contractName', payload.contractName)
    if (payload.contractDescription) form.append('contractDescription', payload.contractDescription)
    if (payload.contractId) form.append('contractId', payload.contractId)
    form.append('receiverId', payload.receiverId)
    form.append('body', payload.body)
    for (const f of payload.attachments || []) {
      form.append('attachments', f)
    }
    return apiFetchForm<{
      review: ReviewRecord
      contractId: string
      messageId: string
    }>(`/api/reviews/${reviewId}/submit`, form)
  },

  downloadOriginal(id: string, filename: string) {
    return downloadFile(`/api/reviews/${id}/file`, filename)
  },

  /** 仅 superadmin（v1.3.2 起）：上传法务审核版（覆盖旧的）。v1.3.1 起支持 comment（拼进自动消息正文） */
  uploadLegalRevision(reviewId: string, file: File, comment?: string) {
    const form = new FormData()
    form.append('file', file)
    if (comment) form.append('comment', comment)
    return apiFetchForm<{ review: ReviewRecord }>(`/api/reviews/${reviewId}/legal-revision`, form)
  },

  /** v1.3.1: 法务"无需修订，直接通过"。不传文件，只标记 + 发消息。v1.3.2 起仅 superadmin 可调 */
  legalApprove(reviewId: string, comment?: string) {
    return apiFetch<{ review: ReviewRecord; notified: boolean }>(`/api/reviews/${reviewId}/legal-approve`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment || '' }),
    })
  },

  downloadLegalRevision(reviewId: string, filename: string) {
    return downloadFile(`/api/reviews/${reviewId}/legal-file`, filename)
  },

  remove(id: string) {
    return apiFetch<{ ok: true }>(`/api/reviews/${id}`, { method: 'DELETE' })
  },
}
