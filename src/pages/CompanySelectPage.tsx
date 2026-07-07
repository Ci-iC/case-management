import { useState } from 'react'
import { Scale, LogOut, Building2, Layers, AlertCircle } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { COMPANY_ROLE_LABEL } from '@/api/auth'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/api/client'

/**
 * v2.0：用户登录后，若关联多家公司、token 没带 cc 时显示。
 * 列出可选公司 + "全部公司"（仅多公司 manager 角色）。
 * 选完后调 switchCompany，token 重签，AuthGate 自动切到主应用。
 */
export function CompanySelectPage() {
  const { user, logout, switchCompany } = useAuthStore()
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const companies = user?.companies || []
  const managerCount = companies.filter(c => c.roles.includes('manager')).length

  async function pick(companyId: string) {
    setSubmitting(companyId)
    setError(null)
    try {
      await switchCompany(companyId)
      // AuthGate 会重新渲染到主应用
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '切换公司失败')
      setError(msg)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-[520px] rounded-xl bg-white p-6 sm:p-8 shadow-modal">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-600">
            <Scale size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-slate-900 leading-tight">GlobalX</p>
            <p className="text-xs text-slate-400 leading-tight mt-0.5">法律事务管理系统</p>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100"
          >
            <LogOut size={12} />
            退出
          </button>
        </div>

        <h2 className="mb-1 text-lg font-semibold text-slate-900">选择公司</h2>
        <p className="mb-5 text-xs text-slate-500">
          您当前的账号关联了 {companies.length} 家公司，请选择要进入的公司。
        </p>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2">
          {managerCount >= 2 && (
            <button
              type="button"
              disabled={submitting !== null}
              onClick={() => pick('ALL')}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-primary-200 bg-primary-50 hover:bg-primary-100 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600">
                <Layers size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">全部公司（汇总视图）</p>
                <p className="text-[11px] text-slate-500 mt-0.5">跨公司聚合查看 · 仅可读，操作需切回具体公司</p>
              </div>
              {submitting === 'ALL' && <span className="text-xs text-primary-700">切换中…</span>}
            </button>
          )}

          {companies.map((c) => (
            <button
              key={c.companyId}
              type="button"
              disabled={submitting !== null}
              onClick={() => pick(c.companyId)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-left disabled:opacity-50"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                <Building2 size={18} className="text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {c.companyName}
                  {c.companyCode && <span className="ml-1.5 text-xs text-slate-400 font-normal">{c.companyCode}</span>}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {c.roles.map(r => COMPANY_ROLE_LABEL[r] || r).join(' · ')}
                </p>
              </div>
              {submitting === c.companyId && <span className="text-xs text-primary-700">切换中…</span>}
            </button>
          ))}
        </div>

        {companies.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-400">
            <p>您未被分配任何公司，请联系平台管理员。</p>
            <Button variant="secondary" size="md" onClick={logout} className="mt-4">退出</Button>
          </div>
        )}
      </div>
    </div>
  )
}
