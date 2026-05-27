import { useEffect, useState } from 'react'
import { Send, X, Paperclip, FileText, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { messagesApi } from '@/api/messages'
import { reviewsApi } from '@/api/reviews'
import { contractsApi } from '@/api/contracts'
import { useCaseStore } from '@/store/useCaseStore'
import { useAuthStore } from '@/store/useAuthStore'
import { canSeeCases } from '@/api/auth'
import { ApiError } from '@/api/client'
import type { Contact, ReviewRecord, ContractRecord } from '@/types'

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
  const [body, setBody] = useState('')
  const [caseId, setCaseId] = useState<string>('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // v1.2：发送给法务时选合同
  const [contractMode, setContractMode] = useState<'new' | 'existing'>('new')
  const [contractName, setContractName] = useState<string>('')
  const [contractId, setContractId] = useState<string>('')
  const [contracts, setContracts] = useState<ContractRecord[]>([])

  const cases = useCaseStore(s => s.cases)
  const me = useAuthStore(s => s.user)
  const canViewCases = canSeeCases(me)

  // v2.0：合同审核「发送给法务审核」时不再锁定收件人，而是过滤为本公司法务岗用户让用户选。
  const isLegalSubmission = !!prefillReview
  // v2.1+: 法务本人也能把审核提交给自己（自己审自己）
  const meIsLegal = (me?.companyRoles || []).includes('legal')

  // 重置 + 加载联系人
  useEffect(() => {
    if (!open) return
    setError(null)
    setBody(prefillReview ? buildPrefillBody(prefillReview) : '')
    setCaseId(prefillCaseId || prefillReview?.caseId || '')
    setAttachments([])
    setContractMode('new')
    setContractName('')
    setContractId('')
    setContracts([])

    messagesApi.contacts()
      .then(({ contacts }) => {
        setContacts(contacts)
        // v2.0：不再自动锁定收件人。发送给法务审核场景由下拉过滤为法务岗用户，用户手动选。
        setReceiverId('')
        if (isLegalSubmission) {
          // 算上"自己"（如果当前用户本身是法务）
          const legalCount = contacts.filter(c => (c.roles || []).includes('legal')).length + (meIsLegal ? 1 : 0)
          if (legalCount === 0) {
            setError('本公司没有可用的法务岗用户，请联系平台超管分配')
          }
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : '加载联系人失败'))

    // 仅"发送给法务审核"模式下加载已有未审批合同
    if (prefillReview) {
      contractsApi.list({ onlyUnapproved: true })
        .then(({ contracts }) => setContracts(contracts))
        .catch(e => console.error('加载已有合同失败', e))
    }
  }, [open, prefillReview, prefillCaseId, isLegalSubmission, meIsLegal])

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
      setError(isLegalSubmission ? '请选择法务岗收件人' : '请选择收件人')
      return
    }
    if (!body.trim()) { setError('请填写留言'); return }

    // v1.2：发送给法务审核时强制选合同
    if (isLegalSubmission) {
      if (contractMode === 'new' && !contractName.trim()) {
        setError('请填写合同名称（系统会自动分配编号）')
        return
      }
      if (contractMode === 'existing' && !contractId) {
        setError('请选择已有合同，或切换到"新合同"')
        return
      }
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isLegalSubmission && prefillReview) {
        await reviewsApi.submitToLegal(prefillReview.id, {
          contractMode,
          contractName: contractMode === 'new' ? contractName.trim() : undefined,
          contractId: contractMode === 'existing' ? contractId : undefined,
          receiverId,
          body: body.trim(),
          attachments,
        })
      } else {
        await messagesApi.send({
          receiverId,
          body: body.trim(),
          caseId: caseId || undefined,
          attachments,
        })
      }
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
          {/* v1.2：发送给法务审核时选合同 */}
          {isLegalSubmission && (
            <Field label="合同" required>
              <div className="space-y-2">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit">
                  {(['new', 'existing'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setContractMode(m)}
                      className={
                        'rounded px-3 py-1 text-xs font-medium transition-colors ' +
                        (contractMode === m
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700')
                      }
                    >
                      {m === 'new' ? '新合同' : '已有合同（追加新版本）'}
                    </button>
                  ))}
                </div>

                {contractMode === 'new' ? (
                  <>
                    <input
                      type="text"
                      className="form-input"
                      value={contractName}
                      onChange={e => setContractName(e.target.value)}
                      placeholder='给这份合同起个名字，如"采购合同 - 某供应商"'
                    />
                    <p className="text-[11px] text-slate-400">
                      提交后系统自动分配编号 <span className="font-mono">YYYY-HT-NNNN</span>（按当年序号递增）
                    </p>
                  </>
                ) : (
                  <>
                    <select
                      className="form-select"
                      value={contractId}
                      onChange={e => setContractId(e.target.value)}
                    >
                      <option value="">选择已有合同…</option>
                      {contracts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {c.name}（已审 {c.versionCount} 次）
                        </option>
                      ))}
                    </select>
                    {contracts.length === 0 && (
                      <p className="text-[11px] text-amber-600">
                        当前没有可关联的合同（已发起审批的合同不可再追加版本）。请切换到"新合同"。
                      </p>
                    )}
                  </>
                )}
              </div>
            </Field>
          )}

          {/* 收件人 */}
          <Field label={isLegalSubmission ? '法务岗收件人' : '收件人'}>
            <select
              className="form-select"
              value={receiverId}
              onChange={e => setReceiverId(e.target.value)}
            >
              <option value="">{isLegalSubmission ? '请选择法务岗用户…' : '请选择…'}</option>
              {/* v2.1+: 法务本人可把审核提交给自己 */}
              {isLegalSubmission && meIsLegal && me && (
                <option value={me.id}>
                  {me.displayName || me.username}（{me.username}） · 法务岗 · 我自己
                </option>
              )}
              {contacts
                .filter(c => isLegalSubmission ? (c.roles || []).includes('legal') : true)
                .map(c => {
                  const roleLabels: Record<string, string> = {
                    manager: '企业管理人员', legal: '法务岗', seal_admin: '印章管理',
                    finance: '财务人员', staff: '普通员工',
                  }
                  const rolesText = (c.roles || []).map(r => roleLabels[r] || r).join(' · ')
                  return (
                    <option key={c.id} value={c.id}>
                      {c.displayName || c.username}（{c.username}）{rolesText ? ` · ${rolesText}` : ''}
                    </option>
                  )
                })}
            </select>
            {isLegalSubmission && (
              <p className="mt-1 text-[11px] text-slate-400">仅显示本公司「法务岗」角色的用户</p>
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
