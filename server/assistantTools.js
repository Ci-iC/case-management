// AI 工作台工具目录。
//
// 每个工具 = 一个独立 descriptor：
//   { name, kind:'read'|'write', label, requiredRoles, description, args, available, run?, summarize?, executor? }
//   - 只读工具：run(ctx,args) 在后端执行，复用现有表/查询，返回精简 JSON 喂回模型
//   - 写工具：无 run（执行在前端调现有接口）；声明 args + summarize(确认框人话摘要) + executor(前端执行器名)
//
// 权限：available(reqUser) 先在 UX 层收窄；真正的写操作由现有接口再次强校验（防御纵深）。
// 新增工具只需在 TOOLS 里加一项，互不影响。

import { db } from './db.js'
import { canReadContractRow } from './auth.js'

function rolesOf(reqUser) {
  return reqUser?.companyRoles || []
}
function hasAnyRole(reqUser, roles) {
  const mine = rolesOf(reqUser)
  return roles.some((r) => mine.includes(r))
}

// 按 code 精确或 name 模糊找当前公司一份合同（带可读权限校验）
async function findContract(reqUser, query) {
  if (!query || !reqUser?.currentCompanyId) return null
  const q = String(query).trim()
  let row = await db('contracts')
    .where({ company_id: reqUser.currentCompanyId, code: q })
    .first()
  if (!row) {
    row = await db('contracts')
      .where('company_id', reqUser.currentCompanyId)
      .where('name', 'ilike', `%${q}%`)
      .orderBy('updated_at', 'desc')
      .first()
  }
  if (!row) return null
  if (!canReadContractRow(reqUser, row)) return null
  return row
}

// 用户是否"参与"了某合同的审批流程（发起人 或 任一审批步骤的处理人）。
// 这是合同可读权限之外的另一条线：审批参与人即便不是创建人/经办人，也应能看到并取走流程文件。
export async function userParticipatesInContract(reqUser, contractId) {
  if (!contractId || !reqUser?.currentCompanyId) return false
  const row = await db('approvals as a')
    .leftJoin('approval_steps as s', 's.approval_id', 'a.id')
    .where('a.contract_id', contractId)
    .where(function () {
      this.where('a.initiator_id', reqUser.id).orWhere('s.assignee_id', reqUser.id)
    })
    .first()
  return !!row
}

// 我参与的全部合同 id（发起或作为审批人）。用于放宽"我的合同"列表。
async function myParticipatedContractIds(reqUser) {
  if (!reqUser?.currentCompanyId) return []
  const ids = await db('approvals as a')
    .leftJoin('approval_steps as s', 's.approval_id', 'a.id')
    .where('a.company_id', reqUser.currentCompanyId)
    .where(function () {
      this.where('a.initiator_id', reqUser.id).orWhere('s.assignee_id', reqUser.id)
    })
    .distinct('a.contract_id')
    .pluck('a.contract_id')
  return ids.filter(Boolean)
}

// 可"升版关联"的历史合同：本公司、尚未进入审批流程（approval_started_at 为空才允许再加新版本，
// 与 POST /api/reviews/:id/submit 的后端校验一致）、当前用户有权见。带 versionCount（已提交版本数）。
async function associableContracts(reqUser) {
  if (!reqUser?.currentCompanyId) return []
  let q = db('contracts as c')
    .where('c.company_id', reqUser.currentCompanyId)
    .whereNull('c.approval_started_at')
  if (!reqUser.canViewAllContracts && !reqUser.isAllCompaniesView) {
    const participatedIds = await myParticipatedContractIds(reqUser)
    q = q.where(function () {
      this.where('c.created_by', reqUser.id).orWhere('c.handler_id', reqUser.id)
      if (participatedIds.length) this.orWhereIn('c.id', participatedIds)
    })
  }
  const rows = await q.orderBy('c.updated_at', 'desc').select('c.id', 'c.code', 'c.name').limit(50)
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const counts = await db('case_reviews')
    .whereIn('contract_id', ids).where('is_draft', false)
    .groupBy('contract_id').select('contract_id').count('* as n')
  const cntMap = new Map(counts.map((c) => [c.contract_id, Number(c.n)]))
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, versionCount: cntMap.get(r.id) || 0 }))
}

