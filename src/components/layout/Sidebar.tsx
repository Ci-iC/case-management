import { useState } from 'react'
import { Briefcase, Calendar, BarChart2, Settings, Scale, LogOut, Users } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { NAV_ITEMS } from '@/constants'
import { useAuthStore } from '@/store/useAuthStore'
import { UsersAdminModal } from '@/components/admin/UsersAdminModal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Briefcase, Calendar, BarChart2, Settings,
}

interface SidebarProps {
  activeNav: string
  onNavChange: (id: string) => void
}

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  const { user, logout } = useAuthStore()
  const [usersOpen, setUsersOpen] = useState(false)

  const isAdmin = user?.role === 'admin'
  const displayLabel = user?.displayName || user?.username || '未登录'
  const initial = (user?.displayName?.[0] || user?.username?.[0] || 'U').toUpperCase()

  return (
    <>
      <aside className="flex h-full w-56 flex-col border-r border-slate-200/80 bg-white">
        {/* Brand */}
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
            <Scale size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">天弘矿业</p>
            <p className="text-[11px] text-slate-400 leading-tight">案件台账管理系统</p>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            工作台
          </p>

          {NAV_ITEMS.map((item) => {
            const Icon = ICON_MAP[item.icon]
            const isActive = activeNav === item.id
            return (
              <button
                key={item.id}
                onClick={() => !item.soon && onNavChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  item.soon && 'cursor-default opacity-50',
                )}
              >
                <Icon size={16} className={isActive ? 'text-primary-600' : 'text-slate-400'} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.soon && (
                  <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">
                    即将上线
                  </span>
                )}
              </button>
            )
          })}

          {isAdmin && (
            <>
              <p className="px-2 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                管理
              </p>
              <button
                onClick={() => setUsersOpen(true)}
                className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                <Users size={16} className="text-slate-400" />
                <span className="flex-1 text-left">用户管理</span>
              </button>
            </>
          )}
        </nav>

        {/* Footer (user info + logout) */}
        <div className="border-t border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
            <div className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shrink-0',
              isAdmin ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700',
            )}>
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-700 truncate">{displayLabel}</p>
              <p className="text-[11px] text-slate-400 truncate">
                {isAdmin ? '管理员' : '普通用户'}
              </p>
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
    </>
  )
}
