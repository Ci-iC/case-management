import { apiFetch } from './client'
import type { ContractRecord } from '@/types'

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
}
