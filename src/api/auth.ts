import { apiFetch } from './client'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  displayName?: string
  canViewCases?: boolean
  canViewContracts?: boolean
  createdAt: string
  createdBy?: string
}

export const authApi = {
  login(username: string, password: string) {
    return apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },

  me() {
    return apiFetch<{ user: AuthUser }>('/api/auth/me')
  },

  changePassword(currentPassword: string, newPassword: string) {
    return apiFetch<{ ok: true }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  },
}
