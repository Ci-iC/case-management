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
  /** v1.2: 关联合同（草稿态时为 null，submit 后才有值） */
  contractId: string | null
  /** v1.2: 草稿态。AI 审核完未发法务前为 true；submit 后转 false */
  isDraft: boolean
  /** v1.3.1: 法务点过"无需修订直接通过"。和 reviewedFilename 共同代表"已经过法务" */
  legalApproved: boolean
  uploadedFilename: string
  uploadedSizeBytes: number | null
  uploadedMimeType: string | null
  reviewText: string
  model: string | null
  createdBy: string
  createdByUsername?: string
  createdByDisplayName?: string
  createdAt: string
  // 法务审核版（admin 上传，业务人员能下载）
  reviewedFilename: string | null
  reviewedSizeBytes: number | null
  reviewedMimeType: string | null
  reviewedBy: string | null
  reviewedByUsername: string | null
  reviewedByDisplayName: string | null
  reviewedAt: string | null
}

// ─── M4: 站内消息 ─────────────────────────────────────────────────────────────

export interface MessageAttachment {
  id: string
  filename: string
  sizeBytes: number | null
  mimeType: string | null
  createdAt: string
  /** 引用的审核记录 id（普通自传附件为 null） */
  reviewId?: string | null
  /** 'original' = 引用合同原版；'legal' = 引用法务修订版；null = 不是 review 引用 */
  reviewFileKind?: 'original' | 'legal' | null
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
  /** v1.3.1: 关联的审批 id（系统审批通知带 approval_id，前端识别后给"跳转到审批"按钮） */
  approvalId: string | null
  /** 当条消息引用 review，且 review 已有法务修订版 → 列表加"已修订"徽标 */
  hasLegalRevision?: boolean
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
    reviewedFilename: string | null
    reviewedSizeBytes: number | null
    reviewedAt: string | null
    reviewedByUsername: string | null
    reviewedByDisplayName: string | null
  } | null
}

// ─── M4: 通讯录 ───────────────────────────────────────────────────────────────

export interface Contact {
  id: string
  username: string
  displayName?: string | null
  /** v2.0：当前公司里的角色列表（manager/legal/seal_admin/finance/staff） */
  roles: string[]
}

// ─── M6: 合同台账 ─────────────────────────────────────────────────────────────

/** v1.3 合同生命周期状态机 */
export type ContractStatus = 'drafting' | 'approving' | 'pending_seal' | 'sealed'

export interface ContractRecord {
  id: string
  /** v1.2: 系统自动生成的合同编号，YYYY-HT-NNNN，全局唯一 */
  code: string
  name: string
  description: string | null
  /** v1.3: 合同生命周期 */
  status: ContractStatus
  /** v1.3: 当前活跃审批的 id（status=approving / pending_seal 时非空） */
  approvalId: string | null
  /** v1.3: AI 合同摘要（双方主体 / 标的 / 金额 / 期限） */
  summary: string | null
  summaryGeneratedAt: string | null
  /** v1.3: 用印版（sealed 状态时非空） */
  sealedFilename: string | null
  sealedSizeBytes: number | null
  sealedMimeType: string | null
  sealedAt: string | null
  sealedBy: string | null
  /** v1.3.1: 清洁版（发起审批时上传，审批界面优先显示） */
  cleanFilename: string | null
  cleanSizeBytes: number | null
  cleanMimeType: string | null
  cleanUploadedAt: string | null
  cleanUploadedBy: string | null
  createdBy: string | null
  createdByUsername?: string
  createdByDisplayName?: string
  createdAt: string
  updatedAt: string
  /** v1.2: 进入审批流程的时间（NULL = 还未审批，可在"已有合同"下拉中选） */
  approvalStartedAt: string | null
  versionCount: number
  lastReviewedAt: string | null
  /** v2.0 多租户 */
  companyId?: string
  companyName?: string | null
  /** v1.4 结构化字段 */
  ourParties?: string[]
  counterParties?: string[]
  contractType?: string | null
  paymentType?: string | null
  contractAmount?: number | null
  termType?: string | null
  termDate?: string | null
  termText?: string | null
  handlerId?: string | null
  handlerUsername?: string | null
  handlerDisplayName?: string | null
  termNotifiedAt?: string | null
  /** 详情时附带：reviews 列表 */
  reviews?: ContractReviewVersion[]
  /** v1.3.1 详情时附带：合同最近一条 approval id（已完成 / 已驳回 / 进行中都行），用于"跳转到审批"按钮 */
  latestApprovalId?: string | null
}

// ─── v1.3: 合同审批 ────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'completed' | 'rejected'
export type ApprovalStepStatus = 'pending' | 'approved' | 'rejected' | 'skipped'
export type ApprovalStepType = 'approver' | 'consultee' | 'final-initiator'
export type ApprovalActionType =
  | 'submit'
  | 'approve'
  | 'reject_to_step'
  | 'reject_to_start'
  | 'add_consultee'
  | 'submit_consultation'
  | 'resubmit'
  | 'upload_seal'

export interface ApprovalRecord {
  id: string
  contractId: string
  contractCode?: string
  contractName?: string
  contractStatus?: ContractStatus
  initiatorId: string
  initiatorUsername?: string
  initiatorDisplayName?: string
  status: ApprovalStatus
  initiationNote: string | null
  currentStepId: string | null
  currentAssigneeId: string | null
  currentAssigneeUsername?: string | null
  currentAssigneeDisplayName?: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  rejectedAt: string | null
}

export interface ApprovalStep {
  id: string
  approvalId: string
  stepIndex: number | null
  parentStepId: string | null
  stepType: ApprovalStepType
  assigneeId: string
  assigneeUsername?: string
  assigneeDisplayName?: string
  /** v2.1+: 该步骤处理人在本公司的角色（用于判断是否到达印章管理员节点） */
  assigneeRoles?: string[]
  status: ApprovalStepStatus
  comment: string | null
  actionedAt: string | null
  createdAt: string
}

export interface ApprovalActionRecord {
  id: string
  approvalId: string
  stepId: string | null
  actorId: string
  actorUsername?: string
  actorDisplayName?: string
  action: ApprovalActionType
  comment: string | null
  targetStepId: string | null
  payload: Record<string, unknown> | null
  createdAt: string
}

/** GET /api/approvals/:id 详情返回结构 */
export interface ApprovalDetail {
  approval: ApprovalRecord
  steps: ApprovalStep[]
  actions: ApprovalActionRecord[]
  contract: {
    id: string
    code: string
    name: string
    status: ContractStatus
    summary: string | null
    summaryGeneratedAt: string | null
    cleanFilename: string | null
    cleanUploadedAt: string | null
    sealedFilename: string | null
    sealedAt: string | null
  }
  reviews: Array<{
    id: string
    uploadedFilename: string
    reviewedFilename: string | null
    createdAt: string
    reviewedAt: string | null
  }>
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
  reviewedFilename: string | null
  reviewedSizeBytes: number | null
  reviewedMimeType: string | null
  reviewedBy: string | null
  reviewedByUsername: string | null
  reviewedByDisplayName: string | null
  reviewedAt: string | null
}

// ─── M5: AI 审核模型 ──────────────────────────────────────────────────────

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
