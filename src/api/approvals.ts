import { apiFetch, apiFetchForm, downloadFile, getAuthHeader, ApiError } from './client'
import type { ApprovalRecord, ApprovalDetail } from '@/types'
import type { TemplateStepRole } from './companies'

// v2.1: 发起审批前查询当前公司 active 模板及候选人
export interface TemplatePreviewCandidate {
  userId: string
  username: string
  displayName?: string | null
}
export interface TemplatePreviewStep {
  stepIndex: number
  role: TemplateStepRole
  /** v2.1+: 后端返回的角色中文名（含自定义角色） */
  roleName?: string
  stepLabel?: string | null
  candidates: TemplatePreviewCandidate[]
}
export interface TemplatePreview {
  template: { id: string; name: string }
  steps: TemplatePreviewStep[]
}

export interface StepAssignment {
  stepIndex: number
  userId: string
}

export const approvalsApi = {
  /** 列表：role=todo（待我审批）/ initiated（我发起的）/ all（admin/superadmin 看全部） */
  list(role: 'todo' | 'initiated' | 'all' = 'todo') {
    return apiFetch<{ approvals: ApprovalRecord[] }>(`/api/approvals?role=${role}`)
  },

  get(id: string) {
    return apiFetch<ApprovalDetail>(`/api/approvals/${id}`)
  },

  /** v2.1: 发起审批前预览当前公司 active 模板（含每步候选人）
   *  contractId 可选：不传时按当前公司预览（用于"不经审核直接发起"——合同尚未创建） */
  templatePreview(contractId?: string) {
    const q = contractId ? `?contractId=${encodeURIComponent(contractId)}` : ''
    return apiFetch<TemplatePreview>(`/api/approvals/template-preview${q}`)
  },

  /** 经办人发起审批：
   *  v1.3.1 起需要清洁版（reuseExistingClean=true 时沿用现有清洁版，否则必须传 cleanFile）
   *  v2.1 起改由模板驱动：stepAssignments 必须覆盖模板里所有步骤
   */
  initiate(payload: {
    contractId: string
    stepAssignments: StepAssignment[]
    initiationNote?: string
    reuseExistingClean?: boolean
    cleanFile?: File
  }) {
    const form = new FormData()
    form.append('contractId', payload.contractId)
    form.append('stepAssignments', JSON.stringify(payload.stepAssignments))
    if (payload.initiationNote) form.append('initiationNote', payload.initiationNote)
    if (payload.reuseExistingClean) form.append('reuseExistingClean', 'true')
    if (payload.cleanFile) form.append('cleanFile', payload.cleanFile)
    return apiFetchForm<{ approvalId: string }>('/api/approvals', form)
  },

  /** 通过（v2.1：模板驱动后不再需要 nextApprovers） */
  approve(approvalId: string, payload: { comment: string }) {
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

  /** 经办人上传用印版（流程结束 → contract.status='sealed'）
   *  v1.4: sealedAt 必填（YYYY-MM-DD，用户手填用印日期） */
  uploadSeal(approvalId: string, file: File, sealedAt: string, comment?: string) {
    const form = new FormData()
    form.append('file', file)
    form.append('sealedAt', sealedAt)
    if (comment) form.append('comment', comment)
    return apiFetchForm<{ ok: true }>(`/api/approvals/${approvalId}/upload-seal`, form)
  },
}

/** 用印版下载（在合同台账已签署区） */
export function downloadSealedContract(contractId: string, filename: string) {
  return downloadFile(`/api/contracts/${contractId}/sealed-file`, filename)
}

/** v2.1+: 用印水印版 PDF（合同清洁版 → LibreOffice 转 PDF → pdf-lib 加公司全称水印） */
export function downloadWatermarkPdf(approvalId: string, filename: string) {
  return downloadFile(`/api/approvals/${approvalId}/export-watermark-pdf`, filename)
}

/** v1.3.1: 清洁版下载（审批界面 / 合同台账详情主显示） */
export function downloadCleanContract(contractId: string, filename: string) {
  return downloadFile(`/api/contracts/${contractId}/clean-file`, filename)
}

/** 网页内预览：拉取清洁版合同的 PDF（Word 会由服务端转 PDF），返回 blob URL 供 pdfjs 渲染。
 *  调用方负责在不用时 URL.revokeObjectURL 释放。 */
export async function fetchPreviewPdfUrl(approvalId: string): Promise<string> {
  const resp = await fetch(`/api/approvals/${approvalId}/preview-pdf`, { headers: getAuthHeader() })
  if (!resp.ok) {
    let msg = `预览加载失败 (${resp.status})`
    try {
      const ct = resp.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const body = await resp.json() as { error?: string }
        if (body?.error) msg = body.error
      }
    } catch { /* ignore */ }
    throw new ApiError(msg, resp.status)
  }
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}
