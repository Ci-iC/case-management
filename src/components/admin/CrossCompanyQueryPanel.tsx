import { useEffect, useState } from 'react'
import { BarChart3, Building2, AlertCircle } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { companiesApi, type Company } from '@/api/companies'
import { contractsApi } from '@/api/contracts'
import { ApiError } from '@/api/client'
import type { ContractRecord } from '@/types'

/**
 * v2.0 平台超管「数据查询（跨公司只读）」。
 * 最小可用版：选一家公司 → 切换到该公司只读视角 → 列出该公司全部合同。
 * 实现机制：调 /api/auth/switch-company 把 token 的 cc 改为目标公司（超管允许），然后调 /api/contracts。
 */
export function CrossCompanyQueryPanel() {
  const { user, switchCompany } = useAuthStore()
  const [companies, setCompanies] = useState<Company[]>([])
  const [selected, setSelected] = useState<string>('')
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    companiesApi.list()
      .then(({ companies }) => setCompanies(companies.filter(c => c.status === 'active')))
      .catch(e => setError(e instanceof ApiError ? e.message : '加载公司列表失败'))
  }, [])

  async function pickCompany(id: string) {
    setSelected(id)
    if (!id) { setContracts([]); return }
    setLoading(true); setError(null)
    try {
      // 超管把 token 的 cc 切换为目标公司（reload:false —— 不刷新页面，留在查询面板）
      await switchCompany(id, { reload: false })
      const { contracts } = await contractsApi.list()
      setContracts(contracts)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载合同失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">数据查询（跨公司只读）</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          选择一家公司，以平台超管"只读"视角查看该公司合同台账。切换公司会重签 token 的所属公司字段。
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 mb-4">
        <label className="block text-xs font-medium text-slate-600 mb-1">查看公司</label>
        <select value={selected} onChange={e => pickCompany(e.target.value)} className="form-select w-full max-w-md">
          <option value="">—请选择公司—</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}（合同 {c.contractCount ?? 0} · 成员 {c.memberCount ?? 0}）</option>
          ))}
        </select>
        {user?.currentCompanyId && (
          <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded inline-flex items-center gap-1">
            <AlertCircle size={11} />
            当前 token 已切换到公司，超管业务接口已可读取该公司数据
          </p>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
        </div>
      )}

      {selected && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
            <Building2 size={12} className="inline mr-1" />
            该公司合同 {contracts.length} 份
          </div>
          {loading && <p className="text-center text-xs text-slate-400 py-8">加载中…</p>}
          {!loading && contracts.length === 0 && <p className="text-center text-xs text-slate-400 py-8">该公司还没有合同</p>}
          {contracts.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">编号</th>
                  <th className="text-left px-3 py-2 font-medium">名称</th>
                  <th className="text-left px-3 py-2 font-medium">状态</th>
                  <th className="text-left px-3 py-2 font-medium">类型</th>
                  <th className="text-left px-3 py-2 font-medium">金额</th>
                  <th className="text-left px-3 py-2 font-medium">经办人</th>
                  <th className="text-left px-3 py-2 font-medium">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-primary-700">{c.code}</td>
                    <td className="px-3 py-1.5 text-slate-900 max-w-xs truncate">{c.name}</td>
                    <td className="px-3 py-1.5 text-xs">{c.status}</td>
                    <td className="px-3 py-1.5 text-xs">{c.contractType || '—'}</td>
                    <td className="px-3 py-1.5 text-xs">{c.contractAmount != null ? c.contractAmount.toLocaleString() : '—'}</td>
                    <td className="px-3 py-1.5 text-xs">{c.handlerDisplayName || c.handlerUsername || '—'}</td>
                    <td className="px-3 py-1.5 text-[11px] text-slate-500">{c.updatedAt?.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!selected && (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-slate-400">
          <BarChart3 size={28} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm">选择一家公司查看其合同台账（只读视角）</p>
        </div>
      )}
    </div>
  )
}
