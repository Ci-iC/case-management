import { apiFetch, apiFetchForm, getAuthHeader, downloadFile } from './client'
import { draftApi } from './draft'

// 跳转目标（待办里的"跳转查看"）
export interface JumpLink {
  index: number
  label: string
  nav: 'approvals' | 'reviews' | 'contracts'
  approvalId?: string
  reviewId?: string
  contractId?: string
}

// 可下载文件链接（AI 把文件"发给用户"时，附在回复下方的下载按钮）
export interface FileLink {
  kind: 'contract_clean' | 'contract_sealed' | 'draft'
  filename: string
  label: string
  contractId?: string   // contract_* 用
  downloadId?: string   // draft（起草草稿）用
}

// 可编辑确认项（用户在确认框里填空/选择，确认后回填到 args）
export interface ActionField {
  key: string
  label: string
  // select=按钮组（选项少时）；dropdown=原生下拉（选项多时，如历史合同列表）
  type: 'text' | 'textarea' | 'select' | 'dropdown' | 'readonly'
  required?: boolean
  options?: { value: string; label?: string }[]
  allowCustom?: boolean
  placeholder?: string
  hint?: string
  value?: string
  /** 条件显隐：仅当另一字段 key 的当前取值等于 value 时才显示（用于互斥字段） */
  showWhen?: { key: string; value: string }
}

// 写操作提议（pending_action）
export interface PendingAction {
  tool: string
  label: string
  executor: string
  args: Record<string, unknown>
  summary: Record<string, unknown> | string
  fields?: ActionField[] | null
  /** 无害动作：前端直接打开对应窗口，无需"确认执行"卡 */
  autoConfirm?: boolean
}

// 执行写操作后回报给后端的结构化结果（用于展示 AI 审核意见、串联 reviewId 等）
export interface ActionResultData {
  reviewId?: string
  reviewResult?: { reviewId: string; filename: string; ourRole?: string; reviewText: string }
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'file' | 'todo' | 'pending_action' | 'action_result' | 'review_result'
  content: string
  data: {
    filename?: string
    attachmentId?: string
    jumpLinks?: JumpLink[]
    // 文本回复附带的可下载文件按钮
    fileLinks?: FileLink[]
    // review_result：结构化审核意见
    reviewId?: string
    ourRole?: string
    reviewText?: string
  } & Partial<PendingAction> | null
  createdAt: string | null
}

export interface QuickAction {
  id: string
  label: string
  icon: string
  kind: 'draft' | 'prompt'
  prompt?: string
}

export const assistantApi = {
  history() {
    return apiFetch<{ messages: AssistantMessage[] }>('/api/assistant/history')
  },
  sendMessage(text: string) {
    return apiFetch<{ messages: AssistantMessage[] }>('/api/assistant/message', {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  },
  upload(file: File) {
    const form = new FormData()
    form.append('file', file)
    return apiFetchForm<{ message: AssistantMessage; attachmentId: string; filename: string }>(
      '/api/assistant/upload', form,
    )
  },
  actionResult(payload: { ok?: boolean; cancelled?: boolean; summary?: string; error?: string; resultData?: ActionResultData }) {
    return apiFetch<{ messages: AssistantMessage[] }>('/api/assistant/action-result', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  quickActions() {
    return apiFetch<{ actions: QuickAction[] }>('/api/assistant/quick-actions')
  },
  /** 手动清空当天对话（含已上传文件），返回重置后的消息（含新的开场待办） */
  clear() {
    return apiFetch<{ messages: AssistantMessage[] }>('/api/assistant/clear', { method: 'POST' })
  },
  /** 下载 AI 回复里附带的文件：起草草稿走 /api/draft，合同清洁版/用印版走带权限校验的工作台入口 */
  downloadFileLink(link: FileLink) {
    if (link.kind === 'draft') return draftApi.download(link.downloadId || '', link.filename)
    const kind = link.kind === 'contract_sealed' ? 'sealed' : 'clean'
    return downloadFile(`/api/assistant/contract-file/${link.contractId}?kind=${kind}`, link.filename)
  },
  /** 起草草稿生成后，把"已生成 + 下载"作为一条消息记进主对话（关掉弹窗也不丢） */
  recordDraftResult(payload: { downloadId: string; filename: string; title?: string }) {
    return apiFetch<{ messages: AssistantMessage[] }>('/api/assistant/draft-result', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  /** 取聊天附件为 File（写操作需要文件时用） */
  async fetchAttachmentFile(attachmentId: string, filename: string): Promise<File> {
    const resp = await fetch(`/api/assistant/attachment/${attachmentId}`, { headers: getAuthHeader() })
    if (!resp.ok) throw new Error('附件获取失败，可能已过期，请重新上传')
    const blob = await resp.blob()
    return new File([blob], filename, { type: blob.type })
  },
}
