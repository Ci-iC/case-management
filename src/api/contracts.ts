import { apiFetch } from './client'
import type { ContractRecord } from '@/types'

export const contractsApi = {
  list() {
    return apiFetch<{ contracts: ContractRecord[] }>('/api/contracts')
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
