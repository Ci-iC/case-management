import { useEffect, useState } from 'react'
import { UserPlus, Trash2, KeyRound, AlertCircle, Plus, X, ShieldAlert, FileSpreadsheet, Upload, CheckCircle2 } from 'lucide-react'
import { usersApi, type UserDetail, type BulkImportResult } from '@/api/users'
import { companiesApi, type Company, type CompanyRoleInfo } from '@/api/companies'
import { COMPANY_ROLE_LABEL, type CompanyRole, type PlatformRole } from '@/api/auth'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ApiError } from '@/api/client'

// 角色 key → 中文名的兜底（自定义角色优先用后端返回的 roleName）
function roleLabel(role: string, roleName?: string): string {
  return roleName || COMPANY_ROLE_LABEL[role as CompanyRole] || role
}

// 按公司缓存角色清单（创建用户 / 分配角色弹窗共用），选了公司才按需拉
function useCompanyRoles() {
  const [rolesByCompany, setRolesByCompany] = useState<Record<string, CompanyRoleInfo[]>>({})
  async function ensureRoles(companyId: string) {
    if (!companyId || rolesByCompany[companyId]) return
    try {
      const { roles } = await companiesApi.listRoles(companyId)
      setRolesByCompany(c => ({ ...c, [companyId]: roles }))
    } catch { /* ignore */ }
  }
  return { rolesByCompany, ensureRoles }
}

