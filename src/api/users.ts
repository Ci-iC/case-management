import { apiFetch } from './client'
import type { AuthUser, UserRole } from './auth'

export const usersApi = {
  list() {
    return apiFetch<{ users: AuthUser[] }>('/api/users')
  },

  create(data: {
    username: string; password: string;
    role: UserRole; displayName?: string;
    canViewCases?: boolean; canViewContracts?: boolean;
  }) {
    return apiFetch<{ user: AuthUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  setRole(id: string, role: UserRole) {
    return apiFetch<{ user: AuthUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
  },

  setDisplayName(id: string, displayName: string) {
    return apiFetch<{ user: AuthUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    })
  },

  remove(id: string) {
    return apiFetch<{ ok: true }>(`/api/users/${id}`, { method: 'DELETE' })
  },

  resetPassword(id: string, newPassword: string) {
    return apiFetch<{ ok: true }>(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    })
  },

  setCaseAccess(id: string, canViewCases: boolean) {
    return apiFetch<{ user: AuthUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ canViewCases }),
    })
  },

  setContractAccess(id: string, canViewContracts: boolean) {
    return apiFetch<{ user: AuthUser }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ canViewContracts }),
    })
  },
}
