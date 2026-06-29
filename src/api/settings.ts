import { apiFetch } from './client'

export interface AppSetting {
  key: string
  value: string
  isSecret: boolean
  isSet: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export const settingsApi = {
  list() {
    return apiFetch<{ settings: AppSetting[] }>(`/api/settings`)
  },
  get(key: string) {
    return apiFetch<{ setting: AppSetting }>(`/api/settings/${encodeURIComponent(key)}`)
  },
  update(key: string, value: string) {
    return apiFetch<{ setting: AppSetting }>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  },
  testOpenAI() {
    return apiFetch<{ ok: true; message: string }>(`/api/settings/test-openai`, { method: 'POST' })
  },
  testEmail(to: string) {
    return apiFetch<{ ok: true; message: string }>(`/api/settings/test-email`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    })
  },
}
