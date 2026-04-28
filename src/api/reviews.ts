import { apiFetch, apiFetchForm, downloadFile } from './client'
import type { ReviewRecord } from '@/types'

export const reviewsApi = {
  list(caseId?: string) {
    const q = caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''
    return apiFetch<{ reviews: ReviewRecord[] }>(`/api/reviews${q}`)
  },

  get(id: string) {
    return apiFetch<{ review: ReviewRecord }>(`/api/reviews/${id}`)
  },

  /** 上传文件并触发审核（按指定审核模型，省略则用 default） */
  create(file: File, opts?: {
    caseId?: string; model?: string; pipelineId?: string;
    contractId?: string; contractName?: string;
    ourRole?: string  // freeform：可填"甲方"/"乙方"/或自定义角色（如"第三方"/"赞助方"）
    reviewIntensity?: 'strict' | 'medium' | 'lenient'
  }) {
    const form = new FormData()
    form.append('file', file)
    if (opts?.caseId) form.append('caseId', opts.caseId)
    if (opts?.model) form.append('model', opts.model)
    if (opts?.pipelineId) form.append('pipelineId', opts.pipelineId)
    if (opts?.contractId) form.append('contractId', opts.contractId)
    if (opts?.contractName) form.append('contractName', opts.contractName)
    if (opts?.ourRole) form.append('ourRole', opts.ourRole)
    if (opts?.reviewIntensity) form.append('reviewIntensity', opts.reviewIntensity)
    return apiFetchForm<{ review: ReviewRecord }>('/api/reviews', form)
  },

  downloadOriginal(id: string, filename: string) {
    return downloadFile(`/api/reviews/${id}/file`, filename)
  },

  remove(id: string) {
    return apiFetch<{ ok: true }>(`/api/reviews/${id}`, { method: 'DELETE' })
  },
}
