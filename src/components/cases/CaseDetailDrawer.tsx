import { Pencil, Archive, Trash2, ExternalLink, Calendar, DollarSign, Users, FileText, AlertCircle } from 'lucide-react'
import { useCaseStore, useCaseById } from '@/store/useCaseStore'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { DisputeTypeBadge, CaseStageBadge } from '@/components/ui/Badge'
import { ConfirmModal } from '@/components/ui/Modal'
import {
  formatDate, formatDateFull, formatAmount, getDaysUntil, urgencyLabel,
  getUrgencyLevel, cn,
} from '@/utils/helpers'
import { URGENCY_TEXT_COLOR, URGENCY_BADGE, CLOSING_METHOD_LABELS } from '@/constants'
import { useState } from 'react'

export function CaseDetailDrawer() {
  const { isDetailOpen, selectedCaseId, closeDetail, openForm, archiveCase, deleteCase } = useCaseStore()
  const caseRecord = useCaseById(selectedCaseId)

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)

  if (!caseRecord) return null

  const c = caseRecord
  const isClosed = c.stage === 'closed'

  return (
    <>
      <Drawer
        open={isDetailOpen}
        onClose={closeDetail}
        width="w-[720px]"
        title={c.caseName}
        subtitle={`${c.caseNumber}  ·  ${c.court}`}
        headerActions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline" size="sm"
              icon={<Pencil size={13} />}
              onClick={() => { closeDetail(); openForm(c.id) }}
            >
              编辑
            </Button>
            <Button
              variant="ghost" size="sm"
              icon={<Archive size={13} />}
              onClick={() => setArchiveConfirm(true)}
            />
            <Button
              variant="ghost" size="sm"
              icon={<Trash2 size={13} className="text-red-400" />}
              onClick={() => setDeleteConfirm(true)}
            />
          </div>
        }
      >
        <div className="px-6 py-5 space-y-6">
          {/* Status bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <DisputeTypeBadge type={c.disputeType} />
            <CaseStageBadge stage={c.stage} />
            {c.isArchived && (
              <span className="inline-flex items-center rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                已归档
              </span>
            )}
            {!isClosed && c.nextKeyDate && (() => {
              const urgency = getUrgencyLevel(c.nextKeyDate)
              if (urgency === 'none' || urgency === 'normal') return null
              return (
                <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium', URGENCY_BADGE[urgency])}>
                  <AlertCircle size={11} />
                  {c.nextKeyDateLabel} · {urgencyLabel(c.nextKeyDate)}
                </span>
              )
            })()}
          </div>

          {/* Section 1: 基本信息 */}
          <Section title="基本信息" icon={<FileText size={14} />}>
            <DetailGrid>
              <DetailItem label="案件编号"  value={<span className="font-mono text-sm">{c.caseNumber}</span>} />
              <DetailItem label="案由"      value={c.causeOfAction} />
              <DetailItem label="受理机构"  value={c.court} span={2} />
              <DetailItem label="案件阶段"  value={<CaseStageBadge stage={c.stage} />} />
              {c.closingMethod && (
                <DetailItem label="结案方式" value={CLOSING_METHOD_LABELS[c.closingMethod]} />
              )}
              {c.judgmentDocumentNumber && (
                <DetailItem label="裁判文书编号" value={<span className="font-mono text-sm">{c.judgmentDocumentNumber}</span>} span={2} />
              )}
              <DetailItem label="承办律师"  value={c.assignedLawyer} />
              <DetailItem label="对接部门"  value={c.businessDepartment} />
            </DetailGrid>
          </Section>

          {/* Section 2: 当事人及金额 */}
          <Section title="当事人及金额" icon={<Users size={14} />}>
            <DetailGrid>
              <DetailItem label="我方主体"     value={c.ourParty} span={2} />
              <DetailItem label="对方主体"     value={c.opposingParty} span={2} />
              {c.thirdParties && (
                <DetailItem label="第三人/关联方" value={c.thirdParties} span={2} />
              )}
              {c.opposingLawyer && (
                <DetailItem label="对方代理人"  value={c.opposingLawyer} />
              )}
              {c.opposingFirm && (
                <DetailItem label="对方律所"    value={c.opposingFirm} />
              )}
            </DetailGrid>

            {/* Amount cards */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <AmountCard
                label="涉案总金额"
                value={formatAmount(c.totalAmount)}
                highlight
              />
              <AmountCard
                label="我方主张"
                value={formatAmount(c.ourClaimAmount)}
              />
              <AmountCard
                label="对方主张"
                value={formatAmount(c.opposingClaimAmount)}
              />
            </div>
          </Section>

          {/* Section 3: 时间节点 */}
          <Section title="时间节点" icon={<Calendar size={14} />}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <TimelineItem label="立案日期"        date={c.filingDate} />
              <TimelineItem label="仲裁开庭时间"    date={c.arbitrationHearingDate} />
              <TimelineItem label="一审开庭时间"    date={c.firstTrialHearingDate} />
              <TimelineItem label="二审开庭时间"    date={c.secondTrialHearingDate} />
              <TimelineItem label="开庭日期"        date={c.hearingDate} />
              <TimelineItem label="判决/裁决日期"   date={c.judgmentDate} />
            </div>

            {/* Next key date highlight */}
            {c.nextKeyDate && (
              <div className={cn(
                'mt-3 rounded-lg border p-3',
                (() => {
                  const u = getUrgencyLevel(c.nextKeyDate)
                  return URGENCY_BADGE[u === 'none' ? 'normal' : u]
                })(),
              )}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                  下一关键节点
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm">{c.nextKeyDateLabel}</span>
                    <span className="ml-2 text-sm">{formatDateFull(c.nextKeyDate)}</span>
                  </div>
                  <span className={cn(
                    'text-sm font-semibold',
                    URGENCY_TEXT_COLOR[getUrgencyLevel(c.nextKeyDate)],
                  )}>
                    {urgencyLabel(c.nextKeyDate)}
                  </span>
                </div>
              </div>
            )}
          </Section>

          {/* Section 4: 当前情况 */}
          <Section title="当前情况" icon={<ExternalLink size={14} />}>
            <div className="space-y-4">
              {c.mainDisputes && (
                <LongText label="主要争议焦点" value={c.mainDisputes} />
              )}
              {c.ourPosition && (
                <LongText label="我方诉求 / 抗辩要点" value={c.ourPosition} />
              )}
              <LongText label="当前进展" value={c.currentProgress} highlight />
              {c.judgmentResult && (
                <LongText label="判决结果" value={c.judgmentResult} />
              )}
              {c.executionProgress && (
                <LongText label="回款 / 执行进展" value={c.executionProgress} />
              )}
              {c.reviewNotes && (
                <LongText label="复盘要点" value={c.reviewNotes} />
              )}
              {c.remarks && (
                <LongText label="备注" value={c.remarks} />
              )}
            </div>
          </Section>

          {/* Meta info */}
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-400 space-y-1">
            <div className="flex items-center justify-between">
              <span>创建人：{c.createdBy}</span>
              <span>创建时间：{formatDate(c.createdAt, 'yyyy/MM/dd HH:mm')}</span>
            </div>
            <div className="flex justify-end">
              <span>最后更新：{formatDate(c.updatedAt, 'yyyy/MM/dd HH:mm')}</span>
            </div>
          </div>

          {/* Future extension placeholder */}
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-center text-xs text-slate-400">
            📎 附件上传  ·  💬 评论协作  ·  📋 操作日志  —— 功能规划中
          </div>
        </div>
      </Drawer>

      {/* Confirm modals */}
      <ConfirmModal
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={async () => {
          try {
            await deleteCase(c.id)
            closeDetail()
          } catch (e) {
            window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
          }
          setDeleteConfirm(false)
        }}
        title="删除案件"
        confirmVariant="danger"
        confirmLabel="确认删除"
        message={<>此操作不可撤销，确认删除「<strong>{c.caseName}</strong>」？</>}
      />
      <ConfirmModal
        open={archiveConfirm}
        onClose={() => setArchiveConfirm(false)}
        onConfirm={async () => {
          try {
            await archiveCase(c.id)
          } catch (e) {
            window.alert(`归档失败：${e instanceof Error ? e.message : String(e)}`)
          }
          setArchiveConfirm(false)
        }}
        title="归档案件"
        confirmLabel="确认归档"
        message={<>归档后案件将从默认列表中隐藏，可在高级筛选中查看。<br />确认归档「<strong>{c.caseName}</strong>」？</>}
      />
    </>
  )
}

