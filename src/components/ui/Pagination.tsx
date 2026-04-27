import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { PAGE_SIZE_OPTIONS } from '@/constants'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = Math.min((page - 1) * pageSize + 1, total)
  const end   = Math.min(page * pageSize, total)

  // Generate page number buttons
  function getPageNumbers(): (number | '...')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | '...')[] = []
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i)
    }
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
    return pages
  }

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Left: count info */}
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span>共 <span className="font-medium text-slate-700">{total}</span> 条</span>
        <span className="text-slate-300">|</span>
        <span>第 {start}–{end} 条</span>
        <span className="text-slate-300">|</span>
        <div className="flex items-center gap-1.5">
          <span>每页</span>
          <select
            value={pageSize}
            onChange={e => { onPageSizeChange(Number(e.target.value)); onPageChange(1) }}
            className="h-7 rounded border border-slate-200 bg-white px-1.5 text-xs text-slate-700
                       focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400/30"
          >
            {PAGE_SIZE_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span>条</span>
        </div>
      </div>

      {/* Right: page buttons */}
      <div className="flex items-center gap-1">
        <PageBtn
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="上一页"
        >
          <ChevronLeft size={14} />
        </PageBtn>

        {getPageNumbers().map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="w-8 text-center text-slate-400 text-sm">…</span>
          ) : (
            <PageBtn
              key={p}
              active={p === page}
              onClick={() => onPageChange(p)}
            >
              {p}
            </PageBtn>
          )
        )}

        <PageBtn
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="下一页"
        >
          <ChevronRight size={14} />
        </PageBtn>
      </div>
    </div>
  )
}

function PageBtn({
  children, active, disabled, onClick, ...props
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  [k: string]: unknown
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40',
        active
          ? 'bg-primary-600 text-white font-medium'
          : 'text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none',
      )}
      {...props}
    >
      {children}
    </button>
  )
}
