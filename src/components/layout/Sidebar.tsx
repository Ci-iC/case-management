import { useEffect, useState } from 'react'
import { Briefcase, Calendar, BarChart2, Settings, Scale, LogOut, FileSearch, FolderOpen, CheckSquare, Mail, KeyRound } from 'lucide-react'
import { messagesApi } from '@/api/messages'
import { cn } from '@/utils/helpers'
import { NAV_ITEMS } from '@/constants'
import { useAuthStore } from '@/store/useAuthStore'
import { canSeeCases, canSeeAllContracts } from '@/api/auth'
import { ChangePasswordModal } from '@/components/auth/ChangePasswordModal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Briefcase, Calendar, BarChart2, Settings, FileSearch, FolderOpen, CheckSquare,
}

interface SidebarProps {
  activeNav: string
  onNavChange: (id: string) => void
  messagesOpen?: boolean
  onToggleMessages?: () => void
}

export function Sidebar({ activeNav, onNavChange, messagesOpen, onToggleMessages }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const [pwdOpen, setPwdOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const { count } = await messagesApi.unreadCount()
        if (alive) setUnreadCount(count)
      } catch { /* ignore */ }
    }
    if (!user?.isAllCompaniesView) tick()    // 汇总视图没有未读消息概念
    const t = setInterval(tick, 30_000)
    // 读消息/删消息后立即刷新（不必等轮询）
    const onChange = () => { if (!user?.isAllCompaniesView) tick() }
    window.addEventListener('messages:unread-changed', onChange)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('messages:unread-changed', onChange)
    }
  }, [user?.isAllCompaniesView, user?.currentCompanyId])

  const viewCases = canSeeCases(user)
  const viewContracts = canSeeAllContracts(user) || !!(user?.companyRoles?.length)
  const displayLabel = user?.displayName || user?.username || '未登录'
  const initial = (user?.displayName?.[0] || user?.username?.[0] || 'U').toUpperCase()
  const roleLabel = user?.isAllCompaniesView ? '汇总视图' : (user?.currentCompany?.companyName || '')

  // 隐藏没权限的菜单
  const visibleItems = NAV_ITEMS.filter((it) => {
    if ('requiresCaseAccess' in it && it.requiresCaseAccess && !viewCases) return false
    if ('requiresContractAccess' in it && it.requiresContractAccess && !viewContracts) return false
    return true
  })

  return (
    <>
      <aside className="flex h-full w-56 flex-col border-r border-slate-200/80 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 shrink-0">
            <Scale size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 leading-tight truncate">GlobalX</p>
            <p className="text-[11px] text-slate-400 leading-tight truncate">法律事务管理系统</p>
          </div>
          {onToggleMessages && !user?.isAllCompaniesView && (
            <button
              onClick={onToggleMessages}
              title={messagesOpen ? '关闭消息中心' : '打开消息中心'}
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors shrink-0',
                messagesOpen
                  ? 'bg-primary-600 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              <Mail size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            工作台
          </p>

          {visibleItems.map((item) => {
            const Icon = ICON_MAP[item.icon]
            const isActive = activeNav === item.id
            const soon = 'soon' in item && item.soon === true
            return (
              <button
                key={item.id}
                onClick={() => !soon && onNavChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  soon && 'cursor-default opacity-50',
                )}
              >
                <Icon size={16} className={isActive ? 'text-primary-600' : 'text-slate-400'} />
                <span className="flex-1 text-left">{item.label}</span>
                {soon && (
                  <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
                    即将上线
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
            <div className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0',
              'bg-primary-100 text-primary-700',
            )}>
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-700 truncate">{displayLabel}</p>
              <p className="text-[11px] text-slate-400 truncate">{roleLabel}</p>
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

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
    </>
  )
}
