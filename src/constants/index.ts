import type { DisputeType, CaseStage, ClosingMethod, UrgencyLevel } from '@/types'

// ─── Dispute Type Definitions ──────────────────────────────────────────────────

export const DISPUTE_TYPE_OPTIONS: { value: DisputeType; label: string }[] = [
  { value: 'contract',   label: '合同纠纷' },
  { value: 'labor',      label: '劳动争议' },
  { value: 'ip',         label: '知识产权' },
  { value: 'tort',       label: '侵权责任' },
  { value: 'compliance', label: '合规/行政' },
  { value: 'other',      label: '其他' },
]

export const DISPUTE_TYPE_LABELS: Record<DisputeType, string> = {
  contract:   '合同纠纷',
  labor:      '劳动争议',
  ip:         '知识产权',
  tort:       '侵权责任',
  compliance: '合规/行政',
  other:      '其他',
}

/** Tailwind classes for each dispute type badge */
export const DISPUTE_TYPE_BADGE: Record<DisputeType, string> = {
  contract:   'bg-blue-50 text-blue-700 border-blue-200',
  labor:      'bg-orange-50 text-orange-700 border-orange-200',
  ip:         'bg-purple-50 text-purple-700 border-purple-200',
  tort:       'bg-red-50 text-red-700 border-red-200',
  compliance: 'bg-teal-50 text-teal-700 border-teal-200',
  other:      'bg-slate-100 text-slate-600 border-slate-200',
}

// ─── Case Stage Definitions ────────────────────────────────────────────────────

export const CASE_STAGE_OPTIONS: { value: CaseStage; label: string }[] = [
  { value: 'filed',        label: '立案' },
  { value: 'hearing',      label: '审理中' },
  { value: 'first_trial',  label: '一审' },
  { value: 'second_trial', label: '二审' },
  { value: 'execution',    label: '执行' },
  { value: 'closed',       label: '结案' },
]

export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
  filed:        '立案',
  hearing:      '审理中',
  first_trial:  '一审',
  second_trial: '二审',
  execution:    '执行',
  closed:       '结案',
}

/** Tailwind classes for each stage badge */
export const CASE_STAGE_BADGE: Record<CaseStage, string> = {
  filed:        'bg-sky-50 text-sky-700 border-sky-200',
  hearing:      'bg-indigo-50 text-indigo-700 border-indigo-200',
  first_trial:  'bg-violet-50 text-violet-700 border-violet-200',
  second_trial: 'bg-amber-50 text-amber-700 border-amber-200',
  execution:    'bg-rose-50 text-rose-700 border-rose-200',
  closed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
}

// ─── Closing Method Definitions ───────────────────────────────────────────────

export const CLOSING_METHOD_OPTIONS: { value: ClosingMethod; label: string }[] = [
  { value: 'withdrawal', label: '撤诉' },
  { value: 'settlement', label: '和解' },
  { value: 'judgment',   label: '判决' },
]

export const CLOSING_METHOD_LABELS: Record<ClosingMethod, string> = {
  withdrawal: '撤诉',
  settlement: '和解',
  judgment:   '判决',
}

// ─── Urgency Levels ────────────────────────────────────────────────────────────

export const URGENCY_BADGE: Record<UrgencyLevel, string> = {
  overdue:  'bg-red-100 text-red-700 border-red-300',
  critical: 'bg-red-50 text-red-600 border-red-200',
  warning:  'bg-orange-50 text-orange-600 border-orange-200',
  soon:     'bg-amber-50 text-amber-600 border-amber-200',
  normal:   'bg-slate-50 text-slate-600 border-slate-200',
  none:     'bg-transparent text-slate-400 border-transparent',
}

export const URGENCY_TEXT_COLOR: Record<UrgencyLevel, string> = {
  overdue:  'text-red-600 font-semibold',
  critical: 'text-red-500 font-medium',
  warning:  'text-orange-500 font-medium',
  soon:     'text-amber-500',
  normal:   'text-slate-600',
  none:     'text-slate-400',
}

// ─── Pagination Options ────────────────────────────────────────────────────────

export const PAGE_SIZE_OPTIONS = [10, 20, 50]
export const DEFAULT_PAGE_SIZE = 20

// ─── Filter Default Values ─────────────────────────────────────────────────────

export const DEFAULT_FILTERS = {
  keyword: '',
  caseNumber: '',
  caseName: '',
  causeOfAction: '',
  disputeType: '' as const,
  stage: '' as const,
  assignedLawyer: '',
  businessDepartment: '',
  ourParty: '',
  opposingParty: '',
  filingDateStart: '',
  filingDateEnd: '',
  amountMin: '',
  amountMax: '',
  showArchived: false,
}

// ─── Navigation Items (for Sidebar) ───────────────────────────────────────────

export const NAV_ITEMS = [
  { id: 'reviews',   label: '合同审核', icon: 'FileSearch',  path: '/reviews' },
  { id: 'approvals', label: '合同审批', icon: 'CheckSquare', path: '/approvals' },
  { id: 'contracts', label: '合同台账', icon: 'FolderOpen',  path: '/contracts', requiresContractAccess: true },
  { id: 'cases',     label: '案件台账', icon: 'Briefcase',   path: '/',          requiresCaseAccess: true },
  { id: 'calendar',  label: '节点日历', icon: 'Calendar',    path: '/calendar',  soon: true },
  { id: 'stats',     label: '数据统计', icon: 'BarChart2',   path: '/stats',     soon: true },
]

/** v1.3 合同状态显示文案 + 配色（badge） */
export const CONTRACT_STATUS_LABELS = {
  drafting:     '起草中',
  approving:    '审批中',
  pending_seal: '待签署',
  sealed:       '已签署',
} as const

export const CONTRACT_STATUS_BADGE = {
  drafting:     'bg-slate-100 text-slate-700 border-slate-200',
  approving:    'bg-blue-50 text-blue-700 border-blue-200',
  pending_seal: 'bg-amber-50 text-amber-700 border-amber-200',
  sealed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
} as const
