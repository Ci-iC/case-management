import { apiFetch, apiFetchForm, downloadFile } from './client'
import type { ApprovalRecord, ApprovalDetail } from '@/types'

export const approvalsApi = {
  /** 列表：role=todo（待我审批）/ initiated（我发起的）/ all（admin/superadmin 看全部） */
  list(role: 'todo' | 'initiated' | 'all' = 'todo') {
    return apiFetch<{ approvals: ApprovalRecord[] }>(`/api/approvals?role=${role}`)
  },

  get(id: string) {
    return apiFetch<ApprovalDetail>(`/api/approvals/${id}`)
  },

  /** 经办人发起审批：v1.3.1 起需要清洁版（reuseExistingClean=true 时沿用现有清洁版，否则必须传 cleanFile） */
  initiate(payload: {
    contractId: string
    firstApproverId: string
    initiationNote?: string
    reuseExistingClean?: boolean
    cleanFile?: File
  }) {
    const form = new FormData()
    form.append('contractId', payload.contractId)
    form.append('firstApproverId', payload.firstApproverId)
    if (payload.initiationNote) form.append('initiationNote', payload.initiationNote)
    if (payload.reuseExistingClean) form.append('reuseExistingClean', 'true')
    if (payload.cleanFile) form.append('cleanFile', payload.cleanFile)
    return apiFetchForm<{ approvalId: string }>('/api/approvals', form)
  },

  /** 通过：超管首次通过时必传 nextApprovers */
  approve(approvalId: string, payload: { comment: string; nextApprovers?: string[] }) {
    return apiFetch<{ ok: true }>(`/api/approvals/${approvalId}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** 驳回：mode='to_step'（返回经办人 → 经办人 resubmit 后跳回当前驳回人）/ 'to_start'（重新发起整轮）*/
  reject(approvalId: string, payload: { comment: string; mode: 'to_step' | 'to_start' }) {
    return apiFetch<{ ok: true }>(`/api/approvals/${approvalId}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** 加签：选 1 个加签人，对方只能"提交意见"，完成后控制权回到加签人 */
  addConsultee(approvalId: string, payload: { consulteeId: string; comment: string }) {
    return apiFetch<{ ok: true; consulteeStepId: string }>(`/api/approvals/${approvalId}/add-consultee`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** 加签人提交意见（仅意见，无通过/驳回） */
  submitConsultation(approvalId: string, payload: { comment: string }) {
    return apiFetch<{ ok: true }>(`/api/approvals/${approvalId}/submit-consultation`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /** 经办人在"被驳回到经办人节点"后重新提交（直接跳回驳回人）；v1.3.1 起可选替换清洁版 */
  resubmit(approvalId: string, payload: { comment?: string; cleanFile?: File }) {
    const form = new FormData()
    if (payload.comment) form.append('comment', payload.comment)
    if (payload.cleanFile) form.append('cleanFile', payload.cleanFile)
    return apiFetchForm<{ ok: true }>(`/api/approvals/${approvalId}/resubmit`, form)
  },

  /** 经办人上传用印版（流程结束 → contract.status='sealed'） */
  uploadSeal(approvalId: string, file: File, comment?: string) {
    const form = new FormData()
    form.append('file', file)
    if (comment) form.append('comment', comment)
    return apiFetchForm<{ ok: true }>(`/api/approvals/${approvalId}/upload-seal`, form)
  },
}

/** 用印版下载（在合同台账已签署区） */
export function downloadSealedContract(contractId: string, filename: string) {
  return downloadFile(`/api/contracts/${contractId}/sealed-file`, filename)
}

/** v1.3.1: 清洁版下载（审批界面 / 合同台账详情主显示） */
export function downloadCleanContract(contractId: string, filename: string) {
  return downloadFile(`/api/contracts/${contractId}/clean-file`, filename)
}
