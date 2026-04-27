import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { CaseRecord, CaseFilters, UrgencyLevel } from '@/types'

// ─── Classname Utility ─────────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date Helpers ──────────────────────────────────────────────────────────────

export function formatDate(dateStr: string | undefined, fmt = 'yyyy/MM/dd'): string {
  if (!dateStr) return '—'
  const d = parseISO(dateStr)
  return isValid(d) ? format(d, fmt, { locale: zhCN }) : '—'
}

export function formatDateFull(dateStr: string | undefined): string {
  return formatDate(dateStr, 'yyyy年M月d日')
}

/** Returns how many calendar days until the given date (negative = overdue). */
export function getDaysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const d = parseISO(dateStr)
  if (!isValid(d)) return null
  return differenceInCalendarDays(d, new Date())
}

export function getUrgencyLevel(dateStr: string | undefined): UrgencyLevel {
  const days = getDaysUntil(dateStr)
  if (days === null) return 'none'
  if (days < 0)   return 'overdue'
  if (days <= 3)  return 'critical'
  if (days <= 7)  return 'warning'
  if (days <= 14) return 'soon'
  return 'normal'
}

export function urgencyLabel(dateStr: string | undefined): string {
  const days = getDaysUntil(dateStr)
  if (days === null) return ''
  if (days < 0)  return `已逾期 ${Math.abs(days)} 天`
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  return `${days} 天后`
}

// ─── Amount Helpers ────────────────────────────────────────────────────────────

/** Formats a numeric amount (in 万元) with thousands separator. */
export function formatAmount(amount: number | undefined): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '—'
  return `${amount.toLocaleString('zh-CN')} 万元`
}

export function formatAmountShort(amount: number | undefined): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '—'
  if (amount >= 10000) return `${(amount / 10000).toFixed(1)} 亿`
  if (amount >= 1000)  return `${(amount / 1000).toFixed(1)} 千万`
  return `${amount.toLocaleString('zh-CN')} 万`
}

// ─── Filter Logic ──────────────────────────────────────────────────────────────

function matchesKeyword(c: CaseRecord, keyword: string): boolean {
  if (!keyword) return true
  const k = keyword.toLowerCase()
  return [
    c.caseNumber, c.caseName, c.causeOfAction,
    c.ourParty, c.opposingParty, c.assignedLawyer,
    c.businessDepartment, c.court, c.currentProgress,
  ].some(v => v?.toLowerCase().includes(k))
}

export function applyFilters(cases: CaseRecord[], filters: CaseFilters): CaseRecord[] {
  return cases.filter(c => {
    // Archive filter
    if (!filters.showArchived && c.isArchived) return false

    // Keyword search
    if (!matchesKeyword(c, filters.keyword)) return false

    // Specific field filters
    if (filters.caseNumber && !c.caseNumber.toLowerCase().includes(filters.caseNumber.toLowerCase())) return false
    if (filters.caseName   && !c.caseName.toLowerCase().includes(filters.caseName.toLowerCase()))     return false
    if (filters.causeOfAction && !c.causeOfAction.toLowerCase().includes(filters.causeOfAction.toLowerCase())) return false
    if (filters.disputeType  && c.disputeType !== filters.disputeType)  return false
    if (filters.stage        && c.stage !== filters.stage)              return false
    if (filters.assignedLawyer && !c.assignedLawyer.toLowerCase().includes(filters.assignedLawyer.toLowerCase())) return false
    if (filters.businessDepartment && !c.businessDepartment.toLowerCase().includes(filters.businessDepartment.toLowerCase())) return false
    if (filters.ourParty     && !c.ourParty.toLowerCase().includes(filters.ourParty.toLowerCase()))         return false
    if (filters.opposingParty && !c.opposingParty.toLowerCase().includes(filters.opposingParty.toLowerCase())) return false

    // Date range filter
    if (filters.filingDateStart && c.filingDate && c.filingDate < filters.filingDateStart) return false
    if (filters.filingDateEnd   && c.filingDate && c.filingDate > filters.filingDateEnd)   return false

    // Amount range filter
    if (filters.amountMin && c.totalAmount !== undefined && c.totalAmount < Number(filters.amountMin)) return false
    if (filters.amountMax && c.totalAmount !== undefined && c.totalAmount > Number(filters.amountMax)) return false

    return true
  })
}

/** Count how many non-default filter values are active. */
export function countActiveFilters(filters: CaseFilters): number {
  const defaults = [
    'caseNumber', 'caseName', 'causeOfAction', 'disputeType',
    'stage', 'assignedLawyer', 'businessDepartment',
    'ourParty', 'opposingParty',
    'filingDateStart', 'filingDateEnd', 'amountMin', 'amountMax',
  ] as const
  return defaults.filter(k => !!filters[k]).length + (filters.showArchived ? 1 : 0)
}

// ─── Sort Logic ────────────────────────────────────────────────────────────────

export function sortCases(
  cases: CaseRecord[],
  field: keyof CaseRecord,
  direction: 'asc' | 'desc',
): CaseRecord[] {
  return [...cases].sort((a, b) => {
    const va = a[field] ?? ''
    const vb = b[field] ?? ''
    let cmp = 0
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), 'zh-CN')
    }
    return direction === 'asc' ? cmp : -cmp
  })
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function truncate(str: string | undefined, max: number): string {
  if (!str) return '—'
  return str.length > max ? str.slice(0, max) + '…' : str
}
