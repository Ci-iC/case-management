import { useEffect } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { useCaseStore } from '@/store/useCaseStore'
import { LoginPage } from '@/pages/LoginPage'
import { ForcedChangePasswordPage } from '@/pages/ForcedChangePasswordPage'
import { CompanySelectPage } from '@/pages/CompanySelectPage'
import { PlatformConsolePage } from '@/pages/PlatformConsolePage'

interface Props {
  children: React.ReactNode
}

/**
 * v2.0 路由分支：
 *   未登录          → LoginPage
 *   must_change_pwd → ForcedChangePasswordPage
 *   superadmin      → PlatformConsolePage（平台控制台，不进业务主应用）
 *   普通用户没选公司 → CompanySelectPage
 *   普通用户已选公司 → 主应用（children）
 */
export function AuthGate({ children }: Props) {
  const { status, user, bootstrap } = useAuthStore()
  const loadCases = useCaseStore((s) => s.loadCases)

  useEffect(() => { bootstrap() }, [bootstrap])

  // 普通用户进入主应用时加载案件
  useEffect(() => {
    if (status === 'authed'
      && !user?.mustChangePassword
      && user?.role !== 'superadmin'
      && user?.currentCompanyId) {
      loadCases()
    }
  }, [status, user?.mustChangePassword, user?.role, user?.currentCompanyId, loadCases])

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-400 text-sm">
        加载中…
      </div>
    )
  }

  if (status !== 'authed') return <LoginPage />
  if (user?.mustChangePassword) return <ForcedChangePasswordPage />
  if (user?.role === 'superadmin') return <PlatformConsolePage />

  // 普通用户
  if (!user?.currentCompanyId) return <CompanySelectPage />

  return <>{children}</>
}
