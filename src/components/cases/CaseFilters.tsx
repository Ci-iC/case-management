import { useState } from 'react'
import { Search, SlidersHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react'
import { useCaseStore } from '@/store/useCaseStore'
import { Button } from '@/components/ui/Button'
import { DISPUTE_TYPE_OPTIONS, CASE_STAGE_OPTIONS } from '@/constants'
import { countActiveFilters } from '@/utils/helpers'
import { cn } from '@/utils/helpers'

export function CaseFilters() {
  const { filters, setFilters, resetFilters } = useCaseStore()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const activeCount = countActiveFilters(filters)

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-card overflow-hidden">
      {/* Quick search bar */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            placeholder="搜索案件编号、名称、案由、当事人、进展..."
            value={filters.keyword}
            onChange={e => setFilters({ keyword: e.target.value })}
            className="form-input pl-9 h-9"
          />
          {filters.keyword && (
            <button
              onClick={() => setFilters({ keyword: '' })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <Button
          variant="outline"
          size="md"
          icon={<SlidersHorizontal size={14} />}
          onClick={() => setShowAdvanced(v => !v)}
          className={cn(showAdvanced && 'border-primary-300 bg-primary-50 text-primary-700')}
        >
          高级筛选
          {activeCount > 0 && (
            <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] text-white font-bold">
              {activeCount}
            </span>
          )}
          {showAdvanced
            ? <ChevronUp size={13} className="ml-0.5" />
            : <ChevronDown size={13} className="ml-0.5" />
          }
        </Button>

        {activeCount > 0 && (
          <Button variant="ghost" size="md" icon={<X size={14} />} onClick={resetFilters}>
            清除筛选
          </Button>
        )}
      </div>

      {/* Advanced filter panel */}
      {showAdvanced && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 bg-slate-50/60">
          <div className="grid grid-cols-4 gap-3">

            {/* Row 1 */}
            <FilterField label="案件编号">
              <input
                type="text"
                placeholder="如 SH2025-001"
                value={filters.caseNumber}
                onChange={e => setFilters({ caseNumber: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="案件名称">
              <input
                type="text"
                placeholder="模糊匹配"
                value={filters.caseName}
                onChange={e => setFilters({ caseName: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="案由">
              <input
                type="text"
                placeholder="模糊匹配"
                value={filters.causeOfAction}
                onChange={e => setFilters({ causeOfAction: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="争议类型">
              <select
                value={filters.disputeType}
                onChange={e => setFilters({ disputeType: e.target.value as any })}
                className="form-select h-8 text-xs"
              >
                <option value="">全部类型</option>
                {DISPUTE_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FilterField>

            {/* Row 2 */}
            <FilterField label="案件阶段">
              <select
                value={filters.stage}
                onChange={e => setFilters({ stage: e.target.value as any })}
                className="form-select h-8 text-xs"
              >
                <option value="">全部阶段</option>
                {CASE_STAGE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FilterField>

            <FilterField label="承办律师">
              <input
                type="text"
                placeholder="律师姓名"
                value={filters.assignedLawyer}
                onChange={e => setFilters({ assignedLawyer: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="对接业务部门">
              <input
                type="text"
                placeholder="部门名称"
                value={filters.businessDepartment}
                onChange={e => setFilters({ businessDepartment: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="我方主体">
              <input
                type="text"
                placeholder="模糊匹配"
                value={filters.ourParty}
                onChange={e => setFilters({ ourParty: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            {/* Row 3 */}
            <FilterField label="对方主体">
              <input
                type="text"
                placeholder="模糊匹配"
                value={filters.opposingParty}
                onChange={e => setFilters({ opposingParty: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="立案日期（起）">
              <input
                type="date"
                value={filters.filingDateStart}
                onChange={e => setFilters({ filingDateStart: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="立案日期（止）">
              <input
                type="date"
                value={filters.filingDateEnd}
                onChange={e => setFilters({ filingDateEnd: e.target.value })}
                className="form-input h-8 text-xs"
              />
            </FilterField>

            <FilterField label="涉案金额（万元）">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  placeholder="最小"
                  value={filters.amountMin}
                  onChange={e => setFilters({ amountMin: e.target.value })}
                  className="form-input h-8 text-xs w-0 flex-1"
                />
                <span className="text-slate-400 text-xs">—</span>
                <input
                  type="number"
                  placeholder="最大"
                  value={filters.amountMax}
                  onChange={e => setFilters({ amountMax: e.target.value })}
                  className="form-input h-8 text-xs w-0 flex-1"
                />
              </div>
            </FilterField>
          </div>

          {/* Archived toggle */}
          <div className="mt-3 flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setFilters({ showArchived: !filters.showArchived })}
                className={cn(
                  'relative h-4.5 w-8 rounded-full transition-colors',
                  filters.showArchived ? 'bg-primary-600' : 'bg-slate-200',
                )}
                style={{ height: '18px', width: '32px' }}
              >
                <div
                  className={cn(
                    'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                    filters.showArchived ? 'translate-x-3.5' : 'translate-x-0.5',
                  )}
                />
              </div>
              <span className="text-xs text-slate-600">显示已归档案件</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-slate-500">{label}</label>
      {children}
    </div>
  )
}
