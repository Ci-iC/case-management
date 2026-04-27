import { apiFetch } from './client'
import type { CaseRecord } from '@/types'

export const casesApi = {
  list() {
    return apiFetch<{ cases: CaseRecord[] }>('/api/cases')
  },

  create(data: Omit<CaseRecord, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'isArchived'>) {
    return apiFetch<{ case: CaseRecord }>('/api/cases', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  update(id: string, data: Partial<CaseRecord>) {
    return apiFetch<{ case: CaseRecord }>(`/api/cases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  remove(id: string) {
    return apiFetch<{ ok: true }>(`/api/cases/${id}`, { method: 'DELETE' })
  },

  bulkImport(cases: CaseRecord[], mode: 'append' | 'replace' | 'renumber') {
    return apiFetch<{ imported: number; skipped: number }>(`/api/cases/bulk-import`, {
      method: 'POST',
      body: JSON.stringify({ cases, mode }),
    })
  },
}
