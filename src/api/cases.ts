import { apiFetch, apiFetchForm } from './client'
import type { CaseRecord } from '@/types'

export const casesApi = {
  /** v2.0: 案件材料智能录入（服务端调用 AI，统一使用平台 OpenAI Key） */
  aiExtract(files: File[], ourRole: 'plaintiff' | 'defendant') {
    const form = new FormData()
    form.append('ourRole', ourRole)
    for (const f of files) form.append('files', f)
    return apiFetchForm<{ data: Partial<CaseRecord> }>('/api/cases/ai-extract', form)
  },

  list() {
    return apiFetch<{ cases: CaseRecord[] }>('/api/cases')
  },

  create(data: Omit<CaseRecord, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version' | 'isArchived'>) {
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
