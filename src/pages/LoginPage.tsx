import { useState } from 'react'
import { Scale, LogIn, AlertCircle, AlertTriangle, X, ChevronRight, KeyRound } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { Button } from '@/components/ui/Button'
import { listSavedAccounts, removeAccount, type SavedAccount } from '@/utils/savedAccounts'

export function LoginPage() {
  const { login, loginWithSavedAccount, status, error, sessionRevokedMessage, clearSessionRevoked } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 多账号选择器：本机"记住我"过的账号
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => listSavedAccounts())
  // 有已存账号 && 用户没主动点"使用其他账号" → 先展示选择器
  const [showPicker, setShowPicker] = useState(() => listSavedAccounts().length > 0)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickingUsername, setPickingUsername] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(username.trim(), password, rememberMe)
    } catch {
      // error surfaced via store
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePickAccount(a: SavedAccount) {
    setPickerError(null)
    setPickingUsername(a.username)
    try {
      await loginWithSavedAccount(a)
    } catch {
      // token 失效：回退到密码登录，帮用户填好用户名
      setSavedAccounts(listSavedAccounts())
      setUsername(a.username)
      setShowPicker(false)
      setPickerError('登录状态已过期，请重新输入密码')
    } finally {
      setPickingUsername(null)
    }
  }

  function handleRemoveAccount(e: React.MouseEvent, usernameToRemove: string) {
    e.stopPropagation()
    removeAccount(usernameToRemove)
    const rest = listSavedAccounts()
    setSavedAccounts(rest)
    if (rest.length === 0) setShowPicker(false)
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-[400px] rounded-xl bg-white p-6 sm:p-8 shadow-modal">
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

        {showPicker && savedAccounts.length > 0 ? (
          <>
            {/* ─── 多账号选择器 ─── */}
            <h2 className="mb-1 text-lg font-semibold text-slate-900">选择账号</h2>
            <p className="mb-5 text-xs text-slate-500">点击账号直接进入，无需输入密码</p>

            <div className="space-y-2 mb-4">
              {savedAccounts.map(a => (
                <button
                  key={a.username}
                  onClick={() => handlePickAccount(a)}
                  disabled={pickingUsername !== null}
                  className="group w-full flex items-center gap-3 rounded-lg border border-slate-200 px-3.5 py-3 text-left hover:border-primary-300 hover:bg-primary-50/40 transition-colors disabled:opacity-60"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700 shrink-0">
                    {(a.displayName?.[0] || a.username[0]).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.displayName || a.username}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {a.username} · 上次登录 {new Date(a.savedAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  {pickingUsername === a.username ? (
                    <span className="text-[11px] text-primary-600 shrink-0">进入中…</span>
                  ) : (
                    <>
                      <span
                        role="button"
                        title="从此设备移除该账号"
                        onClick={e => handleRemoveAccount(e, a.username)}
                        className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0"
                      >
                        <X size={13} />
                      </span>
                      <ChevronRight size={15} className="text-slate-300 shrink-0" />
                    </>
                  )}
                </button>
              ))}
            </div>

            {pickerError && (
              <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{pickerError}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => { setShowPicker(false); setPickerError(null) }}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            >
              <KeyRound size={13} />使用其他账号登录
            </button>
          </>
        ) : (
          <>
            {/* ─── 密码登录 ─── */}
            <h2 className="mb-1 text-lg font-semibold text-slate-900">欢迎登录</h2>
            <p className="mb-5 text-xs text-slate-500">请使用管理员分配的账号登录</p>

            {pickerError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{pickerError}</span>
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

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-xs text-slate-600">记住我（30 天内本设备免登录）</span>
              </label>

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

            {savedAccounts.length > 0 && (
              <button
                type="button"
                onClick={() => { setShowPicker(true); setPickerError(null) }}
                className="mt-3 w-full text-center text-xs text-primary-600 hover:underline"
              >
                ← 返回账号选择
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
