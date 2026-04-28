import { useEffect, useState } from 'react'
import { Send, X, Paperclip, FileText, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { messagesApi } from '@/api/messages'
import { useCaseStore } from '@/store/useCaseStore'
import { useAuthStore } from '@/store/useAuthStore'
import { ApiError } from '@/api/client'
import type { Contact, ReviewRecord } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onSent?: () => void
  /** 预填 review（合同审核 → 发送给法务审核 流程） */
  prefillReview?: ReviewRecord
  /** 预填案件 */
  prefillCaseId?: string
}

export function ComposeMessageDialog({ open, onClose, onSent, prefillReview, prefillCaseId }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [receiverId, setReceiverId] = useState<string>('')
  const [receiverLabel, setReceiverLabel] = useState<string>('')
  const [body, setBody] = useState('')
  const [caseId, setCaseId] = useState<string>('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cases = useCaseStore(s => s.cases)
  const myRole = useAuthStore(s => s.user?.role)
  const canViewCases = useAuthStore(s => !!s.user?.canViewCases) || myRole === 'admin'
  const isAdmin = myRole === 'admin'

  // admin 才能选收件人；普通用户固定发给法务（第一个 admin）
  // 合同审核「发送给法务审核」即使是 admin 也固定流向（产品决策：消息流向只有"业务人员 → 法务"）
  const lockReceiver = !!prefillReview || !isAdmin
  const isLegalSubmission = !!prefillReview

  // 重置 + 加载联系人
  useEffect(() => {
    if (!open) return
    setError(null)
    setBody(prefillReview ? buildPrefillBody(prefillReview) : '')
    setCaseId(prefillCaseId || prefillReview?.caseId || '')
    setAttachments([])

    messagesApi.contacts()
      .then(({ contacts }) => {
        setContacts(contacts)
        if (lockReceiver) {
          // 普通用户 / 法务回传：自动选第一个 admin
          const firstAdmin = contacts.find(c => c.role === 'admin')
          if (firstAdmin) {
            setReceiverId(firstAdmin.id)
            setReceiverLabel(firstAdmin.displayName || firstAdmin.username)
          } else {
            setError('系统中没有可用的法务/管理员账号')
          }
        } else {
          // admin 可选收件人，默认空
          setReceiverId('')
          setReceiverLabel('')
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : '加载联系人失败'))
  }, [open, prefillReview, prefillCaseId, lockReceiver])

  function buildPrefillBody(r: ReviewRecord): string {
    return `麻烦帮忙审核一下「${r.uploadedFilename}」。\n\nAI 已经过了一遍，意见见下方折叠区。我自己想要你再确认的点：\n（请补充）`
  }

  const dialogTitle = isLegalSubmission ? '发送给法务审核' : '发送消息'

  function addFiles(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files).slice(0, 10 - attachments.length)
    setAttachments(prev => [...prev, ...arr].slice(0, 10))
  }

  function removeFile(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  async function onSubmit() {
    if (!receiverId) {
      setError(lockReceiver ? '系统中没有可用的法务账号，请联系管理员' : '请选择收件人')
      return
    }
    if (!body.trim()) { setError('请填写留言'); return }

    setSubmitting(true)
    setError(null)
    try {
      await messagesApi.send({
        receiverId,
        body: body.trim(),
        caseId: caseId || undefined,
        reviewId: prefillReview?.id,
        attachments,
      })
      onSent?.()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '发送失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl rounded-xl bg-white shadow-modal animate-fade-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{dialogTitle}</h3>
            {prefillReview && (
              <p className="mt-0.5 text-xs text-slate-400">
                附带 AI 审核记录「{prefillReview.uploadedFilename}」+ 你写的留言
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 收件人 */}
          <Field label="收件人">
            {lockReceiver ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span>📧 法务{receiverLabel ? ` · ${receiverLabel}` : ''}</span>
                <span className="ml-auto text-[10px] text-slate-400">系统固定收件人</span>
              </div>
            ) : (
              <select
                className="form-select"
                value={receiverId}
                onChange={e => setReceiverId(e.target.value)}
              >
                <option value="">请选择…</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || c.username}（{c.username}）{c.role === 'admin' ? ' · 管理员' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* 关联案件（仅消息中心普通发消息 + admin 才显示；合同审核场景隐藏） */}
          {canViewCases && !isLegalSubmission && (
            <Field label="关联案件（可选）">
              <select className="form-select" value={caseId} onChange={e => setCaseId(e.target.value)}>
                <option value="">不关联</option>
                {cases.map(c => (
                  <option key={c.id} value={c.id}>{c.caseNumber} · {c.caseName}</option>
                ))}
              </select>
            </Field>
          )}

          {/* 引用审核（只显示摘要：原文件名 + 各层级条款数量） */}
          {prefillReview && (
            <Field label="引用审核意见">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-700 mb-1">{prefillReview.uploadedFilename}</p>
                <p className="text-[11px] text-slate-500">{summarizeReview(prefillReview.reviewText)}</p>
                <p className="text-[10px] text-slate-400 mt-1">完整意见会随消息一起发给法务</p>
              </div>
            </Field>
          )}

          {/* 留言 */}
          <Field label="留言" required>
            <textarea
              className="form-textarea"
              rows={5}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="写几句给收件人的话…"
            />
          </Field>

          {/* 附件 */}
          <Field label={`附件（最多 10 个，已选 ${attachments.length}）`}>
            <label className="flex items-center gap-2 rounded-md border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer hover:border-slate-300">
              <Paperclip size={16} className="text-slate-400" />
              <span className="text-sm text-slate-500">点击添加附件</span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={e => { addFiles(e.target.files); e.target.value = '' }}
              />
            </label>
            {attachments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {attachments.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1.5 text-xs">
                    <FileText size={12} className="text-slate-400 shrink-0" />
                    <span className="flex-1 truncate text-slate-700">{f.name}</span>
                    <span className="text-slate-400">{(f.size / 1024).toFixed(1)}KB</span>
                    <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          {error && (
            <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="primary" size="md" icon={<Send size={14} />} loading={submitting} onClick={onSubmit}>
            {isLegalSubmission ? '发送给法务审核' : '发送'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function summarizeReview(text: string): string {
  try {
    const obj = JSON.parse(text)
    if (Array.isArray(obj?.review_opinions)) {
      const parts = obj.review_opinions.map((l: { level: string; items: unknown[] }) =>
        `${l.level} ${Array.isArray(l.items) ? l.items.length : 0} 条`
      )
      return parts.join(' · ')
    }
  } catch { /* 旧数据回落 */ }
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  )
}
