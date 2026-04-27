import { useEffect } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { useCaseStore } from '@/store/useCaseStore'
import { LoginPage } from '@/pages/LoginPage'

interface Props {
  children: React.ReactNode
}

/**
 * Decides whether to render the login page or the authenticated app.
 * Also triggers initial data load for authenticated users.
 */
export function AuthGate({ children }: Props) {
  const { status, bootstrap } = useAuthStore()
  const loadCases = useCaseStore((s) => s.loadCases)

  // On mount: verify any persisted token
  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  // When we become authed, load cases
  useEffect(() => {
    if (status === 'authed') loadCases()
  }, [status, loadCases])

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 text-slate-400 text-sm">
        加载中…
      </div>
    )
  }

  if (status !== 'authed') {
    return <LoginPage />
  }

  return <>{children}</>
}
