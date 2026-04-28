// ─── Enumerations ──────────────────────────────────────────────────────────────

export type DisputeType =
  | 'contract'    // 合同纠纷
  | 'labor'       // 劳动争议
  | 'ip'          // 知识产权
  | 'tort'        // 侵权
  | 'compliance'  // 合规/行政
  | 'other'       // 其他

export type CaseStage =
  | 'filed'        // 立案
  | 'hearing'      // 审理中
  | 'first_trial'  // 一审
  | 'second_trial' // 二审
  | 'execution'    // 执行
  | 'closed'       // 结案

export type ClosingMethod =
  | 'withdrawal'   // 撤诉
  | 'settlement'   // 和解
  | 'judgment'     // 判决

export type UrgencyLevel = 'overdue' | 'critical' | 'warning' | 'soon' | 'normal' | 'none'

// ─── Core Case Entity ──────────────────────────────────────────────────────────

export interface CaseRecord {
  id: string

  // ── 基本信息 ──
  caseNumber: string              // 案件编号
  caseName: string                // 案件名称
  causeOfAction: string           // 案由
  disputeType: DisputeType        // 争议类型
  court: string                   // 受理法院/仲裁机构/监管机关（所有涉案机构）
  stage: CaseStage                // 案件阶段
  judgmentDocumentNumber?: string // 裁判文书编号
  closingMethod?: ClosingMethod   // 结案方式（执行/结案阶段必填）
  assignedLawyer: string          // 承办律师
  businessDepartment: string      // 对接业务部门

  // ── 当事人及金额 ──
  ourParty: string             // 我方主体
  opposingParty: string        // 对方主体
  thirdParties?: string        // 第三人/关联方
  opposingLawyer?: string      // 对方代理人
  opposingFirm?: string        // 对方律所
  totalAmount?: number         // 涉案金额（万元）
  ourClaimAmount?: number      // 我方主张金额
  opposingClaimAmount?: number // 对方主张金额

  // ── 时间节点 ──
  filingDate?: string               // 立案日期
  arbitrationHearingDate?: string   // 仲裁开庭时间
  firstTrialHearingDate?: string    // 一审开庭时间
  secondTrialHearingDate?: string   // 二审开庭时间
  hearingDate?: string              // 开庭日期（通用）
  judgmentDate?: string             // 判决/裁决日期
  nextKeyDate?: string              // 下一关键节点日期
  nextKeyDateLabel?: string         // 下一关键节点说明

  // ── 当前情况 ──
  mainDisputes?: string        // 主要争议焦点
  ourPosition?: string         // 我方诉求/抗辩要点
  currentProgress: string      // 当前进展
  judgmentResult?: string      // 判决结果
  executionProgress?: string   // 回款/执行进展
  reviewNotes?: string         // 复盘要点
  remarks?: string             // 备注

  // ── 元数据 ──
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy?: string
  version: number             // 乐观锁版本号
  isArchived: boolean
}

// ─── Filter / Search State ─────────────────────────────────────────────────────

export interface CaseFilters {
  keyword: string              // 全局模糊搜索
  caseNumber: string
  caseName: string
  causeOfAction: string
  disputeType: DisputeType | ''
  stage: CaseStage | ''
  assignedLawyer: string
  businessDepartment: string
  ourParty: string
  opposingParty: string
  filingDateStart: string
  filingDateEnd: string
  amountMin: string
  amountMax: string
  showArchived: boolean
}

// ─── Pagination ────────────────────────────────────────────────────────────────

export interface PaginationState {
  page: number
  pageSize: number
}

// ─── Sort ──────────────────────────────────────────────────────────────────────

export type SortField =
  | 'caseNumber'
  | 'caseName'
  | 'disputeType'
  | 'stage'
  | 'totalAmount'
  | 'filingDate'
  | 'nextKeyDate'
  | 'updatedAt'

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  field: SortField
  direction: SortDirection
}

// ─── Future Extension Stubs ────────────────────────────────────────────────────

/** Placeholder for future user/auth context */
export interface UserContext {
  id: string
  name: string
  role: 'admin' | 'lawyer' | 'viewer'
  department: string
}

/** Placeholder for operation log entries */
export interface OperationLog {
  id: string
  caseId: string
  userId: string
  action: 'create' | 'update' | 'delete' | 'archive' | 'view'
  detail: string
  createdAt: string
}

/** Placeholder for case attachments */
export interface CaseAttachment {
  id: string
  caseId: string
  fileName: string
  fileSize: number
  fileType: string
  uploadedBy: string
  uploadedAt: string
  url: string
}

/** Placeholder for progress notes / comments */
export interface CaseComment {
  id: string
  caseId: string
  content: string
  author: string
  createdAt: string
  updatedAt: string
}

// ─── M4: AI 审核 ──────────────────────────────────────────────────────────────

export interface ReviewRecord {
  id: string
  caseId: string | null
  uploadedFilename: string
  uploadedSizeBytes: number | null
  uploadedMimeType: string | null
  reviewText: string
  model: string | null
  createdBy: string
  createdByUsername?: string
  createdByDisplayName?: string
  createdAt: string
}

// ─── M4: 站内消息 ─────────────────────────────────────────────────────────────

export interface MessageAttachment {
  id: string
  filename: string
  sizeBytes: number | null
  mimeType: string | null
  createdAt: string
}

export interface MessageRecord {
  id: string
  senderId: string
  senderUsername?: string
  senderDisplayName?: string
  receiverId: string
  receiverUsername?: string
  receiverDisplayName?: string
  body: string
  caseId: string | null
  caseNumber?: string
  caseName?: string
  reviewId: string | null
  isRead: boolean
  readAt?: string | null
  createdAt: string
  attachmentCount: number
  // 详情时附带
  attachments?: MessageAttachment[]
  review?: {
    id: string
    uploadedFilename: string
    reviewText: string
    model: string | null
    createdAt: string
  } | null
}

// ─── M4: 通讯录 ───────────────────────────────────────────────────────────────

export interface Contact {
  id: string
  username: string
  displayName?: string | null
  role: 'admin' | 'user'
}

// ─── M6: 合同台账 ─────────────────────────────────────────────────────────────

export interface ContractRecord {
  id: string
  name: string
  description: string | null
  createdBy: string | null
  createdByUsername?: string
  createdByDisplayName?: string
  createdAt: string
  updatedAt: string
  versionCount: number
  lastReviewedAt: string | null
  /** 详情时附带 */
  reviews?: ContractReviewVersion[]
}

export interface ContractReviewVersion {
  id: string
  version: number
  uploadedFilename: string
  uploadedSizeBytes: number | null
  uploadedMimeType: string | null
  reviewText: string
  model: string | null
  pipelineId: string | null
  createdBy: string | null
  createdByUsername?: string
  createdByDisplayName?: string
  createdAt: string
}

// ─── M5: AI 审核流水线 ──────────────────────────────────────────────────────

export interface PipelineStep {
  id: string
  pipelineId: string
  position: number
  name: string
  prompt: string
  enabled: boolean
}

export interface Pipeline {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
  steps: PipelineStep[]
}
