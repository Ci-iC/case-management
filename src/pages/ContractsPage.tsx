import { useEffect, useState } from 'react'
import {
  FolderOpen, FileText, Sparkles, Download, Search, ChevronRight, ArrowLeft,
  RefreshCw, Calendar, User as UserIcon, FileCheck, ChevronDown, ChevronUp, CheckSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { contractsApi } from '@/api/contracts'
import { reviewsApi } from '@/api/reviews'
import { downloadSealedContract } from '@/api/approvals'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'
import { ApiError } from '@/api/client'
import { cn } from '@/utils/helpers'
import { CONTRACT_STATUS_BADGE, CONTRACT_STATUS_LABELS } from '@/constants'
import type { ContractRecord, ContractReviewVersion, ContractStatus } from '@/types'

type StatusFilter = 'all' | ContractStatus

interface ContractsPageProps {
  /** 跳转到审批详情（由 AppLayout 提供，跨页面切换） */
  onJumpToApproval?: (approvalId: string) => void
}

export default function ContractsPage({ onJumpToApproval }: ContractsPageProps = {}) {
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ContractRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null)
  // v1.3.1 详情页两个折叠区
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)

  async function loadList() {
    setLoading(true)
    setError(null)
    try {
      const { contracts } = await contractsApi.list()
      setContracts(contracts)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '加载失败'))
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true)
    setDetail(null)
    setSelectedId(id)
    try {
      const { contract } = await contractsApi.get(id)
      setDetail(contract)
      // v1.3.1: 不默认展开任何版本，让用户点击 v1/v2 自己选择展开
      setExpandedReviewId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => { loadList() }, [])

  const filtered = contracts.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase()
      return c.name.toLowerCase().includes(k) ||
        (c.code || '').toLowerCase().includes(k) ||
        (c.description || '').toLowerCase().includes(k)
    }
    return true
  })

  const counts = {
    all:           contracts.length,
    drafting:      contracts.filter(c => c.status === 'drafting').length,
    approving:     contracts.filter(c => c.status === 'approving').length,
    pending_seal:  contracts.filter(c => c.status === 'pending_seal').length,
    sealed:        contracts.filter(c => c.status === 'sealed').length,
  }

  // 详情视图
  if (selectedId && (detail || detailLoading)) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-6 shrink-0">
          <button onClick={() => { setSelectedId(null); setDetail(null) }} className="text-slate-400 hover:text-slate-700">
            <ArrowLeft size={18} />
          </button>
          <FolderOpen size={18} className="text-primary-600" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-slate-900 truncate flex items-center gap-2">
              {detail?.code && (
                <span className="font-mono text-primary-700 bg-primary-50 px-2 py-0.5 rounded text-sm shrink-0">
                  {detail.code}
                </span>
              )}
              {detail && (
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium border shrink-0',
                  CONTRACT_STATUS_BADGE[detail.status],
                )}>
                  {CONTRACT_STATUS_LABELS[detail.status]}
                </span>
              )}
              <span className="truncate">{detail?.name || '加载中…'}</span>
            </h1>
            {detail && (
              <p className="text-[11px] text-slate-400">
                共 {detail.versionCount} 次审核 · 创建人 {detail.createdByDisplayName || detail.createdByUsername || '—'}
                {detail.lastReviewedAt && ` · 上次审核 ${new Date(detail.lastReviewedAt).toLocaleString('zh-CN')}`}
                {detail.sealedAt && ` · 已签署 ${new Date(detail.sealedAt).toLocaleDateString('zh-CN')}`}
              </p>
            )}
          </div>
          {detail?.sealedFilename && (
            <Button
              variant="primary"
              size="sm"
              icon={<FileCheck size={12} />}
              onClick={() => downloadSealedContract(detail.id, detail.sealedFilename!)}
            >
              下载用印版
            </Button>
          )}
        </header>

        {detail?.description && (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-2 text-xs text-slate-600">
            {detail.description}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 max-w-4xl mx-auto w-full">
          {detailLoading && <p className="text-center text-sm text-slate-400 py-6">加载中…</p>}

          {/* AI 合同摘要 */}
          {detail && (
            <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={14} className="text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">AI 合同摘要</p>
                {detail.summaryGeneratedAt && (
                  <span className="text-[11px] text-amber-600/70">
                    · 生成于 {new Date(detail.summaryGeneratedAt).toLocaleString('zh-CN')}
                  </span>
                )}
              </div>
              {detail.summary ? (
                <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 font-sans">
                  {detail.summary}
                </pre>
              ) : (
                <p className="text-sm text-amber-700/80 italic">
                  本合同尚未生成 AI 摘要（在合同发起审批时会自动生成）
                </p>
              )}
            </section>
          )}

          {/* 折叠区 1：修订过程 */}
          {detail && (
            <section className="rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setRevisionsOpen(!revisionsOpen)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">修订过程</span>
                  <span className="text-xs text-slate-400">{detail.reviews?.length || 0} 版</span>
                </div>
                {revisionsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {revisionsOpen && (
                <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                  {detail.reviews && detail.reviews.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">该合同还没有审核版本</p>
                  )}
                  {detail.reviews?.map(rv => (
                    <VersionCard
                      key={rv.id}
                      review={rv}
                      total={detail.reviews?.length || 0}
                      expanded={expandedReviewId === rv.id}
                      onToggle={() => setExpandedReviewId(expandedReviewId === rv.id ? null : rv.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 折叠区 2：审批及用印版 */}
          {detail && (
            <section className="rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setApprovalOpen(!approvalOpen)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <CheckSquare size={16} className="text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">审批及用印版</span>
                  {detail.status === 'approving' && (
                    <span className="text-[10px] rounded bg-blue-100 text-blue-700 px-1.5 py-0.5">审批中</span>
                  )}
                  {detail.status === 'pending_seal' && (
                    <span className="text-[10px] rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">待签署</span>
                  )}
                  {detail.status === 'sealed' && (
                    <span className="text-[10px] rounded bg-emerald-100 text-emerald-700 px-1.5 py-0.5">已签署</span>
                  )}
                </div>
                {approvalOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {approvalOpen && (
                <div className="border-t border-slate-100 px-4 py-4 space-y-3">
                  {!detail.latestApprovalId ? (
                    <p className="text-sm text-slate-400 text-center py-4">该合同还没有发起过审批</p>
                  ) : (
                    <>
                      <Button
                        variant="primary"
                        size="md"
                        icon={<ChevronRight size={14} />}
                        onClick={() => onJumpToApproval?.(detail.latestApprovalId!)}
                      >
                        查看审批详情（含审批流水、操作记录、AI 摘要）
                      </Button>
                    </>
                  )}
                  {detail.sealedFilename && (
                    <Button
                      variant="outline"
                      size="md"
                      icon={<FileCheck size={14} />}
                      onClick={() => downloadSealedContract(detail.id, detail.sealedFilename!)}
                    >
                      下载用印版（{detail.sealedFilename}）
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    )
  }

  // 列表视图
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shrink-0">
        <div className="flex items-center gap-2">
          <FolderOpen size={18} className="text-primary-600" />
          <h1 className="text-base font-semibold text-slate-900">合同台账</h1>
          <span className="text-xs text-slate-400">所有审核过的合同 + 历史版本</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索合同名"
              className="rounded border border-slate-200 pl-7 pr-2.5 py-1 text-xs w-48 focus:outline-none focus:border-primary-400"
            />
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={loadList}>
            刷新
          </Button>
        </div>
      </header>

      {/* 状态筛选 tabs */}
      <div className="flex border-b border-slate-200 bg-white px-4 overflow-x-auto">
        {([
          { v: 'all',          label: '全部' },
          { v: 'drafting',     label: CONTRACT_STATUS_LABELS.drafting },
          { v: 'approving',    label: CONTRACT_STATUS_LABELS.approving },
          { v: 'pending_seal', label: CONTRACT_STATUS_LABELS.pending_seal },
          { v: 'sealed',       label: CONTRACT_STATUS_LABELS.sealed },
        ] as { v: StatusFilter; label: string }[]).map(t => (
          <button
            key={t.v}
            onClick={() => setStatusFilter(t.v)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px shrink-0',
              statusFilter === t.v
                ? 'text-primary-700 border-primary-600'
                : 'text-slate-500 border-transparent hover:text-slate-700',
            )}
          >
            {t.label}
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[10px]',
              statusFilter === t.v ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500',
            )}>
              {counts[t.v]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-6 mt-3 rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && contracts.length === 0 && (
          <p className="text-center text-xs text-slate-400 py-6">加载中…</p>
        )}
        {!loading && contracts.length === 0 && (
          <div className="flex h-full items-center justify-center text-slate-400">
            <div className="text-center">
              <FolderOpen size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm">还没有合同记录</p>
              <p className="mt-1 text-xs text-slate-400">到「合同审核」上传一份合同，台账会自动建立</p>
            </div>
          </div>
        )}
        {!loading && filtered.length === 0 && contracts.length > 0 && (
          <p className="text-center text-xs text-slate-400 py-6">没有匹配「{keyword}」的合同</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => loadDetail(c.id)}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-primary-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <FolderOpen size={16} className="text-primary-500 mt-0.5 shrink-0" />
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium border',
                    CONTRACT_STATUS_BADGE[c.status],
                  )}>
                    {CONTRACT_STATUS_LABELS[c.status]}
                  </span>
                  <span className="rounded-full bg-primary-50 text-primary-700 px-2 py-0.5 text-[10px] font-medium">
                    v{c.versionCount}
                  </span>
                </div>
              </div>
              <p className="font-mono text-[11px] text-primary-700 mb-1">{c.code}</p>
              <p className="text-sm font-semibold text-slate-800 mb-1 line-clamp-2">{c.name}</p>
              {c.description && (
                <p className="text-[11px] text-slate-500 line-clamp-2 mb-2">{c.description}</p>
              )}
              <div className="flex items-center gap-3 text-[10px] text-slate-400">
                <span className="flex items-center gap-0.5">
                  <UserIcon size={9} /> {c.createdByDisplayName || c.createdByUsername || '—'}
                </span>
                <span className="flex items-center gap-0.5">
                  <Calendar size={9} />
                  {c.lastReviewedAt ? new Date(c.lastReviewedAt).toLocaleDateString('zh-CN') : '—'}
                </span>
                <ChevronRight size={11} className="ml-auto text-slate-300" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function VersionCard({
  review, total, expanded, onToggle,
}: {
  review: ContractReviewVersion
  total: number
  expanded: boolean
  onToggle: () => void
}) {
  const isLatest = review.version === total
  return (
    <div className={cn(
      'rounded-lg border bg-white',
      expanded ? 'border-primary-200' : 'border-slate-200'
    )}>
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50/60"
      >
        <span className={cn(
          'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shrink-0',
          isLatest ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500',
        )}>
          v{review.version}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileText size={12} className="text-slate-400 shrink-0" />
            <p className="text-sm font-medium text-slate-700 truncate">{review.uploadedFilename}</p>
            {isLatest && (
              <span className="rounded bg-primary-50 text-primary-700 px-1.5 py-0.5 text-[10px]">最新</span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {new Date(review.createdAt).toLocaleString('zh-CN')} ·
            上传人 {review.createdByDisplayName || review.createdByUsername || '—'}
          </p>
        </div>
        <ChevronRight size={14} className={cn(
          'shrink-0 text-slate-400 transition-transform mt-1',
          expanded && 'rotate-90'
        )} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <div className="flex items-center gap-1 mb-1">
            <Sparkles size={11} className="text-amber-600" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">AI 审核意见</p>
          </div>
          <ReviewOpinionsView reviewText={review.reviewText} />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Download size={11} />}
              onClick={() => reviewsApi.downloadOriginal(review.id, review.uploadedFilename)}
            >
              下载原始版
            </Button>
            {review.reviewedFilename ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Download size={11} />}
                onClick={() => reviewsApi.downloadLegalRevision(review.id, review.reviewedFilename!)}
              >
                下载法务审核版
              </Button>
            ) : (
              <span className="text-[10px] text-slate-400 italic">
                法务尚未上传审核版
              </span>
            )}
            {review.reviewedAt && (
              <span className="text-[10px] text-slate-400">
                · 法务版上传于 {new Date(review.reviewedAt).toLocaleString('zh-CN')}
                {review.reviewedByDisplayName && `（${review.reviewedByDisplayName}）`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
