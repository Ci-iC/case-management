import { useEffect, useState } from 'react'
import {
  FolderOpen, FileText, Sparkles, Download, Search, ChevronRight, ArrowLeft,
  RefreshCw, Calendar, User as UserIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { contractsApi } from '@/api/contracts'
import { reviewsApi } from '@/api/reviews'
import { ReviewOpinionsView } from '@/components/reviews/ReviewOpinionsView'
import { ApiError } from '@/api/client'
import { cn } from '@/utils/helpers'
import type { ContractRecord, ContractReviewVersion } from '@/types'

export default function ContractsPage() {
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ContractRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null)

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
      // 默认展开最新版本
      if (contract.reviews && contract.reviews.length > 0) {
        setExpandedReviewId(contract.reviews[contract.reviews.length - 1].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => { loadList() }, [])

  const filtered = keyword.trim()
    ? contracts.filter(c =>
        c.name.toLowerCase().includes(keyword.trim().toLowerCase()) ||
        (c.description || '').toLowerCase().includes(keyword.trim().toLowerCase())
      )
    : contracts

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
            <h1 className="text-base font-semibold text-slate-900 truncate">
              {detail?.name || '加载中…'}
            </h1>
            {detail && (
              <p className="text-[11px] text-slate-400">
                共 {detail.versionCount} 次审核 · 创建人 {detail.createdByDisplayName || detail.createdByUsername || '—'}
                {detail.lastReviewedAt && ` · 上次审核 ${new Date(detail.lastReviewedAt).toLocaleString('zh-CN')}`}
              </p>
            )}
          </div>
        </header>

        {detail?.description && (
          <div className="border-b border-slate-100 bg-slate-50 px-6 py-2 text-xs text-slate-600">
            {detail.description}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {detailLoading && <p className="text-center text-xs text-slate-400 py-6">加载中…</p>}
          {detail && detail.reviews && detail.reviews.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-6">该合同还没有审核版本</p>
          )}
          {detail?.reviews?.map(rv => (
            <VersionCard
              key={rv.id}
              review={rv}
              total={detail.reviews?.length || 0}
              expanded={expandedReviewId === rv.id}
              onToggle={() => setExpandedReviewId(expandedReviewId === rv.id ? null : rv.id)}
            />
          ))}
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
                <span className="rounded-full bg-primary-50 text-primary-700 px-2 py-0.5 text-[10px] font-medium">
                  v{c.versionCount}
                </span>
              </div>
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
            上传人 {review.createdByDisplayName || review.createdByUsername || '—'} ·
            模型 {review.model || '—'}
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
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Download size={11} />}
              onClick={() => reviewsApi.downloadOriginal(review.id, review.uploadedFilename)}
            >
              下载原文件
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
