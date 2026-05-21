import { useEffect, useState } from 'react'
import { CheckSquare, Inbox, Send, RefreshCw, Plus, ChevronRight, Clock, ArrowLeft } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { Button } from '@/components/ui/Button'
import { approvalsApi } from '@/api/approvals'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import type { ApprovalRecord, ContractStatus } from '@/types'
import { CONTRACT_STATUS_BADGE, CONTRACT_STATUS_LABELS } from '@/constants'
import { InitiateApprovalDialog } from '@/components/approvals/InitiateApprovalDialog'
import { ApprovalDetailView } from '@/components/approvals/ApprovalDetailView'

type Tab = 'todo' | 'initiated'

interface ApprovalsPageProps {
  /** 从消息中心跳转过来时带的审批 id，进入页面后自动打开详情 */
  initialApprovalId?: string | null
  /** 已消费 initialApprovalId 后通知父组件清空，避免下次进入仍然跳那条 */
  onConsumedInitial?: () => void
}

export default function ApprovalsPage({ initialApprovalId, onConsumedInitial }: ApprovalsPageProps = {}) {
  const me = useAuthStore(s => s.user)
  const [tab, setTab] = useState<Tab>('todo')
  const [list, setList] = useState<ApprovalRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [initiateOpen, setInitiateOpen] = useState(false)

  // 接收外部传入的"待打开"审批 id（来自消息中心跳转 / 合同台账跳转）
  useEffect(() => {
    if (initialApprovalId) {
      setSelectedId(initialApprovalId)
      onConsumedInitial?.()
    }
  }, [initialApprovalId, onConsumedInitial])

  async function loadList() {
    setLoading(true)
    setError(null)
    try {
      const { approvals } = await approvalsApi.list(tab)
      setList(approvals)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadList() }, [tab])  // eslint-disable-line react-hooks/exhaustive-deps

  // 详情视图
  if (selectedId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-6 shrink-0">
          <button onClick={() => { setSelectedId(null); loadList() }} className="text-slate-400 hover:text-slate-700">
            <ArrowLeft size={18} />
          </button>
          <CheckSquare size={18} className="text-primary-600" />
          <h1 className="text-base font-semibold text-slate-900">审批详情</h1>
        </header>
        <ApprovalDetailView
          approvalId={selectedId}
          onActionDone={() => { setSelectedId(null); loadList() }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6 shrink-0">
        <div className="flex items-center gap-2">
          <CheckSquare size={18} className="text-primary-600" />
          <h1 className="text-base font-semibold text-slate-900">合同审批</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw size={12} />} onClick={loadList}>
            刷新
          </Button>
          <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setInitiateOpen(true)}>
            发起审批
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white">
        {(['todo', 'initiated'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex items-center gap-1.5 px-5 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px',
              tab === t
                ? 'text-primary-700 border-primary-600'
                : 'text-slate-500 border-transparent hover:text-slate-700',
            )}
          >
            {t === 'todo' ? <Inbox size={13} /> : <Send size={13} />}
            {t === 'todo' ? '待我审批' : '我发起的'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700 mb-3">{error}</p>
        )}
        {loading && list.length === 0 && (
          <p className="text-center text-xs text-slate-400 py-6">加载中…</p>
        )}
        {!loading && list.length === 0 && (
          <div className="flex h-full items-center justify-center text-slate-400">
            <div className="text-center">
              <CheckSquare size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm">{tab === 'todo' ? '当前没有待你审批的合同' : '你还没有发起过审批'}</p>
              {tab === 'initiated' && (
                <p className="mt-1 text-xs">点击右上角「发起审批」从已经法务审核过的合同发起</p>
              )}
            </div>
          </div>
        )}
        <div className="space-y-2">
          {list.map(a => {
            const isMineCurrent = a.currentAssigneeId === me?.id
            return (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className="w-full text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-primary-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-primary-700">{a.contractCode}</span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] border',
                        CONTRACT_STATUS_BADGE[a.contractStatus as ContractStatus] || CONTRACT_STATUS_BADGE.drafting,
                      )}>
                        {CONTRACT_STATUS_LABELS[a.contractStatus as ContractStatus] || '—'}
                      </span>
                      {tab === 'todo' && isMineCurrent && (
                        <span className="rounded bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] font-medium">
                          待你处理
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-800 truncate mb-0.5">{a.contractName}</p>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span>发起：{a.initiatorDisplayName || a.initiatorUsername}</span>
                      {a.currentAssigneeId && (
                        <span>当前：{a.currentAssigneeDisplayName || a.currentAssigneeUsername}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {new Date(a.updatedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-300 shrink-0 mt-1" />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <InitiateApprovalDialog
        open={initiateOpen}
        onClose={() => setInitiateOpen(false)}
        onInitiated={(approvalId) => {
          setInitiateOpen(false)
          setSelectedId(approvalId)
        }}
      />
    </div>
  )
}
