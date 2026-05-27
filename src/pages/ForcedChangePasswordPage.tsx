import { Scale, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm'

/**
 * v1.4: 首次登录 / 被重置密码后的强制改密码页。
 * AuthGate 检测 user.mustChangePassword=true 时渲染此页面替代主应用。
 * 用户只能 (a) 改完密码进入主应用，或 (b) 退出登录用别的账号。
 */
export function ForcedChangePasswordPage() {
  const { user, logout } = useAuthStore()

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-[440px] rounded-xl bg-white p-8 shadow-modal">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-600">
            <Scale size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-slate-900 leading-tight">GlobalX</p>
            <p className="text-xs text-slate-400 leading-tight mt-0.5">法律事务管理系统</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100"
            title="切换账号"
          >
            <LogOut size={12} />
            退出
          </button>
        </div>

        <h2 className="mb-1 text-lg font-semibold text-slate-900">设置新密码</h2>
        {user?.displayName || user?.username ? (
          <p className="mb-5 text-xs text-slate-500">
            当前账号：<span className="font-medium text-slate-700">{user?.displayName || user?.username}</span>
          </p>
        ) : (
          <p className="mb-5 text-xs text-slate-500">首次登录需先修改初始密码</p>
        )}

        <ChangePasswordForm
          mode="forced"
          onSuccess={() => { /* mustChangePassword 已置 false，AuthGate 自动切回主应用 */ }}
        />
      </div>
    </div>
  )
}
