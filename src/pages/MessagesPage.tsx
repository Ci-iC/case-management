import { useEffect, useRef, useState } from 'react'
import { Mail, Send, Inbox, ArrowLeft, Trash2, Download, FileText, Briefcase, Sparkles, RefreshCw, Plus, Upload, CheckCircle2, CheckSquare } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/Modal'
import { messagesApi } from '@/api/messages'
import { reviewsApi } from '@/api/reviews'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import { hasCompanyRole } from '@/api/auth'
import type { MessageRecord } from '@/types'
import { ComposeMessageDialog } from '@/components/messages/ComposeMessageDialog'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'

type Folder = 'inbox' | 'sent'

interface MessagesPageProps {
  /** 点击审批通知里的"跳转到审批"按钮 */
  onJumpToApproval?: (approvalId: string) => void
}

export default function MessagesPage({ onJumpToApproval }: MessagesPageProps = {}) {
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
      // 选中第一条（仅桌面双栏布局；移动端先停在列表，避免一进来就把首条未读标已读）
      const isDesktop = window.matchMedia('(min-width: 1024px)').matches
      if (messages.length > 0 && !selected && isDesktop) {
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
        // 立即通知侧边栏/顶栏刷新未读数（不必等 30 秒轮询）
        window.dispatchEvent(new Event('messages:unread-changed'))
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
      // 删的可能是未读消息，通知刷新未读数
      window.dispatchEvent(new Event('messages:unread-changed'))
    } catch (e) {
      window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
    setDeleteId(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 shrink-0">
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
        {/* List：移动端单栏 —— 选中消息后隐藏列表、只显示详情 */}
        <aside className={cn(
          'col-span-12 lg:col-span-4 flex-col border-r border-slate-200 bg-slate-50',
          selected ? 'hidden lg:flex' : 'flex',
        )}>
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

        {/* Detail：移动端未选中时隐藏（显示列表） */}
        <section className={cn(
          'col-span-12 lg:col-span-8 flex-col overflow-hidden bg-white',
          selected ? 'flex' : 'hidden lg:flex',
        )}>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="lg:hidden flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              <ArrowLeft size={14} />返回列表
            </button>
          )}
          {selected ? (
            <MessageDetailView
              message={selected}
              canLegalReply={hasCompanyRole(me, 'legal')}
              onDelete={() => setDeleteId(selected.id)}
              onJumpToApproval={onJumpToApproval}
              onLegalRevisionUploaded={async () => {
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
        {message.hasLegalRevision && (
          <span className="flex items-center gap-0.5 text-emerald-600 font-medium">
            <CheckCircle2 size={9} /> 已修订
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

// canLegalReply: 当前用户能否在这条消息上做"法务答复"动作（上传修订版 / 直接通过）。
// v2.0 多租户起：法务 = 当前公司里有 'legal' 角色的用户（platform_user）。
// （v1.3.2 时曾等价于 isSuperAdmin，因为那时单租户、admin=法务；多租户后超管不参与业务。）
function MessageDetailView({
  message, canLegalReply, onDelete, onLegalRevisionUploaded, onJumpToApproval,
}: {
  message: MessageRecord
  canLegalReply: boolean
  onDelete: () => void
  onLegalRevisionUploaded: () => void
  onJumpToApproval?: (approvalId: string) => void
}) {
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [uploadingLegal, setUploadingLegal] = useState(false)
  const [approving, setApproving] = useState(false)
  const [uploadFlash, setUploadFlash] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [legalComment, setLegalComment] = useState('')
  const legalFileRef = useRef<HTMLInputElement>(null)

  async function onPickLegalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !message.reviewId) return
    // 限制必须是 Word 文档（.doc / .docx），方便业务人员后续在 Word 里继续修订
    const name = f.name.toLowerCase()
    if (!name.endsWith('.doc') && !name.endsWith('.docx')) {
      setUploadError('请上传 Word（.doc / .docx 格式）文档')
      return
    }
    setUploadingLegal(true)
    setUploadError(null)
    setUploadFlash(null)
    try {
      await reviewsApi.uploadLegalRevision(message.reviewId, f, legalComment.trim() || undefined)
      setUploadFlash(`已上传法务审核版「${f.name}」，已自动发站内信通知业务人员`)
      setLegalComment('')
      onLegalRevisionUploaded()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploadingLegal(false)
      setTimeout(() => setUploadFlash(null), 4000)
    }
  }

  async function onLegalApprove() {
    if (!message.reviewId) return
    if (!window.confirm('确认无需修订意见，让业务方直接用当前版本发起合同审批？')) return
    setApproving(true)
    setUploadError(null)
    setUploadFlash(null)
    try {
      await reviewsApi.legalApprove(message.reviewId, legalComment.trim() || undefined)
      setUploadFlash('已标记"无需修订直接通过"，业务方可直接发起合同审批')
      setLegalComment('')
      onLegalRevisionUploaded()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setApproving(false)
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

        {/* 法务答复区（v1.3.2 起：仅 superadmin，且消息有 review 引用） */}
        {canLegalReply && message.reviewId && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-slate-800">法务答复</p>
              {message.review?.reviewedFilename && (
                <p className="mt-1 text-[11px] text-emerald-700 leading-relaxed">
                  <CheckCircle2 size={11} className="inline mr-1" />
                  已上传修订版《{message.review.reviewedFilename}》
                  {message.review.reviewedAt && (
                    <span className="text-slate-500"> · {new Date(message.review.reviewedAt).toLocaleString('zh-CN')}</span>
                  )}
                  <span className="block mt-0.5 text-slate-500">如需更新，重新上传会覆盖旧版本并再次自动通知业务人员。</span>
                </p>
              )}
              {!message.review?.reviewedFilename && (
                <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                  上传 Word 修订稿、或点"无需修订直接通过"。两者都会自动发站内信通知业务人员。
                </p>
              )}
            </div>

            {/* 留言（修订版和直接通过都用）*/}
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">留言（可选，会拼进给业务方的通知消息）</label>
              <textarea
                className="form-textarea text-sm"
                rows={2}
                value={legalComment}
                onChange={e => setLegalComment(e.target.value)}
                placeholder="例如：付款节奏建议改为先 50% 再 50%；其他无问题，可发起审批"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="primary"
                size="sm"
                icon={<Upload size={11} />}
                loading={uploadingLegal}
                disabled={approving}
                onClick={() => legalFileRef.current?.click()}
              >
                {message.review?.reviewedFilename ? '重新上传修订稿' : '上传 Word 修订稿'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<CheckCircle2 size={11} />}
                loading={approving}
                disabled={uploadingLegal}
                onClick={onLegalApprove}
              >
                无需修订，直接通过
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
              <p className="flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 size={12} /> {uploadFlash}
              </p>
            )}
            {uploadError && (
              <p className="text-xs text-red-700">{uploadError}</p>
            )}
          </div>
        )}

        {/* 系统审批通知 → 跳转到审批详情按钮 */}
        {message.approvalId && (
          <div className="rounded-lg border border-primary-200 bg-primary-50/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <CheckSquare size={16} className="text-primary-600 shrink-0" />
              <p className="flex-1 text-sm text-slate-700">这是一条审批流转通知，点击右侧按钮跳转到审批详情</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onJumpToApproval?.(message.approvalId!)}
              >
                跳转到审批
              </Button>
            </div>
          </div>
        )}

        {/* 附件分两组：合同（来自 review 引用）+ 其他附件 */}
        {(() => {
          const all = message.attachments || []
          if (all.length === 0) return null
          const contractAtts = all.filter(a => a.reviewFileKind)
          const otherAtts = all.filter(a => !a.reviewFileKind)
          return (
            <>
              {contractAtts.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    合同文件（{contractAtts.length}）
                  </p>
                  <ul className="space-y-1.5">
                    {contractAtts.map(a => {
                      const isLegal = a.reviewFileKind === 'legal'
                      return (
                        <li
                          key={a.id}
                          className={cn(
                            'flex items-center gap-2 rounded border px-3 py-2',
                            isLegal ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40',
                          )}
                        >
                          <FileText size={14} className={cn('shrink-0', isLegal ? 'text-emerald-600' : 'text-amber-600')} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                                  isLegal ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                                )}
                              >
                                {isLegal ? '法务审核版' : '原合同'}
                              </span>
                              <p className="text-sm text-slate-700 truncate">{a.filename}</p>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {a.sizeBytes != null ? `${(a.sizeBytes / 1024).toFixed(1)} KB` : ''}
                            </p>
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
                      )
                    })}
                  </ul>
                </div>
              )}

              {otherAtts.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    其他附件（{otherAtts.length}）
                  </p>
                  <ul className="space-y-1.5">
                    {otherAtts.map(a => (
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
            </>
          )
        })()}
      </div>
    </>
  )
}
