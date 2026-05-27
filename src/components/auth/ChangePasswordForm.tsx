import { useState } from 'react'
import { KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/useAuthStore'
import { ApiError } from '@/api/client'

interface Props {
  /** forced: 首次/重置后强制改密；voluntary: 自助修改 */
  mode: 'forced' | 'voluntary'
  /** voluntary 模式下取消按钮文案；forced 模式无取消按钮 */
  onCancel?: () => void
  /** 改密成功后回调（forced 模式可用于跳转主页；voluntary 模式用于关闭弹窗） */
  onSuccess?: () => void
}

export function ChangePasswordForm({ mode, onCancel, onSuccess }: Props) {
  const changePassword = useAuthStore((s) => s.changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // 前端先做硬性校验，错的直接挡掉不发请求
  function clientValidate(): string | null {
    if (!currentPassword) return '请输入当前密码'
    if (!newPassword) return '请输入新密码'
    if (newPassword.length < 6) return '新密码至少 6 位'
    if (newPassword === currentPassword) return '新密码不能与当前密码相同'
    if (confirmPassword !== newPassword) return '两次输入的新密码不一致'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const clientErr = clientValidate()
    if (clientErr) { setError(clientErr); return }

    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword, confirmPassword)
      setSuccess(true)
      // 给一点反馈时间再触发回调
      setTimeout(() => onSuccess?.(), 600)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '修改密码失败')
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === 'forced' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 leading-relaxed">
          检测到您使用的是初始密码或刚被重置的密码。出于账户安全，请先设置新密码后再使用系统其他功能。
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">当前密码</label>
        <div className="relative">
          <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type={showCurrent ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="form-input pl-9 pr-10"
            placeholder="请输入当前密码"
            autoComplete="current-password"
            autoFocus
            required
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            title={showCurrent ? '隐藏' : '显示'}
          >
            {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          新密码 <span className="text-slate-400 font-normal">（至少 6 位）</span>
        </label>
        <div className="relative">
          <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="form-input pl-9 pr-10"
            placeholder="请输入新密码"
            autoComplete="new-password"
            required
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            title={showNew ? '隐藏' : '显示'}
          >
            {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">确认新密码</label>
        <div className="relative">
          <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type={showNew ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="form-input pl-9 pr-10"
            placeholder="请再次输入新密码"
            autoComplete="new-password"
            required
          />
        </div>
        {confirmPassword && newPassword && confirmPassword !== newPassword && (
          <p className="mt-1 text-[11px] text-red-600">两次输入的新密码不一致</p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <span>密码修改成功{mode === 'forced' ? '，即将进入系统' : '，其他设备已被踢下线'}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {mode === 'voluntary' && onCancel && (
          <Button type="button" variant="secondary" size="md" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={submitting}
          disabled={success}
        >
          {mode === 'forced' ? '设置新密码并进入' : '保存'}
        </Button>
      </div>
    </form>
  )
}
