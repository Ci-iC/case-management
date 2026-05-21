import { useEffect, useState } from 'react'
import { UserPlus, Trash2, KeyRound, AlertCircle, CheckCircle2, Shield, ShieldCheck, User as UserIcon, Briefcase, FolderOpen, Pencil } from 'lucide-react'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { usersApi } from '@/api/users'
import { useAuthStore } from '@/store/useAuthStore'
import type { AuthUser, UserRole } from '@/api/auth'
import { isAdminOrAbove, isSuperAdmin } from '@/api/auth'
import { formatDate } from '@/utils/helpers'
import { cn } from '@/utils/helpers'

interface Props {
  open: boolean
  onClose: () => void
}

function roleLabel(role: UserRole | string): string {
  if (role === 'superadmin') return '超级管理员'
  if (role === 'admin') return '管理员'
  return '普通用户'
}

function roleBadgeClass(role: UserRole | string): string {
  if (role === 'superadmin') return 'bg-rose-100 text-rose-700'
  if (role === 'admin') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-500'
}

function RoleIcon({ role }: { role: UserRole | string }) {
  if (role === 'superadmin') return <ShieldCheck size={14} />
  if (role === 'admin') return <Shield size={14} />
  return <UserIcon size={14} />
}

export function UsersAdminModal({ open, onClose }: Props) {
  const currentUser = useAuthStore((s) => s.user)

  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('user')
  const [newCanViewCases, setNewCanViewCases] = useState(false)
  const [newCanViewContracts, setNewCanViewContracts] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null)
  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [renameTarget, setRenameTarget] = useState<AuthUser | null>(null)
  const [renameValue, setRenameValue] = useState('')

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const { users } = await usersApi.list()
      setUsers(users)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])

  function resetCreateForm() {
    setNewUsername('')
    setNewPassword('')
    setNewDisplayName('')
    setNewRole('user')
    setNewCanViewCases(false)
    setNewCanViewContracts(false)
  }

  async function handleCreate() {
    if (!newUsername.trim() || !newPassword) {
      setError('请填写账号和密码')
      return
    }
    setError(null)
    try {
      const isAdminish = newRole === 'admin' || newRole === 'superadmin'
      await usersApi.create({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
        displayName: newDisplayName.trim() || undefined,
        canViewCases: isAdminish ? true : newCanViewCases,
        canViewContracts: isAdminish ? true : newCanViewContracts,
      })
      resetCreateForm()
      setShowCreate(false)
      setFlash(`已创建账号「${newUsername.trim()}」`)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleCaseAccess(u: AuthUser) {
    if (isAdminOrAbove(u)) return  // admin / superadmin 默认有权限，不可关
    const next = !u.canViewCases
    try {
      await usersApi.setCaseAccess(u.id, next)
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, canViewCases: next } : x))
      setFlash(next ? `已开放「${u.username}」的案件管理权限` : `已关闭「${u.username}」的案件管理权限`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleContractAccess(u: AuthUser) {
    if (isAdminOrAbove(u)) return
    const next = !u.canViewContracts
    try {
      await usersApi.setContractAccess(u.id, next)
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, canViewContracts: next } : x))
      setFlash(next ? `已开放「${u.username}」的合同台账权限` : `已关闭「${u.username}」的合同台账权限`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await usersApi.remove(deleteTarget.id)
      setFlash(`已删除账号「${deleteTarget.username}」`)
      setDeleteTarget(null)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleteTarget(null)
    }
  }

  async function handleRename() {
    if (!renameTarget) return
    const v = renameValue.trim()
    if (v.length > 64) { setError('昵称最多 64 个字符'); return }
    try {
      await usersApi.setDisplayName(renameTarget.id, v)
      setUsers(prev => prev.map(x => x.id === renameTarget.id ? { ...x, displayName: v || undefined } : x))
      setFlash(`已更新「${renameTarget.username}」的昵称`)
      setRenameTarget(null)
      setRenameValue('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleResetPassword() {
    if (!resetTarget) return
    if (!resetPw || resetPw.length < 6) {
      setError('新密码至少 6 位')
      return
    }
    try {
      await usersApi.resetPassword(resetTarget.id, resetPw)
      setFlash(`已重置「${resetTarget.username}」的密码`)
      setResetTarget(null)
      setResetPw('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const newRoleIsAdminish = newRole === 'admin' || newRole === 'superadmin'

  return (
    <>
      <Modal open={open} onClose={onClose} title="用户管理">
        <div className="w-[640px] space-y-4">
          {flash && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 size={14} /> {flash}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs">
                关闭
              </button>
            </div>
          )}

          {/* Create user toggle */}
          {!showCreate && (
            <div className="flex justify-end">
              <Button variant="primary" size="md" icon={<UserPlus size={14} />} onClick={() => setShowCreate(true)}>
                新建账号
              </Button>
            </div>
          )}

          {showCreate && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-700">新建账号</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">账号 *</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="form-input"
                    placeholder="2-32 个字符"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">初始密码 *</label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input font-mono"
                    placeholder="至少 6 位"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">姓名 / 备注</label>
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    className="form-input"
                    placeholder="选填，例如：张律师"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">角色</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="form-select"
                  >
                    <option value="user">普通用户（按权限开关访问）</option>
                    <option value="admin">管理员（看全部台账 + 法务工作）</option>
                    <option value="superadmin">超级管理员（系统配置 + 用户管理）</option>
                  </select>
                </div>
              </div>
              {!newRoleIsAdminish && (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300"
                      checked={newCanViewCases}
                      onChange={(e) => setNewCanViewCases(e.target.checked)}
                    />
                    <span>开放案件管理权限（勾选后可看全部案件）</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300"
                      checked={newCanViewContracts}
                      onChange={(e) => setNewCanViewContracts(e.target.checked)}
                    />
                    <span>开放合同台账权限（勾选后可看全部合同 + 历史版本）</span>
                  </label>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => { setShowCreate(false); resetCreateForm(); setError(null) }}
                >
                  取消
                </Button>
                <Button variant="primary" size="md" onClick={handleCreate}>
                  确认创建
                </Button>
              </div>
            </div>
          )}

          {/* User list */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 border-b border-slate-200 flex justify-between">
              <span>全部账号（{users.length}）</span>
              {loading && <span className="text-slate-400">加载中…</span>}
            </div>
            <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
              {users.length === 0 && !loading ? (
                <div className="py-10 text-center text-sm text-slate-400">暂无账号</div>
              ) : (
                users.map((u) => {
                  const adminish = isAdminOrAbove(u)
                  const isSuper = isSuperAdmin(u)
                  return (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                    <div className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full shrink-0',
                      roleBadgeClass(u.role),
                    )}>
                      <RoleIcon role={u.role} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate">{u.username}</span>
                        {u.displayName && <span className="text-xs text-slate-500 truncate">（{u.displayName}）</span>}
                        {u.id === currentUser?.id && (
                          <span className="text-[10px] rounded bg-primary-100 text-primary-700 px-1.5 py-0.5">我</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {roleLabel(u.role)} · 创建于 {formatDate(u.createdAt)}
                      </p>
                    </div>
                    <button
                      className={cn(
                        'p-1.5 rounded transition-colors',
                        adminish
                          ? 'text-amber-500 cursor-default'
                          : u.canViewCases
                            ? 'text-emerald-600 hover:bg-emerald-50'
                            : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100',
                      )}
                      onClick={() => toggleCaseAccess(u)}
                      title={
                        adminish
                          ? `${roleLabel(u.role)}默认有案件权限`
                          : u.canViewCases
                            ? '点击关闭案件管理权限'
                            : '点击开放案件管理权限'
                      }
                      disabled={adminish}
                    >
                      <Briefcase size={14} />
                    </button>
                    <button
                      className={cn(
                        'p-1.5 rounded transition-colors',
                        adminish
                          ? 'text-amber-500 cursor-default'
                          : u.canViewContracts
                            ? 'text-emerald-600 hover:bg-emerald-50'
                            : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100',
                      )}
                      onClick={() => toggleContractAccess(u)}
                      title={
                        adminish
                          ? `${roleLabel(u.role)}默认有合同台账权限`
                          : u.canViewContracts
                            ? '点击关闭合同台账权限'
                            : '点击开放合同台账权限'
                      }
                      disabled={adminish}
                    >
                      <FolderOpen size={14} />
                    </button>
                    <button
                      className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      onClick={() => { setRenameTarget(u); setRenameValue(u.displayName || '') }}
                      title="改昵称"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      onClick={() => { setResetTarget(u); setResetPw('') }}
                      title="重置密码（重置后该用户在所有设备会被强制登出）"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                      disabled={u.id === currentUser?.id || (isSuper && users.filter(x => x.role === 'superadmin').length <= 1)}
                      onClick={() => setDeleteTarget(u)}
                      title={
                        u.id === currentUser?.id
                          ? '不能删除自己'
                          : isSuper && users.filter(x => x.role === 'superadmin').length <= 1
                            ? '系统至少保留一个超级管理员'
                            : '删除账号'
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="删除账号"
        confirmLabel="确认删除"
        confirmVariant="danger"
        message={
          <>确认删除账号「<strong>{deleteTarget?.username}</strong>」？此操作不可撤销。</>
        }
      />

      {/* Rename modal */}
      <Modal
        open={!!renameTarget}
        onClose={() => { setRenameTarget(null); setRenameValue('') }}
        title={`修改「${renameTarget?.username || ''}」的昵称`}
      >
        <div className="w-[360px] space-y-3">
          <label className="block text-xs font-medium text-slate-600">昵称（留空清除）</label>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="form-input"
            placeholder="例如：Wells / 张律师"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
          />
          <p className="text-[11px] text-slate-400">最多 64 个字符</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="md" onClick={() => { setRenameTarget(null); setRenameValue('') }}>
              取消
            </Button>
            <Button variant="primary" size="md" onClick={handleRename}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset password modal */}
      <Modal
        open={!!resetTarget}
        onClose={() => { setResetTarget(null); setResetPw('') }}
        title={`重置「${resetTarget?.username || ''}」的密码`}
      >
        <div className="w-[360px] space-y-3">
          <label className="block text-xs font-medium text-slate-600">新密码</label>
          <input
            type="text"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            className="form-input font-mono"
            placeholder="至少 6 位"
            autoFocus
          />
          <p className="text-[11px] text-slate-400">重置后该用户当前已登录的所有设备会被强制登出。</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="md" onClick={() => { setResetTarget(null); setResetPw('') }}>
              取消
            </Button>
            <Button variant="primary" size="md" onClick={handleResetPassword}>
              确认重置
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
