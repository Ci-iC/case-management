import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { CompanySwitcher } from './CompanySwitcher'
import { useAuthStore } from '@/store/useAuthStore'
import { canSeeCases, canSeeAllContracts } from '@/api/auth'
import CasesPage from '@/pages/CasesPage'
import ContractReviewPage from '@/pages/ContractReviewPage'
import ContractsPage from '@/pages/ContractsPage'
import WorkbenchPage from '@/pages/WorkbenchPage'
import MessagesPage from '@/pages/MessagesPage'
import ApprovalsPage from '@/pages/ApprovalsPage'
import type { JumpLink } from '@/api/assistant'

export default function AppLayout() {
  const user = useAuthStore(s => s.user)
  const viewCases = canSeeCases(user)
  const viewContracts = canSeeAllContracts(user) || !!(user?.companyRoles?.length)

  const [activeNav, setActiveNav] = useState<string>('workbench')
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null)

  function navigateToApproval(approvalId: string) {
    setMessagesOpen(false)
    setPendingApprovalId(approvalId)
    setActiveNav('approvals')
  }

  // 工作台待办里的"跳转查看"
  function handleJump(link: JumpLink) {
    setMessagesOpen(false)
    if (link.nav === 'approvals' && link.approvalId) { navigateToApproval(link.approvalId); return }
    if (link.nav === 'reviews') { setActiveNav('reviews'); return }
    if (link.nav === 'contracts') { setActiveNav('contracts'); return }
  }

  function showPage() {
    if (messagesOpen) return <MessagesPage onJumpToApproval={navigateToApproval} />
    switch (activeNav) {
      case 'workbench': return <WorkbenchPage onNavigate={handleJump} />
      case 'cases': return viewCases ? <CasesPage /> : <ContractReviewPage />
      case 'reviews': return <ContractReviewPage />
      case 'contracts': return viewContracts
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

      <main className="flex flex-1 flex-col overflow-hidden">
        {/* v2.0: 顶部公司切换器（普通用户 + 多公司用户才显示出意义） */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-slate-100 bg-white">
          <CompanySwitcher />
          {user?.isAllCompaniesView && (
            <p className="text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded">
              当前为"全部公司"汇总视图，仅支持查看；如需操作请切换到具体公司
            </p>
          )}
        </div>
        {showPage()}
      </main>
    </div>
  )
}