// ─── Detail Sub-components ─────────────────────────────────────────────────────

function Section({ title, icon, children }: {
  title: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
        <span className="text-primary-500">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-4 gap-x-4 gap-y-3">
      {children}
    </div>
  )
}

function DetailItem({ label, value, span = 1 }: {
  label: string; value: React.ReactNode; span?: 1 | 2 | 3 | 4
}) {
  const spanClass = span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : span === 4 ? 'col-span-4' : ''
  return (
    <div className={spanClass}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 font-medium leading-snug">
        {value || <span className="text-slate-300">—</span>}
      </p>
    </div>
  )
}

function AmountCard({ label, value, highlight }: {
  label: string; value: string; highlight?: boolean
}) {
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5',
      highlight ? 'border-primary-200 bg-primary-50' : 'border-slate-100 bg-slate-50',
    )}>
      <p className={cn('text-[11px] font-medium mb-1', highlight ? 'text-primary-600' : 'text-slate-500')}>
        {label}
      </p>
      <p className={cn('text-base font-bold tabular-nums', highlight ? 'text-primary-700' : 'text-slate-700')}>
        {value}
      </p>
    </div>
  )
}

function TimelineItem({ label, date, isDeadline }: {
  label: string; date: string | undefined; isDeadline?: boolean
}) {
  const urgency = isDeadline ? getUrgencyLevel(date) : 'none'
  const daysUntil = isDeadline ? getDaysUntil(date) : null
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        {date ? (
          <>
            <span className={cn('text-sm font-medium', isDeadline ? URGENCY_TEXT_COLOR[urgency] : 'text-slate-700')}>
              {formatDateFull(date)}
            </span>
            {isDeadline && daysUntil !== null && daysUntil <= 14 && (
              <span className={cn('text-xs', URGENCY_TEXT_COLOR[urgency])}>
                {urgencyLabel(date)}
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-slate-300">—</span>
        )}
      </div>
    </div>
  )
}

function LongText({ label, value, highlight }: {
  label: string; value: string; highlight?: boolean
}) {
  return (
    <div className={cn(
      'rounded-lg p-3',
      highlight ? 'bg-amber-50 border border-amber-100' : 'bg-slate-50',
    )}>
      <p className={cn(
        'text-[11px] font-semibold uppercase tracking-wide mb-1.5',
        highlight ? 'text-amber-700' : 'text-slate-500',
      )}>
        {label}
      </p>
      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}
