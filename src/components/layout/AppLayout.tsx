import { useState } from 'react'
import { Menu } from 'lucide-react'
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
  // 移动端侧边栏抽屉（lg 以上常驻，此状态无效）
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
        onNavChange={(id) => { setMessagesOpen(false); setActiveNav(id); setSidebarOpen(false) }}
        messagesOpen={messagesOpen}
        onToggleMessages={() => { setMessagesOpen(!messagesOpen); setSidebarOpen(false) }}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <main className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* v2.0: 顶部公司切换器（普通用户 + 多公司用户才显示出意义）；移动端左侧加汉堡按钮 */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-2 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              title="打开菜单"
              className="lg:hidden shrink-0 -ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>
            <CompanySwitcher />
          </div>
          {user?.isAllCompaniesView && (
            <p className="hidden sm:block text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded">
              当前为"全部公司"汇总视图，仅支持查看；如需操作请切换到具体公司
            </p>
          )}
        </div>
        {user?.isAllCompaniesView && (
          <p className="sm:hidden text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 border-b border-amber-100">
            "全部公司"汇总视图，仅支持查看
          </p>
        )}
        {showPage()}
      </main>
    </div>
  )
}
