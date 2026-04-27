import { useEffect, useState } from 'react'
import { UserPlus, Trash2, KeyRound, AlertCircle, CheckCircle2, Shield, User as UserIcon } from 'lucide-react'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { usersApi } from '@/api/users'
import { useAuthStore } from '@/store/useAuthStore'
import type { AuthUser } from '@/api/auth'
import { formatDate } from '@/utils/helpers'
import { cn } from '@/utils/helpers'

interface Props {
  open: boolean
  onClose: () => void
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
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user')

  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null)
  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null)
  const [resetPw, setResetPw] = useState('')

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
  }

  async function handleCreate() {
    if (!newUsername.trim() || !newPassword) {
      setError('请填写账号和密码')
      return
    }
    setError(null)
    try {
      await usersApi.create({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
        displayName: newDisplayName.trim() || undefined,
      })
      resetCreateForm()
      setShowCreate(false)
      setFlash(`已创建账号「${newUsername.trim()}」`)
      refresh()
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
                    onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
                    className="form-select"
                  >
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
              </div>
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
                users.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                    <div className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full shrink-0',
                      u.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500',
                    )}>
                      {u.role === 'admin' ? <Shield size={14} /> : <UserIcon size={14} />}
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
                        {u.role === 'admin' ? '管理员' : '普通用户'} · 创建于 {formatDate(u.createdAt)}
                      </p>
                    </div>
                    <button
                      className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      onClick={() => { setResetTarget(u); setResetPw('') }}
                      title="重置密码"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                      disabled={u.id === currentUser?.id}
                      onClick={() => setDeleteTarget(u)}
                      title={u.id === currentUser?.id ? '不能删除自己' : '删除账号'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
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