export function AccountsAdminPanel() {
  const [users, setUsers] = useState<UserDetail[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editAssignFor, setEditAssignFor] = useState<UserDetail | null>(null)
  const [resetFor, setResetFor] = useState<UserDetail | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [tplLoading, setTplLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [u, c] = await Promise.all([usersApi.list(), companiesApi.list()])
      setUsers(u.users)
      setCompanies(c.companies.filter(c => c.status === 'active'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function remove(u: UserDetail) {
    if (!window.confirm(`确认删除账号「${u.username}」？该账号在途的合同审批会被自动作废。`)) return
    await usersApi.remove(u.id)
    await load()
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">账号管理</h2>
          <p className="text-xs text-slate-500 mt-0.5">创建用户并分配公司角色（一个用户可在多家公司有不同角色）</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="md" icon={<FileSpreadsheet size={14} />}
            onClick={async () => {
              setTplLoading(true)
              try { await usersApi.downloadImportTemplate() }
              catch (e) { setError(e instanceof Error ? e.message : '下载模板失败') }
              finally { setTplLoading(false) }
            }}
            loading={tplLoading}
          >
            下载导入模板
          </Button>
          <Button variant="outline" size="md" icon={<Upload size={14} />} onClick={() => setImportOpen(true)}>
            批量导入
          </Button>
          <Button variant="primary" size="md" icon={<UserPlus size={14} />} onClick={() => setCreateOpen(true)}>
            新建账号
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">账号</th>
              <th className="text-left px-4 py-2 font-medium">昵称</th>
              <th className="text-left px-4 py-2 font-medium">平台角色</th>
              <th className="text-left px-4 py-2 font-medium">公司角色</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-xs">加载中…</td></tr>}
            {!loading && users.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-xs">还没有账号</td></tr>}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-2.5 font-medium text-slate-900">{u.username}</td>
                <td className="px-4 py-2.5 text-slate-700">{u.displayName || '—'}</td>
                <td className="px-4 py-2.5">
                  {u.role === 'superadmin'
                    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-rose-50 text-rose-700"><ShieldAlert size={11} />平台超管</span>
                    : <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">平台用户</span>}
                </td>
                <td className="px-4 py-2.5">
                  {u.role === 'superadmin'
                    ? <span className="text-xs text-slate-400">—（超管不归属公司）</span>
                    : (u.companyAssignments?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {u.companyAssignments.map(a => (
                          <span key={a.assignmentId} className="px-1.5 py-0.5 rounded text-[10px] bg-primary-50 text-primary-700">
                            {a.companyName} · {roleLabel(a.role, a.roleName)}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-xs text-amber-700">未分配公司</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {u.role !== 'superadmin' && (
                    <button onClick={() => setEditAssignFor(u)}
                      className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 mr-1">
                      角色
                    </button>
                  )}
                  <button onClick={() => setResetFor(u)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100">
                    <KeyRound size={12} />重置密码
                  </button>
                  <button onClick={() => remove(u)}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded ml-1">
                    <Trash2 size={12} />删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserDialog
        open={createOpen} companies={companies}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load() }}
      />
      {editAssignFor && (
        <ManageAssignmentsDialog
          user={editAssignFor} companies={companies}
          onClose={() => { setEditAssignFor(null); load() }}
        />
      )}
      {resetFor && (
        <ResetPasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={() => { setResetFor(null); load() }}
        />
      )}
      <BulkImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { setImportOpen(false); load() }}
      />
    </div>
  )
}

// ─── 批量导入对话框 ──────────────────────────────────────────────────────────
function BulkImportDialog({ open, onClose, onDone }: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setFile(null); setResult(null); setError(null) }
  }, [open])

  async function submit() {
    if (!file) { setError('请选择 .xlsx 文件'); return }
    setSubmitting(true)
    setError(null)
    try {
      const r = await usersApi.bulkImport(file)
      setResult(r)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '导入失败'))
    } finally {
      setSubmitting(false)
    }
  }

  function close() {
    if (result && result.imported > 0) onDone()
    else onClose()
  }

  return (
    <Modal open={open} onClose={close} title="批量导入用户名单">
      <div className="w-[560px] max-w-full space-y-4">
        {!result && (
          <>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              建议先点「下载导入模板」拿到带表头和示例的 .xlsx，填好之后再上传。
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">选择文件（.xlsx）*</label>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="block text-xs"
              />
              {file && (
                <p className="mt-1 text-[11px] text-slate-500">
                  已选：{file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
              <Button variant="primary" size="md" icon={<Upload size={14} />} loading={submitting}
                onClick={submit} disabled={!file}>
                开始导入
              </Button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={16} className="text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-800">导入完成</p>
              </div>
              <p className="text-xs text-emerald-700">
                成功 <strong>{result.imported}</strong> 条，跳过/失败 <strong>{result.skipped}</strong> 条
              </p>
            </div>

            {result.errors.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1">未导入的明细（{result.errors.length} 条）：</p>
                <div className="rounded-lg border border-slate-200 max-h-60 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium w-12">行号</th>
                        <th className="text-left px-2 py-1.5 font-medium w-32">账号</th>
                        <th className="text-left px-2 py-1.5 font-medium">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 text-slate-500">{e.row}</td>
                          <td className="px-2 py-1.5 text-slate-700">{e.username}</td>
                          <td className="px-2 py-1.5 text-red-600">{e.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="secondary" size="md" onClick={() => { setResult(null); setFile(null) }}>
                再导入一批
              </Button>
              <Button variant="primary" size="md" onClick={close}>完成</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function CreateUserDialog({ open, companies, onClose, onCreated }: {
  open: boolean; companies: Company[]; onClose: () => void; onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<PlatformRole>('platform_user')
  const [assignments, setAssignments] = useState<Array<{ companyId: string; role: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { rolesByCompany, ensureRoles } = useCompanyRoles()

  useEffect(() => {
    if (open) {
      setUsername(''); setPassword(''); setDisplayName(''); setRole('platform_user'); setAssignments([]); setError(null)
    }
  }, [open])

  function addAssignment() {
    const firstCompany = companies[0]?.id || ''
    if (firstCompany) ensureRoles(firstCompany)
    setAssignments(a => [...a, { companyId: firstCompany, role: '' }])
  }
  function removeAssignment(i: number) {
    setAssignments(a => a.filter((_, idx) => idx !== i))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      await usersApi.create({
        username: username.trim(),
        password,
        role,
        displayName: displayName.trim() || undefined,
        assignments: role === 'platform_user'
          ? assignments.filter(a => a.companyId && a.role)
          : undefined,
      })
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败')
    } finally { setSubmitting(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="新建账号">
      <form onSubmit={submit} className="w-[520px] space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">账号 *</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              className="form-input" required autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">初始密码 *</label>
            <input type="text" value={password} onChange={e => setPassword(e.target.value)}
              className="form-input" required minLength={6}
              placeholder="至少 6 位（用户首次登录会强制改密）" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">昵称</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)}
              className="form-input" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">平台角色</label>
            <select value={role} onChange={e => setRole(e.target.value as PlatformRole)} className="form-select">
              <option value="platform_user">普通用户（按公司角色分配）</option>
              <option value="superadmin">平台超管（不归属公司）</option>
            </select>
          </div>
        </div>

        {role === 'platform_user' && (
          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-600">公司角色分配（可空，之后再分配也行）</label>
              <button type="button" onClick={addAssignment}
                className="text-xs text-primary-600 hover:text-primary-800 inline-flex items-center gap-1">
                <Plus size={12} />添加
              </button>
            </div>
            {assignments.length === 0 && (
              <p className="text-[11px] text-slate-400">还未分配。可以创建后再去"角色"按钮里加。</p>
            )}
            <div className="space-y-2">
              {assignments.map((a, i) => {
                const roleOpts = rolesByCompany[a.companyId] || []
                return (
                  <div key={i} className="flex items-center gap-2">
                    <select value={a.companyId} onChange={e => {
                      const cid = e.target.value
                      if (cid) ensureRoles(cid)
                      const arr = [...assignments]; arr[i] = { companyId: cid, role: '' }; setAssignments(arr)
                    }} className="form-select flex-1">
                      <option value="">—选择公司—</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select value={a.role} onChange={e => {
                      const arr = [...assignments]; arr[i] = { ...arr[i], role: e.target.value }; setAssignments(arr)
                    }} className="form-select w-40" disabled={!a.companyId}>
                      <option value="">{a.companyId ? '—选择角色—' : '先选公司'}</option>
                      {roleOpts.map(r => (
                        <option key={r.key} value={r.key}>{r.name}{r.isSystem ? '' : '（自定义）'}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => removeAssignment(i)}
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50">
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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

function ManageAssignmentsDialog({ user, companies, onClose }: {
  user: UserDetail; companies: Company[]; onClose: () => void
}) {
  const [list, setList] = useState(user.companyAssignments || [])
  const [addCompanyId, setAddCompanyId] = useState('')
  const [addRole, setAddRole] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { rolesByCompany, ensureRoles } = useCompanyRoles()
  const roleOpts = rolesByCompany[addCompanyId] || []

  async function reload() {
    const { users } = await usersApi.list()
    const fresh = users.find(u => u.id === user.id)
    setList(fresh?.companyAssignments || [])
  }

  async function add() {
    if (!addCompanyId) { setError('请选择公司'); return }
    if (!addRole) { setError('请选择角色'); return }
    setBusy(true); setError(null)
    try {
      await usersApi.addCompanyRole(user.id, addCompanyId, addRole)
      await reload()
      setAddCompanyId(''); setAddRole('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '添加失败')
    } finally { setBusy(false) }
  }

  async function remove(assignmentId: string) {
    setBusy(true); setError(null)
    try {
      await usersApi.removeCompanyRole(user.id, assignmentId)
      await reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '移除失败')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={true} onClose={onClose} title={`角色分配：${user.username}`}>
      <div className="w-[520px] space-y-4">
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">当前角色</p>
          {list.length === 0
            ? <p className="text-xs text-slate-400">未分配任何公司角色</p>
            : (
              <div className="space-y-1.5">
                {list.map(a => (
                  <div key={a.assignmentId} className="flex items-center gap-2 rounded border border-slate-200 px-3 py-1.5 text-sm">
                    <span className="font-medium text-slate-900">{a.companyName}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-700">{roleLabel(a.role, a.roleName)}</span>
                    <span className="flex-1" />
                    <button onClick={() => remove(a.assignmentId)}
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" disabled={busy}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-600 mb-2">添加角色</p>
          <div className="flex items-center gap-2">
            <select value={addCompanyId} onChange={e => {
              const cid = e.target.value
              if (cid) ensureRoles(cid)
              setAddCompanyId(cid); setAddRole('')
            }} className="form-select flex-1">
              <option value="">—选择公司—</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={addRole} onChange={e => setAddRole(e.target.value)} className="form-select w-40" disabled={!addCompanyId}>
              <option value="">{addCompanyId ? '—选择角色—' : '先选公司'}</option>
              {roleOpts.map(r => (
                <option key={r.key} value={r.key}>{r.name}{r.isSystem ? '' : '（自定义）'}</option>
              ))}
            </select>
            <Button variant="primary" size="md" onClick={add} loading={busy} icon={<Plus size={12} />}>添加</Button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Modal>
  )
}

function ResetPasswordDialog({ user, onClose, onDone }: {
  user: UserDetail; onClose: () => void; onDone: () => void
}) {
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await usersApi.resetPassword(user.id, pwd)
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '重置失败')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={true} onClose={onClose} title={`重置密码：${user.username}`}>
      <form onSubmit={submit} className="w-[420px] space-y-3">
        <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded">
          重置后该用户下次登录会被强制改密。所有已登录设备会被踢下线。
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">新密码（至少 6 位）</label>
          <input type="text" value={pwd} onChange={e => setPwd(e.target.value)}
            className="form-input" required minLength={6} autoFocus />
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>取消</Button>
          <Button type="submit" variant="primary" size="md" loading={busy}>重置</Button>
        </div>
      </form>
    </Modal>
  )
}