// 按 code/name 找合同，权限放宽到"可读 或 参与审批"。用于取流程文件。
async function findAccessibleContract(reqUser, query) {
  if (!query || !reqUser?.currentCompanyId) return null
  const q = String(query).trim()
  let row = await db('contracts').where({ company_id: reqUser.currentCompanyId, code: q }).first()
  if (!row) {
    row = await db('contracts')
      .where('company_id', reqUser.currentCompanyId)
      .where('name', 'ilike', `%${q}%`)
      .orderBy('updated_at', 'desc')
      .first()
  }
  if (!row) return null
  if (canReadContractRow(reqUser, row)) return row
  if (await userParticipatesInContract(reqUser, row.id)) return row
  return null
}

function safeParseOpinions(reviewText) {
  if (!reviewText) return null
  try {
    const v = typeof reviewText === 'string' ? JSON.parse(reviewText) : reviewText
    return v
  } catch {
    return typeof reviewText === 'string' ? reviewText.slice(0, 4000) : null
  }
}

// ─── 工具定义 ────────────────────────────────────────────────────────────────
export const TOOLS = [
  // ===== 只读 =====
  {
    name: 'list_todos',
    kind: 'read',
    label: '查询我的待办',
    requiredRoles: null,
    description: '查询当前用户的待办：待我审批的合同、提交给我处理的合同审核。',
    args: {},
    available: (u) => !!u?.currentCompanyId,
    async run(ctx) {
      const { reqUser } = ctx
      const cid = reqUser.currentCompanyId
      const approvalRows = await db('approvals as a')
        .leftJoin('contracts as c', 'a.contract_id', 'c.id')
        .leftJoin('approval_steps as cs', 'a.current_step_id', 'cs.id')
        .where('a.company_id', cid)
        .where('cs.assignee_id', reqUser.id)
        .where('cs.status', 'pending')
        .where('a.status', 'pending')
        .select(
          'a.id as approvalId', 'c.code as contractCode', 'c.name as contractName',
          'cs.step_type as stepType', 'cs.step_role as stepRole',
        )
        .limit(50)
      // nodeKind：seal=用印环节 / upload_scan=上传盖章扫描件 / approve=普通审批
      //   这两步是流程收尾，实质审批已结束。step_role 为空（迁移前在途审批）时退化为 approve。
      const approvals = approvalRows.map((r) => ({
        approvalId: r.approvalId,
        contractCode: r.contractCode,
        contractName: r.contractName,
        nodeKind: r.stepType === 'final-initiator' ? 'upload_scan'
          : r.stepRole === 'seal_admin' ? 'seal'
          : 'approve',
      }))
      const reviews = await db('messages as m')
        .leftJoin('case_reviews as r', 'm.review_id', 'r.id')
        .leftJoin('contracts as c', 'r.contract_id', 'c.id')
        .where('m.receiver_id', reqUser.id)
        .where('m.company_id', cid)
        .whereNotNull('m.review_id')
        .where('m.is_read', false)
        .select('r.id as reviewId', 'r.uploaded_filename as filename', 'c.code as contractCode', 'c.name as contractName')
        .limit(50)
      return { pendingApprovals: approvals, pendingReviews: reviews }
    },
  },
  {
    name: 'list_my_contracts',
    kind: 'read',
    label: '查询我的合同',
    requiredRoles: null,
    description: '查询合同列表。可选 status 过滤（drafting/approving/pending_seal/sealed）。普通员工返回自己创建/经办的，以及自己参与过审批流程的合同。',
    args: { status: '可选，合同状态：drafting|approving|pending_seal|sealed' },
    available: (u) => !!u?.currentCompanyId,
    async run(ctx, args) {
      const { reqUser } = ctx
      let q = db('contracts as c').where('c.company_id', reqUser.currentCompanyId)
      if (!reqUser.canViewAllContracts && !reqUser.isAllCompaniesView) {
        const participatedIds = await myParticipatedContractIds(reqUser)
        q = q.where(function () {
          this.where('c.created_by', reqUser.id).orWhere('c.handler_id', reqUser.id)
          if (participatedIds.length) this.orWhereIn('c.id', participatedIds)
        })
      }
      const STATUSES = ['drafting', 'approving', 'pending_seal', 'sealed']
      if (args?.status && STATUSES.includes(args.status)) q = q.where('c.status', args.status)
      const rows = await q
        .orderBy('c.updated_at', 'desc')
        .select('c.code', 'c.name', 'c.status', 'c.contract_type')
        .limit(50)
      return { contracts: rows }
    },
  },
  {
    name: 'get_contract_status',
    kind: 'read',
    label: '查询合同状态/审批进度',
    requiredRoles: null,
    description: '按合同编号或名称查询一份合同的状态与审批进度（各审批节点、当前在谁手上）。',
    args: { query: '已存在合同的编号(系统自动生成，如 天弘-HT-2026-001)或名称关键词' },
    available: (u) => !!u?.currentCompanyId,
    async run(ctx, args) {
      const c = await findContract(ctx.reqUser, args?.query)
      if (!c) return { found: false, message: '未找到匹配且你有权查看的合同' }
      const out = {
        found: true,
        code: c.code, name: c.name, status: c.status,
        contractType: c.contract_type || null,
        summary: c.summary || null,
      }
      if (c.approval_id) {
        const steps = await db('approval_steps as s')
          .leftJoin('users as u', 's.assignee_id', 'u.id')
          .where('s.approval_id', c.approval_id)
          .orderBy('s.created_at', 'asc')
          .select('s.step_index', 's.step_type', 's.step_role', 's.step_label', 's.status', 'u.display_name as assignee', 'u.username')
        out.approval = {
          steps: steps.map((s) => ({
            stepIndex: s.step_index, type: s.step_type, status: s.status,
            // nodeKind 帮助你向用户解释节点职责：seal=印章管理员用印、upload_scan=经办人上传盖章扫描件（两步均为收尾，实质审批已结束）
            nodeKind: s.step_type === 'final-initiator' ? 'upload_scan'
              : s.step_role === 'seal_admin' ? 'seal' : 'approve',
            label: s.step_label || null,
            assignee: s.assignee || s.username || null,
          })),
        }
      }
      return out
    },
  },
  {
    name: 'read_contract_material',
    kind: 'read',
    label: '读取合同/审核材料',
    requiredRoles: null,
    description: '读取一份合同的 AI 摘要与最近一次法务审核意见，便于你决策。按已存在合同的编号或名称查。',
    args: { query: '已存在合同的编号或名称关键词' },
    available: (u) => !!u?.currentCompanyId,
    async run(ctx, args) {
      const c = await findContract(ctx.reqUser, args?.query)
      if (!c) return { found: false, message: '未找到匹配且你有权查看的合同' }
      const review = await db('case_reviews')
        .where({ contract_id: c.id, is_draft: false })
        .orderBy('created_at', 'desc')
        .first()
      return {
        found: true,
        code: c.code, name: c.name, status: c.status,
        summary: c.summary || null,
        reviewOpinions: review ? safeParseOpinions(review.review_text) : null,
        reviewedFilename: review?.reviewed_filename || null,
      }
    },
  },
  {
    name: 'list_cases',
    kind: 'read',
    label: '查询案件台账',
    requiredRoles: ['legal', 'manager'],
    description: '查询案件台账（仅法务/管理人员）。',
    args: {},
    available: (u) => hasAnyRole(u, ['legal', 'manager']),
    async run() {
      const rows = await db('cases')
        .orderBy('updated_at', 'desc')
        .select('case_number', 'case_name', 'stage', 'our_party', 'opposing_party', 'total_amount')
        .limit(50)
      return { cases: rows }
    },
  },
  {
    name: 'list_reviews',
    kind: 'read',
    label: '查询合同审核记录',
    requiredRoles: null,
    description: '查询合同 AI 审核记录列表（普通员工只看自己提交的）。',
    args: {},
    available: (u) => !!u?.currentCompanyId,
    async run(ctx) {
      const { reqUser } = ctx
      const canSeeAll = hasAnyRole(reqUser, ['manager', 'legal', 'seal_admin', 'finance'])
      let q = db('case_reviews as r').where('r.company_id', reqUser.currentCompanyId).where('r.is_draft', false)
      if (!canSeeAll) q = q.where('r.created_by', reqUser.id)
      const rows = await q
        .orderBy('r.created_at', 'desc')
        .select('r.id', 'r.uploaded_filename', 'r.legal_approved', 'r.reviewed_at', 'r.contract_id')
        .limit(50)
      return { reviews: rows }
    },
  },
  {
    name: 'list_approval_candidates',
    kind: 'read',
    label: '查询可选审批人',
    requiredRoles: null,
    description: '发起审批前，查询本公司 active 审批模板的每个步骤及候选审批人（按合同查）。用于把"审批人姓名"对应到 userId。',
    args: { query: '已存在合同的编号或名称关键词' },
    available: (u) => !!u?.currentCompanyId && !u?.isAllCompaniesView,
    async run(ctx, args) {
      const { reqUser } = ctx
      const c = await findContract(reqUser, args?.query)
      if (!c) return { found: false, message: '未找到匹配的合同' }
      const template = await db('approval_templates')
        .where({ company_id: reqUser.currentCompanyId, is_active: true })
        .first()
      if (!template) return { found: true, contractId: c.id, templateMissing: true, message: '本公司未配置生效中的审批模板' }
      const steps = await db('approval_template_steps').where({ template_id: template.id }).orderBy('step_index', 'asc')
      const rolesNeeded = [...new Set(steps.map((s) => s.role))]
      const candRows = rolesNeeded.length === 0 ? [] : await db('user_company_roles as ucr')
        .innerJoin('users as u', 'ucr.user_id', 'u.id')
        .whereNull('u.deleted_at')
        .where('ucr.company_id', reqUser.currentCompanyId)
        .whereIn('ucr.role', rolesNeeded)
        .select('ucr.role', 'u.id as userId', 'u.username', 'u.display_name as displayName')
      const byRole = new Map(rolesNeeded.map((r) => [r, []]))
      for (const c2 of candRows) byRole.get(c2.role).push({ userId: c2.userId, username: c2.username, displayName: c2.displayName })
      return {
        found: true,
        contractId: c.id,
        template: { id: template.id, name: template.name },
        steps: steps.map((s) => ({ stepIndex: s.step_index, role: s.role, stepLabel: s.step_label || null, candidates: byRole.get(s.role) || [] })),
      }
    },
  },
  {
    name: 'list_legal_members',
    kind: 'read',
    label: '查询本公司法务',
    requiredRoles: null,
    description: '查询本公司的法务人员（含 userId）。提交法务审核(submit_to_legal)前用它确定接收法务的 userId。',
    args: {},
    available: (u) => !!u?.currentCompanyId,
    async run(ctx) {
      const rows = await db('user_company_roles as ucr')
        .innerJoin('users as u', 'ucr.user_id', 'u.id')
        .whereNull('u.deleted_at')
        .where('ucr.company_id', ctx.reqUser.currentCompanyId)
        .where('ucr.role', 'legal')
        .select('u.id as userId', 'u.username', 'u.display_name as displayName')
        .orderBy('u.username', 'asc')
      return { members: rows }
    },
  },

  {
    name: 'list_my_approvals',
    kind: 'read',
    label: '查询我参与的审批',
    requiredRoles: null,
    description: '查询当前用户参与的合同审批流程（我发起的 + 我作为审批人参与的），含审批状态、当前节点与当前在谁手上。',
    args: {},
    available: (u) => !!u?.currentCompanyId,
    async run(ctx) {
      const { reqUser } = ctx
      const ids = await db('approvals as a')
        .leftJoin('approval_steps as s', 's.approval_id', 'a.id')
        .where('a.company_id', reqUser.currentCompanyId)
        .where(function () {
          this.where('a.initiator_id', reqUser.id).orWhere('s.assignee_id', reqUser.id)
        })
        .distinct('a.id')
        .pluck('a.id')
      if (ids.length === 0) return { approvals: [] }
      const rows = await db('approvals as a')
        .leftJoin('contracts as c', 'a.contract_id', 'c.id')
        .leftJoin('approval_steps as cs', 'a.current_step_id', 'cs.id')
        .leftJoin('users as cu', 'cs.assignee_id', 'cu.id')
        .whereIn('a.id', ids)
        .orderBy('a.updated_at', 'desc')
        .limit(50)
        .select(
          'a.id as approvalId', 'a.status as approvalStatus', 'a.initiator_id',
          'c.code', 'c.name', 'c.status as contractStatus',
          'cs.step_type as curType', 'cs.step_role as curRole',
          'cu.display_name as currentAssignee', 'cu.username as currentAssigneeUsername',
        )
      return {
        approvals: rows.map((r) => ({
          code: r.code, name: r.name, contractStatus: r.contractStatus, approvalStatus: r.approvalStatus,
          iAmInitiator: r.initiator_id === reqUser.id,
          currentNode: r.curType === 'final-initiator' ? '上传盖章扫描件'
            : r.curRole === 'seal_admin' ? '用印' : (r.approvalStatus === 'pending' ? '审批中' : '已结束'),
          currentAssignee: r.currentAssignee || r.currentAssigneeUsername || null,
        })),
      }
    },
  },
  {
    name: 'get_contract_files',
    kind: 'read',
    label: '获取合同文件',
    requiredRoles: null,
    description: '获取一份合同可下载的文件（清洁版 / 用印版），并把下载按钮附到回复里发给用户。按编号或名称查；只要你对该合同有查看权限、或参与了它的审批流程即可获取。用户说"把某合同文件发我/下载/要清洁版用印版"时用它。',
    args: { query: '已存在合同的编号或名称关键词' },
    available: (u) => !!u?.currentCompanyId,
    async run(ctx, args) {
      const c = await findAccessibleContract(ctx.reqUser, args?.query)
      if (!c) return { found: false, message: '未找到匹配、且你有权查看或参与的合同' }
      const files = []
      const links = []
      if (c.clean_storage_path && c.clean_filename) {
        files.push({ kind: '清洁版', filename: c.clean_filename })
        links.push({ kind: 'contract_clean', contractId: c.id, filename: c.clean_filename, label: `清洁版：${c.clean_filename}` })
      }
      if (c.sealed_storage_path && c.sealed_filename) {
        files.push({ kind: '用印版', filename: c.sealed_filename })
        links.push({ kind: 'contract_sealed', contractId: c.id, filename: c.sealed_filename, label: `用印版：${c.sealed_filename}` })
      }
      if (files.length === 0) {
        return { found: true, code: c.code, name: c.name, files: [], message: '该合同暂无可下载文件（清洁版/用印版均未上传）' }
      }
      return { found: true, code: c.code, name: c.name, files, _fileLinks: links }
    },
  },

  // ===== 写操作（前端确认后调现有接口执行） =====
  {
    name: 'draft_contract',
    kind: 'write',
    label: '合同起草',
    requiredRoles: null,
    // autoConfirm：不影响他人的动作，确定意图后直接打开窗口，无需先弹"确认执行"卡
    autoConfirm: true,
    description: '用户要"起草/拟一份合同"时调用：打开合同起草工具（对话式收集要素、匹配模板或自行起草、生成 Word 草稿）。args 留空即可。',
    args: {},
    executor: 'draft_contract',
    available: (u) => !!u?.currentCompanyId,
    async summarize() {
      return { 操作: '打开合同起草工具' }
    },
  },
  {
    name: 'approve',
    kind: 'write',
    label: '审批通过',
    requiredRoles: null,
    description: '通过当前轮到我审批的某个合同审批。需要 approvalId 与审批意见 comment。',
    args: { approvalId: '审批 ID（可先用 list_todos 拿到）', comment: '审批意见（必填，非空）' },
    executor: 'approve',
    available: (u) => !!u?.currentCompanyId,
    async summarize(args, ctx) {
      const info = await approvalContractInfo(ctx.reqUser, args?.approvalId)
      return { 操作: '审批通过', 合同: info, 审批意见: args?.comment || '(未填写)' }
    },
    async fields(args, ctx) {
      const info = await approvalContractInfo(ctx.reqUser, args?.approvalId)
      return [
        { key: 'contract', label: '合同', type: 'readonly', value: info },
        { key: 'comment', label: '审批意见', type: 'textarea', required: true, value: args?.comment || '', placeholder: '填写通过意见，如「同意，无异议」' },
      ]
    },
  },
  {
    name: 'reject',
    kind: 'write',
    label: '审批驳回',
    requiredRoles: null,
    description: '驳回当前轮到我审批的某个合同审批。mode=to_step 退回经办人改后跳回我；to_start 整轮重新发起。',
    args: { approvalId: '审批 ID', comment: '驳回意见（必填，非空）', mode: 'to_step 或 to_start' },
    executor: 'reject',
    available: (u) => !!u?.currentCompanyId,
    async summarize(args, ctx) {
      const info = await approvalContractInfo(ctx.reqUser, args?.approvalId)
      return { 操作: '审批驳回', 合同: info, 驳回方式: args?.mode === 'to_start' ? '整轮重新发起' : '退回经办人', 驳回意见: args?.comment || '(未填写)' }
    },
    async fields(args, ctx) {
      const info = await approvalContractInfo(ctx.reqUser, args?.approvalId)
      return [
        { key: 'contract', label: '合同', type: 'readonly', value: info },
        { key: 'mode', label: '驳回方式', type: 'select', required: true,
          options: [{ value: 'to_step', label: '退回经办人修改后跳回我' }, { value: 'to_start', label: '整轮重新发起' }],
          value: args?.mode === 'to_start' ? 'to_start' : 'to_step' },
        { key: 'comment', label: '驳回意见', type: 'textarea', required: true, value: args?.comment || '', placeholder: '说明驳回原因与修改要求' },
      ]
    },
  },
  {
    name: 'legal_approve',
    kind: 'write',
    label: '审核通过（法务直通）',
    requiredRoles: ['legal'],
    description: '法务对某条已提交的合同审核给出"无需修订，直接通过"。需要 reviewId，可选 comment。',
    args: { reviewId: '审核记录 ID', comment: '法务意见（可选）' },
    executor: 'legal_approve',
    available: (u) => hasAnyRole(u, ['legal']),
    async summarize(args) {
      return { 操作: '审核通过（法务直通）', 审核记录: args?.reviewId, 法务意见: args?.comment || '(无)' }
    },
    async fields(args) {
      return [
        { key: 'comment', label: '法务意见', type: 'textarea', required: false, value: args?.comment || '', placeholder: '可选：填写法务意见（如「无需修订，可直接发起审批」）' },
      ]
    },
  },
  {
    name: 'upload_legal_revision',
    kind: 'write',
    label: '上传法务修订版',
    requiredRoles: ['legal'],
    description: '法务上传某条审核的修订版 Word。需要 reviewId 与一份已在聊天里上传的文件（用 attachmentFilename 指定）。',
    args: { reviewId: '审核记录 ID', attachmentFilename: '聊天里已上传的修订版文件名', comment: '法务意见（可选）' },
    executor: 'upload_legal_revision',
    available: (u) => hasAnyRole(u, ['legal']),
    async summarize(args) {
      return { 操作: '上传法务修订版', 审核记录: args?.reviewId, 文件: args?.attachmentFilename || '(未指定)', 法务意见: args?.comment || '(无)' }
    },
    async fields(args) {
      return [
        { key: 'attachmentFilename', label: '修订版文件', type: 'readonly', value: args?.attachmentFilename || '(未指定)' },
        { key: 'comment', label: '法务意见', type: 'textarea', required: false, value: args?.comment || '', placeholder: '可选：给经办人的修订说明' },
      ]
    },
  },
  {
    name: 'submit_review',
    kind: 'write',
    label: 'AI 审核合同',
    requiredRoles: null,
    // autoConfirm：AI 审核仅产出参考意见、不提交法务、不影响他人，确定意图后直接打开审核窗口
    autoConfirm: true,
    description: '对一份已在聊天里上传的 Word 合同跑 AI 审核（这是"自己看"的辅助审核，产出审核意见，不会发给法务）。审核意见会自动展示给用户。用 attachmentFilename 指定文件；必须确认我方立场 ourRole（甲方/乙方/自定义）与审核幅度 reviewIntensity(strict/medium/lenient)——这两项由用户在确认框里最终确定。',
    args: { attachmentFilename: '聊天里已上传的合同文件名', ourRole: '我方立场（甲方/乙方/自定义，默认甲方）', reviewIntensity: 'strict|medium|lenient（默认 medium）' },
    executor: 'submit_review',
    available: (u) => !!u?.currentCompanyId,
    async summarize(args) {
      return { 操作: 'AI 审核合同', 文件: args?.attachmentFilename || '(未指定)', 我方立场: args?.ourRole || '甲方', 审核幅度: args?.reviewIntensity || 'medium' }
    },
    async fields(args) {
      return [
        { key: 'attachmentFilename', label: '合同文件', type: 'readonly', value: args?.attachmentFilename || '(未指定)' },
        { key: 'ourRole', label: '我方立场', type: 'select', required: true, allowCustom: true,
          options: [{ value: '甲方' }, { value: '乙方' }],
          value: args?.ourRole || '甲方', hint: 'AI 会从我方视角找对我方不利的条款' },
        { key: 'reviewIntensity', label: '审核幅度', type: 'select', required: true,
          options: [{ value: 'strict', label: '严格 · 尽力争取我方利益' }, { value: 'medium', label: '中等 · 常规企业法务标准' }, { value: 'lenient', label: '宽松 · 只标明显风险' }],
          value: args?.reviewIntensity || 'medium' },
      ]
    },
  },
  {
    name: 'submit_to_legal',
    kind: 'write',
    label: '提交法务审核',
    requiredRoles: null,
    description: '把一条已完成 AI 审核的草稿(reviewId)提交法务，并通知接收法务(receiverId 用 list_legal_members 查)。两种归属：①新建合同 contractMode=new(只需 contractName，编号自动)；②升版关联到已有合同 contractMode=existing——同一份合同的修订版/二三版用它，作为该合同新版本(V2/V3…)，别新建重复合同。用户说"这是XX合同的修订版/二版/在XX基础上改的"或点名某既有合同时，设 contractMode=existing 并把那份历史合同名填进 contractName，系统会自动匹配关联、用户还能在确认框核对改选。',
    args: {
      reviewId: '已完成 AI 审核的审核记录 ID（来自 submit_review）',
      contractMode: 'new（新建合同，默认）或 existing（升版关联到已有合同）',
      contractName: 'new 时=新合同名称（编号自动）；existing 时=用户点名的那份历史合同名称（用于系统自动匹配关联）',
      contractId: 'existing 时要关联到的历史合同 ID（一般留空，由确认框按名称匹配/用户选择）',
      receiverId: '接收法务的 userId（用 list_legal_members 查）',
      body: '给法务的说明/留言',
    },
    executor: 'submit_to_legal',
    available: (u) => !!u?.currentCompanyId && !u?.isAllCompaniesView,
    async summarize(args) {
      let contract
      if (args?.contractMode === 'existing') {
        if (args?.contractId) {
          const c = await db('contracts').where({ id: args.contractId }).first()
          contract = c ? `升版关联：${c.code} ${c.name}` : '升版关联已有合同（确认框选择）'
        } else {
          contract = `升版关联已有合同${args?.contractName ? `（匹配「${args.contractName}」）` : '（确认框选择）'}`
        }
      } else {
        contract = `新建：${args?.contractName || '(未填名称)'}`
      }
      let receiver = args?.receiverId || '(未指定)'
      if (args?.receiverId) {
        const u = await db('users').where({ id: args.receiverId }).first()
        if (u) receiver = u.display_name || u.username
      }
      return { 操作: '提交法务审核', 合同: contract, 接收法务: receiver, 留言: args?.body || '(无)' }
    },
    async fields(args, ctx) {
      const reqUser = ctx.reqUser
      // 接收法务下拉：本公司 legal 角色
      const members = await db('user_company_roles as ucr')
        .innerJoin('users as u', 'ucr.user_id', 'u.id')
        .whereNull('u.deleted_at')
        .where('ucr.company_id', reqUser.currentCompanyId)
        .where('ucr.role', 'legal')
        .select('u.id as userId', 'u.username', 'u.display_name as displayName')
        .orderBy('u.username', 'asc')
      const memberOptions = members.map((m) => ({ value: m.userId, label: m.displayName || m.username }))

      // 可升版关联的历史合同（仅起草中、未发起审批的才能再加版本）
      const assoc = await associableContracts(reqUser)
      const contractOptions = assoc.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}（已审 ${c.versionCount} 次）` }))

      // 自动关联：AI 给了 contractId 直接用；否则若意图为升版且给了名称，按名称/编号在可关联列表里匹配一份
      let defaultContractId = args?.contractId || ''
      if (!defaultContractId && args?.contractName) {
        const kw = String(args.contractName).trim()
        const hit = assoc.find((c) => c.name && (c.name.includes(kw) || kw.includes(c.name))) || assoc.find((c) => c.code === kw)
        if (hit) defaultContractId = hit.id
      }
      const matched = defaultContractId && contractOptions.some((o) => o.value === defaultContractId)
      const defaultMode = (args?.contractMode === 'existing' || matched) ? 'existing' : 'new'

      return [
        { key: 'contractMode', label: '提交方式', type: 'select', required: true,
          options: [
            { value: 'new', label: '新建合同' },
            { value: 'existing', label: '关联已有合同（升版 V2/V3…）' },
          ],
          value: defaultMode,
          hint: '同一份合同的修订/二版选「关联已有合同」，会作为新版本挂在原合同下、不另建' },
        { key: 'contractId', label: '关联到历史合同', type: 'dropdown', required: true,
          options: contractOptions, value: matched ? defaultContractId : '',
          placeholder: '选择要升版的历史合同…',
          showWhen: { key: 'contractMode', value: 'existing' },
          hint: contractOptions.length === 0
            ? '当前没有可升版关联的合同（已发起审批/已签署的不可再加版本）'
            : '这份审核将作为所选合同的新版本（V2/V3…）归档' },
        { key: 'contractName', label: '新合同名称', type: 'text', required: true,
          value: matched ? '' : (args?.contractName || ''), placeholder: '给这份合同起个名字（编号系统自动生成）',
          showWhen: { key: 'contractMode', value: 'new' } },
        { key: 'receiverId', label: '接收法务', type: 'select', required: true, options: memberOptions,
          value: args?.receiverId || (memberOptions[0]?.value || ''),
          hint: memberOptions.length === 0 ? '本公司暂无法务岗用户' : undefined },
        { key: 'body', label: '给法务的留言', type: 'textarea', required: true,
          value: args?.body || '请帮忙审核这份合同，谢谢。' },
      ]
    },
  },
  {
    name: 'initiate_approval',
    kind: 'write',
    label: '发起合同审批',
    requiredRoles: null,
    description: '弹出"发起审批"表单：自动列可发起合同、沿用/上传清洁版、按模板列审批人供用户确认。别自己查状态、别因"起草中"拒绝；args 可留空，字段都在表单里填。',
    args: {
      contractId: '合同 ID',
      stepAssignments: '数组 [{stepIndex, userId}]，覆盖模板所有步骤',
      initiationNote: '发起说明（可选）',
      reuseExistingClean: 'true 则沿用合同已存清洁版',
      attachmentFilename: '聊天里上传的清洁版文件名（reuseExistingClean 非 true 时需要）',
    },
    executor: 'initiate_approval',
    available: (u) => !!u?.currentCompanyId && !u?.isAllCompaniesView,
    async summarize(args, ctx) {
      const c = args?.contractId ? await db('contracts').where({ id: args.contractId }).first() : null
      return {
        操作: '发起合同审批',
        合同: c ? `${c.code} ${c.name}` : (args?.contractId || '(未指定)'),
        审批节点数: Array.isArray(args?.stepAssignments) ? args.stepAssignments.length : 0,
        清洁版: args?.reuseExistingClean ? '沿用已有' : (args?.attachmentFilename || '(待指定)'),
      }
    },
  },
]

// 取审批对应的合同信息（确认框展示用）
async function approvalContractInfo(reqUser, approvalId) {
  if (!approvalId) return '(未指定 approvalId)'
  const row = await db('approvals as a')
    .leftJoin('contracts as c', 'a.contract_id', 'c.id')
    .where('a.id', approvalId)
    .select('c.code', 'c.name')
    .first()
  if (!row) return approvalId
  return `${row.code || ''} ${row.name || ''}`.trim() || approvalId
}

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
export function getTool(name) {
  return TOOLS_BY_NAME.get(name) || null
}

/** 按用户角色过滤出可用工具 */
export function buildCatalogForUser(reqUser) {
  return TOOLS.filter((t) => {
    try { return t.available(reqUser) } catch { return false }
  })
}
