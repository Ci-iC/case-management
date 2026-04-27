import { apiFetch } from './client'

export interface AppSetting {
  key: string
  value: string
  updatedAt: string
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
}
