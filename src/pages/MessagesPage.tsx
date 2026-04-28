import { useEffect, useRef, useState } from 'react'
import { Mail, Send, Inbox, Trash2, Download, FileText, Briefcase, Sparkles, RefreshCw, Plus, Upload, CheckCircle2 } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { messagesApi } from '@/api/messages'
import { reviewsApi } from '@/api/reviews'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import type { MessageRecord } from '@/types'
import { ComposeMessageDialog } from '@/components/messages/ComposeMessageDialog'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'

type Folder = 'inbox' | 'sent'

export default function MessagesPage() {
  const me = useAuthStore(s => s.user)
  const [folder, setFolder] = useState<Folder>('inbox')
  const [list, setList] = useState<MessageRecord[]>([])
  const [selected, setSelected] = useState<MessageRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadList() {
    setLoading(true)
    setError(null)
    try {
      const { messages } = await messagesApi.list(folder)
      setList(messages)
      // 选中第一条
      if (messages.length > 0 && !selected) {
        await selectMessage(messages[0])
      } else if (messages.length === 0) {
        setSelected(null)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadList() }, [folder])  // eslint-disable-line react-hooks/exhaustive-deps

  async function selectMessage(m: MessageRecord) {
    try {
      const { message } = await messagesApi.get(m.id)
      setSelected(message)
      // 收件箱里点开未读消息 → 标记已读
      if (folder === 'inbox' && !message.isRead) {
        await messagesApi.markRead(message.id)
        setList(prev => prev.map(x => x.id === message.id ? { ...x, isRead: true } : x))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载详情失败')
    }
  }

  async function onDelete(id: string) {
    try {
      await messagesApi.remove(id)
      setList(prev => prev.filter(m => m.id !== id))
      if (selected?.id === id) setSelected(null)
    } catch (e) {
      window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
    setDeleteId(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shrink-0">
        <div className="flex items-center gap-2">
          <Mail size={18} className="text-primary-600" />
          <h1 className="text-base font-semibold text-slate-900">消息中心</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={loadList}>
            刷新
          </Button>
          <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setComposeOpen(true)}>
            新消息
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-12 overflow-hidden">
        {/* List */}
        <aside className="col-span-4 flex flex-col border-r border-slate-200 bg-slate-50">
          {/* Folder tabs */}
          <div className="flex border-b border-slate-200 bg-white">
            {(['inbox', 'sent'] as Folder[]).map(f => (
              <button
                key={f}
                onClick={() => { setFolder(f); setSelected(null) }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors',
                  folder === f
                    ? 'text-primary-700 border-b-2 border-primary-600 -mb-px'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {f === 'inbox' ? <Inbox size={13} /> : <Send size={13} />}
                {f === 'inbox' ? '收件箱' : '发件箱'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && list.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-6">加载中…</p>
            )}
            {!loading && list.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-6">
                {folder === 'inbox' ? '收件箱是空的' : '还没发过消息'}
              </p>
            )}
            {error && (
              <p className="m-3 rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
            )}
            {list.map(m => (
              <MessageListItem
                key={m.id}
                message={m}
                folder={folder}
                meId={me?.id}
                active={selected?.id === m.id}
                onClick={() => selectMessage(m)}
              />
            ))}
          </div>
        </aside>

        {/* Detail */}
        <section className="col-span-8 flex flex-col overflow-hidden bg-white">
          {selected ? (
            <MessageDetailView
              message={selected}
              isAdmin={me?.role === 'admin'}
              onDelete={() => setDeleteId(selected.id)}
              onLegalRevisionUploaded={async () => {
                // 重新拉详情让 review 区域刷新（保留选中态）
                if (selected) {
                  try {
                    const { message } = await messagesApi.get(selected.id)
                    setSelected(message)
                  } catch { /* ignore */ }
                }
              }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-slate-400">
              <div className="text-center">
                <Mail size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm">选择左侧消息查看详情</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmModal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && onDelete(deleteId)}
        title="删除消息"
        message="此操作不可撤销，确认删除该消息（含附件）？"
        confirmLabel="确认删除"
        confirmVariant="danger"
      />

      <ComposeMessageDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSent={() => { setComposeOpen(false); if (folder === 'sent') loadList() }}
      />
    </div>
  )
}

// ─── List Item ────────────────────────────────────────────────────────────────

function MessageListItem({
  message, folder, meId, active, onClick,
}: {
  message: MessageRecord
  folder: Folder
  meId: string | undefined
  active: boolean
  onClick: () => void
}) {
  const isMine = message.senderId === meId
  const counterpart = folder === 'inbox'
    ? (message.senderDisplayName || message.senderUsername)
    : (message.receiverDisplayName || message.receiverUsername)
  const unread = folder === 'inbox' && !message.isRead && !isMine

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full border-b border-slate-100 px-3 py-3 text-left transition-colors',
        active ? 'bg-primary-50' : 'hover:bg-white',
        unread && !active && 'bg-white',
      )}
    >
      <div className="flex items-center gap-2">
        <p className={cn('text-sm flex-1 truncate', unread ? 'font-semibold text-slate-900' : 'text-slate-700')}>
          {folder === 'inbox' ? '来自' : '发给'} {counterpart}
        </p>
        {unread && <span className="h-2 w-2 rounded-full bg-primary-500 shrink-0" />}
      </div>
      <p className="mt-0.5 text-xs text-slate-500 truncate">{message.body}</p>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
        <span>{new Date(message.createdAt).toLocaleString('zh-CN')}</span>
        {message.attachmentCount > 0 && (
          <span className="flex items-center gap-0.5">
            <FileText size={9} /> {message.attachmentCount}
          </span>
        )}
        {message.reviewId && (
          <span className="flex items-center gap-0.5">
            <Sparkles size={9} /> 审核
          </span>
        )}
        {message.caseId && (
          <span className="flex items-center gap-0.5">
            <Briefcase size={9} /> 案件
          </span>
        )}
      </div>
    </button>
  )
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function MessageDetailView({
  message, isAdmin, onDelete, onLegalRevisionUploaded,
}: {
  message: MessageRecord
  isAdmin: boolean
  onDelete: () => void
  onLegalRevisionUploaded: () => void
}) {
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [uploadingLegal, setUploadingLegal] = useState(false)
  const [uploadFlash, setUploadFlash] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const legalFileRef = useRef<HTMLInputElement>(null)

  async function onPickLegalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !message.reviewId) return
    // 限制必须是 Word 文档（.doc / .docx），方便业务人员后续在 Word 里继续修订
    const name = f.name.toLowerCase()
    if (!name.endsWith('.doc') && !name.endsWith('.docx')) {
      setUploadError('法务审核版必须是 Word 文档（.doc 或 .docx），方便业务人员继续修订')
      return
    }
    setUploadingLegal(true)
    setUploadError(null)
    setUploadFlash(null)
    try {
      await reviewsApi.uploadLegalRevision(message.reviewId, f)
      setUploadFlash(`已上传法务审核版「${f.name}」，业务人员可在合同台账下载`)
      onLegalRevisionUploaded()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploadingLegal(false)
      setTimeout(() => setUploadFlash(null), 4000)
    }
  }
  return (
    <>
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">
                {message.senderDisplayName || message.senderUsername}
              </span>
              <span className="mx-2 text-slate-300">→</span>
              <span className="font-medium text-slate-700">
                {message.receiverDisplayName || message.receiverUsername}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">{new Date(message.createdAt).toLocaleString('zh-CN')}</p>
          </div>
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* 关联案件 */}
        {message.caseId && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">关联案件</p>
            <p className="text-sm text-slate-700">
              <Briefcase size={12} className="inline mr-1 text-slate-400" />
              {message.caseNumber || '—'}{message.caseName ? ` · ${message.caseName}` : ''}
            </p>
          </div>
        )}

        {/* 留言正文 */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">留言</p>
          <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 font-sans">
            {message.body}
          </pre>
        </div>

        {/* 引用的审核 */}
        {message.review && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50">
            <button
              onClick={() => setReviewExpanded(!reviewExpanded)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-amber-50"
            >
              <Sparkles size={14} className="text-amber-600 shrink-0" />
              <p className="flex-1 text-sm font-medium text-slate-700 truncate">
                AI 审核意见 · {message.review.uploadedFilename}
              </p>
              <span className="text-[10px] text-slate-400">
                {reviewExpanded ? '收起' : '展开'}
              </span>
            </button>
            {reviewExpanded && (
              <div className="border-t border-amber-200/60 px-4 py-3 bg-white">
                <ReviewOpinionsView reviewText={message.review.reviewText} />
              </div>
            )}
          </div>
        )}

        {/* 法务上传审核版（仅 admin、且消息有 review 引用） */}
        {isAdmin && message.reviewId && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <Upload size={14} className="mt-0.5 text-emerald-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">上传法务审核版</p>
                <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
                  下载原合同修订后，把 <strong>Word 修订稿（.doc / .docx）</strong>上传到这里。
                  业务人员可以在「合同台账」对应版本下载，方便他们继续修订。重复上传会覆盖旧的。
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Upload size={11} />}
                loading={uploadingLegal}
                onClick={() => legalFileRef.current?.click()}
              >
                上传 Word 修订稿
              </Button>
              <input
                ref={legalFileRef}
                type="file"
                accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={onPickLegalFile}
              />
            </div>
            {uploadFlash && (
              <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 size={12} /> {uploadFlash}
              </p>
            )}
            {uploadError && (
              <p className="mt-2 text-xs text-red-700">{uploadError}</p>
            )}
          </div>
        )}

        {/* 附件 */}
        {message.attachments && message.attachments.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              附件（{message.attachments.length}）
            </p>
            <ul className="space-y-1.5">
              {message.attachments.map(a => (
                <li key={a.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                  <FileText size={14} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{a.filename}</p>
                    <p className="text-[10px] text-slate-400">{a.sizeBytes != null ? `${(a.sizeBytes / 1024).toFixed(1)} KB` : ''}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Download size={11} />}
                    onClick={() => messagesApi.downloadAttachment(message.id, a.id, a.filename)}
                  >
                    下载
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  )
}
