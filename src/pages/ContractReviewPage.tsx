import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, Send, Download, Sparkles, ChevronDown, ChevronUp, Workflow, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { reviewsApi } from '@/api/reviews'
import { pipelinesApi } from '@/api/pipelines'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import { isSuperAdmin } from '@/api/auth'
import type { ReviewRecord, Pipeline } from '@/types'
import { ComposeMessageDialog } from '@/components/messages/ComposeMessageDialog'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'
import { ReviewParamsDialog, type Intensity } from '@/components/reviews/ReviewParamsDialog'

type Mode = 'formal' | 'self'

const MODE_INFO: Record<Mode, { label: string; desc: string }> = {
  formal: {
    label: '发起审核',
    desc: 'AI 审核完成后，可以选择「发送给法务审核」，附原文件 + 审核意见 + 留言',
  },
  self: {
    label: '智能审核',
    desc: '只是给自己看一眼审核结果，不发给法务',
  },
}

const ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export default function ContractReviewPage() {
  // v1.3.2 起：仅 superadmin 是法务（不显示"发送给法务审核"按钮和模式切换）；
  // admin 是公司高管/领导，也是业务方角色，需要走完整流程：AI 审核 → 发法务（superadmin）
  const isSuper = useAuthStore(s => isSuperAdmin(s.user))
  const [mode, setMode] = useState<Mode>('formal')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<ReviewRecord | null>(null)
  const [history, setHistory] = useState<ReviewRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [composeFor, setComposeFor] = useState<ReviewRecord | null>(null)
  const [submittedOpen, setSubmittedOpen] = useState(false)
  const [reviewedFlashOpen, setReviewedFlashOpen] = useState(false)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipelineId, setPipelineId] = useState<string>('')
  const [paramsOpen, setParamsOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const { reviews } = await reviewsApi.list()
      setHistory(reviews)
    } catch (e) {
      console.error(e)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadPipelines() {
    try {
      const { pipelines } = await pipelinesApi.list()
      setPipelines(pipelines)
      const def = pipelines.find(p => p.isDefault)
      if (def) setPipelineId(def.id)
      else if (pipelines[0]) setPipelineId(pipelines[0].id)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    loadHistory()
    loadPipelines()
  }, [])

  function pickFile(f: File | null) {
    setFile(f)
    setError(null)
  }

  // 点"开始审核"按钮时调：先做前置校验，通过后弹参数对话框
  // v1.2 起：合同关联推迟到"发送给法务审核"，这里不再校验合同
  function openParamsDialog() {
    setError(null)
    if (!file) { setError('请先选择文件'); return }
    setParamsOpen(true)
  }

  // 参数对话框确认后真正发起审核（草稿态写入 case_reviews，is_draft=true）
  async function doSubmit({ ourRole, reviewIntensity }: { ourRole: string; reviewIntensity: Intensity }) {
    if (!file) return
    setSubmitting(true)
    setError(null)
    try {
      const { review } = await reviewsApi.create(file, {
        pipelineId: pipelineId || undefined,
        ourRole: ourRole || undefined,
        reviewIntensity,
      })
      setLatest(review)
      setExpandedId(review.id)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setParamsOpen(false)
      // v1.3.1: AI 审核完成后弹一次提示，提醒用户这只是辅助
      // v1.3.2: 仅业务方（含 admin 高管）才弹；superadmin 自己是法务不需要"再发给法务"的提醒
      if (!isSuper) setReviewedFlashOpen(true)
      await loadHistory()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '审核失败'))
      setParamsOpen(false)  // 失败时关闭对话框，错误显示在主区域
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPipeline = pipelines.find(p => p.id === pipelineId) || null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary-600" />
          <h1 className="text-base font-semibold text-slate-900">合同审核</h1>
          <span className="hidden sm:inline text-xs text-slate-400">由 AI 给出修改建议</span>
        </div>
        {!isSuper && (
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(['formal', 'self'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors ' +
                  (mode === m
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700')
                }
              >
                {MODE_INFO[m].label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Mode hint - superadmin 不需要显示（superadmin 自己就是法务） */}
      {!isSuper && (
        <div className="border-b border-slate-100 bg-amber-50/40 px-4 sm:px-6 py-2 text-xs text-amber-800">
          {MODE_INFO[mode].desc}
        </div>
      )}

      {/* Body：移动端上下堆叠整页滚动；lg 以上双栏、各自内滚 */}
      <div className="flex flex-col lg:grid flex-1 lg:grid-cols-12 gap-0 overflow-y-auto lg:overflow-hidden">

        {/* Left: upload + current result */}
        <section className="lg:col-span-7 flex flex-col lg:overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-200">
          {/* Pipeline picker + Upload area */}
          <div className="border-b border-slate-100 px-4 sm:px-6 py-4 space-y-3">
            {/* Pipeline picker */}
            <div className="flex items-center gap-2">
              <Workflow size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-600 shrink-0">审核模型：</span>
              <select
                className="flex-1 max-w-md rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none focus:border-primary-400"
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
                disabled={pipelines.length === 0}
              >
                {pipelines.length === 0 && <option value="">（加载中…）</option>}
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.isDefault ? ' · 默认' : ''}（{p.steps.filter(s => s.enabled).length} 个并行节点）
                  </option>
                ))}
              </select>
              {selectedPipeline?.description && (
                <span className="text-[10px] text-slate-400 italic truncate">{selectedPipeline.description}</span>
              )}
            </div>

            <UploadZone
              file={file}
              onPick={pickFile}
              onSubmit={openParamsDialog}
              submitting={submitting}
              fileInputRef={fileInputRef}
              modeLabel={MODE_INFO[mode].label}
            />
            {error && (
              <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
          </div>

          {/* Latest result */}
          <div className="flex-1 lg:overflow-y-auto px-4 sm:px-6 py-5">
            {latest ? (
              <ReviewBlock
                review={latest}
                mode={mode}
                showSendButton={mode === 'formal' && !isSuper}
                onSendToLegal={() => setComposeFor(latest)}
                onDownload={() => reviewsApi.downloadOriginal(latest.id, latest.uploadedFilename)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">
                <div className="text-center">
                  <FileText size={32} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm">上传一份文件，AI 会给出修改建议</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right: history */}
        <aside className="lg:col-span-5 flex flex-col lg:overflow-hidden bg-slate-50">
          <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">历史审核</p>
            <button onClick={loadHistory} className="text-xs text-primary-600 hover:underline">
              刷新
            </button>
          </div>
          <div className="flex-1 lg:overflow-y-auto px-3 py-3 space-y-2">
            {historyLoading && history.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-6">加载中…</p>
            )}
            {!historyLoading && history.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-6">暂无审核记录</p>
            )}
            {history.map(r => (
              <HistoryItem
                key={r.id}
                review={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onDownload={() => reviewsApi.downloadOriginal(r.id, r.uploadedFilename)}
              />
            ))}
          </div>
        </aside>
      </div>

      <ComposeMessageDialog
        open={!!composeFor}
        prefillReview={composeFor || undefined}
        onClose={() => setComposeFor(null)}
        onSent={() => {
          // 发送成功后：立刻弹"已提交"提示 + 重置审核会话回到初始界面，
          // 避免主区那个"发送给法务审核"按钮还在 → 用户误以为没发出去再点一次
          setComposeFor(null)
          setLatest(null)
          setExpandedId(null)
          loadHistory()  // 让右侧历史立刻显示这次提交
          setSubmittedOpen(true)
        }}
      />

      {/* AI 审核完成提示：辅助参考，正式需提交法务 */}
      <Modal
        open={reviewedFlashOpen}
        onClose={() => setReviewedFlashOpen(false)}
        title="AI 审核完成"
      >
        <div className="w-[26rem] max-w-full">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
              <Sparkles size={22} className="text-amber-500" />
            </div>
            <div className="flex-1 text-sm text-slate-700 leading-relaxed">
              <p>
                AI 已经给出了一份审核意见。请注意，<strong>AI 审核仅供参考</strong>，
                不能替代法务的正式审核。
              </p>
              <p className="mt-2">
                如需正式过法务，请在审核结果右上角点击 <strong>「发送给法务审核」</strong>。
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" size="md" onClick={() => setReviewedFlashOpen(false)}>
              知道了
            </Button>
          </div>
        </div>
      </Modal>

      {/* 已提交法务审核：必须点"知道了"才关，避免误关 */}
      <Modal
        open={submittedOpen}
        onClose={() => setSubmittedOpen(false)}
        title="已提交法务审核"
      >
        <div className="w-[26rem] max-w-full">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={22} className="text-emerald-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-700 leading-relaxed">
                您的合同已成功提交法务审核，预计 <strong>1~2 个工作日</strong> 内回复。
              </p>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                法务上传修订版后，您会在「消息中心」收到通知，可直接下载法务审核版。
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" size="md" onClick={() => setSubmittedOpen(false)}>
              知道了
            </Button>
          </div>
        </div>
      </Modal>

      <ReviewParamsDialog
        open={paramsOpen}
        submitLabel={MODE_INFO[mode].label}
        loading={submitting}
        onCancel={() => setParamsOpen(false)}
        onConfirm={doSubmit}
      />
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UploadZone({
  file, onPick, onSubmit, submitting, fileInputRef, modeLabel,
}: {
  file: File | null
  onPick: (f: File | null) => void
  onSubmit: () => void
  submitting: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  modeLabel: string
}) {
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) onPick(f)
  }

  return (
    <div className="flex items-center gap-3">
      <label
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        className={
          'flex flex-1 cursor-pointer items-center gap-3 rounded-md border-2 border-dashed px-4 py-3 transition-colors ' +
          (file ? 'border-primary-300 bg-primary-50/40' : 'border-slate-200 bg-slate-50 hover:border-slate-300')
        }
      >
        <Upload size={18} className={file ? 'text-primary-600' : 'text-slate-400'} />
        <div className="flex-1 min-w-0">
          {file ? (
            <>
              <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
              <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB · 点击或拖拽换一个</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-600">点击或拖拽文件到这里</p>
              <p className="text-xs text-slate-400">请上传 Word（.doc / .docx 格式）文档，单文件 20MB 以内</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={e => onPick(e.target.files?.[0] || null)}
        />
      </label>
      <Button
        variant="primary"
        size="lg"
        loading={submitting}
        disabled={!file}
        icon={<Sparkles size={14} />}
        onClick={onSubmit}
      >
        {submitting ? '审核中…' : modeLabel}
      </Button>
    </div>
  )
}

function ReviewBlock({
  review, showSendButton, onSendToLegal, onDownload,
}: {
  review: ReviewRecord
  mode: Mode
  showSendButton: boolean
  onSendToLegal: () => void
  onDownload: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-slate-400 shrink-0" />
            <p className="text-sm font-medium text-slate-800 truncate">{review.uploadedFilename}</p>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {new Date(review.createdAt).toLocaleString('zh-CN')} · 模型 {review.model || '-'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" icon={<Download size={12} />} onClick={onDownload}>
            原文件
          </Button>
          {showSendButton && (
            <Button variant="primary" size="sm" icon={<Send size={12} />} onClick={onSendToLegal}>
              发送给法务审核
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          AI 审核意见
        </p>
        <ReviewOpinionsView reviewText={review.reviewText} />
      </div>
    </div>
  )
}

function HistoryItem({
  review, expanded, onToggle, onDownload,
}: {
  review: ReviewRecord
  expanded: boolean
  onToggle: () => void
  onDownload: () => void
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
      >
        <FileText size={14} className="text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700 truncate">{review.uploadedFilename}</p>
          <p className="text-[10px] text-slate-400">
            {new Date(review.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>
        {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-3 py-2.5 space-y-2">
          <div className="max-h-96 overflow-y-auto">
            <ReviewOpinionsView reviewText={review.reviewText} compact />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" icon={<Download size={11} />} onClick={onDownload}>
              原文件
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
