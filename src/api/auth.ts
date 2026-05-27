import { apiFetch } from './client'

// v2.0: 平台层只有 superadmin / platform_user
export type PlatformRole = 'superadmin' | 'platform_user'

// 公司层角色
export type CompanyRole = 'manager' | 'legal' | 'seal_admin' | 'finance' | 'staff'

export interface UserCompanyAssignment {
  companyId: string
  companyName: string
  companyCode?: string | null
  roles: CompanyRole[]
}

export interface AuthUser {
  id: string
  username: string
  role: PlatformRole | string         // 兼容历史 string
  displayName?: string
  mustChangePassword?: boolean
  createdAt: string
  // v2.0 公司上下文
  companies?: UserCompanyAssignment[]
  currentCompanyId?: string | null
  currentCompany?: UserCompanyAssignment | null
  companyRoles?: CompanyRole[]
  isAllCompaniesView?: boolean
}

export function isSuperAdmin(user: { role?: string } | null | undefined): boolean {
  return user?.role === 'superadmin'
}

/** 当前公司里是否有某个角色 */
export function hasCompanyRole(user: AuthUser | null | undefined, role: CompanyRole): boolean {
  return (user?.companyRoles || []).includes(role)
}

/** 是否当前公司里"能看全公司合同"的角色（manager/legal/seal_admin/finance） */
export function canSeeAllContracts(user: AuthUser | null | undefined): boolean {
  const roles = user?.companyRoles || []
  return roles.some(r => ['manager', 'legal', 'seal_admin', 'finance'].includes(r))
}

/**
 * 是否能看案件台账。
 * v2.0：案件台账跨公司共享，所有公司的法务岗/企业管理人员都能看 —— 只要用户在**任意一家公司**有
 * 'legal' 或 'manager' 角色即可。
 */
export function canSeeCases(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'superadmin') return true
  const companies = user.companies || []
  return companies.some(c => (c.roles || []).some(r => r === 'legal' || r === 'manager'))
}

/** 公司角色中文标签 */
export const COMPANY_ROLE_LABEL: Record<CompanyRole, string> = {
  manager: '企业管理人员',
  legal: '法务岗',
  seal_admin: '印章管理岗',
  finance: '财务人员',
  staff: '普通员工',
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

  /** 用户可选公司（含 superadmin 看全部 active） */
  companies() {
    return apiFetch<{ companies: UserCompanyAssignment[] }>('/api/auth/companies')
  },

  /** 切换公司，重签 token。companyId 可传 'ALL'（manager 多公司汇总视图） */
  switchCompany(companyId: string) {
    return apiFetch<{ token: string }>('/api/auth/switch-company', {
      method: 'POST',
      body: JSON.stringify({ companyId }),
    })
  },

  changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    return apiFetch<{ ok: true; token: string; user: AuthUser }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    })
  },
}
