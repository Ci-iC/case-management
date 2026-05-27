import { useEffect, useState } from 'react'
import { Building2, Plus, Power, AlertCircle, Workflow, Shield, History } from 'lucide-react'
import { companiesApi, type Company } from '@/api/companies'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ApiError } from '@/api/client'
import { ApprovalTemplatesModal } from './ApprovalTemplatesModal'
import { CompanyRolesModal } from './CompanyRolesModal'

export function CompaniesAdminPanel() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // v2.1: 审批流模板入口
  const [templateCompany, setTemplateCompany] = useState<Company | null>(null)
  // v2.1+: 角色管理入口
  const [rolesCompany, setRolesCompany] = useState<Company | null>(null)
  // v2.1+: 简称历史入口
  const [historyCompany, setHistoryCompany] = useState<Company | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { companies } = await companiesApi.list()
      setCompanies(companies)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载公司列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleStatus(c: Company) {
    if (c.status === 'active') {
      if (!window.confirm(`确认停用公司「${c.name}」？停用后该公司用户无法登录到此公司，业务数据保留但不可访问。`)) return
      await companiesApi.deactivate(c.id)
    } else {
      await companiesApi.patch(c.id, { status: 'active' })
    }
    await load()
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">企业管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">新增、停用企业，查看每家企业的成员与合同数量</p>
        </div>
        <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          新增企业
        </Button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">公司名称</th>
              <th className="text-left px-4 py-2 font-medium">简称</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="text-left px-4 py-2 font-medium">成员数</th>
              <th className="text-left px-4 py-2 font-medium">合同数</th>
              <th className="text-left px-4 py-2 font-medium">创建时间</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-xs">加载中…</td></tr>
            )}
            {!loading && companies.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-xs">还没有企业，点右上角新增</td></tr>
            )}
            {companies.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Building2 size={14} className="text-slate-400" />
                    <span className="font-medium text-slate-900">{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-mono text-slate-700">{c.code || '—'}</span>
                </td>
                <td className="px-4 py-2.5">
                  {c.status === 'active'
                    ? <span className="px-2 py-0.5 rounded text-[11px] bg-emerald-50 text-emerald-700">运行中</span>
                    : <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500">已停用</span>
                  }
                </td>
                <td className="px-4 py-2.5 text-slate-700">{c.memberCount ?? 0}</td>
                <td className="px-4 py-2.5 text-slate-700">{c.contractCount ?? 0}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">
                  {c.createdAt?.slice(0, 10)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => setHistoryCompany(c)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 mr-1"
                    title="查看并修改公司简称（合同编号前缀）"
                  >
                    <History size={12} />
                    简称历史
                  </button>
                  <button
                    onClick={() => setRolesCompany(c)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 mr-1"
                    title="管理该公司的角色（含自定义角色和看合同权限开关）"
                  >
                    <Shield size={12} />
                    角色管理
                  </button>
                  <button
                    onClick={() => setTemplateCompany(c)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 mr-1"
                    title="管理该公司的审批流模板"
                  >
                    <Workflow size={12} />
                    审批流模板
                  </button>
                  <button
                    onClick={() => toggleStatus(c)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
                  >
                    <Power size={12} />
                    {c.status === 'active' ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateCompanyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load() }}
      />

      {templateCompany && (
        <ApprovalTemplatesModal
          open
          onClose={() => setTemplateCompany(null)}
          companyId={templateCompany.id}
          companyName={templateCompany.name}
        />
      )}

      {rolesCompany && (
        <CompanyRolesModal
          open
          onClose={() => setRolesCompany(null)}
          companyId={rolesCompany.id}
          companyName={rolesCompany.name}
        />
      )}

      {historyCompany && (
        <CompanyCodeHistoryDialog
          open
          onClose={() => setHistoryCompany(null)}
          company={historyCompany}
          onSaved={() => { load() }}
        />
      )}
    </div>
  )
}

// v2.1+: 简称格式校验（前端预校验，后端二次校验）
const CODE_RE = /^[A-Z0-9]{2,8}$/

function CreateCompanyDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setName(''); setCode(''); setDescription(''); setError(null) }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!CODE_RE.test(code.trim())) {
      setError('公司简称必须是 2-8 位大写字母或数字（用于合同编号前缀）')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await companiesApi.create({
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || undefined,
      })
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增企业">
      <form onSubmit={submit} className="w-[460px] space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            公司名称 <span className="text-red-400">*</span>
          </label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="form-input" placeholder="如：广州天弘矿业有限公司" required autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            公司简称 <span className="text-red-400">*</span>
            <span className="ml-2 text-[10px] text-slate-400">
              用于合同编号前缀，2-8 位大写字母/数字。例：GZTH → 合同编号 GZTH-HT-2025-001
            </span>
          </label>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            className="form-input font-mono"
            placeholder="如：GZTH"
            maxLength={8}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">备注</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            className="form-input min-h-[80px]" placeholder="简短描述" />
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button type="submit" variant="primary" size="md" loading={submitting}>创建</Button>
        </div>
      </form>
    </Modal>
  )
}

