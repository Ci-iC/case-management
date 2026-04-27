import { cn } from '@/utils/helpers'
import type { DisputeType, CaseStage } from '@/types'
import {
  DISPUTE_TYPE_BADGE, DISPUTE_TYPE_LABELS,
  CASE_STAGE_BADGE, CASE_STAGE_LABELS,
} from '@/constants'

interface BadgeProps {
  className?: string
  children: React.ReactNode
}

/** Generic badge wrapper */
export function Badge({ className, children }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium',
      className
    )}>
      {children}
    </span>
  )
}

/** Dispute type badge */
export function DisputeTypeBadge({ type }: { type: DisputeType }) {
  return (
    <Badge className={DISPUTE_TYPE_BADGE[type]}>
      {DISPUTE_TYPE_LABELS[type]}
    </Badge>
  )
}

/** Case stage badge */
export function CaseStageBadge({ stage }: { stage: CaseStage }) {
  return (
    <Badge className={CASE_STAGE_BADGE[stage]}>
      {CASE_STAGE_LABELS[stage]}
    </Badge>
  )
}
