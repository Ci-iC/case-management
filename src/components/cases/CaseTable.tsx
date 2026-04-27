import { ArrowUpDown, ArrowUp, ArrowDown, Eye, Pencil, Archive, Trash2, MoreHorizontal, Bell } from 'lucide-react'
import { useCaseStore, usePaginatedCases } from '@/store/useCaseStore'
import { Pagination } from '@/components/ui/Pagination'
import { DisputeTypeBadge, CaseStageBadge } from '@/components/ui/Badge'
import { ConfirmModal } from '@/components/ui/Modal'
import { cn, formatDate, formatAmountShort, getUrgencyLevel, urgencyLabel, truncate } from '@/utils/helpers'
import { URGENCY_TEXT_COLOR } from '@/constants'
import type { SortField, SortState, CaseRecord } from '@/types'
import { useState, useRef, useEffect } from 'react'

// ─── Column Definitions ────────────────────────────────────────────────────────

interface Column {
  key: SortField | string
  label: string
  sortable?: boolean
  width?: string
  align?: 'left' | 'right' | 'center'
}

const COLUMNS: Column[] = [
  { key: 'select',       label: '',            width: 'w-[40px]',  align: 'center' },
  { key: 'caseNumber',   label: '案件编号',     sortable: true,  width: 'w-[120px]' },
  { key: 'caseName',     label: '案件名称',     sortable: true,  width: 'w-[220px]' },
  { key: 'disputeType',  label: '争议类型',     sortable: true,  width: 'w-[100px]' },
  { key: 'stage',        label: '案件阶段',     sortable: true,  width: 'w-[90px]' },
  { key: 'ourParty',     label: '我方主体',     width: 'w-[140px]' },
  { key: 'opposingParty', label: '对方主体',    width: 'w-[140px]' },
  { key: 'totalAmount',  label: '涉案金额',     sortable: true,  width: 'w-[90px]',  align: 'right' },
  { key: 'assignedLawyer', label: '承办律师',   width: 'w-[72px]' },
  { key: 'nextKeyDate',  label: '下一关键节点', sortable: true,  width: 'w-[160px]' },
  { key: 'actions',      label: '操作',        width: 'w-[80px]', align: 'center' },
]

// ─── Table Component ───────────────────────────────────────────────────────────

