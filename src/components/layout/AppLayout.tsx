import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { useAuthStore } from '@/store/useAuthStore'
import { isAdminOrAbove } from '@/api/auth'
import CasesPage from '@/pages/CasesPage'
import ContractReviewPage from '@/pages/ContractReviewPage'
import ContractsPage from '@/pages/ContractsPage'
import MessagesPage from '@/pages/MessagesPage'
import ApprovalsPage from '@/pages/ApprovalsPage'

export default function AppLayout() {
  const user = useAuthStore(s => s.user)
  const isAdmin = isAdminOrAbove(user)
  const canViewCases = isAdmin || !!user?.canViewCases

  // 默认导航：有案件权限 → cases；否则 → reviews
  const [activeNav, setActiveNav] = useState<string>(canViewCases ? 'cases' : 'reviews')
  const [messagesOpen, setMessagesOpen] = useState(false)
  // 从消息中心跳转到某个审批详情时的"待打开 id"，ApprovalsPage 自己消费后清空
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null)

  const canViewContracts = isAdmin || !!user?.canViewContracts

  function navigateToApproval(approvalId: string) {
    setMessagesOpen(false)
    setPendingApprovalId(approvalId)
    setActiveNav('approvals')
  }

  function showPage() {
    if (messagesOpen) return <MessagesPage onJumpToApproval={navigateToApproval} />
    switch (activeNav) {
      case 'cases': return canViewCases ? <CasesPage /> : <ContractReviewPage />
      case 'reviews': return <ContractReviewPage />
      case 'contracts': return canViewContracts
        ? <ContractsPage onJumpToApproval={navigateToApproval} />
        : <ContractReviewPage />
      case 'approvals': return (
        <ApprovalsPage
          initialApprovalId={pendingApprovalId}
          onConsumedInitial={() => setPendingApprovalId(null)}
        />
      )
      default: return <ContractReviewPage />
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      <Sidebar
        activeNav={messagesOpen ? '' : activeNav}
        onNavChange={(id) => { setMessagesOpen(false); setActiveNav(id) }}
        messagesOpen={messagesOpen}
        onToggleMessages={() => setMessagesOpen(!messagesOpen)}
      />

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {showPage()}
      </main>
    </div>
  )
}
