import { apiFetch } from './client'
import type { CompanyRole } from './auth'

// v2.1+: 模板步骤可用的角色 key 不再是固定 enum，而是按公司 company_roles 表里的 key
//   （staff 在 server 端被过滤掉，不会出现在模板步骤里）
export type TemplateStepRole = string

export interface ApprovalTemplateStep {
  id: string
  stepIndex: number
  role: TemplateStepRole
  /** v2.1+: 后端返回的角色中文名（从 company_roles.name 取） */
  roleName?: string
  stepLabel?: string | null
}

export interface ApprovalTemplate {
  id: string
  companyId: string
  name: string
  isActive: boolean
  createdBy?: string | null
  createdAt: string
  updatedAt: string
  steps: ApprovalTemplateStep[]
}

export interface ApprovalTemplateStepInput {
  role: TemplateStepRole
  stepLabel?: string
}

// 系统内置 5 个角色的 fallback 中文名（前端在拿不到 roleName 的极端场景才用）
export const APPROVAL_TEMPLATE_ROLE_LABEL: Record<string, string> = {
  legal: '法务岗',
  finance: '财务人员',
  manager: '企业管理人员',
  seal_admin: '印章管理岗',
  staff: '普通员工',
}

export interface Company {
  id: string
  name: string
  code?: string | null
  status: 'active' | 'inactive'
  description?: string | null
  memberCount?: number
  contractCount?: number
  createdAt: string
  updatedAt?: string
  createdBy?: string | null
}

export interface CompanyMemberAssignment {
  assignmentId: string
  role: CompanyRole
}

export interface CompanyMember {
  userId: string
  username: string
  displayName?: string
  roles: CompanyRole[]
  assignments: CompanyMemberAssignment[]
}

// v2.1+: 公司角色（含系统内置 + 自定义）
export interface CompanyRoleInfo {
  id: string
  companyId: string
  key: string
  name: string
  canViewAllContracts: boolean
  isSystem: boolean
  sortOrder: number
  memberCount: number
  templateRefCount: number
  createdAt: string
  updatedAt: string
}

export const companiesApi = {
  list() {
    return apiFetch<{ companies: Company[] }>('/api/companies')
  },
  detail(id: string) {
    return apiFetch<{ company: Company; members: CompanyMember[] }>(`/api/companies/${id}`)
  },
  create(payload: { name: string; code?: string; description?: string }) {
    return apiFetch<{ companyId: string }>('/api/companies', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  patch(id: string, payload: Partial<Company>) {
    return apiFetch<{ ok: true }>(`/api/companies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  deactivate(id: string) {
    return apiFetch<{ ok: true }>(`/api/companies/${id}`, { method: 'DELETE' })
  },

  // ─── v2.1+ 公司简称历史 ─────────────────────────────────────────────────
  codeHistory(companyId: string) {
    return apiFetch<{
      currentCode: string | null
      history: Array<{
        id: string
        code: string
        validFrom: string
        validUntil: string | null
        isCurrent: boolean
        changedByUsername: string | null
        changedByDisplayName: string | null
      }>
    }>(`/api/companies/${companyId}/code-history`)
  },

  // ─── v2.1+ 公司角色 ─────────────────────────────────────────────────────
  listRoles(companyId: string) {
    return apiFetch<{ roles: CompanyRoleInfo[] }>(`/api/companies/${companyId}/roles`)
  },
  createRole(companyId: string, payload: { name: string; canViewAllContracts?: boolean }) {
    return apiFetch<{ roleId: string; key: string }>(
      `/api/companies/${companyId}/roles`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  },
  updateRole(companyId: string, roleId: string, payload: {
    name?: string
    canViewAllContracts?: boolean
  }) {
    return apiFetch<{ ok: true }>(
      `/api/companies/${companyId}/roles/${roleId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    )
  },
  deleteRole(companyId: string, roleId: string) {
    return apiFetch<{ ok: true }>(
      `/api/companies/${companyId}/roles/${roleId}`,
      { method: 'DELETE' },
    )
  },

  // ─── v2.1 审批流模板 ────────────────────────────────────────────────────
  listTemplates(companyId: string) {
    return apiFetch<{ templates: ApprovalTemplate[] }>(
      `/api/companies/${companyId}/approval-templates`,
    )
  },
  createTemplate(companyId: string, payload: {
    name: string
    steps: ApprovalTemplateStepInput[]
    isActive?: boolean
  }) {
    return apiFetch<{ templateId: string }>(
      `/api/companies/${companyId}/approval-templates`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  },
  updateTemplate(companyId: string, templateId: string, payload: {
    name?: string
    steps?: ApprovalTemplateStepInput[]
  }) {
    return apiFetch<{ ok: true }>(
      `/api/companies/${companyId}/approval-templates/${templateId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    )
  },
  activateTemplate(companyId: string, templateId: string) {
    return apiFetch<{ ok: true }>(
      `/api/companies/${companyId}/approval-templates/${templateId}/activate`,
      { method: 'PATCH' },
    )
  },
  deleteTemplate(companyId: string, templateId: string) {
    return apiFetch<{ ok: true }>(
      `/api/companies/${companyId}/approval-templates/${templateId}`,
      { method: 'DELETE' },
    )
  },
}
