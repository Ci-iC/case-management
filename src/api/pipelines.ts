import { apiFetch } from './client'
import type { Pipeline, PipelineStep } from '@/types'

export interface PipelineCreateData {
  name: string
  description?: string | null
  isDefault?: boolean
  steps: { name: string; prompt: string; enabled?: boolean }[]
}

export interface PipelineUpdateData {
  name?: string
  description?: string | null
  isDefault?: boolean
  steps?: { name: string; prompt: string; enabled?: boolean }[]
}

export const pipelinesApi = {
  list() {
    return apiFetch<{ pipelines: Pipeline[] }>('/api/pipelines')
  },
  get(id: string) {
    return apiFetch<{ pipeline: Pipeline }>(`/api/pipelines/${id}`)
  },
  create(data: PipelineCreateData) {
    return apiFetch<{ pipeline: Pipeline }>('/api/pipelines', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },
  update(id: string, data: PipelineUpdateData) {
    return apiFetch<{ pipeline: Pipeline }>(`/api/pipelines/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },
  remove(id: string) {
    return apiFetch<{ ok: true }>(`/api/pipelines/${id}`, { method: 'DELETE' })
  },
}

export type { Pipeline, PipelineStep }
