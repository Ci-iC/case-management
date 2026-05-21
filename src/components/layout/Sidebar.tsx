import { useEffect, useState } from 'react'
import { Briefcase, Calendar, BarChart2, Settings, Scale, LogOut, Users, FileSearch, Workflow, FolderOpen, CheckSquare, Mail } from 'lucide-react'
import { messagesApi } from '@/api/messages'
import { cn } from '@/utils/helpers'
import { NAV_ITEMS } from '@/constants'
import { useAuthStore } from '@/store/useAuthStore'
import { isAdminOrAbove, isSuperAdmin } from '@/api/auth'
import { UsersAdminModal } from '@/components/admin/UsersAdminModal'
import { SystemSettingsModal } from '@/components/admin/SystemSettingsModal'
import { PipelinesAdminModal } from '@/components/admin/PipelinesAdminModal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Briefcase, Calendar, BarChart2, Settings, FileSearch, FolderOpen, CheckSquare,
}

interface SidebarProps {
  activeNav: string
  onNavChange: (id: string) => void
  /** v1.3.1 把消息按钮挪到 Sidebar 顶部，由父组件控制开关 */
  messagesOpen?: boolean
  onToggleMessages?: () => void
}

export function Sidebar({ activeNav, onNavChange, messagesOpen, onToggleMessages }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const [usersOpen, setUsersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pipelinesOpen, setPipelinesOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // 30 秒轮询未读数（沿用原 TopBar 的策略）
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const { count } = await messagesApi.unreadCount()
        if (alive) setUnreadCount(count)
      } catch { /* ignore */ }
    }
    tick()
    const t = setInterval(tick, 30_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const isAdmin = isAdminOrAbove(user)        // 管理员或超管：能看全部台账
  const isSuper = isSuperAdmin(user)          // 仅超管：能进系统配置
  const canViewCases = !!user?.canViewCases || isAdmin
  const canViewContracts = !!user?.canViewContracts || isAdmin
  const displayLabel = user?.displayName || user?.username || '未登录'
  const initial = (user?.displayName?.[0] || user?.username?.[0] || 'U').toUpperCase()
  const roleLabel = isSuper ? '超级管理员' : (user?.role === 'admin' ? '管理员' : '普通用户')

  // 隐藏没权限的菜单
  const visibleItems = NAV_ITEMS.filter((it) => {
    if ('requiresCaseAccess' in it && it.requiresCaseAccess && !canViewCases) return false
    if ('requiresContractAccess' in it && it.requiresContractAccess && !canViewContracts) return false
    return true
  })

  return (
    <>
      <aside className="flex h-full w-56 flex-col border-r border-slate-200/80 bg-white">
        {/* Brand + 消息按钮（v1.3.1 从 TopBar 挪过来，加大且紧贴系统名称） */}
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 shrink-0">
            <Scale size={16} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 leading-tight truncate">GlobalX</p>
            <p className="text-[11px] text-slate-400 leading-tight truncate">法律事务管理系统</p>
          </div>
          {onToggleMessages && (
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

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            工作台
          </p>

          {visibleItems.map((item) => {
            const Icon = ICON_MAP[item.icon]
            const isActive = activeNav === item.id
            const soon = 'soon' in item && item.soon
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

          {isSuper && (
            <>
              <p className="px-2 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                系统管理
              </p>
              <button
                onClick={() => setUsersOpen(true)}
                className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                <Users size={16} className="text-slate-400" />
                <span className="flex-1 text-left">用户管理</span>
              </button>
              <button
                onClick={() => setPipelinesOpen(true)}
                className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                <Workflow size={16} className="text-slate-400" />
                <span className="flex-1 text-left">审核模型</span>
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                <Settings size={16} className="text-slate-400" />
                <span className="flex-1 text-left">系统设置</span>
              </button>
            </>
          )}
        </nav>

        {/* Footer (user info + logout) */}
        <div className="border-t border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
            <div className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0',
              isSuper ? 'bg-rose-100 text-rose-700'
                : isAdmin ? 'bg-amber-100 text-amber-700'
                : 'bg-primary-100 text-primary-700',
            )}>
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-700 truncate">{displayLabel}</p>
              <p className="text-[11px] text-slate-400 truncate">{roleLabel}</p>
            </div>
            <button
              onClick={() => {
                if (window.confirm('确认退出登录？')) logout()
              }}
              title="退出登录"
              className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <UsersAdminModal open={usersOpen} onClose={() => setUsersOpen(false)} />
      <SystemSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PipelinesAdminModal open={pipelinesOpen} onClose={() => setPipelinesOpen(false)} />
    </>
  )
}
