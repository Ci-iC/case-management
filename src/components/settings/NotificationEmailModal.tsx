import { useEffect, useState } from 'react'
import { Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/useAuthStore'

interface Props {
  open: boolean
  onClose: () => void
}

/** 个人设置：通知邮箱 + 邮件通知开关。所有用户可用。 */
export function NotificationEmailModal({ open, onClose }: Props) {
  const { user, updateProfile } = useAuthStore()
  const [emailValue, setEmailValue] = useState('')
  const [notifyEnabled, setNotifyEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setEmailValue(user?.notificationEmail || '')
    setNotifyEnabled(user?.emailNotifyEnabled !== false)
    setError(null)
    setFlash(null)
  }, [open, user])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await updateProfile({ notificationEmail: emailValue.trim(), emailNotifyEnabled: notifyEnabled })
      setFlash('已保存')
      setTimeout(() => { setFlash(null); onClose() }, 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="通知邮箱设置">
      <div className="w-[420px] max-w-full space-y-4">
        {flash && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 size={14} /> {flash}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        <p className="text-xs text-slate-500 leading-relaxed">
          填写后，当你在系统里收到新的站内信（如审批流转、法务审核结果等）时，会同时收到一封邮件提醒。
          该邮箱可与登录账号无关；留空则不发送邮件。
        </p>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">通知邮箱</label>
          <input
            type="email"
            className="form-input"
            disabled={saving}
            value={emailValue}
            placeholder="you@example.com"
            onChange={(e) => setEmailValue(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={notifyEnabled}
            disabled={saving}
            onChange={(e) => setNotifyEnabled(e.target.checked)}
          />
          接收邮件通知
          <span className="text-[11px] text-slate-400">（关闭后即使填了邮箱也不会发）</span>
        </label>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>取消</Button>
          <Button variant="primary" size="md" icon={<Save size={14} />} loading={saving} onClick={save}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}
