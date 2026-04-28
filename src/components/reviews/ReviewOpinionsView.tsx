// 审核结果渲染：把后端存的 JSON（三层级 review_opinions）渲染为三张表格。
// 旧数据是纯文本/Markdown，回落到 pre 块原样展示。

import { AlertTriangle, AlertCircle, Lightbulb } from 'lucide-react'
import { cn } from '@/utils/helpers'

interface OpinionItem {
  serial_no: number
  clause_no: string
  original_text: string
  revised_text: string
  comment: string
  risk_level: '高' | '中' | '低' | string
}

interface OpinionLevel {
  level: string
  items: OpinionItem[]
}

interface ReviewOpinions {
  review_opinions: OpinionLevel[]
}

const LEVEL_META: Record<string, { icon: typeof AlertTriangle; tone: string; bg: string; text: string; border: string }> = {
  '重大风险条款': {
    icon: AlertTriangle,
    tone: 'red',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
  },
  '一般风险条款': {
    icon: AlertCircle,
    tone: 'amber',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },
  '优化完善条款': {
    icon: Lightbulb,
    tone: 'blue',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },
}

const RISK_BADGE: Record<string, string> = {
  '高': 'bg-red-100 text-red-700 border-red-300',
  '中': 'bg-amber-100 text-amber-700 border-amber-300',
  '低': 'bg-slate-100 text-slate-600 border-slate-300',
}

function tryParse(text: string): ReviewOpinions | null {
  if (!text) return null
  try {
    const obj = JSON.parse(text)
    if (!obj || !Array.isArray(obj.review_opinions)) return null
    return obj as ReviewOpinions
  } catch {
    return null
  }
}

interface Props {
  reviewText: string
  /** 紧凑模式（用于侧栏列表展开等空间小的场景）：表格更密 */
  compact?: boolean
}

export function ReviewOpinionsView({ reviewText, compact }: Props) {
  const data = tryParse(reviewText)

  if (!data) {
    // 旧数据 / 解析失败 fallback
    return (
      <pre className={cn(
        'whitespace-pre-wrap break-words font-sans text-slate-700 leading-relaxed',
        compact ? 'text-xs' : 'text-sm',
      )}>
        {reviewText}
      </pre>
    )
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      {data.review_opinions.map(layer => (
        <LevelTable key={layer.level} layer={layer} compact={compact} />
      ))}
    </div>
  )
}

function LevelTable({ layer, compact }: { layer: OpinionLevel; compact?: boolean }) {
  const meta = LEVEL_META[layer.level] || {
    icon: AlertCircle,
    tone: 'slate',
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
  }
  const Icon = meta.icon
  const empty = !layer.items || layer.items.length === 0
  const cellPad = compact ? 'px-2 py-1.5' : 'px-3 py-2'
  const fontSize = compact ? 'text-[11px]' : 'text-xs'

  return (
    <section className={cn('rounded-lg border', meta.border)}>
      {/* 层级标题 */}
      <div className={cn('flex items-center gap-2 border-b px-3 py-2', meta.bg, meta.border)}>
        <Icon size={compact ? 12 : 14} className={meta.text} />
        <h4 className={cn('font-semibold flex-1', meta.text, compact ? 'text-xs' : 'text-sm')}>
          {layer.level}
        </h4>
        <span className={cn('text-[10px] tabular-nums', meta.text)}>
          {layer.items.length} 条
        </span>
      </div>

      {empty ? (
        <p className={cn('px-3 py-4 text-center text-slate-400', fontSize)}>
          本层级暂无审核意见
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={cn('w-full table-fixed', fontSize)}>
            <colgroup>
              <col className="w-10" />            {/* 序号 */}
              <col className="w-24" />            {/* 条款编号 */}
              <col />                              {/* 原文 */}
              <col />                              {/* 修改后原文 */}
              <col />                              {/* 修改意见 */}
              <col className="w-14" />            {/* 风险程度 */}
            </colgroup>
            <thead>
              <tr className="bg-slate-50/60 text-slate-500">
                <th className={cn('font-medium text-center', cellPad)}>序号</th>
                <th className={cn('font-medium text-left', cellPad)}>条款编号</th>
                <th className={cn('font-medium text-left', cellPad)}>原文</th>
                <th className={cn('font-medium text-left', cellPad)}>修改后原文</th>
                <th className={cn('font-medium text-left', cellPad)}>修改意见</th>
                <th className={cn('font-medium text-center', cellPad)}>风险</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {layer.items.map(item => (
                <tr key={item.serial_no} className="align-top">
                  <td className={cn('text-center text-slate-500 tabular-nums', cellPad)}>
                    {item.serial_no}
                  </td>
                  <td className={cn('text-slate-700 font-medium break-words', cellPad)}>
                    {item.clause_no || '未编号条款'}
                  </td>
                  <td className={cn('text-slate-700 break-words whitespace-pre-wrap', cellPad)}>
                    {item.original_text || '—'}
                  </td>
                  <td className={cn('text-slate-700 break-words whitespace-pre-wrap', cellPad)}>
                    {item.revised_text || '—'}
                  </td>
                  <td className={cn('text-slate-600 break-words whitespace-pre-wrap', cellPad)}>
                    {item.comment || '—'}
                  </td>
                  <td className={cn('text-center', cellPad)}>
                    <span className={cn(
                      'inline-block rounded border px-1.5 py-0.5 font-medium text-[10px]',
                      RISK_BADGE[item.risk_level] || 'bg-slate-100 text-slate-600 border-slate-300',
                    )}>
                      {item.risk_level || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
