import { Component, type ReactNode } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import CasesPage from '@/pages/CasesPage'
import { AuthGate } from '@/components/auth/AuthGate'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center flex-col gap-4 text-slate-600">
          <p className="text-lg font-semibold">页面加载出错</p>
          <p className="text-sm text-slate-400">{(this.state.error as Error).message}</p>
          <button
            className="px-4 py-2 rounded bg-primary-600 text-white text-sm"
            onClick={() => { localStorage.removeItem('case-management-store'); location.reload() }}
          >
            清除缓存并刷新
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Root application component.
 * Currently renders the cases page directly.
 * Future: add react-router-dom for multi-page routing and auth guard.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <AuthGate>
        <AppLayout>
          <CasesPage />
        </AppLayout>
      </AuthGate>
    </ErrorBoundary>
  )
}
