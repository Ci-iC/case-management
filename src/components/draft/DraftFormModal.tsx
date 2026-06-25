import { useRef, useState } from 'react'
import { Upload, X, FileText } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { DRAFT_FORM_FIELDS } from '@/api/draft'

export interface DraftFormPayload {
  /** 7 项字段拼成的结构化文本（作为第一条消息发给 AI） */
  text: string
  /** 随表单一起上传的补充材料 */
  files: File[]
}

interface DraftFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: DraftFormPayload) => void
}

/** 「起草合同」快捷按钮弹出的表单：7 项必填 + 补充说明 + 材料上传 */
export function DraftFormModal({ open, onClose, onSubmit }: DraftFormModalProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setValues({})
    setNote('')
    setFiles([])
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function pickFiles(list: FileList | null) {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 5))
  }

  function submit() {
    const missing = DRAFT_FORM_FIELDS.filter((f) => !values[f.key]?.trim())
    if (missing.length > 0) {
      setError(`请填写：${missing.map((f) => f.label).join('、')}`)
      return
    }
    // 拼成结构化文本，作为第一条消息发给 AI
    const lines = DRAFT_FORM_FIELDS.map((f) => `${f.label}：${values[f.key].trim()}`)
    if (note.trim()) lines.push(`其他补充说明：${note.trim()}`)
    const text = `我要起草一份合同，以下是基本信息：\n${lines.join('\n')}`
    onSubmit({ text, files })
    reset()
  }

  return (
    <Modal open={open} onClose={handleClose} title="起草合同 · 填写基本信息">
      <div className="w-[560px] max-w-full space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {DRAFT_FORM_FIELDS.map((f) => (
            <div key={f.key} className={f.key === 'subject' || f.key === 'payment' ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {f.label} <span className="text-red-500">*</span>
              </label>
              <input
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">其他补充说明（选填）</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="特殊条款、交付要求、违约约定等任何需要补充的内容"
            className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm resize-none focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">补充材料（选填，Word/txt，最多 5 个）</label>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".doc,.docx,.txt"
            className="hidden"
            onChange={(e) => { pickFiles(e.target.files); if (fileRef.current) fileRef.current.value = '' }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-primary-400 hover:text-primary-600 w-full justify-center"
          >
            <Upload size={15} /> 点击选择文件
          </button>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  <FileText size={13} className="text-slate-400 shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={handleClose}>取消</Button>
          <Button variant="primary" onClick={submit}>确认，开始引导</Button>
        </div>
      </div>
    </Modal>
  )
}
