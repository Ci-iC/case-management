// 点击"开始审核"后弹出的参数对话框：让用户选我方立场 + 审核幅度，确认后才真正提交。

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/helpers'

export type Intensity = 'strict' | 'medium' | 'lenient'
export type RoleMode = 'party_a' | 'party_b' | 'custom'

const ROLE_PRESET: Record<Exclude<RoleMode, 'custom'>, string> = {
  party_a: '甲方',
  party_b: '乙方',
}

const INTENSITY_OPTS: { value: Intensity; label: string; desc: string }[] = [
  { value: 'strict',  label: '严格', desc: '严格的审核标准，尽可能争取我方利益' },
  { value: 'medium',  label: '中等', desc: '常规企业法务标准' },
  { value: 'lenient', label: '宽松', desc: '只标明显的法律 / 商业风险' },
]

interface Props {
  open: boolean
  submitLabel: string                                                   // "发起审核" / "智能审核"
  onCancel: () => void
  onConfirm: (params: { ourRole: string; reviewIntensity: Intensity }) => void
  loading?: boolean
}

export function ReviewParamsDialog({ open, submitLabel, onCancel, onConfirm, loading }: Props) {
  const [roleMode, setRoleMode] = useState<RoleMode>('party_a')
  const [customRole, setCustomRole] = useState('')
  const [intensity, setIntensity] = useState<Intensity>('medium')
  const [error, setError] = useState<string | null>(null)

  // 每次打开都重置错误（保留上次的选择，方便连续审核）
  useEffect(() => {
    if (open) setError(null)
  }, [open])

  if (!open) return null

  function handleConfirm() {
    let ourRole = ''
    if (roleMode === 'custom') {
      const v = customRole.trim()
      if (!v) { setError('请填写我方立场'); return }
      if (v.length > 50) { setError('立场名称不要超过 50 个字'); return }
      ourRole = v
    } else {
      ourRole = ROLE_PRESET[roleMode]
    }
    onConfirm({ ourRole, reviewIntensity: intensity })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={loading ? undefined : onCancel} />

      <div className="relative z-10 w-full max-w-lg rounded-xl bg-white shadow-modal animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary-600" />
            <h3 className="text-base font-semibold text-slate-900">设置审核参数</h3>
          </div>
          <button onClick={onCancel} disabled={loading} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* 我方立场 */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-700">
              我方立场
            </label>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 mb-2">
              {([
                { v: 'party_a' as RoleMode, label: '甲方' },
                { v: 'party_b' as RoleMode, label: '乙方' },
                { v: 'custom'  as RoleMode, label: '自定义' },
              ]).map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setRoleMode(opt.v)}
                  className={cn(
                    'flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
                    roleMode === opt.v
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {roleMode === 'custom' && (
              <input
                type="text"
                className="form-input"
                value={customRole}
                onChange={e => setCustomRole(e.target.value)}
                placeholder='请填写我方立场，如"第三方"、"赞助方"、"承包方"'
                autoFocus
                maxLength={50}
              />
            )}
            <p className="mt-1.5 text-[11px] text-slate-400">
              AI 会从我方视角找对我方不利的条款。
            </p>
          </div>

          {/* 审核幅度 */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-700">
              审核幅度
            </label>
            <div className="space-y-2">
              {INTENSITY_OPTS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setIntensity(opt.value)}
                  className={cn(
                    'w-full rounded-md border text-left px-3 py-2 transition-colors',
                    intensity === opt.value
                      ? 'border-primary-300 bg-primary-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'h-3.5 w-3.5 shrink-0 rounded-full border-2',
                      intensity === opt.value ? 'border-primary-600 bg-primary-600' : 'border-slate-300',
                    )} />
                    <span className="text-sm font-medium text-slate-800">{opt.label}</span>
                    <span className="text-[11px] text-slate-400">— {opt.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={loading}>取消</Button>
          <Button variant="primary" size="md" loading={loading} onClick={handleConfirm}>
            {loading ? '审核中…' : `确认并${submitLabel}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