export function CaseTable() {
  const {
    pagination, setPagination, totalCount,
    sort, setSort,
    openDetail, openForm, archiveCase, deleteCase,
    selectedIds, filteredCases, toggleSelectCase, selectAllFiltered, clearSelection,
  } = useCaseStore()
  const cases = usePaginatedCases()

  const [archiveConfirm, setArchiveConfirm] = useState<CaseRecord | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<CaseRecord | null>(null)

  const isAllSelected = filteredCases.length > 0 && selectedIds.length === filteredCases.length
  const isSomeSelected = selectedIds.length > 0 && !isAllSelected

  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = isSomeSelected
  }, [isSomeSelected])

  function handleSort(field: SortField) {
    const newSort: SortState =
      sort.field === field && sort.direction === 'asc'
        ? { field, direction: 'desc' }
        : { field, direction: 'asc' }
    setSort(newSort)
  }

  function SortIcon({ field }: { field: SortField | string }) {
    if (sort.field !== field) return <ArrowUpDown size={12} className="text-slate-300 ml-1" />
    return sort.direction === 'asc'
      ? <ArrowUp size={12} className="text-primary-500 ml-1" />
      : <ArrowDown size={12} className="text-primary-500 ml-1" />
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Table card */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1140px] text-sm">
            {/* Header */}
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
                      col.width,
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                      col.sortable && 'cursor-pointer select-none hover:text-slate-700',
                    )}
                    onClick={col.sortable ? () => handleSort(col.key as SortField) : undefined}
                  >
                    {col.key === 'select' ? (
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={() => isAllSelected ? clearSelection() : selectAllFiltered()}
                        title={isAllSelected ? '取消全选' : `全选所有 ${filteredCases.length} 件`}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="inline-flex items-center">
                        {col.label}
                        {col.sortable && <SortIcon field={col.key} />}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            {/* Body */}
            <tbody className="divide-y divide-slate-50">
              {cases.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="py-16 text-center text-slate-400 text-sm">
                    暂无符合条件的案件
                  </td>
                </tr>
              ) : (
                cases.map(c => (
                  <CaseRow
                    key={c.id}
                    caseRecord={c}
                    isSelected={selectedIds.includes(c.id)}
                    onToggleSelect={() => toggleSelectCase(c.id)}
                    onView={() => openDetail(c.id)}
                    onEdit={() => openForm(c.id)}
                    onArchive={() => setArchiveConfirm(c)}
                    onDelete={() => setDeleteConfirm(c)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={totalCount}
        onPageChange={page => setPagination({ page })}
        onPageSizeChange={pageSize => setPagination({ pageSize, page: 1 })}
      />

      {/* Archive confirm */}
      <ConfirmModal
        open={!!archiveConfirm}
        onClose={() => setArchiveConfirm(null)}
        onConfirm={async () => {
          if (!archiveConfirm) return
          try {
            await archiveCase(archiveConfirm.id)
          } catch (e) {
            window.alert(`归档失败：${e instanceof Error ? e.message : String(e)}`)
          }
          setArchiveConfirm(null)
        }}
        title="归档案件"
        message={
          <>
            确认将「<strong>{archiveConfirm?.caseName}</strong>」归档？<br />
            归档后案件将从默认列表中隐藏，可通过"显示已归档"查看。
          </>
        }
        confirmLabel="归档"
        confirmVariant="primary"
      />

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return
          try {
            await deleteCase(deleteConfirm.id)
          } catch (e) {
            window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
          }
          setDeleteConfirm(null)
        }}
        title="删除案件"
        message={
          <>
            此操作不可撤销，确认永久删除「<strong>{deleteConfirm?.caseName}</strong>」？
          </>
        }
        confirmLabel="确认删除"
        confirmVariant="danger"
      />
    </div>
  )
}

// ─── Row Component ─────────────────────────────────────────────────────────────

interface CaseRowProps {
  caseRecord: CaseRecord
  isSelected: boolean
  onToggleSelect: () => void
  onView: () => void
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}

function CaseRow({ caseRecord: c, isSelected, onToggleSelect, onView, onEdit, onArchive, onDelete }: CaseRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const urgency = getUrgencyLevel(c.nextKeyDate)
  const isClosed = c.stage === 'closed'
  const isArchived = c.isArchived

  return (
    <tr
      className={cn(
        'group table-row-hover',
        isClosed && 'bg-slate-50/40',
        isArchived && 'opacity-60',
        isSelected && 'bg-primary-50/60',
      )}
      onClick={onView}
    >
      {/* 复选框 */}
      <td
        className="px-3 py-3 w-[40px] text-center"
        onClick={e => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
        />
      </td>

      {/* 案件编号 */}
      <td className="px-3 py-3 w-[120px]">
        <span className="font-mono text-xs text-slate-500 font-medium">{c.caseNumber}</span>
      </td>

      {/* 案件名称 */}
      <td className="px-3 py-3 w-[220px]">
        <div className="flex flex-col gap-0.5">
          <span
            className="text-sm font-medium text-slate-800 leading-snug line-clamp-2"
            title={c.caseName}
          >
            {c.caseName}
          </span>
          <span className="text-[11px] text-slate-400 truncate" title={c.causeOfAction}>
            {c.causeOfAction}
          </span>
        </div>
      </td>

      {/* 争议类型 */}
      <td className="px-3 py-3 w-[100px]">
        <DisputeTypeBadge type={c.disputeType} />
      </td>

      {/* 案件阶段 */}
      <td className="px-3 py-3 w-[90px]">
        <CaseStageBadge stage={c.stage} />
      </td>

      {/* 我方主体 */}
      <td className="px-3 py-3 w-[140px]">
        <span className="text-sm text-slate-700 truncate block" title={c.ourParty}>
          {truncate(c.ourParty, 14)}
        </span>
      </td>

      {/* 对方主体 */}
      <td className="px-3 py-3 w-[140px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-slate-700 truncate" title={c.opposingParty}>
            {truncate(c.opposingParty, 14)}
          </span>
          {c.opposingFirm && (
            <span className="text-[11px] text-slate-400 truncate" title={c.opposingFirm}>
              {truncate(c.opposingFirm, 12)}
            </span>
          )}
        </div>
      </td>

      {/* 涉案金额 */}
      <td className="px-3 py-3 w-[90px] text-right">
        <span className={cn(
          'text-sm font-semibold tabular-nums',
          c.totalAmount && c.totalAmount >= 1000 ? 'text-slate-800' : 'text-slate-600',
        )}>
          {c.totalAmount ? formatAmountShort(c.totalAmount) : '—'}
        </span>
      </td>

      {/* 承办律师 */}
      <td className="px-3 py-3 w-[72px]">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full bg-primary-100 flex items-center justify-center text-[10px] font-semibold text-primary-700 flex-shrink-0">
            {c.assignedLawyer ? c.assignedLawyer.charAt(0) : ''}
          </div>
          <span className="text-xs text-slate-600 truncate">{c.assignedLawyer}</span>
        </div>
      </td>

      {/* 下一关键节点 */}
      <td className="px-3 py-3 w-[160px]">
        {c.nextKeyDate && !isClosed ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              {(urgency === 'critical' || urgency === 'overdue' || urgency === 'warning') && (
                <Bell size={11} className={cn(
                  urgency === 'overdue' ? 'text-red-500' :
                  urgency === 'critical' ? 'text-red-400' : 'text-orange-400'
                )} />
              )}
              <span className={cn('text-xs font-medium', URGENCY_TEXT_COLOR[urgency])}>
                {formatDate(c.nextKeyDate)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] text-slate-400 truncate" title={c.nextKeyDateLabel}>
                {truncate(c.nextKeyDateLabel, 12)}
              </span>
              <span className={cn('text-[10px] font-medium flex-shrink-0', URGENCY_TEXT_COLOR[urgency])}>
                {urgencyLabel(c.nextKeyDate)}
              </span>
            </div>
          </div>
        ) : isClosed ? (
          <span className="text-xs text-slate-400">已结案</span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>

      {/* 操作 */}
      <td
        className="px-3 py-3 w-[80px] text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActionBtn title="查看详情" onClick={onView}>
            <Eye size={13} />
          </ActionBtn>
          <ActionBtn title="编辑" onClick={onEdit}>
            <Pencil size={13} />
          </ActionBtn>
          <div className="relative">
            <ActionBtn title="更多" onClick={() => setMenuOpen(v => !v)}>
              <MoreHorizontal size={13} />
            </ActionBtn>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 w-32 rounded-md border border-slate-200 bg-white shadow-md py-1 text-sm">
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
                  onClick={() => { onArchive(); setMenuOpen(false) }}
                >
                  <Archive size={13} />
                  归档案件
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-red-500 hover:bg-red-50"
                  onClick={() => { onDelete(); setMenuOpen(false) }}
                >
                  <Trash2 size={13} />
                  删除案件
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

function ActionBtn({ title, onClick, children }: {
  title: string; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
    >
      {children}
    </button>
  )
}
