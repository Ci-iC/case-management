import { apiFetch, apiFetchForm, getAuthHeader } from './client'
import type { ContractRecord } from '@/types'

export interface ContractFields {
  contractName?: string | null
  ourParties?: string[]
  counterParties?: string[]
  contractType?: string | null
  paymentType?: string | null
  contractAmount?: number | null
  termType?: string | null
  termDate?: string | null
  termText?: string | null
}

export interface ContractMeta {
  contractTypes: string[]
  paymentTypes: string[]
  termTypes: string[]
  requiresAmountPaymentTypes: string[]
  contractStatuses: string[]
}

export const contractsApi = {
  list(opts?: { onlyUnapproved?: boolean; status?: 'drafting' | 'approving' | 'pending_seal' | 'sealed' }) {
    const params = new URLSearchParams()
    if (opts?.status) params.set('status', opts.status)
    if (opts?.onlyUnapproved) params.set('onlyUnapproved', '1')
    const q = params.toString() ? `?${params.toString()}` : ''
    return apiFetch<{ contracts: ContractRecord[] }>(`/api/contracts${q}`)
  },
  get(id: string) {
    return apiFetch<{ contract: ContractRecord }>(`/api/contracts/${id}`)
  },
  meta() {
    return apiFetch<ContractMeta>('/api/contracts/meta')
  },
  create(data: { name: string; description?: string }) {
    return apiFetch<{ contract: ContractRecord }>('/api/contracts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },
  update(id: string, data: { name?: string; description?: string | null }) {
    return apiFetch<{ contract: ContractRecord }>(`/api/contracts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },
  /** v1.4+: AI 提取结构化字段（**以清洁版为准**，不写库，前端拿到后填充编辑卡片）
   *  二选一：传 cleanFile（新上传的清洁版 Word）或 reuseExistingClean（沿用合同已存清洁版）。 */
  extractFields(id: string, opts: { cleanFile?: File; reuseExistingClean?: boolean }) {
    const form = new FormData()
    if (opts.cleanFile) form.append('cleanFile', opts.cleanFile)
    if (opts.reuseExistingClean) form.append('reuseExistingClean', 'true')
    return apiFetchForm<{ fields: ContractFields }>(`/api/contracts/${id}/extract-fields`, form)
  },
  /** v1.4: 保存结构化字段草稿 */
  saveDraft(id: string, data: Partial<ContractFields> & { name?: string; handlerId?: string }) {
    return apiFetch<{ contract: ContractRecord }>(`/api/contracts/${id}/draft`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },
  /** v1.4: Excel 导出（mode=filtered|all + 过滤参数） */
  exportXlsx(query: string = ''): Promise<void> {
    const headers = getAuthHeader()
    return fetch(`/api/contracts/export${query ? `?${query}` : ''}`, { headers })
      .then(async (resp) => {
        if (!resp.ok) {
          let msg = `导出失败 (${resp.status})`
          try { msg = (await resp.json())?.error || msg } catch {}
          throw new Error(msg)
        }
        const blob = await resp.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = '合同台账.xlsx'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      })
  },
}
