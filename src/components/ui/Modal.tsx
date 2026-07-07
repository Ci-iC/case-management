import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'

// ─── Generic Modal ─────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <div className="relative z-10 flex w-auto max-w-[95vw] max-h-[90dvh] flex-col rounded-xl bg-white shadow-modal animate-fade-in">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 sm:px-6 py-3.5 sm:py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="ml-4 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>
        {/* Body：移动端弹窗常超屏高，自身滚动 */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: React.ReactNode
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}

/** Simple confirmation modal */
export function ConfirmModal({
  open, onClose, onConfirm,
  title, message,
  confirmLabel = '确认',
  confirmVariant = 'primary',
  loading,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white shadow-modal animate-fade-in">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <X size={16} />
        </button>

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle size={20} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{message}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="secondary" size="md" onClick={onClose}>取消</Button>
          <Button variant={confirmVariant} size="md" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
