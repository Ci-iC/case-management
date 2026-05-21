import { apiFetch } from './client'

export type UserRole = 'superadmin' | 'admin' | 'user'

export interface AuthUser {
  id: string
  username: string
  role: UserRole
  displayName?: string
  canViewCases?: boolean
  canViewContracts?: boolean
  createdAt: string
  createdBy?: string
}

/** 是否管理员或以上（admin / superadmin），用于看全部台账、做法务工作 */
export function isAdminOrAbove(user: { role?: UserRole | string } | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'superadmin'
}

/** 是否超级管理员（系统设置 / 用户管理 / 审核模型管理） */
export function isSuperAdmin(user: { role?: UserRole | string } | null | undefined): boolean {
  return user?.role === 'superadmin'
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