// v2.1+: 简称历史 + 改简称 弹窗
function CompanyCodeHistoryDialog({ open, onClose, company, onSaved }: {
  open: boolean
  onClose: () => void
  company: Company
  onSaved: () => void
}) {
  const [data, setData] = useState<{
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
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const d = await companiesApi.codeHistory(company.id)
      setData(d)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载历史失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) { setEditing(false); setNewCode(''); load() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company.id])

  async function saveCode() {
    if (!CODE_RE.test(newCode.trim())) {
      setError('简称必须是 2-8 位大写字母或数字')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await companiesApi.patch(company.id, { code: newCode.trim() })
      setEditing(false)
      setNewCode('')
      onSaved()
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`简称历史 · ${company.name}`}>
      <div className="w-[520px] max-w-full space-y-3">
        {/* 当前简称 + 改简称 */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] text-slate-500 mb-1">当前生效简称</p>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={newCode}
                onChange={e => setNewCode(e.target.value.toUpperCase())}
                className="form-input font-mono w-32"
                placeholder={data?.currentCode || 'GZTH'}
                maxLength={8}
                autoFocus
              />
              <Button size="sm" variant="primary" loading={saving} onClick={saveCode}>保存</Button>
              <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setError(null) }}>取消</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg text-slate-900">{data?.currentCode || '—'}</span>
              <Button size="sm" variant="outline" onClick={() => { setNewCode(data?.currentCode || ''); setEditing(true) }}>
                改简称
              </Button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            改简称后，历史合同编号保留不变；新发起的合同使用新简称。<br />
            简称不能与其他公司当前简称或历史简称冲突。
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
          </div>
        )}

        {/* 历史列表 */}
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">变更历史</p>
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            {loading && <div className="text-center py-6 text-slate-400 text-xs">加载中…</div>}
            {!loading && (!data || data.history.length === 0) && (
              <div className="text-center py-6 text-slate-400 text-xs">暂无历史</div>
            )}
            {!loading && data?.history.map(h => (
              <div key={h.id} className="border-b last:border-b-0 border-slate-100 px-3 py-2 flex items-center gap-3">
                <span className={`font-mono text-sm shrink-0 ${h.isCurrent ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                  {h.code}
                </span>
                {h.isCurrent && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700">当前</span>}
                <span className="text-[11px] text-slate-400 flex-1">
                  {new Date(h.validFrom).toLocaleString('zh-CN')}
                  {h.validUntil ? ` ~ ${new Date(h.validUntil).toLocaleString('zh-CN')}` : ' ~ 至今'}
                </span>
                {h.changedByUsername && (
                  <span className="text-[11px] text-slate-400">
                    {h.changedByDisplayName || h.changedByUsername}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Modal>
  )
}
