import { useEffect, useState } from 'react'
import { Download, FileText, ChevronDown, ChevronUp, Sparkles, Check, X, UserPlus, Upload, Send, RefreshCcw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { approvalsApi, downloadSealedContract, downloadCleanContract } from '@/api/approvals'
import { reviewsApi } from '@/api/reviews'
import { messagesApi } from '@/api/messages'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import { isSuperAdmin } from '@/api/auth'
import { cn } from '@/utils/helpers'
import { CONTRACT_STATUS_BADGE, CONTRACT_STATUS_LABELS } from '@/constants'
import type { ApprovalDetail, ApprovalStep, Contact, ContractStatus } from '@/types'

interface Props {
  approvalId: string
  /** 操作执行后回调（关闭详情、刷新列表） */
  onActionDone?: () => void
}

export function ApprovalDetailView({ approvalId, onActionDone }: Props) {
  const me = useAuthStore(s => s.user)
  const [data, setData] = useState<ApprovalDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const d = await approvalsApi.get(approvalId)
      setData(d)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [approvalId])  // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) {
    return <div className="flex-1 flex items-center justify-center text-sm text-slate-400">加载中…</div>
  }
  if (error) {
    return <div className="m-6 rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</div>
  }
  if (!data) return null

  const { approval, steps, actions, contract, reviews } = data

  // 主链审批人 step（不含 consultee 和 final-initiator）
  const approverSteps = steps
    .filter(s => s.stepType === 'approver')
    .sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0))
  const finalStep = steps.find(s => s.stepType === 'final-initiator')
  const currentStep = steps.find(s => s.id === approval.currentStepId)
  const isMyTurn = currentStep && currentStep.assigneeId === me?.id && currentStep.status === 'pending'

  // 判断 final-initiator 当前是"被驳回等重提"还是"待用印版"
  const lastReject = [...actions].reverse().find(a => a.action === 'reject_to_step')
  const lastResubmit = [...actions].reverse().find(a => a.action === 'resubmit')
  const isInRejectedToInitiator =
    !!lastReject &&
    (!lastResubmit || new Date(lastReject.createdAt) > new Date(lastResubmit.createdAt))

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-w-5xl mx-auto w-full">
      {/* ─── 顶部：合同信息 + 进度条 ─────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3 mb-4">
          <FileText size={20} className="text-primary-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-sm text-primary-700 bg-primary-50 px-2 py-0.5 rounded">{contract.code}</span>
              <span className={cn(
                'rounded px-2 py-0.5 text-[11px] border',
                CONTRACT_STATUS_BADGE[contract.status as ContractStatus],
              )}>
                {CONTRACT_STATUS_LABELS[contract.status as ContractStatus]}
              </span>
              {approval.status === 'rejected' && (
                <span className="rounded bg-red-100 text-red-700 px-2 py-0.5 text-[11px]">本轮已驳回</span>
              )}
              {approval.status === 'completed' && (
                <span className="rounded bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px]">已完成</span>
              )}
            </div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">{contract.name}</h2>
            <p className="text-[11px] text-slate-400">
              发起人：{approval.initiatorDisplayName || approval.initiatorUsername} · {new Date(approval.createdAt).toLocaleString('zh-CN')}
            </p>
            {approval.initiationNote && (
              <p className="mt-1 text-xs text-slate-600 bg-slate-50 rounded px-2 py-1.5">
                <span className="text-slate-400">发起说明：</span>{approval.initiationNote}
              </p>
            )}
          </div>
        </div>

        {/* 进度条 */}
        <ProgressBar approverSteps={approverSteps} finalStep={finalStep} currentStepId={approval.currentStepId} />
      </section>

      {/* ─── 合同文件：主显示清洁版 + 用印版（如有），历史修订折叠 ─────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">合同文件</p>
        <div className="space-y-2">
          {contract.cleanFilename ? (
            <button
              onClick={() => downloadCleanContract(contract.id, contract.cleanFilename!)}
              className="w-full flex items-center gap-3 rounded-lg bg-primary-50 border-2 border-primary-200 px-4 py-3 hover:bg-primary-100 text-left"
            >
              <Download size={18} className="text-primary-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{contract.cleanFilename}</p>
                <p className="text-[11px] text-primary-600">清洁版 · 待审批文件</p>
              </div>
            </button>
          ) : (
            <p className="text-xs text-slate-400 italic">尚未上传清洁版</p>
          )}

          {contract.sealedFilename && (
            <button
              onClick={() => downloadSealedContract(contract.id, contract.sealedFilename!)}
              className="w-full flex items-center gap-3 rounded-lg bg-emerald-50 border-2 border-emerald-200 px-4 py-3 hover:bg-emerald-100 text-left"
            >
              <Download size={18} className="text-emerald-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{contract.sealedFilename}</p>
                <p className="text-[11px] text-emerald-600">用印版 · 流程完成</p>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* ─── 历史修订记录（折叠） ──────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
        >
          <span className="text-sm font-medium text-slate-600">历史修订记录（{reviews.length} 版）</span>
          {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {historyOpen && (
          <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            {reviews.length === 0 && (
              <p className="text-sm text-slate-400">暂无</p>
            )}
            {reviews.map((rv, idx) => (
              <div key={rv.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-600 py-1 border-b last:border-0 border-slate-100">
                <span className="text-slate-400 w-8 shrink-0">v{idx + 1}</span>
                <span className="flex-1 min-w-0 truncate">{rv.uploadedFilename}</span>
                <button
                  onClick={() => reviewsApi.downloadOriginal(rv.id, rv.uploadedFilename)}
                  className="text-primary-700 hover:underline text-xs"
                >
                  <Download size={11} className="inline mr-0.5" />原合同
                </button>
                {rv.reviewedFilename && (
                  <button
                    onClick={() => reviewsApi.downloadLegalRevision(rv.id, rv.reviewedFilename!)}
                    className="text-emerald-700 hover:underline text-xs"
                  >
                    <Download size={11} className="inline mr-0.5" />法务版
                  </button>
                )}
                <span className="text-[11px] text-slate-400 shrink-0">{new Date(rv.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── AI 合同摘要 ────────────────────────────────── */}
      <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-amber-600" />
          <p className="text-xs font-semibold text-amber-800">AI 合同摘要</p>
          {contract.summaryGeneratedAt && (
            <span className="text-[10px] text-amber-600/70">
              生成于 {new Date(contract.summaryGeneratedAt).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        {contract.summary ? (
          <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 font-sans">
            {contract.summary}
          </pre>
        ) : (
          <p className="text-xs text-amber-700 italic">摘要生成中…如长时间未出现可刷新本页（生成失败请检查 OpenAI 配置）</p>
        )}
      </section>

      {/* ─── 审批流水（actions 时间线） ─────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-3">审批记录</p>
        <ActionTimeline data={data} />
      </section>

      {/* ─── 操作区：仅当前任务归我时显示 ──────────────── */}
      {isMyTurn && currentStep && approval.status === 'pending' && (
        <ActionPanel
          approvalId={approval.id}
          currentStep={currentStep}
          isInRejectedToInitiator={isInRejectedToInitiator}
          onDone={() => {
            onActionDone?.()
            load()
          }}
        />
      )}
    </div>
  )
}

// ─── 进度条 ─────────────────────────────────────────────────────────────────

function ProgressBar({
  approverSteps, finalStep, currentStepId,
}: {
  approverSteps: ApprovalStep[]
  finalStep: ApprovalStep | undefined
  currentStepId: string | null
}) {
  const allNodes = [...approverSteps]
  if (finalStep) allNodes.push(finalStep)
  if (allNodes.length === 0) return null
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {allNodes.map((s, idx) => {
        const isCurrent = s.id === currentStepId
        const color =
          s.status === 'approved' ? 'bg-emerald-500 text-white'
          : s.status === 'rejected' ? 'bg-red-500 text-white'
          : isCurrent ? 'bg-blue-500 text-white animate-pulse'
          : 'bg-slate-200 text-slate-500'
        return (
          <div key={s.id} className="flex items-center gap-1 shrink-0">
            <div className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium', color)}>
              {s.status === 'approved' ? <Check size={10} /> : s.status === 'rejected' ? <X size={10} /> : null}
              <span>{s.assigneeDisplayName || s.assigneeUsername}</span>
            </div>
            {idx < allNodes.length - 1 && (
              <div className="w-3 h-px bg-slate-300" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 时间线 ─────────────────────────────────────────────────────────────────

function ActionTimeline({ data }: { data: ApprovalDetail }) {
  const { actions, steps } = data
  const stepById = new Map(steps.map(s => [s.id, s]))
  if (actions.length === 0) return <p className="text-sm text-slate-400">暂无操作记录</p>
  return (
    <div className="space-y-3">
      {actions.map(a => {
        const target = a.targetStepId ? stepById.get(a.targetStepId) : null
        return (
          <div key={a.id} className="flex gap-3">
            <div className="w-2 h-2 rounded-full bg-primary-400 mt-2 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-medium text-slate-700">{a.actorDisplayName || a.actorUsername}</span>
                <span className="text-slate-400 ml-2 text-xs">{new Date(a.createdAt).toLocaleString('zh-CN')}</span>
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                <ActionLabel action={a.action} target={target} payload={a.payload} steps={steps} />
              </p>
              {a.comment && (
                <p className="mt-1 text-sm text-slate-700 bg-slate-50 rounded px-3 py-2 leading-relaxed">{a.comment}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ActionLabel({
  action, target, payload, steps,
}: {
  action: string
  target: ApprovalStep | null | undefined
  payload: Record<string, unknown> | null
  steps: ApprovalStep[]
}) {
  switch (action) {
    case 'submit': return <>发起审批</>
    case 'approve': {
      const list = (payload?.nextApprovers as string[]) || []
      const names = list.map(id => {
        const s = steps.find(x => x.assigneeId === id)
        return s?.assigneeDisplayName || s?.assigneeUsername || id
      })
      return (
        <>
          <span className="text-emerald-700">通过</span>
          {names.length > 0 && <span className="text-slate-500">，指派后续审批人：{names.join(' → ')}</span>}
        </>
      )
    }
    case 'reject_to_step': return <span className="text-red-700">驳回到经办人节点（待经办人重新提交后跳回此审批人）</span>
    case 'reject_to_start': return <span className="text-red-700">驳回，要求重新发起审批</span>
    case 'add_consultee': return (
      <>
        <span className="text-blue-700">加签</span>
        {target && <span className="text-slate-500">，咨询 {target.assigneeDisplayName || target.assigneeUsername}</span>}
      </>
    )
    case 'submit_consultation': return <span className="text-blue-700">提交加签意见</span>
    case 'resubmit': return <>经办人重新提交</>
    case 'upload_seal': return <span className="text-emerald-700">上传用印版，流程结束</span>
    default: return <>{action}</>
  }
}

// ─── 操作区 ─────────────────────────────────────────────────────────────────

function ActionPanel({
  approvalId, currentStep, isInRejectedToInitiator, onDone,
}: {
  approvalId: string
  currentStep: ApprovalStep
  isInRejectedToInitiator: boolean
  onDone: () => void
}) {
  // 三个对话框的状态
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [consulteeOpen, setConsulteeOpen] = useState(false)

  if (currentStep.stepType === 'consultee') {
    return (
      <>
        <ActionRoot title="加签节点：请提交你的意见">
          <Button variant="primary" size="md" icon={<Send size={14} />} onClick={() => setApproveOpen(true)}>
            提交意见
          </Button>
        </ActionRoot>
        <ConsulteeSubmitDialog
          open={approveOpen}
          onClose={() => setApproveOpen(false)}
          approvalId={approvalId}
          onDone={onDone}
        />
      </>
    )
  }

  if (currentStep.stepType === 'final-initiator') {
    if (isInRejectedToInitiator) {
      // 被驳回到经办人节点 → 重新提交
      return (
        <ActionRoot title="审批被驳回，请修改材料后重新提交">
          <ResubmitButton approvalId={approvalId} onDone={onDone} />
        </ActionRoot>
      )
    }
    // 待上传用印版
    return (
      <ActionRoot title="所有审批已通过，请上传用印版">
        <UploadSealButton approvalId={approvalId} onDone={onDone} />
      </ActionRoot>
    )
  }

  // approver 节点：通过 / 驳回 / 加签
  const isFirstStep = currentStep.stepIndex === 1
  return (
    <>
      <ActionRoot title="待你审批">
        <Button variant="primary" size="md" icon={<Check size={14} />} onClick={() => setApproveOpen(true)}>
          通过
        </Button>
        <Button variant="danger" size="md" icon={<X size={14} />} onClick={() => setRejectOpen(true)}>
          驳回
        </Button>
        <Button variant="outline" size="md" icon={<UserPlus size={14} />} onClick={() => setConsulteeOpen(true)}>
          加签
        </Button>
      </ActionRoot>

      <ApproveDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        approvalId={approvalId}
        needsNextApprovers={isFirstStep}
        onDone={onDone}
      />
      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        approvalId={approvalId}
        onDone={onDone}
      />
      <ConsulteeAddDialog
        open={consulteeOpen}
        onClose={() => setConsulteeOpen(false)}
        approvalId={approvalId}
        onDone={onDone}
      />
    </>
  )
}

function ActionRoot({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border-2 border-primary-200 bg-primary-50/40 p-4">
      <p className="text-xs font-semibold text-primary-800 mb-3">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

// ─── 通过对话框（含可选指派下一审批人） ────────────────────────────────────

function ApproveDialog({
  open, onClose, approvalId, needsNextApprovers, onDone,
}: {
  open: boolean
  onClose: () => void
  approvalId: string
  needsNextApprovers: boolean
  onDone: () => void
}) {
  const me = useAuthStore(s => s.user)
  const isSuper = isSuperAdmin(me)
  const [comment, setComment] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setComment('')
    setPicked([])
    setError(null)
    if (needsNextApprovers) {
      messagesApi.contacts()
        .then(({ contacts }) => setContacts(contacts))
        .catch(e => setError(e instanceof Error ? e.message : '加载联系人失败'))
    }
  }, [open, needsNextApprovers])

  async function onSubmit() {
    if (!comment.trim()) { setError('请填写审批意见'); return }
    setSubmitting(true)
    setError(null)
    try {
      await approvalsApi.approve(approvalId, {
        comment: comment.trim(),
        ...(needsNextApprovers ? { nextApprovers: picked } : {}),
      })
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  function toggle(id: string) {
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  }
  function move(idx: number, dir: -1 | 1) {
    setPicked(p => {
      const next = [...p]
      const j = idx + dir
      if (j < 0 || j >= next.length) return p
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="审批通过">
      <div className="w-[520px] max-w-full space-y-3">
        {needsNextApprovers && (
          <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800 flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <div>
              作为超级管理员，请在下方<strong>指派后续审批人并排序</strong>。
              留空表示无后续审批人，直接流转到经办人传用印版。
              {!isSuper && '（你不是超级管理员，但当前是 step 1。这是异常情况，请联系系统管理员）'}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">审批意见 *</label>
          <textarea
            className="form-textarea"
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="必填，简述审批意见"
          />
        </div>

        {needsNextApprovers && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              后续审批人（按顺序，已选 {picked.length}）
            </label>

            {picked.length > 0 && (
              <div className="rounded border border-slate-200 bg-slate-50 p-2 mb-2 space-y-1">
                {picked.map((id, idx) => {
                  const c = contacts.find(x => x.id === id)
                  return (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-slate-400 text-right">{idx + 1}.</span>
                      <span className="flex-1 truncate">{c?.displayName || c?.username || id}</span>
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">↑</button>
                      <button onClick={() => move(idx, 1)} disabled={idx === picked.length - 1} className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">↓</button>
                      <button onClick={() => toggle(id)} className="px-1 text-red-500 hover:text-red-700">×</button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="rounded border border-slate-200 max-h-48 overflow-y-auto">
              {contacts.filter(c => !picked.includes(c.id)).map(c => (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between"
                >
                  <span>
                    {c.displayName || c.username}（{c.username}）
                    <span className="ml-1 text-[10px] text-slate-400">
                      {c.role === 'superadmin' ? '超管' : c.role === 'admin' ? '管理员' : '普通'}
                    </span>
                  </span>
                  <span className="text-primary-600 text-[10px]">+ 添加</span>
                </button>
              ))}
              {contacts.filter(c => !picked.includes(c.id)).length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">没有更多联系人可选</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="primary" size="md" loading={submitting} onClick={onSubmit}>确认通过</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── 驳回对话框（含模式选择） ────────────────────────────────────────────────

function RejectDialog({
  open, onClose, approvalId, onDone,
}: {
  open: boolean
  onClose: () => void
  approvalId: string
  onDone: () => void
}) {
  const [comment, setComment] = useState('')
  const [mode, setMode] = useState<'to_step' | 'to_start'>('to_step')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setComment('')
    setMode('to_step')
    setError(null)
  }, [open])

  async function onSubmit() {
    if (!comment.trim()) { setError('请填写驳回意见'); return }
    setSubmitting(true)
    setError(null)
    try {
      await approvalsApi.reject(approvalId, { comment: comment.trim(), mode })
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="驳回">
      <div className="w-[480px] max-w-full space-y-3">
        <div>
          <label className="mb-2 block text-xs font-medium text-slate-600">驳回方式 *</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50 has-[:checked]:bg-blue-50 has-[:checked]:border-blue-300">
              <input type="radio" checked={mode === 'to_step'} onChange={() => setMode('to_step')} className="mt-0.5" />
              <div>
                <p className="text-sm text-slate-800">返回当前节点</p>
                <p className="text-[11px] text-slate-500 mt-0.5">流程退到经办人，经办人改完材料后<strong>直接跳回你这里</strong>，不再过中间已通过的人</p>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50 has-[:checked]:bg-blue-50 has-[:checked]:border-blue-300">
              <input type="radio" checked={mode === 'to_start'} onChange={() => setMode('to_start')} className="mt-0.5" />
              <div>
                <p className="text-sm text-slate-800">重新发起审批</p>
                <p className="text-[11px] text-slate-500 mt-0.5">本轮审批作废，经办人需要从头发起新一轮（合同回到"起草中"状态）</p>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">驳回意见 *</label>
          <textarea
            className="form-textarea"
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="请说明驳回原因和需要修改的点"
          />
        </div>

        {error && (
          <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="danger" size="md" loading={submitting} onClick={onSubmit}>确认驳回</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── 加签对话框 ──────────────────────────────────────────────────────────────

function ConsulteeAddDialog({
  open, onClose, approvalId, onDone,
}: {
  open: boolean
  onClose: () => void
  approvalId: string
  onDone: () => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [consulteeId, setConsulteeId] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setComment('')
    setConsulteeId('')
    setError(null)
    messagesApi.contacts()
      .then(({ contacts }) => setContacts(contacts))
      .catch(e => setError(e instanceof Error ? e.message : '加载联系人失败'))
  }, [open])

  async function onSubmit() {
    if (!consulteeId) { setError('请选择加签对象'); return }
    if (!comment.trim()) { setError('请填写加签说明'); return }
    setSubmitting(true)
    setError(null)
    try {
      await approvalsApi.addConsultee(approvalId, { consulteeId, comment: comment.trim() })
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="加签">
      <div className="w-[480px] max-w-full space-y-3">
        <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
          加签是临时咨询某人。对方只能"提交意见"，提交后控制权回到你这里，由你决定通过 / 驳回。
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">加签对象 *</label>
          <select className="form-select" value={consulteeId} onChange={e => setConsulteeId(e.target.value)}>
            <option value="">选择联系人…</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>
                {c.displayName || c.username}（{c.username}）
                {c.role === 'superadmin' ? ' · 超管' : c.role === 'admin' ? ' · 管理员' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">加签说明 *</label>
          <textarea
            className="form-textarea"
            rows={3}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="请说明加签的原因和需要对方提供的意见"
          />
        </div>
        {error && (
          <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="primary" size="md" loading={submitting} onClick={onSubmit}>发起加签</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── 加签人提交意见 ─────────────────────────────────────────────────────────

function ConsulteeSubmitDialog({
  open, onClose, approvalId, onDone,
}: {
  open: boolean
  onClose: () => void
  approvalId: string
  onDone: () => void
}) {
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (open) { setComment(''); setError(null) } }, [open])

  async function onSubmit() {
    if (!comment.trim()) { setError('请填写意见'); return }
    setSubmitting(true)
    setError(null)
    try {
      await approvalsApi.submitConsultation(approvalId, { comment: comment.trim() })
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="提交加签意见">
      <div className="w-[460px] max-w-full space-y-3">
        <p className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
          提交意见后，控制权会回到加签人。你不能直接通过或驳回审批。
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">意见 *</label>
          <textarea
            className="form-textarea"
            rows={4}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="请填写你对该合同的意见、建议或确认"
          />
        </div>
        {error && (
          <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="primary" size="md" loading={submitting} onClick={onSubmit}>提交意见</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── 经办人重新提交按钮 ──────────────────────────────────────────────────────

function ResubmitButton({ approvalId, onDone }: { approvalId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await approvalsApi.resubmit(approvalId, { comment: comment.trim() || undefined })
      onDone()
      setOpen(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '操作失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button variant="primary" size="md" icon={<RefreshCcw size={14} />} onClick={() => { setOpen(true); setComment(''); setError(null) }}>
        重新提交
      </Button>
      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title="重新提交审批">
          <div className="w-[460px] max-w-full space-y-3">
            <p className="text-xs text-slate-600">
              提交后流程将<strong>直接跳回上次驳回你的审批人</strong>，不会重新走中间已通过的人。
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">补充说明（可选）</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="说明你做了什么修改"
              />
            </div>
            {error && (
              <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="md" onClick={() => setOpen(false)} disabled={submitting}>取消</Button>
              <Button variant="primary" size="md" loading={submitting} onClick={onSubmit}>确认提交</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ─── 上传用印版按钮 ──────────────────────────────────────────────────────────

function UploadSealButton({ approvalId, onDone }: { approvalId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    if (!file) { setError('请选择用印版文件'); return }
    setSubmitting(true)
    setError(null)
    try {
      await approvalsApi.uploadSeal(approvalId, file, comment.trim() || undefined)
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '上传失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full">
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        onChange={e => setFile(e.target.files?.[0] || null)}
        className="block text-xs mb-2"
      />
      <textarea
        className="form-textarea mb-2"
        rows={2}
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="备注（可选）"
      />
      {error && (
        <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700 mb-2">{error}</p>
      )}
      <Button variant="primary" size="md" icon={<Upload size={14} />} loading={submitting} onClick={onSubmit} disabled={!file}>
        上传用印版并完成流程
      </Button>
    </div>
  )
}
