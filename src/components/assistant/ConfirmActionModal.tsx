import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/helpers'
import type { ActionField, PendingAction } from '@/api/assistant'

interface ConfirmActionModalProps {
  open: boolean
  action: PendingAction | null
  loading?: boolean
  /** 用户在确认框里编辑后的最终取值（key → value），回填到 args */
  onConfirm: (values: Record<string, string>) => void
  onCancel: () => void
}

const CUSTOM = '__custom__'

/** 写操作确认框：AI 给出待确认事项（填空 / 选择），用户可直接确认或修改后确认 */
export function ConfirmActionModal({ open, action, loading, onConfirm, onCancel }: ConfirmActionModalProps) {
  const fields = (action?.fields || []).filter(Boolean) as ActionField[]
  const editable = fields.filter((f) => f.type !== 'readonly')

  // 表单取值 + “自定义”分支的额外输入
  const [values, setValues] = useState<Record<string, string>>({})
  const [customSel, setCustomSel] = useState<Record<string, boolean>>({})  // select 是否选了“自定义”
  const [error, setError] = useState<string | null>(null)

  // 每次打开（或换了一个 action）都用字段默认值重新初始化
  useEffect(() => {
    if (!open || !action) return
    const init: Record<string, string> = {}
    const cust: Record<string, boolean> = {}
    for (const f of fields) {
      init[f.key] = f.value ?? ''
      if (f.type === 'select' && f.allowCustom && f.value && !(f.options || []).some((o) => o.value === f.value)) {
        cust[f.key] = true   // 默认值不在选项里 → 视为自定义
      }
    }
    setValues(init)
    setCustomSel(cust)
    setError(null)
  }, [open, action])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !action) return null

  function setVal(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  // 条件显隐：仅当依赖字段的当前取值匹配时才显示（互斥字段靠它实现）
  function isVisible(f: ActionField): boolean {
    if (!f.showWhen) return true
    return String(values[f.showWhen.key] ?? '') === f.showWhen.value
  }

  function handleConfirm() {
    for (const f of editable) {
      if (isVisible(f) && f.required && !String(values[f.key] ?? '').trim()) {
        setError(`请填写「${f.label}」`)
        return
      }
    }
    // 收集最终值（只回传 editable + 当前可见 + 有值的；隐藏字段不提交，保证互斥）
    const out: Record<string, string> = {}
    for (const f of fields) {
      if (f.type === 'readonly') continue
      if (!isVisible(f)) continue
      const v = String(values[f.key] ?? '').trim()
      if (v) out[f.key] = v
    }
    onConfirm(out)
  }

  // 没有 fields → 退回旧的"摘要展示"（兼容尚未声明 fields 的工具，如 initiate_approval）
  const summary = action.summary
  const summaryEntries: [string, string][] = typeof summary === 'string'
    ? [['说明', summary]]
    : Object.entries(summary || {}).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={loading ? undefined : onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white shadow-modal animate-fade-in">
        <div className="px-6 pt-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle size={20} className="text-amber-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-900">确认执行：{action.label}</h3>
              <p className="mt-1 text-xs text-slate-400">请核对并按需修改以下事项，确认后将实际执行该操作。</p>
            </div>
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-6 py-4">
          {fields.length > 0 ? (
            <div className="space-y-4">
              {fields.filter(isVisible).map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? ''}
                  isCustom={!!customSel[f.key]}
                  disabled={!!loading}
                  onChange={(v) => setVal(f.key, v)}
                  onPickCustom={(on) => {
                    setCustomSel((prev) => ({ ...prev, [f.key]: on }))
                    if (on) setVal(f.key, '')
                  }}
                />
              ))}
            </div>
          ) : (
            <dl className="space-y-1.5">
              {summaryEntries.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-sm">
                  <dt className="shrink-0 text-slate-500">{k}：</dt>
                  <dd className="min-w-0 flex-1 break-words text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {error && <p className="mt-3 rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>取消</Button>
          <Button variant="primary" loading={loading} onClick={handleConfirm}>确认执行</Button>
        </div>
      </div>
    </div>
  )
}

function FieldRow({
  field, value, isCustom, disabled, onChange, onPickCustom,
}: {
  field: ActionField
  value: string
  isCustom: boolean
  disabled: boolean
  onChange: (v: string) => void
  onPickCustom: (on: boolean) => void
}) {
  const { type, label, options = [], allowCustom, placeholder, hint, required } = field

  if (type === 'readonly') {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 break-words">{value || '—'}</p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-700">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>

      {type === 'select' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const active = !isCustom && value === o.value
              return (
                <button
                  key={o.value} type="button" disabled={disabled}
                  onClick={() => { onPickCustom(false); onChange(o.value) }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                    active ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  {o.label || o.value}
                </button>
              )
            })}
            {allowCustom && (
              <button
                type="button" disabled={disabled}
                onClick={() => onPickCustom(true)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                  isCustom ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                自定义
              </button>
            )}
          </div>
          {allowCustom && isCustom && (
            <input
              type="text" disabled={disabled} value={value} autoFocus
              onChange={(e) => onChange(e.target.value)}
              placeholder="请填写自定义内容"
              className="form-input mt-2"
            />
          )}
          {options.length === 0 && !allowCustom && (
            <p className="text-xs text-amber-600">无可选项</p>
          )}
        </>
      )}

      {type === 'dropdown' && (
        options.length === 0 ? (
          <p className="text-xs text-amber-600">无可选项</p>
        ) : (
          <select
            disabled={disabled} value={value}
            onChange={(e) => onChange(e.target.value)}
            className="form-select"
          >
            <option value="">{placeholder || '请选择…'}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label || o.value}</option>
            ))}
          </select>
        )
      )}

      {type === 'text' && (
        <input
          type="text" disabled={disabled} value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="form-input"
        />
      )}

      {type === 'textarea' && (
        <textarea
          disabled={disabled} value={value} rows={3}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="form-input resize-none"
        />
      )}

      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
