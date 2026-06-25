import { useEffect, useRef, useState } from 'react'
import {
  Send, Upload, FileText, Loader2, Download, Sparkles, Bot, Trash2,
  FileSignature, CheckSquare, FolderOpen, FileSearch, ExternalLink, X,
} from 'lucide-react'
import { cn } from '@/utils/helpers'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/api/client'
import {
  assistantApi, type AssistantMessage, type JumpLink, type PendingAction, type QuickAction, type FileLink,
} from '@/api/assistant'
import { getExecutor } from '@/api/assistantExecutors'
import { ConfirmActionModal } from '@/components/assistant/ConfirmActionModal'
import { InitiateApprovalDialog } from '@/components/approvals/InitiateApprovalDialog'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'
import { DraftFormModal, type DraftFormPayload } from '@/components/draft/DraftFormModal'
import { DraftChatModal, type DraftChatInitial } from '@/components/draft/DraftChatModal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  FileSignature, CheckSquare, FolderOpen, FileSearch, Send,
}

interface WorkbenchPageProps {
  /** 待办里"跳转查看" → 切到对应页面 */
  onNavigate?: (link: JumpLink) => void
}

export default function WorkbenchPage({ onNavigate }: WorkbenchPageProps = {}) {
  const [msgs, setMsgs] = useState<AssistantMessage[]>([])
  const [quickActions, setQuickActions] = useState<QuickAction[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)      // 进页加载
  const [sending, setSending] = useState(false)       // 对话/执行中
  const [uploading, setUploading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [staged, setStaged] = useState<File[]>([])   // 暂存待发送的附件（点发送才上传）

  // 写操作确认
  const [confirmAction, setConfirmAction] = useState<PendingAction | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [consumed, setConsumed] = useState<Set<string>>(new Set())   // 已处理的 pending_action 消息 id

  // 发起审批：直接打开现成的发起审批表单（清洁版用聊天里最近上传的文件预填；合同由用户在表单里选）
  const [approvalDialog, setApprovalDialog] = useState<{ cleanFile?: File } | null>(null)

  // 合同起草（复用 /api/draft 管线，独立于对话）
  const [formOpen, setFormOpen] = useState(false)
  const [draftChat, setDraftChat] = useState<DraftChatInitial | null>(null)   // 起草引导对话

  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const busy = sending || uploading

  useEffect(() => { void init() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  // 无害动作（合同起草 / AI 审核）：消息一到就自动打开对应窗口，免去点"确认执行"卡
  useEffect(() => {
    const last = msgs[msgs.length - 1]
    if (!last || last.kind !== 'pending_action' || !last.data?.autoConfirm) return
    if (consumed.has(last.id) || confirmAction || formOpen || draftChat || approvalDialog) return
    openConfirm(last)
  }, [msgs])  // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    setLoading(true)
    setError(null)
    try {
      const [{ messages }, { actions }] = await Promise.all([
        assistantApi.history(),
        assistantApi.quickActions(),
      ])
      setMsgs(messages)
      setQuickActions(actions)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleClear() {
    if (busy || clearing) return
    if (!window.confirm('确定清空当前对话吗？本次上传的参考文件也会一并删除，且不可恢复。')) return
    setClearing(true)
    setError(null)
    try {
      const { messages } = await assistantApi.clear()
      setMsgs(messages)
      setConsumed(new Set())
      setStaged([])
      setInput('')
      setConfirmAction(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '清空失败')
    } finally {
      setClearing(false)
    }
  }

  async function send(text: string) {
    const t = text.trim()
    if ((!t && staged.length === 0) || busy) return
    const files = staged
    setInput('')
    setError(null)

    // 1) 先把暂存的附件逐个上传（生成 file 气泡），失败则把未上传的留回暂存
    if (files.length > 0) {
      setUploading(true)
      const remaining = [...files]
      try {
        while (remaining.length) {
          const { message } = await assistantApi.upload(remaining[0])
          setMsgs((prev) => [...prev, message])
          remaining.shift()
        }
        setStaged([])
      } catch (e) {
        setStaged(remaining)
        setInput(t)
        setError(e instanceof ApiError ? e.message : '上传失败')
        setUploading(false)
        return
      }
      setUploading(false)
    }

    // 2) 触发 AI 回合（可带文字，也可只发文件）
    setSending(true)
    if (t) setMsgs((prev) => [...prev, optimisticUser(t)])
    try {
      const { messages } = await assistantApi.sendMessage(t)
      // 用服务端返回替换乐观项（去掉临时项，追加真实项）
      setMsgs((prev) => [...prev.filter((m) => !m.id.startsWith('tmp-')), ...messages])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '对话失败')
      setMsgs((prev) => prev.filter((m) => !m.id.startsWith('tmp-')))
    } finally {
      setSending(false)
    }
  }

  // 拖拽 / 点击上传按钮：先暂存到发言框，点发送时才真正上传
  function addStaged(list: FileList | File[]) {
    const ok: File[] = []
    let rejected = 0
    for (const f of Array.from(list)) {
      if (/\.(docx?|txt)$/i.test(f.name)) ok.push(f)
      else rejected++
    }
    if (rejected > 0) setError('参考文件仅支持 Word（.doc/.docx）或文本（.txt），已忽略其他文件')
    if (ok.length > 0) setStaged((prev) => [...prev, ...ok].slice(0, 5))
  }

  function removeStaged(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx))
  }

  // 在当天会话里按文件名找附件（写操作取文件用）
  function findAttachment(filename?: string) {
    if (!filename) {
      // 没指定就取最近一个文件
      const last = [...msgs].reverse().find((m) => m.kind === 'file' && m.data?.attachmentId)
      return last?.data?.attachmentId ? { attachmentId: last.data.attachmentId, filename: last.data.filename || '' } : null
    }
    const hit = [...msgs].reverse().find(
      (m) => m.kind === 'file' && m.data?.attachmentId && (m.data.filename === filename || m.data.filename?.includes(filename)),
    )
    return hit?.data?.attachmentId ? { attachmentId: hit.data.attachmentId, filename: hit.data.filename || filename } : null
  }

  async function doConfirm(values: Record<string, string>) {
    if (!confirmAction) return
    const executor = getExecutor(confirmAction.tool)
    setConfirmLoading(true)
    setError(null)
    try {
      if (!executor) throw new Error('该操作暂未接入执行器')
      // 用户在确认框里编辑后的值覆盖 AI 给的默认 args
      const mergedArgs = { ...confirmAction.args, ...values }
      const out = await executor(mergedArgs, { findAttachment })
      const summary = typeof out === 'string' ? out : out.summary
      const resultData = typeof out === 'string' ? undefined : out.resultData
      const { messages } = await assistantApi.actionResult({ ok: true, summary, resultData })
      setMsgs((prev) => [...prev, ...messages])
    } catch (e) {
      const errMsg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '执行失败')
      try {
        const { messages } = await assistantApi.actionResult({ ok: false, error: errMsg })
        setMsgs((prev) => [...prev, ...messages])
      } catch { setError(errMsg) }
    } finally {
      setConfirmLoading(false)
      setConfirmAction(null)
    }
  }

  async function doCancel(messageId?: string) {
    setConfirmAction(null)
    if (messageId) setConsumed((s) => new Set(s).add(messageId))
    try {
      const { messages } = await assistantApi.actionResult({ cancelled: true })
      setMsgs((prev) => [...prev, ...messages])
    } catch { /* ignore */ }
  }

  function openConfirm(m: AssistantMessage) {
    const d = m.data
    if (!d?.tool) return
    setConsumed((s) => new Set(s).add(m.id))
    // 合同起草：不走通用确认框，直接打开起草表单
    if (d.tool === 'draft_contract') {
      setFormOpen(true)
      return
    }
    // 发起审批：不走通用确认框，直接打开现成的发起审批表单
    if (d.tool === 'initiate_approval') {
      void openApprovalDialog()
      return
    }
    setConfirmAction({
      tool: d.tool, label: d.label || d.tool, executor: d.executor || '',
      args: (d.args as Record<string, unknown>) || {}, summary: d.summary || {},
      fields: d.fields || null,
    })
  }

  // 打开发起审批表单：把聊天里最近上传的文件当作清洁版预填（用户在表单里选定合同后会自动跑 AI 字段提取）
  async function openApprovalDialog() {
    let cleanFile: File | undefined
    const att = findAttachment()
    if (att) {
      try { cleanFile = await assistantApi.fetchAttachmentFile(att.attachmentId, att.filename) } catch { /* 取不到就让用户在表单里上传 */ }
    }
    setApprovalDialog({ cleanFile })
  }

  async function onApprovalInitiated() {
    setApprovalDialog(null)
    try {
      const { messages } = await assistantApi.actionResult({ ok: true, summary: '审批流程已发起，相关审批人会收到站内通知，可在「合同审批」里查看进度。' })
      setMsgs((prev) => [...prev, ...messages])
    } catch { /* ignore */ }
  }

  function onApprovalClose() {
    setApprovalDialog(null)
    void doCancel()
  }

  function onQuickAction(qa: QuickAction) {
    if (qa.kind === 'draft') { setFormOpen(true); return }
    if (qa.kind === 'prompt' && qa.prompt) void send(qa.prompt)
  }

  // 合同起草：表单提交后不直接生成，先进引导对话（核对模板 + 至少追问一轮），确认后再生成
  function handleDraftSubmit(payload: DraftFormPayload) {
    setFormOpen(false)
    setError(null)
    setDraftChat({ text: payload.text, files: payload.files })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-6 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
          <Bot size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 leading-tight">AI 工作台</p>
          <p className="text-[11px] text-slate-400 leading-tight">用自然语言完成法务操作 · 当天对话保留，次日清空</p>
        </div>
        <button
          type="button" onClick={handleClear} disabled={busy || clearing || loading}
          title="清空对话"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-red-600 disabled:opacity-40"
        >
          {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          清空对话
        </button>
      </div>

      {/* 消息区 */}
      <div
        className={cn('relative flex-1 overflow-y-auto px-4 py-5', dragOver && 'ring-2 ring-inset ring-primary-400 bg-primary-50/40')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addStaged(e.dataTransfer.files) }}
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {loading && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" />加载中…</div>}
          {msgs.map((m, idx) => (
            <Bubble
              key={m.id} msg={m}
              // 本地已点 / 或它后面已经有消息（说明已确认或取消过）→ 显示"已处理"，刷新后仍保持
              consumed={consumed.has(m.id) || idx !== msgs.length - 1}
              onJump={onNavigate}
              onConfirm={() => openConfirm(m)}
              onCancel={() => doCancel(m.id)}
            />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={15} className="animate-spin" />AI 正在处理…
            </div>
          )}
          {dragOver && <p className="text-center text-sm text-primary-600">松手添加到发言框，确认后点发送</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-slate-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {/* 动态快捷按钮（按角色） */}
          {quickActions.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {quickActions.map((qa) => {
                const Icon = ICON_MAP[qa.icon] || Sparkles
                return (
                  <Button key={qa.id} variant="outline" size="sm" icon={<Icon size={14} />}
                    onClick={() => onQuickAction(qa)} disabled={busy}>
                    {qa.label}
                  </Button>
                )
              })}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-2 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/20">
            {/* 暂存的附件（点发送时随消息一起提交） */}
            {staged.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {staged.map((f, i) => (
                  <div key={`${f.name}-${i}`}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
                    <FileText size={13} className="shrink-0 text-primary-600" />
                    <span className="max-w-[160px] truncate" title={f.name}>{f.name}</span>
                    <button type="button" onClick={() => removeStaged(i)} disabled={busy} title="移除"
                      className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" multiple accept=".doc,.docx,.txt" className="hidden"
                onChange={(e) => { addStaged(e.target.files || []); if (fileRef.current) fileRef.current.value = '' }} />
              <button type="button" title="添加文件" onClick={() => fileRef.current?.click()} disabled={busy}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 disabled:opacity-50">
                <Upload size={18} />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
                rows={1}
                placeholder="告诉我你要做什么，例如『我有哪些待办』『通过这个审批』『起草一份采购合同』…"
                className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none"
              />
              <Button variant="primary" size="md" icon={<Send size={15} />} onClick={() => send(input)}
                disabled={busy || (!input.trim() && staged.length === 0)}>
                发送
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Enter 发送，Shift+Enter 换行 · 拖拽或点 <Upload size={11} className="inline -mt-0.5" /> 添加 Word/txt，随消息一起发送</p>
        </div>
      </div>

      <ConfirmActionModal
        open={!!confirmAction} action={confirmAction} loading={confirmLoading}
        onConfirm={doConfirm} onCancel={() => doCancel()}
      />
      <DraftFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleDraftSubmit} />
      <DraftChatModal
        open={!!draftChat}
        initial={draftChat}
        onClose={() => setDraftChat(null)}
        onGenerated={async (result) => {
          setDraftChat(null)
          // 把"已生成 + 下载"记进主对话（弹窗关掉也能在对话里下载）
          try {
            const { messages } = await assistantApi.recordDraftResult({
              downloadId: result.downloadId, filename: result.filename, title: result.title,
            })
            setMsgs((prev) => [...prev, ...messages])
          } catch (e) {
            setError(e instanceof ApiError ? e.message : '草稿已生成，但写入对话失败')
          }
        }}
      />
      {approvalDialog && (
        <InitiateApprovalDialog
          open
          prefillCleanFile={approvalDialog.cleanFile}
          onClose={onApprovalClose}
          onInitiated={onApprovalInitiated}
        />
      )}
    </div>
  )
}

function optimisticUser(text: string): AssistantMessage {
  return { id: `tmp-${Date.now()}`, role: 'user', kind: 'text', content: text, data: null, createdAt: null }
}

// ─── 消息气泡 ────────────────────────────────────────────────────────────────
function Bubble({ msg, consumed, onJump, onConfirm, onCancel }: {
  msg: AssistantMessage
  consumed: boolean
  onJump?: (l: JumpLink) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const isUser = msg.role === 'user'

  // 待办推送
  if (msg.kind === 'todo') {
    const links = msg.data?.jumpLinks || []
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{msg.content}</p>
        {links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {links.map((l, i) => (
              <button key={i} onClick={() => onJump?.(l)}
                className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-xs text-primary-700 hover:bg-primary-100">
                <ExternalLink size={12} /> {l.index}. {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // 写操作确认卡
  if (msg.kind === 'pending_action') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-700">
            <Sparkles size={15} /><span className="text-sm font-semibold">{msg.content}</span>
          </div>
          {msg.data?.autoConfirm ? (
            <p className="mt-2 text-xs text-slate-400">已为你打开操作窗口</p>
          ) : consumed ? (
            <p className="mt-2 text-xs text-slate-400">已处理</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" size="sm" onClick={onConfirm}>确认执行</Button>
              <Button variant="secondary" size="sm" onClick={onCancel}>取消</Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // AI 审核意见（结构化表格）
  if (msg.kind === 'review_result') {
    const d = msg.data || {}
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={15} className="text-primary-600" />
          <p className="text-sm font-semibold text-slate-800">
            AI 审核意见{d.filename ? ` · ${d.filename}` : ''}
            {d.ourRole ? <span className="ml-1 text-xs font-normal text-slate-400">（我方立场：{d.ourRole}）</span> : null}
          </p>
        </div>
        <ReviewOpinionsView reviewText={d.reviewText || ''} compact />
      </div>
    )
  }

  // 文件
  if (msg.kind === 'file') {
    return (
      <div className="flex justify-end">
        <div className="flex items-center gap-2 rounded-2xl rounded-tr-sm bg-primary-600 px-3 py-2 text-white">
          <FileText size={15} /><span className="text-sm">{msg.data?.filename || '文件'}</span>
        </div>
      </div>
    )
  }

  // action_result：仅作记录（供模型/历史），执行结果改由助手文本气泡呈现，这里不再展示
  if (msg.kind === 'action_result') return null

  // 普通文本（助手文本可附带"可下载文件"按钮）
  const fileLinks = !isUser ? (msg.data?.fileLinks || []) : []
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
        isUser ? 'rounded-tr-sm bg-primary-600 text-white' : 'rounded-tl-sm border border-slate-200 bg-white text-slate-700',
      )}>
        <span className="whitespace-pre-wrap">{msg.content}</span>
        {fileLinks.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {fileLinks.map((l, i) => <FileLinkButton key={i} link={l} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// 助手回复里的可下载文件按钮
function FileLinkButton({ link }: { link: FileLink }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function onClick() {
    setBusy(true); setErr(null)
    try { await assistantApi.downloadFileLink(link) }
    catch (e) { setErr(e instanceof ApiError ? e.message : '下载失败') }
    finally { setBusy(false) }
  }
  return (
    <div>
      <button onClick={onClick} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs text-primary-700 hover:bg-primary-100 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {link.label}
      </button>
      {err && <p className="mt-0.5 text-[11px] text-red-500">{err}</p>}
    </div>
  )
}

