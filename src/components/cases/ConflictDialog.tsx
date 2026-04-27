import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CASE_STAGE_LABELS, DISPUTE_TYPE_LABELS, CLOSING_METHOD_LABELS } from '@/constants'
import type { CaseRecord, DisputeType, CaseStage, ClosingMethod } from '@/types'

// 字段中文标签：用户在冲突对话框里能看懂哪些字段不一致
const FIELD_LABELS: Partial<Record<keyof CaseRecord, string>> = {
  caseNumber: '案件编号',
  caseName: '案件名称',
  causeOfAction: '案由',
  disputeType: '争议类型',
  court: '受理法院',
  stage: '案件阶段',
  judgmentDocumentNumber: '裁判文书编号',
  closingMethod: '结案方式',
  assignedLawyer: '承办律师',
  businessDepartment: '对接业务部门',
  ourParty: '我方主体',
  opposingParty: '对方主体',
  thirdParties: '第三人/关联方',
  opposingLawyer: '对方代理人',
  opposingFirm: '对方律所',
  totalAmount: '涉案金额（万元）',
  ourClaimAmount: '我方主张金额',
  opposingClaimAmount: '对方主张金额',
  filingDate: '立案日期',
  arbitrationHearingDate: '仲裁开庭时间',
  firstTrialHearingDate: '一审开庭时间',
  secondTrialHearingDate: '二审开庭时间',
  hearingDate: '开庭日期',
  judgmentDate: '判决/裁决日期',
  nextKeyDate: '下一关键节点日期',
  nextKeyDateLabel: '下一关键节点说明',
  mainDisputes: '主要争议焦点',
  ourPosition: '我方诉求/抗辩要点',
  currentProgress: '当前进展',
  judgmentResult: '判决结果',
  executionProgress: '回款/执行进展',
  reviewNotes: '复盘要点',
  remarks: '备注',
  isArchived: '归档状态',
}

// 不参与差异显示的字段（元数据/版本号）
const SKIP_FIELDS = new Set<keyof CaseRecord>(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'version'])

function formatValue(key: keyof CaseRecord, v: unknown): string {
  if (v === undefined || v === null || v === '') return '（空）'
  if (key === 'disputeType') return DISPUTE_TYPE_LABELS[v as DisputeType] ?? String(v)
  if (key === 'stage') return CASE_STAGE_LABELS[v as CaseStage] ?? String(v)
  if (key === 'closingMethod') return CLOSING_METHOD_LABELS[v as ClosingMethod] ?? String(v)
  if (key === 'isArchived') return v ? '已归档' : '在用'
  if (typeof v === 'number') return String(v)
  return String(v)
}

interface DiffRow {
  key: keyof CaseRecord
  label: string
  mine: string
  current: string
}

function computeDiff(mine: Partial<CaseRecord>, current: CaseRecord): DiffRow[] {
  const rows: DiffRow[] = []
  const keys = new Set<keyof CaseRecord>([
    ...(Object.keys(mine) as (keyof CaseRecord)[]),
    ...(Object.keys(current) as (keyof CaseRecord)[]),
  ])
  for (const k of keys) {
    if (SKIP_FIELDS.has(k)) continue
    const a = mine[k]
    const b = current[k]
    // 把空串、null、undefined 视为同一种"空"，避免噪音差异
    const norm = (x: unknown) => (x === '' || x === undefined || x === null ? null : x)
    if (norm(a) === norm(b)) continue
    rows.push({
      key: k,
      label: FIELD_LABELS[k] ?? k,
      mine: formatValue(k, a),
      current: formatValue(k, b),
    })
  }
  return rows
}

interface Props {
  open: boolean
  mine: Partial<CaseRecord> | null     // 我刚才提交的数据（含旧 version）
  current: CaseRecord | null            // 服务端返回的最新版
  onClose: () => void                   // 关闭对话框（不做任何动作）
  onDiscardMine: () => void             // 放弃我的修改：用服务端版本覆盖表单
  onForceOverwrite: () => void          // 用我的覆盖：拿服务端 version 重发提交
  loading?: boolean
}

export function ConflictDialog({
  open, mine, current, onClose, onDiscardMine, onForceOverwrite, loading,
}: Props) {
  if (!open || !mine || !current) return null

  const diff = computeDiff(mine, current)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl rounded-xl bg-white shadow-modal animate-fade-in flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle size={20} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-slate-900">案件已被他人修改</h3>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              你打开后另一位同事保存了改动（服务端版本 v{current.version}）。
              请对比下方差异后选择处理方式。
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        {/* Diff body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {diff.length === 0 ? (
            <p className="text-sm text-slate-500">
              你和服务端的内容字段一致，仅版本号不同。点「用我的覆盖」即可继续保存。
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-3 text-xs font-medium text-slate-500 px-1 pb-1 border-b border-slate-100">
                <div className="col-span-3">字段</div>
                <div className="col-span-4">服务端最新（v{current.version}）</div>
                <div className="col-span-5">你的改动</div>
              </div>
              {diff.map((row) => (
                <div key={row.key} className="grid grid-cols-12 gap-3 text-sm">
                  <div className="col-span-3 text-slate-600 font-medium pt-0.5">{row.label}</div>
                  <div className="col-span-4 rounded bg-slate-50 px-2 py-1 text-slate-700 break-words whitespace-pre-wrap">
                    {row.current}
                  </div>
                  <div className="col-span-5 rounded bg-amber-50 px-2 py-1 text-amber-900 break-words whitespace-pre-wrap border border-amber-100">
                    {row.mine}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t border-slate-100 px-6 py-3 sm:flex-row sm:justify-between sm:items-center">
          <p className="text-xs text-slate-400 leading-relaxed">
            「用我的覆盖」会把上方<span className="text-amber-700">黄色</span>列的值写回服务端，
            同时丢弃服务端的最新改动。
          </p>
          <div className="flex justify-end gap-2 flex-shrink-0">
            <Button
              variant="secondary"
              size="md"
              icon={<RefreshCw size={14} />}
              onClick={onDiscardMine}
              disabled={loading}
            >
              放弃我的修改
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={loading}
              onClick={onForceOverwrite}
            >
              用我的覆盖
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
