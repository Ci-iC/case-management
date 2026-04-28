import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, Send, Download, Sparkles, ChevronDown, ChevronUp, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { reviewsApi } from '@/api/reviews'
import { pipelinesApi } from '@/api/pipelines'
import { contractsApi } from '@/api/contracts'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import type { ReviewRecord, Pipeline, ContractRecord } from '@/types'
import { ComposeMessageDialog } from '@/components/messages/ComposeMessageDialog'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'

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

const ACCEPT = '.pdf,.docx,.doc,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain'

export default function ContractReviewPage() {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [mode, setMode] = useState<Mode>('formal')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<ReviewRecord | null>(null)
  const [history, setHistory] = useState<ReviewRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [composeFor, setComposeFor] = useState<ReviewRecord | null>(null)
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipelineId, setPipelineId] = useState<string>('')
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [contractMode, setContractMode] = useState<'new' | 'existing'>('new')
  const [contractName, setContractName] = useState<string>('')
  const [contractId, setContractId] = useState<string>('')

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

  async function loadContracts() {
    try {
      const { contracts } = await contractsApi.list()
      setContracts(contracts)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    loadHistory()
    loadPipelines()
    loadContracts()
  }, [])

  function pickFile(f: File | null) {
    setFile(f)
    setError(null)
  }

  async function onSubmit() {
    if (!file) return
    // 必须确定合同：新合同要填名称，已有合同要选一条
    if (contractMode === 'new' && !contractName.trim()) {
      setError('请填写合同名称（如"采购合同 - 某供应商"），方便后续在合同台账里追溯')
      return
    }
    if (contractMode === 'existing' && !contractId) {
      setError('请选择关联的已有合同，或切换到"新合同"')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const opts: Parameters<typeof reviewsApi.create>[1] = {
        pipelineId: pipelineId || undefined,
      }
      if (contractMode === 'new') opts.contractName = contractName.trim()
      else opts.contractId = contractId
      const { review } = await reviewsApi.create(file, opts)
      setLatest(review)
      setExpandedId(review.id)
      setFile(null)
      setContractName('')  // 提交后清空合同名输入框
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadHistory()
      await loadContracts()  // 刷新合同列表（可能新建了一条）
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '审核失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPipeline = pipelines.find(p => p.id === pipelineId) || null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary-600" />
          <h1 className="text-base font-semibold text-slate-900">合同审核</h1>
          <span className="text-xs text-slate-400">由 AI 给出修改建议</span>
        </div>
        {!isAdmin && (
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

      {/* Mode hint - admin 不需要显示（admin 自己就是法务） */}
      {!isAdmin && (
        <div className="border-b border-slate-100 bg-amber-50/40 px-6 py-2 text-xs text-amber-800">
          {MODE_INFO[mode].desc}
        </div>
      )}

      {/* Body */}
      <div className="grid flex-1 grid-cols-12 gap-0 overflow-hidden">

        {/* Left: upload + current result */}
        <section className="col-span-7 flex flex-col overflow-hidden border-r border-slate-200">
          {/* Contract picker + Pipeline picker + Upload area */}
          <div className="border-b border-slate-100 px-6 py-4 space-y-3">
            {/* Contract picker */}
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-600 shrink-0">合同：</span>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 shrink-0">
                {(['new', 'existing'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setContractMode(m)}
                    className={
                      'rounded px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                      (contractMode === m
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700')
                    }
                  >
                    {m === 'new' ? '新合同' : '已有合同的新版本'}
                  </button>
                ))}
              </div>
              {contractMode === 'new' ? (
                <input
                  type="text"
                  className="flex-1 max-w-md rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none focus:border-primary-400"
                  value={contractName}
                  onChange={(e) => setContractName(e.target.value)}
                  placeholder='给这份合同起个名字，如"采购合同 - 某供应商"'
                />
              ) : (
                <select
                  className="flex-1 max-w-md rounded border border-slate-200 px-2.5 py-1 text-xs focus:outline-none focus:border-primary-400"
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                >
                  <option value="">选择已有合同…</option>
                  {contracts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}（已审 {c.versionCount} 次）
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Pipeline picker */}
            <div className="flex items-center gap-2">
              <Workflow size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-600 shrink-0">使用流水线：</span>
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
              onSubmit={onSubmit}
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
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {latest ? (
              <ReviewBlock
                review={latest}
                mode={mode}
                showSendButton={mode === 'formal' && !isAdmin}
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
        <aside className="col-span-5 flex flex-col overflow-hidden bg-slate-50">
          <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">历史审核</p>
            <button onClick={loadHistory} className="text-xs text-primary-600 hover:underline">
              刷新
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
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
        onSent={() => setComposeFor(null)}
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
              <p className="text-xs text-slate-400">支持 .pdf / .docx / .txt，单文件 20MB 以内</p>
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
