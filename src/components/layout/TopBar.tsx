import { useEffect, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { messagesApi } from '@/api/messages'
import { useAuthStore } from '@/store/useAuthStore'
import { cn } from '@/utils/helpers'

interface Props {
  active: boolean
  onClick: () => void
}

const POLL_INTERVAL = 30_000

export function TopBar({ active, onClick }: Props) {
  const status = useAuthStore(s => s.status)
  const [unread, setUnread] = useState(0)
  const timer = useRef<number | null>(null)

  async function fetchUnread() {
    try {
      const { count } = await messagesApi.unreadCount()
      setUnread(count)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (status !== 'authed') return
    fetchUnread()
    timer.current = window.setInterval(fetchUnread, POLL_INTERVAL)
    // 读消息/删消息后立即刷新（不必等轮询）
    const onChange = () => fetchUnread()
    window.addEventListener('messages:unread-changed', onChange)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      window.removeEventListener('messages:unread-changed', onChange)
    }
  }, [status])

  // 当用户点开消息中心后，本地立即清零（详情页还会再触发一次刷新）
  useEffect(() => {
    if (active) fetchUnread()
  }, [active])

  return (
    <header className="flex h-12 items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 shrink-0">
      <button
        onClick={onClick}
        title="消息中心"
        className={cn(
          'relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
          active
            ? 'bg-primary-50 text-primary-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        <Mail size={16} className={active ? 'text-primary-600' : 'text-slate-500'} />
        <span>消息</span>
        {unread > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </header>
  )
}
