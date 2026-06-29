import { useState } from 'react'
import { Mail, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  open: boolean
  /** 点"知道了" / 关闭：标记已看过 */
  onDismiss: () => void
  /** 点"去设置"：标记已看过并打开通知邮箱设置 */
  onGoSettings: () => void
}

/** 版本更新后首次登录的功能介绍弹窗：介绍"邮件通知"新功能，引导用户去设置通知邮箱。 */
export function EmailFeatureNoticeModal({ open, onDismiss, onGoSettings }: Props) {
  const [busy, setBusy] = useState(false)
  if (!open) return null

  async function handle(action: () => void) {
    setBusy(true)
    try { action() } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white shadow-modal animate-fade-in overflow-hidden">
        <div className="bg-gradient-to-br from-primary-500 to-primary-600 px-6 py-5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <BellRing size={18} />
            </div>
            <h3 className="text-base font-semibold">新功能：邮件通知</h3>
          </div>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed">
            现在你可以填写一个<strong>通知邮箱</strong>，当系统里有新的站内信（审批流转、法务审核结果、同事留言等）时，
            会同时给你发一封邮件提醒，不用一直盯着系统也不会错过重要消息。
          </p>
          <ul className="text-[13px] text-slate-600 space-y-1.5 pl-1">
            <li className="flex gap-2"><Mail size={15} className="mt-0.5 shrink-0 text-primary-500" />邮箱可与登录账号不同，随时可改</li>
            <li className="flex gap-2"><Mail size={15} className="mt-0.5 shrink-0 text-primary-500" />可随时开关，留空则不发送</li>
          </ul>
          <p className="text-[11px] text-slate-400">
            入口：左下角头像旁的「通知邮箱」按钮，随时可设置。
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="secondary" size="md" disabled={busy} onClick={() => handle(onDismiss)}>稍后再说</Button>
          <Button variant="primary" size="md" disabled={busy} onClick={() => handle(onGoSettings)}>去设置邮箱</Button>
        </div>
      </div>
    </div>
  )
}
