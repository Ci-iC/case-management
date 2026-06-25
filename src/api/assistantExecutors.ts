// 写操作执行器：tool name → 调用现有 src/api 接口执行。
// 复用现有权限/校验，不新建业务逻辑。需要文件的工具从聊天附件取 File。

import { approvalsApi, type StepAssignment } from './approvals'
import { reviewsApi } from './reviews'
import { assistantApi, type ActionResultData } from './assistant'

export interface ExecutorHelpers {
  /** 按文件名在当天会话里找附件（返回 {attachmentId, filename}） */
  findAttachment: (filename?: string) => { attachmentId: string; filename: string } | null
}

type Args = Record<string, any>
/** 执行器返回：一句话 summary（回灌 AI），或带结构化结果（如 AI 审核意见、串联 reviewId） */
type ExecResult = string | { summary: string; resultData?: ActionResultData }

async function fileFromAttachment(args: Args, helpers: ExecutorHelpers): Promise<File> {
  const att = helpers.findAttachment(args.attachmentFilename)
  if (!att) throw new Error(`聊天里没有找到文件「${args.attachmentFilename || ''}」，请先上传该文件`)
  return assistantApi.fetchAttachmentFile(att.attachmentId, att.filename)
}

// 统计审核意见三层级条数（reviewText 是 {review_opinions:[{level,items}]} 的 JSON）
function countOpinions(reviewText: string): { major: number; normal: number; improve: number } {
  const out = { major: 0, normal: 0, improve: 0 }
  try {
    const obj = JSON.parse(reviewText)
    for (const layer of obj?.review_opinions || []) {
      const n = Array.isArray(layer?.items) ? layer.items.length : 0
      if (layer.level === '重大风险条款') out.major = n
      else if (layer.level === '一般风险条款') out.normal = n
      else if (layer.level === '优化完善条款') out.improve = n
    }
  } catch { /* ignore */ }
  return out
}

// 每个执行器返回 summary（或带 resultData 的结构化结果）
const EXECUTORS: Record<string, (args: Args, helpers: ExecutorHelpers) => Promise<ExecResult>> = {
  async approve(args) {
    if (!args.approvalId) throw new Error('缺少 approvalId')
    if (!args.comment?.trim()) throw new Error('审批意见不能为空')
    await approvalsApi.approve(args.approvalId, { comment: args.comment })
    return '审批已通过。'
  },

  async reject(args) {
    if (!args.approvalId) throw new Error('缺少 approvalId')
    if (!args.comment?.trim()) throw new Error('驳回意见不能为空')
    const mode = args.mode === 'to_start' ? 'to_start' : 'to_step'
    await approvalsApi.reject(args.approvalId, { comment: args.comment, mode })
    return mode === 'to_start' ? '审批已驳回（整轮重新发起）。' : '审批已驳回到经办人。'
  },

  async legal_approve(args) {
    if (!args.reviewId) throw new Error('缺少 reviewId')
    await reviewsApi.legalApprove(args.reviewId, args.comment || '')
    return '法务审核已直通。'
  },

  async upload_legal_revision(args, helpers) {
    if (!args.reviewId) throw new Error('缺少 reviewId')
    const file = await fileFromAttachment(args, helpers)
    await reviewsApi.uploadLegalRevision(args.reviewId, file, args.comment)
    return '法务修订版已上传。'
  },

  async submit_review(args, helpers) {
    const file = await fileFromAttachment(args, helpers)
    const ourRole = args.ourRole || '甲方'
    const { review } = await reviewsApi.create(file, {
      ourRole,
      reviewIntensity: args.reviewIntensity,
    })
    const c = countOpinions(review.reviewText)
    const summary = `已完成 AI 审核（我方立场：${ourRole}）：重大风险 ${c.major} 条、一般风险 ${c.normal} 条、优化建议 ${c.improve} 条。审核意见已展示，可据此修改后重新上传，或提交法务做正式审核。`
    return {
      summary,
      resultData: {
        reviewId: review.id,
        reviewResult: { reviewId: review.id, filename: review.uploadedFilename, ourRole, reviewText: review.reviewText },
      },
    }
  },

  async submit_to_legal(args) {
    if (!args.reviewId) throw new Error('请先完成一次 AI 审核，再提交法务')
    if (!args.receiverId) throw new Error('请选择接收法务')
    await reviewsApi.submitToLegal(args.reviewId, {
      contractMode: args.contractMode === 'existing' ? 'existing' : 'new',
      contractName: args.contractName,
      contractDescription: args.contractDescription,
      contractId: args.contractId,
      receiverId: args.receiverId,
      body: args.body || '请审核',
    })
    const name = args.contractName ? `《${args.contractName}》` : '该合同'
    return `已将${name}提交法务审核，预计 1~2 个工作日回复；法务处理后你会在「消息中心」收到站内通知。`
  },

  async initiate_approval(args, helpers) {
    if (!args.contractId) throw new Error('缺少 contractId')
    const stepAssignments: StepAssignment[] = Array.isArray(args.stepAssignments) ? args.stepAssignments : []
    if (stepAssignments.length === 0) throw new Error('缺少 stepAssignments（每个步骤的审批人）')
    let cleanFile: File | undefined
    if (!args.reuseExistingClean) cleanFile = await fileFromAttachment(args, helpers)
    const res = await approvalsApi.initiate({
      contractId: args.contractId,
      stepAssignments,
      initiationNote: args.initiationNote,
      reuseExistingClean: !!args.reuseExistingClean,
      cleanFile,
    })
    return `审批流程已发起（审批 ${res.approvalId}）。`
  },
}

export function getExecutor(tool: string) {
  return EXECUTORS[tool] || null
}
