import { create } from 'zustand'
import type { CaseRecord, CaseFilters, PaginationState, SortState } from '@/types'
import { DEFAULT_FILTERS } from '@/constants'
import { applyFilters, sortCases } from '@/utils/helpers'
import { casesApi } from '@/api/cases'
import { ApiError } from '@/api/client'

// ─── Store Shape ───────────────────────────────────────────────────────────────

interface CaseState {
  // Raw data (server-authoritative, cached in memory)
  cases: CaseRecord[]

  // Loading / error state
  isLoading: boolean
  loadError: string | null

  // UI state
  filters: CaseFilters
  pagination: PaginationState
  sort: SortState
  selectedCaseId: string | null
  editingCaseId: string | null
  isDetailOpen: boolean
  isFormOpen: boolean
  selectedIds: string[]
  pendingSmartCase: Partial<CaseRecord> | null

  // Derived views
  filteredCases: CaseRecord[]
  totalCount: number

  // Data actions (all async, hit server)
  loadCases: () => Promise<void>
  addCase: (data: Omit<CaseRecord, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'isArchived'>) => Promise<CaseRecord>
  updateCase: (id: string, data: Partial<CaseRecord>) => Promise<CaseRecord>
  deleteCase: (id: string) => Promise<void>
  archiveCase: (id: string) => Promise<void>
  unarchiveCase: (id: string) => Promise<void>
  importCases: (incoming: CaseRecord[], mode: 'append' | 'replace' | 'renumber') => Promise<{ imported: number; skipped: number }>

  // UI actions (sync, local only)
  setFilters: (filters: Partial<CaseFilters>) => void
  resetFilters: () => void
  setPagination: (p: Partial<PaginationState>) => void
  setSort: (sort: SortState) => void
  openDetail: (caseId: string) => void
  closeDetail: () => void
  openForm: (caseId: string | null) => void
  openFormWithPrefill: (data: Partial<CaseRecord>) => void
  closeForm: () => void
  toggleSelectCase: (id: string) => void
  selectAllFiltered: () => void
  clearSelection: () => void

  // Internal
  _recompute: () => void
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useCaseStore = create<CaseState>()((set, get) => ({
  cases: [],
  isLoading: false,
  loadError: null,

  filters: { ...DEFAULT_FILTERS },
  pagination: { page: 1, pageSize: 20 },
  sort: { field: 'updatedAt', direction: 'desc' },
  selectedCaseId: null,
  editingCaseId: null,
  isDetailOpen: false,
  isFormOpen: false,
  selectedIds: [],
  pendingSmartCase: null,
  filteredCases: [],
  totalCount: 0,

  // ── Data ──

  async loadCases() {
    set({ isLoading: true, loadError: null })
    try {
      const { cases } = await casesApi.list()
      set({ cases, isLoading: false })
      get()._recompute()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '加载案件失败')
      set({ isLoading: false, loadError: msg })
    }
  },

  async addCase(data) {
    const { case: created } = await casesApi.create(data)
    set((s) => ({ cases: [created, ...s.cases] }))
    get()._recompute()
    return created
  },

  async updateCase(id, data) {
    const { case: updated } = await casesApi.update(id, data)
    set((s) => ({ cases: s.cases.map((c) => (c.id === id ? updated : c)) }))
    get()._recompute()
    return updated
  },

  async deleteCase(id) {
    await casesApi.remove(id)
    set((s) => ({ cases: s.cases.filter((c) => c.id !== id) }))
    if (get().selectedCaseId === id) set({ isDetailOpen: false, selectedCaseId: null })
    if (get().editingCaseId === id) set({ isFormOpen: false, editingCaseId: null })
    get()._recompute()
  },

  async archiveCase(id) {
    await get().updateCase(id, { isArchived: true })
    if (get().selectedCaseId === id) set({ isDetailOpen: false })
  },

  async unarchiveCase(id) {
    await get().updateCase(id, { isArchived: false })
  },

  async importCases(incoming, mode) {
    const result = await casesApi.bulkImport(incoming, mode)
    await get().loadCases()
    return result
  },

  // ── UI ──

  setFilters(filters) {
    set((s) => ({
      filters: { ...s.filters, ...filters },
      pagination: { ...s.pagination, page: 1 },
      selectedIds: [],
    }))
    get()._recompute()
  },

  resetFilters() {
    set({
      filters: { ...DEFAULT_FILTERS },
      pagination: { page: 1, pageSize: get().pagination.pageSize },
      selectedIds: [],
    })
    get()._recompute()
  },

  setPagination(p) {
    set((s) => ({ pagination: { ...s.pagination, ...p } }))
  },

  setSort(sort) {
    set({ sort })
    get()._recompute()
  },

  openDetail: (caseId) => set({ selectedCaseId: caseId, isDetailOpen: true }),
  closeDetail: () => set({ isDetailOpen: false }),
  openForm: (caseId) => set({ editingCaseId: caseId, isFormOpen: true, pendingSmartCase: null }),
  openFormWithPrefill: (data) => set({ editingCaseId: null, isFormOpen: true, pendingSmartCase: data }),
  closeForm: () => set({ isFormOpen: false, editingCaseId: null, pendingSmartCase: null }),

  toggleSelectCase: (id) => {
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    }))
  },

  selectAllFiltered: () => {
    set((s) => ({ selectedIds: s.filteredCases.map((c) => c.id) }))
  },

  clearSelection: () => set({ selectedIds: [] }),

  _recompute() {
    const { cases, filters, sort } = get()
    const filtered = applyFilters(cases, filters)
    const sorted = sortCases(filtered, sort.field as keyof CaseRecord, sort.direction)
    set({ filteredCases: sorted, totalCount: sorted.length })
  },
}))

// ─── Selector Hooks ────────────────────────────────────────────────────────────

export function usePaginatedCases() {
  const { filteredCases, pagination } = useCaseStore()
  const { page, pageSize } = pagination
  const start = (page - 1) * pageSize
  return filteredCases.slice(start, start + pageSize)
}

export function useCaseById(id: string | null): CaseRecord | undefined {
  return useCaseStore((s) => s.cases.find((c) => c.id === id))
}

export function useCaseStats() {
  const cases = useCaseStore((s) => s.cases.filter((c) => !c.isArchived))
  const total = cases.length
  const active = cases.filter((c) => c.stage !== 'closed').length
  const closed = cases.filter((c) => c.stage === 'closed').length
  const today = new Date().toISOString().slice(0, 10)
  const soon = cases.filter((c) => {
    if (!c.nextKeyDate || c.stage === 'closed') return false
    const diff = Math.ceil((new Date(c.nextKeyDate).getTime() - new Date(today).getTime()) / 86400000)
    return diff >= 0 && diff <= 7
  }).length
  return { total, active, closed, soon }
}
