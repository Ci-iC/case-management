import { useState } from 'react'
import { Scale, LogOut, Building2, Users, Workflow, Settings as SettingsIcon, BarChart3, KeyRound, BookText } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/utils/helpers'
import { CompaniesAdminPanel } from '@/components/admin/CompaniesAdminPanel'
import { AccountsAdminPanel } from '@/components/admin/AccountsAdminPanel'
import { PipelinesAdminPanel } from '@/components/admin/PipelinesAdminPanel'
import { PlatformSettingsPanel } from '@/components/admin/PlatformSettingsPanel'
import { ContractTemplatesPanel } from '@/components/admin/ContractTemplatesPanel'
import { CrossCompanyQueryPanel } from '@/components/admin/CrossCompanyQueryPanel'
import { ChangePasswordModal } from '@/components/auth/ChangePasswordModal'

type Tab = 'companies' | 'accounts' | 'pipelines' | 'templates' | 'settings' | 'query'

const TABS: Array<{ key: Tab; label: string; icon: typeof Building2 }> = [
  { key: 'companies', label: '企业管理', icon: Building2 },
  { key: 'accounts', label: '账号管理', icon: Users },
  { key: 'pipelines', label: 'AI 审核模型', icon: Workflow },
  { key: 'query', label: '数据查询', icon: BarChart3 },
  { key: 'templates', label: '合同模板', icon: BookText },
  { key: 'settings', label: '平台设置', icon: SettingsIcon },
]

/**
 * v2.0 平台超管控制台：取代主应用入口（superadmin 登录后直接进入这里）。
 * 5 个 tab：企业管理 / 账号管理 / 审批流配置 / 数据查询 / 平台设置。
 */
export function PlatformConsolePage() {
  const { user, logout } = useAuthStore()
  const [tab, setTab] = useState<Tab>('companies')
  const [pwdOpen, setPwdOpen] = useState(false)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="flex h-full w-56 flex-col border-r border-slate-200/80 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600 shrink-0">
            <Scale size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 leading-tight truncate">平台管理控制台</p>
            <p className="text-[11px] text-slate-400 leading-tight truncate">GlobalX SuperAdmin</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-rose-50 text-rose-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                <Icon size={16} className={active ? 'text-rose-600' : 'text-slate-400'} />
                <span className="flex-1 text-left">{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0 bg-rose-100 text-rose-700">
              {(user?.displayName?.[0] || user?.username?.[0] || 'S').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-700 truncate">{user?.displayName || user?.username}</p>
              <p className="text-[11px] text-slate-400 truncate">平台超管</p>
            </div>
            <button
              onClick={() => setPwdOpen(true)}
              title="修改密码"
              className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            >
              <KeyRound size={14} />
            </button>
            <button
              onClick={() => { if (window.confirm('确认退出登录？')) logout() }}
              title="退出登录"
              className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        {tab === 'companies' && <CompaniesAdminPanel />}
        {tab === 'accounts' && <AccountsAdminPanel />}
        {tab === 'pipelines' && <PipelinesAdminPanel />}
        {tab === 'query' && <CrossCompanyQueryPanel />}
        {tab === 'templates' && <ContractTemplatesPanel />}
        {tab === 'settings' && <PlatformSettingsPanel />}
      </main>

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </div>
  )
}
