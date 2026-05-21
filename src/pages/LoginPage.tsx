import { useState } from 'react'
import { Scale, LogIn, AlertCircle, AlertTriangle } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { Button } from '@/components/ui/Button'

export function LoginPage() {
  const { login, status, error, sessionRevokedMessage, clearSessionRevoked } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(username.trim(), password)
    } catch {
      // error surfaced via store
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-[400px] rounded-xl bg-white p-8 shadow-modal">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-600">
            <Scale size={20} className="text-white" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900 leading-tight">GlobalX</p>
            <p className="text-xs text-slate-400 leading-tight mt-0.5">法律事务管理系统</p>
          </div>
        </div>

        <h2 className="mb-1 text-lg font-semibold text-slate-900">欢迎登录</h2>
        <p className="mb-5 text-xs text-slate-500">请使用管理员分配的账号登录</p>

        {sessionRevokedMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="leading-relaxed">{sessionRevokedMessage}</p>
              <button
                type="button"
                onClick={clearSessionRevoked}
                className="mt-1 text-[11px] text-amber-700 underline hover:text-amber-900"
              >
                我知道了
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="form-input"
              placeholder="请输入账号"
              autoFocus
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              placeholder="请输入密码"
              autoComplete="current-password"
              required
            />
          </div>

          {error && status === 'guest' && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon={<LogIn size={14} />}
            loading={submitting || status === 'loading'}
            className="w-full"
          >
            登录
          </Button>
        </form>
      </div>
    </div>
  )
}
