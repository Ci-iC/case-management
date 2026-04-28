import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useAuthStore } from '@/store/useAuthStore'
import CasesPage from '@/pages/CasesPage'
import ContractReviewPage from '@/pages/ContractReviewPage'
import ContractsPage from '@/pages/ContractsPage'
import MessagesPage from '@/pages/MessagesPage'

export default function AppLayout() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const canViewCases = isAdmin || !!user?.canViewCases

  // 默认导航：有案件权限 → cases；否则 → reviews
  const [activeNav, setActiveNav] = useState<string>(canViewCases ? 'cases' : 'reviews')
  const [messagesOpen, setMessagesOpen] = useState(false)

  function showPage() {
    if (messagesOpen) return <MessagesPage />
    switch (activeNav) {
      case 'cases': return canViewCases ? <CasesPage /> : <ContractReviewPage />
      case 'reviews': return <ContractReviewPage />
      case 'contracts': return <ContractsPage />
      default: return <ContractReviewPage />
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <Sidebar
        activeNav={messagesOpen ? '' : activeNav}
        onNavChange={(id) => { setMessagesOpen(false); setActiveNav(id) }}
      />

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          active={messagesOpen}
          onClick={() => setMessagesOpen(!messagesOpen)}
        />
        {showPage()}
      </main>
    </div>
  )
}
