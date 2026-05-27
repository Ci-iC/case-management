import { apiFetch, apiFetchForm, getAuthHeader } from './client'
import type { AuthUser, PlatformRole, CompanyRole } from './auth'

export interface BulkImportResult {
  imported: number
  skipped: number
  errors: Array<{ row: number; username: string; error: string }>
}

export interface UserAssignment {
  assignmentId: string
  companyId: string
  companyName: string
  companyCode?: string | null
  companyStatus: 'active' | 'inactive'
  /** 角色 key —— v2.1+ 可能是自定义角色（如 role_xxxx），不再局限于固定 5 个 */
  role: string
  /** v2.1+: 角色中文名（含自定义角色），用于直接展示 */
  roleName?: string
}

export interface UserDetail extends AuthUser {
  companyAssignments: UserAssignment[]
}

export const usersApi = {
  list() {
    return apiFetch<{ users: UserDetail[] }>('/api/users')
  },

  /** v2.0: 联系人接口，按当前公司过滤 */
  contacts() {
    return apiFetch<{ contacts: Array<{ id: string; username: string; displayName?: string; roles: CompanyRole[] }> }>('/api/users/contacts')
  },

  create(data: {
    username: string; password: string;
    role: PlatformRole; displayName?: string;
    assignments?: Array<{ companyId: string; role: string }>;
  }) {
    return apiFetch<{ user: UserDetail }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  setRole(id: string, role: PlatformRole) {
    return apiFetch<{ user: UserDetail }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    })
  },

  setDisplayName(id: string, displayName: string) {
    return apiFetch<{ user: UserDetail }>(`/api/users/${id}`, {
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

  addCompanyRole(userId: string, companyId: string, role: string) {
    return apiFetch<{ assignmentId: string }>(`/api/users/${userId}/company-roles`, {
      method: 'POST',
      body: JSON.stringify({ companyId, role }),
    })
  },

  removeCompanyRole(userId: string, assignmentId: string) {
    return apiFetch<{ ok: true }>(`/api/users/${userId}/company-roles/${assignmentId}`, {
      method: 'DELETE',
    })
  },

  /** v2.0: 下载用户导入 Excel 模板（带表头 + 示例行 + 填写说明） */
  downloadImportTemplate() {
    return fetch('/api/users/import-template', { headers: getAuthHeader() })
      .then(async (resp) => {
        if (!resp.ok) {
          let msg = `下载失败 (${resp.status})`
          try { msg = (await resp.json())?.error || msg } catch {}
          throw new Error(msg)
        }
        const blob = await resp.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = '用户导入模板.xlsx'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      })
  },

  /** v2.0: 批量导入用户名单 */
  bulkImport(file: File) {
    const form = new FormData()
    form.append('file', file)
    return apiFetchForm<BulkImportResult>('/api/users/bulk-import', form)
  },
}
