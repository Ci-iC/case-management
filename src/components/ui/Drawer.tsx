import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/helpers'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  headerActions?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}

/**
 * A right-side slide-in drawer component.
 * Closes on Escape key and backdrop click.
 */
export function Drawer({
  open, onClose, title, subtitle, headerActions, children, footer,
  width = 'w-[680px]',
}: DrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/20 animate-fade-in cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={cn(
          'flex flex-col bg-white shadow-drawer animate-slide-in-right',
          'h-full overflow-hidden',
          width,
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="text-base font-semibold text-slate-900 leading-snug truncate">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-slate-500 truncate">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerActions}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body – scrollable */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 border-t border-slate-100 px-6 py-3 bg-slate-50/80">
            {footer}
          </div>
        )}
      </aside>
    </div>
  )
}
