import { useState, useRef, useEffect } from 'react'
import { Building2, Layers, ChevronDown, Check } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { COMPANY_ROLE_LABEL } from '@/api/auth'
import { cn } from '@/utils/helpers'

/**
 * v2.0 顶部公司切换器。
 * 显示当前公司（或"全部公司"）+ 下拉切换。仅普通用户使用；超管不在主应用里。
 */
export function CompanySwitcher() {
  const { user, switchCompany } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  if (!user || user.role === 'superadmin') return null
  const companies = user.companies || []
  if (companies.length === 0) return null

  const managerCount = companies.filter(c => c.roles.includes('manager')).length
  const canViewAll = managerCount >= 2

  const currentLabel = user.isAllCompaniesView
    ? '全部公司'
    : (user.currentCompany?.companyName || '未选择')
  const currentRoles = user.isAllCompaniesView
    ? '汇总视图（只读）'
    : (user.companyRoles || []).map(r => COMPANY_ROLE_LABEL[r] || r).join(' · ')

  async function pick(companyId: string) {
    if (busy) return
    setBusy(true)
    try {
      await switchCompany(companyId)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors text-left',
          open && 'bg-slate-50 border-slate-300',
        )}
      >
        {user.isAllCompaniesView
          ? <Layers size={14} className="text-primary-600 shrink-0" />
          : <Building2 size={14} className="text-slate-400 shrink-0" />
        }
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-900 truncate max-w-[140px]">{currentLabel}</p>
          <p className="text-[10px] text-slate-400 truncate max-w-[140px]">{currentRoles}</p>
        </div>
        <ChevronDown size={12} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[240px] max-w-[320px] rounded-lg bg-white shadow-lg border border-slate-200 overflow-hidden">
          {canViewAll && (
            <button
              type="button"
              onClick={() => pick('ALL')}
              disabled={busy}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100"
            >
              <Layers size={14} className="text-primary-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900">全部公司</p>
                <p className="text-[10px] text-slate-400">汇总视图 · 只读</p>
              </div>
              {user.isAllCompaniesView && <Check size={14} className="text-primary-600 shrink-0" />}
            </button>
          )}
          {companies.map((c) => {
            const active = !user.isAllCompaniesView && user.currentCompanyId === c.companyId
            return (
              <button
                key={c.companyId}
                type="button"
                onClick={() => pick(c.companyId)}
                disabled={busy}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <Building2 size={14} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{c.companyName}</p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {c.roles.map(r => COMPANY_ROLE_LABEL[r] || r).join(' · ')}
                  </p>
                </div>
                {active && <Check size={14} className="text-primary-600 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
