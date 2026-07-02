// v2.1 合同审批流程（模板驱动）
//
// 流程语义：
//   - 经办人（contract.created_by）发起审批 → 系统读取本公司 active 的 approval_templates
//     按模板生成 approval_steps 主链 step_index=1..N（superadmin 不出现在任何节点）
//   - 发起时，对每个模板步骤，前端从候选人（公司内有对应角色的用户）中指定具体审批人
//     单人角色自动填，多人角色让发起人挑
//   - 后续审批人按顺序流转：通过/驳回/加签
//   - 加签：临时分支咨询某人 → 那人只能"提交意见"无通过/驳回 → 控制权回到加签人
//   - 驳回-到经办人节点：经办人改完直接跳回驳回人（不重走中间已通过节点）
//   - 驳回-重提：当前 approval 关闭，经办人需重新发起
//   - 全部通过 → 流转到经办人节点 → 经办人传用印版 → 合同状态 'sealed'

import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { db, writeAudit } from '../db.js'
import {
  requireAuth, requireCompanyContext, requireCompanyRole,
  hasCompanyRole, canReadContractRow,
} from '../auth.js'
import { chatCompletion } from '../openai.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink, wordOnlyFileFilter } from '../storage.js'
import { notifyNewMessageEmail } from '../emailService.js'

const execFileP = promisify(execFile)

const r = Router()
r.use(requireAuth, requireCompanyContext)

// ─── 上传 multer ─────────────────────────────────────────────────────────────
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const SEALED_ROOT = path.join(DATA_ROOT, 'sealed')
const CLEAN_ROOT = path.join(DATA_ROOT, 'clean')
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')

const sealUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const dir = path.join(SEALED_ROOT, req.params.id || 'misc')
      try { await ensureDir(dir); cb(null, dir) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
})

// 清洁版：先存 tmp，事务里搬到 clean/<contractId>/（避免 multer destination 阶段 body 还没解析）
// fileFilter：清洁版只允许 Word（.doc/.docx），PDF 等会被拒绝
const cleanUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(TMP_ROOT); cb(null, TMP_ROOT) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: wordOnlyFileFilter,
})

// ─── AI 合同摘要 ──────────────────────────────────────────────────────────────
//   发起审批时调一次，存到 contracts.summary（同合同后续审批共用）
//   prompt 来自 app_settings.contract_summary_prompt（超管可在系统设置改）

async function generateContractSummary(contractId, contractName) {
  // v1.3.1: 摘要基于清洁版（contracts.clean_*）—— 那是经办人发起审批时整合好的最终版本
  const contract = await db('contracts')
    .select('clean_storage_path', 'clean_mime_type', 'clean_filename')
    .where({ id: contractId })
    .first()
  if (!contract?.clean_storage_path) return null

  let text
  try {
    text = await extractTextFromFile(
      toAbsolutePath(contract.clean_storage_path),
      contract.clean_mime_type,
      contract.clean_filename,
    )
  } catch (e) {
    console.error('[summary] extract text failed:', e?.message || e)
    return null
  }
  if (!text || text.trim().length < 10) return null
  // 太长截断（摘要不需要全文，前 8 万字够了）
  if (text.length > 80_000) text = text.slice(0, 80_000)

  // 取 prompt（DB 优先，缺省用兜底）
  const promptRow = await db('app_settings').where({ key: 'contract_summary_prompt' }).first()
  const systemPrompt = promptRow?.value || DEFAULT_SUMMARY_PROMPT

  const userMsg = `【合同名称】${contractName || '未命名'}\n\n【合同正文】\n${text}`
  const result = await chatCompletion({
    system: systemPrompt,
    user: userMsg,
  })
  return result.content
}

const DEFAULT_SUMMARY_PROMPT = `你是一名资深合同审阅助理，请用简洁的中文段落总结以下合同的关键信息。
按"双方主体 / 合同标的 / 金额与支付节奏 / 关键期限"4 个方面各写一段（约 1-3 句）。
只输出 4 段，不要 Markdown 标题、不要列表符号、不要前后导语。`

async function extractTextFromFile(absPath, mimeType, originalName) {
  const ext = path.extname(originalName).toLowerCase()
  if (ext === '.txt' || mimeType === 'text/plain') {
    return (await fs.readFile(absPath, 'utf8')).trim()
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default
    const buf = await fs.readFile(absPath)
    const result = await mammoth.extractRawText({ buffer: buf })
    return (result.value || '').trim()
  }
  if (ext === '.doc') {
    const WordExtractor = (await import('word-extractor')).default
    const extractor = new WordExtractor()
    const doc = await extractor.extract(absPath)
    return (doc.getBody() || '').trim()
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const buf = await fs.readFile(absPath)
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise
    const parts = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map(it => ('str' in it) ? it.str : '').join(' '))
    }
    await doc.destroy()
    return parts.join('\n').trim()
  }
  return ''
}

// ─── 行 → JSON ────────────────────────────────────────────────────────────────

function rowToApproval(row) {
  if (!row) return null
  return {
    id: row.id,
    contractId: row.contract_id,
    contractCode: row.contract_code,
    contractName: row.contract_name,
    contractStatus: row.contract_status,
    initiatorId: row.initiator_id,
    initiatorUsername: row.initiator_username,
    initiatorDisplayName: row.initiator_display_name,
    status: row.status,
    initiationNote: row.initiation_note,
    currentStepId: row.current_step_id || null,
    currentAssigneeId: row.current_assignee_id || null,
    currentAssigneeUsername: row.current_assignee_username || null,
    currentAssigneeDisplayName: row.current_assignee_display_name || null,
    // 当前节点种类：seal=用印 / upload_scan=上传盖章扫描件 / approve=普通审批（两步均为收尾，实质审批已结束）
    currentNodeKind: row.current_step_type === 'final-initiator' ? 'upload_scan'
      : row.current_step_role === 'seal_admin' ? 'seal' : 'approve',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: toIso(row.completed_at),
    rejectedAt: toIso(row.rejected_at),
  }
}

function rowToStep(row) {
  if (!row) return null
  return {
    id: row.id,
    approvalId: row.approval_id,
    stepIndex: row.step_index,
    parentStepId: row.parent_step_id || null,
    stepType: row.step_type,
    stepRole: row.step_role || null,
    stepLabel: row.step_label || null,
    assigneeId: row.assignee_id,
    assigneeUsername: row.assignee_username,
    assigneeDisplayName: row.assignee_display_name,
    status: row.status,
    comment: row.comment,
    actionedAt: toIso(row.actioned_at),
    createdAt: toIso(row.created_at),
  }
}

function rowToAction(row) {
  if (!row) return null
  return {
    id: row.id,
    approvalId: row.approval_id,
    stepId: row.step_id || null,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorDisplayName: row.actor_display_name,
    action: row.action,
    comment: row.comment,
    targetStepId: row.target_step_id || null,
    payload: row.payload || null,
    createdAt: toIso(row.created_at),
  }
}

function toIso(v) {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : v
}

const APPROVAL_SELECT = [
  'a.id', 'a.contract_id', 'a.company_id', 'a.initiator_id', 'a.status', 'a.initiation_note',
  'a.current_step_id', 'a.created_at', 'a.updated_at', 'a.completed_at', 'a.rejected_at',
  'c.code as contract_code', 'c.name as contract_name', 'c.status as contract_status',
  'iu.username as initiator_username', 'iu.display_name as initiator_display_name',
  'cs.assignee_id as current_assignee_id', 'cs.step_type as current_step_type', 'cs.step_role as current_step_role',
  'cu.username as current_assignee_username', 'cu.display_name as current_assignee_display_name',
]

function joinApproval(q) {
  return q
    .from('approvals as a')
    .leftJoin('contracts as c', 'a.contract_id', 'c.id')
    .leftJoin('users as iu', 'a.initiator_id', 'iu.id')
    .leftJoin('approval_steps as cs', 'a.current_step_id', 'cs.id')
    .leftJoin('users as cu', 'cs.assignee_id', 'cu.id')
}

// ─── 工具：写一条 action ──────────────────────────────────────────────────────
async function writeAction(trx, { approvalId, stepId, actorId, action, comment, targetStepId, payload, companyId }) {
  await trx('approval_actions').insert({
    approval_id: approvalId,
    step_id: stepId || null,
    actor_id: actorId,
    action,
    comment: comment || null,
    target_step_id: targetStepId || null,
    payload: payload ? JSON.stringify(payload) : null,
    company_id: companyId,
  })
}

// ─── 工具：审批流转通知 ──────────────────────────────────────────────────────
async function sendApprovalNotice(trx, { approvalId, senderId, recipientId, body, companyId }) {
  if (!recipientId || recipientId === senderId) return
  await trx('messages').insert({
    sender_id: senderId,
    receiver_id: recipientId,
    body,
    approval_id: approvalId,
    company_id: companyId,
    is_read: false,
  })
  // 异步邮件通知（fire-and-forget，失败只记日志，绝不影响审批/站内信流程）
  void notifyNewMessageEmail({ receiverId: recipientId, title: '合同审批通知', body })
}

function buildNoticeBody({ contract, action, actorName, extra, isSealNode }) {
  const head = `${contract.code} 《${contract.name}》`
  switch (action) {
    case 'submit':
      if (isSealNode) return `合同实质性审批已完成，现需您【用印盖章】：${head}（由 ${actorName} 发起）。请核对终稿无误后加盖公章，并在审批界面点【通过】。${extra ? `\n\n发起说明：${extra}` : ''}`
      return `您有一份合同待审批：${head}（由 ${actorName} 发起）${extra ? `\n\n发起说明：${extra}` : ''}`
    case 'approve_next':
      if (isSealNode) return `合同已通过全部实质性审批，现需您【用印盖章】：${head}（上一步由 ${actorName} 通过）。这是审批流的用印环节，请核对终稿无误后加盖公章，并在审批界面点【通过】。${extra ? `\n\n上一步意见：${extra}` : ''}`
      return `合同审批流转到您：${head}（上一步由 ${actorName} 通过）${extra ? `\n\n上一步意见：${extra}` : ''}`
    case 'approve_final':       return `合同已完成全部审批及用印，请您上传【盖章后的扫描件】归档（此为流程最后一步，实质审批已结束）：${head}${extra ? `\n\n上一步意见：${extra}` : ''}`
    case 'reject_to_step':      return `您的合同审批被驳回，请修改材料后在审批界面点【重新提交】：${head}（驳回人：${actorName}）${extra ? `\n\n驳回意见：${extra}` : ''}`
    case 'reject_to_start':     return `您的合同审批被驳回（重新发起）：${head}（驳回人：${actorName}）${extra ? `\n\n驳回意见：${extra}` : ''}\n\n如需继续，请到合同审批页重新发起。`
    case 'add_consultee':       return `您被 ${actorName} 加签到合同审批：${head}${extra ? `\n\n加签说明：${extra}` : ''}\n\n请在审批界面提交您的意见。`
    case 'submit_consultation': return `您加签的咨询已完成，请继续审批：${head}（咨询人：${actorName}）${extra ? `\n\n咨询意见：${extra}` : ''}`
    case 'resubmit':            return `经办人已重新提交合同，请继续审批：${head}（经办人：${actorName}）${extra ? `\n\n补充说明：${extra}` : ''}`
    default: return `合同审批有更新：${head}`
  }
}

// 判断某个审批步骤是否"用印节点"（印章管理员盖章）。
//   只认流程节点配置的角色（step_role），绝不看处理人本身的身份 —— 否则"财务兼印章岗"
//   的人担任的财务节点会被误判成用印节点。step_role 为空（极个别无法回填的老审批）按普通审批处理。
function stepIsSealNode(step) {
  return !!step && step.step_type === 'approver' && step.step_role === 'seal_admin'
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/approvals — 发起审批（v2.1）
//   body:
//     contractId           合同 id
//     stepAssignments      [{ stepIndex, userId }] —— 必须覆盖模板里全部步骤
//     initiationNote       可选
//     reuseExistingClean   "true" | "false"
//     cleanFile            可选 multipart 文件
//
//   v2.1 改造点：
//     - 移除"第一步给 superadmin"的硬编码，superadmin 不再出现在任何审批节点
//     - 读取当前公司 active 的 approval_templates，按模板生成 approval_steps 主链
//     - 经办人最终节点（step_index=999, step_type=final-initiator）保持不变
r.post('/', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'),
  cleanUpload.single('cleanFile'), async (req, res, next) => {
  let savedAbsPath = req.file?.path || null
  try {
    const { contractId, initiationNote } = req.body || {}
    const reuseClean = req.body?.reuseExistingClean === 'true' || req.body?.reuseExistingClean === true

    // stepAssignments 可能是 JSON 字符串（FormData）或对象/数组
    let stepAssignments = req.body?.stepAssignments
    if (typeof stepAssignments === 'string') {
      try { stepAssignments = JSON.parse(stepAssignments) } catch {
        return res.status(400).json({ error: 'stepAssignments 必须是合法的 JSON 数组' })
      }
    }
    if (!contractId) return res.status(400).json({ error: '请选择合同' })
    if (!Array.isArray(stepAssignments) || stepAssignments.length === 0) {
      return res.status(400).json({ error: '请为每个审批步骤指定审批人' })
    }

    const contract = await db('contracts').where({ id: contractId }).first()
    if (!contract) return res.status(404).json({ error: '合同不存在' })
    if (contract.company_id !== req.user.currentCompanyId) {
      return res.status(403).json({ error: '该合同不属于当前公司' })
    }
    // 仅"起草中"的合同可发起审批：
    //   - 新建的、以及审批被驳回后退回"起草中"的合同 → 可发起（含重新发起）
    //   - "审批中" → 已有进行中的审批，不能重复发起
    //   - "待签署""已签署" → 审批已结束，不能再发起，也不覆盖其已生成的用印/盖章件
    // 注意：v2.x 已放开"必须先经法务审核"的前置要求，未经法务审核的起草中合同也可直接发起。
    if (contract.status !== 'drafting') {
      return res.status(400).json({
        error: '该合同当前不是"起草中"状态，不能发起审批（审批中或已完成审批的合同不能重复发起；被驳回的合同会退回"起草中"后可重新发起）',
      })
    }
    if (!canReadContractRow(req.user, contract)) {
      return res.status(403).json({ error: '无权对该合同发起审批' })
    }

    // 兜底：起草中合同理论上不应有进行中的审批，仍防御性拦一道，避免并行两条审批
    const activeApproval = await db('approvals')
      .where({ contract_id: contractId, status: 'pending' })
      .first()
    if (activeApproval) {
      return res.status(409).json({ error: '该合同已有进行中的审批' })
    }

    const initiatorId = contract.created_by
    const companyId = contract.company_id

    // ─── 读取 active 模板 + 步骤 ────────────────────────────────────────────
    const template = await db('approval_templates')
      .where({ company_id: companyId, is_active: true })
      .first()
    if (!template) {
      return res.status(412).json({
        error: '本公司尚未配置生效中的审批流模板，请联系平台超管在企业管理中配置',
        templateMissing: true,
      })
    }
    const templateSteps = await db('approval_template_steps')
      .where({ template_id: template.id })
      .orderBy('step_index', 'asc')
    if (templateSteps.length === 0) {
      return res.status(412).json({
        error: '生效中的审批流模板没有任何步骤，请联系平台超管补充',
        templateMissing: true,
      })
    }

    // ─── 校验 stepAssignments ────────────────────────────────────────────────
    // 必须按 stepIndex 全部覆盖，且每个 userId 在当前公司确实有对应 role
    const assignmentMap = new Map() // stepIndex → userId
    for (const a of stepAssignments) {
      const idx = Number(a?.stepIndex)
      const uid = String(a?.userId || '').trim()
      if (!Number.isInteger(idx) || !uid) {
        return res.status(400).json({ error: 'stepAssignments 每项必须含 stepIndex 与 userId' })
      }
      assignmentMap.set(idx, uid)
    }

    const allAssigneeIds = [...new Set(assignmentMap.values())]
    // 一次拉所有候选人角色信息，便于校验
    const ucrRows = await db('user_company_roles as ucr')
      .innerJoin('users as u', 'ucr.user_id', 'u.id')
      .whereNull('u.deleted_at')
      .where('ucr.company_id', companyId)
      .whereIn('ucr.user_id', allAssigneeIds)
      .select('ucr.user_id', 'ucr.role')
    const rolesByUser = new Map()
    for (const r of ucrRows) {
      if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, new Set())
      rolesByUser.get(r.user_id).add(r.role)
    }

    for (const ts of templateSteps) {
      const uid = assignmentMap.get(ts.step_index)
      if (!uid) {
        return res.status(400).json({
          error: `审批步骤 #${ts.step_index}（${ts.role}）未指定审批人`,
        })
      }
      const roles = rolesByUser.get(uid)
      if (!roles || !roles.has(ts.role)) {
        return res.status(400).json({
          error: `审批步骤 #${ts.step_index} 指定的用户在本公司没有"${ts.role}"角色`,
        })
      }
      if (uid === initiatorId) {
        return res.status(400).json({
          error: `审批步骤 #${ts.step_index} 不能指定经办人本人作为审批人`,
        })
      }
    }

    // v1.3.1: 清洁版处理
    if (reuseClean) {
      if (!contract.clean_storage_path) {
        return res.status(400).json({ error: '该合同没有可沿用的清洁版，请上传新清洁版' })
      }
      if (req.file) await safeUnlink(req.file.path)
      savedAbsPath = null
    } else {
      if (!req.file) {
        return res.status(400).json({ error: '请上传清洁版文件' })
      }
    }

    // 把 tmp 文件搬到 clean/<contractId>/（事务前完成，事务里才写库）
    let newCleanStoragePath = null
    let newCleanFilename = null
    let oldCleanAbsToRemove = null
    if (!reuseClean) {
      const targetDir = path.join(CLEAN_ROOT, contractId)
      await ensureDir(targetDir)
      newCleanFilename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      const targetAbs = path.join(targetDir, `${Date.now()}_${safeFilename(newCleanFilename)}`)
      await fs.rename(req.file.path, targetAbs)
      savedAbsPath = targetAbs
      newCleanStoragePath = toStoragePath(targetAbs)
      oldCleanAbsToRemove = contract.clean_storage_path ? toAbsolutePath(contract.clean_storage_path) : null
    }

    const result = await db.transaction(async (trx) => {
      if (newCleanStoragePath) {
        await trx('contracts').where({ id: contractId }).update({
          clean_filename: newCleanFilename,
          clean_storage_path: newCleanStoragePath,
          clean_size_bytes: req.file.size,
          clean_mime_type: req.file.mimetype,
          clean_uploaded_at: new Date(),
          clean_uploaded_by: req.user.id,
          summary: null,
          summary_generated_at: null,
        })
      }

      const [approvalRow] = await trx('approvals').insert({
        contract_id: contractId,
        initiator_id: initiatorId,
        status: 'pending',
        initiation_note: initiationNote ? String(initiationNote).trim() : null,
        company_id: companyId,
      }, ['id'])
      const approvalId = approvalRow.id

      // 按模板生成主链：step_index = 1..N
      //   v2.4：把模板的 role / step_label 固化到步骤上，节点身份不再靠处理人角色推断
      let firstStepId = null
      for (const ts of templateSteps) {
        const [row] = await trx('approval_steps').insert({
          approval_id: approvalId,
          step_index: ts.step_index,
          step_type: 'approver',
          step_role: ts.role,
          step_label: ts.step_label || null,
          assignee_id: assignmentMap.get(ts.step_index),
          status: 'pending',
          company_id: companyId,
        }, ['id'])
        if (firstStepId === null) firstStepId = row.id
      }
      // 经办人最终节点（用印完成后上传盖章扫描件归档）
      await trx('approval_steps').insert({
        approval_id: approvalId,
        step_index: 999,
        step_type: 'final-initiator',
        step_role: null,
        step_label: '上传盖章扫描件',
        assignee_id: initiatorId,
        status: 'pending',
        company_id: companyId,
      })

      await trx('approvals').where({ id: approvalId }).update({
        current_step_id: firstStepId,
      })
      await trx('contracts').where({ id: contractId }).update({
        status: 'approving',
        approval_id: approvalId,
        updated_at: new Date(),
      })

      await writeAction(trx, {
        approvalId, stepId: null, actorId: req.user.id,
        action: 'submit', comment: initiationNote || null,
        payload: { templateId: template.id, assignments: [...assignmentMap].map(([i, u]) => ({ stepIndex: i, userId: u })) },
        companyId,
      })

      // 通知第一审批人
      const firstAssigneeId = assignmentMap.get(templateSteps[0].step_index)
      await sendApprovalNotice(trx, {
        approvalId, senderId: req.user.id, recipientId: firstAssigneeId,
        body: buildNoticeBody({
          contract, action: 'submit',
          actorName: req.user.displayName || req.user.username,
          extra: initiationNote ? String(initiationNote).trim() : '',
          isSealNode: templateSteps[0].role === 'seal_admin',
        }),
        companyId,
      })

      return { approvalId, currentStepId: firstStepId }
    })

    if (oldCleanAbsToRemove) await safeUnlink(oldCleanAbsToRemove)

    if (newCleanStoragePath || !contract.summary) {
      generateContractSummary(contractId, contract.name)
        .then(async (summary) => {
          if (summary) {
            await db('contracts').where({ id: contractId }).update({
              summary,
              summary_generated_at: new Date(),
            })
          }
        })
        .catch(err => console.error('[summary] generation failed:', err?.message || err))
    }

    await writeAudit({
      actorId: req.user.id, action: 'approval.submit',
      targetType: 'approval', targetId: result.approvalId,
      payload: { contractId, templateId: template.id, reuseClean, cleanReplaced: !!newCleanStoragePath },
      companyId: req.user.currentCompanyId,
    })

    res.status(201).json({ approvalId: result.approvalId })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// GET /api/approvals?role=todo|initiated|all — 列表（v2.0：按公司过滤）
r.get('/', async (req, res, next) => {
  try {
    const role = req.query.role || 'todo'
    let q = joinApproval(db.select(APPROVAL_SELECT)).orderBy('a.updated_at', 'desc')
    q = q.where('a.company_id', req.user.currentCompanyId)

    if (role === 'todo') {
      q = q
        .where('cs.assignee_id', req.user.id)
        .where('cs.status', 'pending')
        .where('a.status', 'pending')
    } else if (role === 'initiated') {
      q = q.where('a.initiator_id', req.user.id)
    } else if (role === 'all') {
      // 公司管理员/法务能看本公司所有审批
      if (!hasCompanyRole(req, 'manager') && !hasCompanyRole(req, 'legal')) {
        return res.status(403).json({ error: '仅企业管理人员 / 法务岗可查看本公司全部审批' })
      }
    } else {
      return res.status(400).json({ error: '不支持的 role 参数' })
    }

    const rows = await q.limit(500)
    res.json({ approvals: rows.map(rowToApproval) })
  } catch (e) { next(e) }
})

// GET /api/approvals/template-preview?contractId=xxx
//   v2.1: 发起审批前查询当前公司 active 模板 + 每步候选人
//   返回 { template, steps: [{ stepIndex, role, stepLabel, candidates: [{userId, username, displayName}] }] }
//   - 无 active 模板 → 412（让前端把错误展示出来，禁止发起）
//   - 某角色在公司内没人 → candidates 为空，前端按需提示"联系超管补充人员"
r.get('/template-preview', async (req, res, next) => {
  try {
    if (req.user.isAllCompaniesView) {
      return res.status(400).json({ error: '"全部公司"模式不能发起审批，请先切换到具体公司' })
    }
    // contractId 可选：不传时按当前公司预览模板（用于"不经审核直接发起"——合同尚未创建）
    const { contractId } = req.query || {}
    if (contractId) {
      const contract = await db('contracts').where({ id: contractId }).first()
      if (!contract) return res.status(404).json({ error: '合同不存在' })
      if (contract.company_id !== req.user.currentCompanyId) {
        return res.status(403).json({ error: '该合同不属于当前公司' })
      }
    }

    const template = await db('approval_templates')
      .where({ company_id: req.user.currentCompanyId, is_active: true })
      .first()
    if (!template) {
      return res.status(412).json({
        error: '本公司尚未配置任何生效中的审批流模板，请联系平台超管在企业管理中配置',
        templateMissing: true,
      })
    }

    const steps = await db('approval_template_steps')
      .where({ template_id: template.id })
      .orderBy('step_index', 'asc')

    const rolesNeeded = [...new Set(steps.map(s => s.role))]

    // 一次性把模板里出现的角色对应的中文名拉出来（用于前端展示，不再依赖前端写死的 label）
    const roleNameRows = rolesNeeded.length === 0 ? [] : await db('company_roles')
      .where({ company_id: req.user.currentCompanyId })
      .whereIn('key', rolesNeeded)
      .select('key', 'name')
    const roleNameByKey = new Map(roleNameRows.map(r => [r.key, r.name]))

    // 候选人：当前公司有该角色且未软删除的用户
    const candRows = rolesNeeded.length === 0 ? [] : await db('user_company_roles as ucr')
      .innerJoin('users as u', 'ucr.user_id', 'u.id')
      .whereNull('u.deleted_at')
      .where('ucr.company_id', req.user.currentCompanyId)
      .whereIn('ucr.role', rolesNeeded)
      .select('ucr.role', 'u.id', 'u.username', 'u.display_name')
      .orderBy('u.username', 'asc')

    const candidatesByRole = new Map()
    for (const r of rolesNeeded) candidatesByRole.set(r, [])
    for (const c of candRows) {
      candidatesByRole.get(c.role).push({
        userId: c.id,
        username: c.username,
        displayName: c.display_name || null,
      })
    }

    res.json({
      template: {
        id: template.id,
        name: template.name,
      },
      steps: steps.map(s => ({
        stepIndex: s.step_index,
        role: s.role,
        roleName: roleNameByKey.get(s.role) || s.role,
        stepLabel: s.step_label || null,
        candidates: candidatesByRole.get(s.role) || [],
      })),
    })
  } catch (e) { next(e) }
})

// GET /api/approvals/:id — 详情
r.get('/:id', async (req, res, next) => {
  try {
    const row = await joinApproval(db.select(APPROVAL_SELECT)).where('a.id', req.params.id).first()
    if (!row) return res.status(404).json({ error: '审批不存在' })
    if (row.company_id !== req.user.currentCompanyId) {
      return res.status(403).json({ error: '该审批不属于当前公司' })
    }

    const canSeeAll = hasCompanyRole(req, 'manager') || hasCompanyRole(req, 'legal')
    const isInitiator = row.initiator_id === req.user.id
    const involved = await db('approval_steps').where({ approval_id: row.id, assignee_id: req.user.id }).first()
    if (!canSeeAll && !isInitiator && !involved) {
      return res.status(403).json({ error: '无权查看该审批' })
    }

    const steps = await db('approval_steps as s')
      .leftJoin('users as u', 's.assignee_id', 'u.id')
      .select(
        's.id', 's.approval_id', 's.step_index', 's.parent_step_id', 's.step_type',
        's.step_role', 's.step_label',
        's.assignee_id', 's.status', 's.comment', 's.actioned_at', 's.created_at',
        'u.username as assignee_username', 'u.display_name as assignee_display_name',
      )
      .where('s.approval_id', row.id)
      .orderBy([
        { column: 's.created_at', order: 'asc' },
      ])

    // v2.1+: 给每个 step 附加 assignee 在本公司的角色（前端据此判断"是否到达印章管理员节点"）
    const assigneeIds = [...new Set(steps.map(s => s.assignee_id).filter(Boolean))]
    const roleMap = new Map()
    if (assigneeIds.length > 0) {
      const ucr = await db('user_company_roles')
        .where({ company_id: row.company_id })
        .whereIn('user_id', assigneeIds)
        .select('user_id', 'role')
      for (const r of ucr) {
        if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, [])
        roleMap.get(r.user_id).push(r.role)
      }
    }

    const actions = await db('approval_actions as ac')
      .leftJoin('users as u', 'ac.actor_id', 'u.id')
      .select(
        'ac.id', 'ac.approval_id', 'ac.step_id', 'ac.actor_id', 'ac.action',
        'ac.comment', 'ac.target_step_id', 'ac.payload', 'ac.created_at',
        'u.username as actor_username', 'u.display_name as actor_display_name',
      )
      .where('ac.approval_id', row.id)
      .orderBy('ac.created_at', 'asc')

    // 合同信息（含 summary、reviews 列表，便于审批界面下载）
    const contract = await db('contracts').where({ id: row.contract_id }).first()
    const reviews = await db('case_reviews')
      .select('id', 'uploaded_filename', 'reviewed_filename', 'created_at', 'reviewed_at')
      .where({ contract_id: row.contract_id, is_draft: false })
      .orderBy('created_at', 'asc')

    res.json({
      approval: rowToApproval(row),
      steps: steps.map(s => ({ ...rowToStep(s), assigneeRoles: roleMap.get(s.assignee_id) || [] })),
      actions: actions.map(rowToAction),
      contract: {
        id: contract.id,
        code: contract.code,
        name: contract.name,
        status: contract.status,
        summary: contract.summary || null,
        summaryGeneratedAt: toIso(contract.summary_generated_at),
        cleanFilename: contract.clean_filename || null,
        cleanUploadedAt: toIso(contract.clean_uploaded_at),
        sealedFilename: contract.sealed_filename || null,
        sealedAt: toIso(contract.sealed_at),
      },
      reviews: reviews.map(r => ({
        id: r.id,
        uploadedFilename: r.uploaded_filename,
        reviewedFilename: r.reviewed_filename || null,
        createdAt: toIso(r.created_at),
        reviewedAt: toIso(r.reviewed_at),
      })),
    })
  } catch (e) { next(e) }
})

// ─── 通过 ─────────────────────────────────────────────────────────────────────
// POST /api/approvals/:id/approve
//   body: { comment }
//   v2.1: 模板驱动后所有审批人在发起时就具化完毕，通过不再需要 nextApprovers
r.post('/:id/approve', async (req, res, next) => {
  try {
    const { comment } = req.body || {}
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: '请填写审批意见' })

    const ctx = await loadActionContext(req.params.id, req.user.id, req.user.currentCompanyId)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep, companyId } = ctx

    if (currentStep.step_type === 'consultee') {
      return res.status(400).json({ error: '加签节点不能"通过"，请使用"提交意见"' })
    }
    if (currentStep.step_type === 'final-initiator') {
      return res.status(400).json({ error: '经办人节点应使用"上传用印版"完成流程' })
    }

    let approvalIdForAudit = null
    await db.transaction(async (trx) => {
      const now = new Date()
      await trx('approval_steps').where({ id: currentStep.id }).update({
        status: 'approved', comment: String(comment).trim(), actioned_at: now,
      })

      // 找下一步 current_step_id：
      //   1) 主链（step_type=approver）中 step_index 大于当前且 status=pending 的最小 step_index
      //   2) 没有则到 final-initiator
      const nextApprover = await trx('approval_steps')
        .where({ approval_id: approval.id, step_type: 'approver', status: 'pending' })
        .where('step_index', '>', currentStep.step_index)
        .orderBy('step_index', 'asc')
        .first()
      let nextStepId
      let isFinalInitiator = false
      if (nextApprover) {
        nextStepId = nextApprover.id
      } else {
        const finalStep = await trx('approval_steps')
          .where({ approval_id: approval.id, step_type: 'final-initiator' })
          .first()
        nextStepId = finalStep.id
        isFinalInitiator = true
        await trx('contracts').where({ id: approval.contract_id }).update({
          status: 'pending_seal',
          updated_at: now,
        })
      }
      await trx('approvals').where({ id: approval.id }).update({
        current_step_id: nextStepId,
        updated_at: now,
      })

      await writeAction(trx, {
        approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
        action: 'approve', comment,
        companyId,
      })

      const targetStep = await trx('approval_steps').where({ id: nextStepId }).first()
      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      const isSealTarget = !isFinalInitiator && stepIsSealNode(targetStep)
      await sendApprovalNotice(trx, {
        approvalId: approval.id,
        senderId: req.user.id,
        recipientId: targetStep.assignee_id,
        body: buildNoticeBody({
          contract,
          action: isFinalInitiator ? 'approve_final' : 'approve_next',
          actorName: req.user.displayName || req.user.username,
          extra: comment,
          isSealNode: isSealTarget,
        }),
        companyId,
      })

      approvalIdForAudit = approval.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.approve',
      targetType: 'approval', targetId: approvalIdForAudit,
      companyId: req.user.currentCompanyId,
    })
    res.json({ ok: true })
  } catch (e) {
    if (e?.status) return res.status(e.status).json({ error: e.message })
    next(e)
  }
})

// ─── 驳回 ─────────────────────────────────────────────────────────────────────
// POST /api/approvals/:id/reject
//   body: { comment, mode: 'to_step' | 'to_start' }
r.post('/:id/reject', async (req, res, next) => {
  try {
    const { comment, mode } = req.body || {}
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: '请填写驳回意见' })
    if (mode !== 'to_step' && mode !== 'to_start') {
      return res.status(400).json({ error: 'mode 必须是 to_step 或 to_start' })
    }

    const ctx = await loadActionContext(req.params.id, req.user.id, req.user.currentCompanyId)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep, companyId } = ctx

    if (currentStep.step_type === 'consultee') {
      return res.status(400).json({ error: '加签节点不能驳回，请使用"提交意见"' })
    }
    if (currentStep.step_type === 'final-initiator') {
      return res.status(400).json({ error: '经办人节点不能驳回' })
    }

    await db.transaction(async (trx) => {
      const now = new Date()
      await trx('approval_steps').where({ id: currentStep.id }).update({
        status: 'rejected', comment: String(comment).trim(), actioned_at: now,
      })
      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      const actorName = req.user.displayName || req.user.username

      if (mode === 'to_start') {
        await trx('approvals').where({ id: approval.id }).update({
          status: 'rejected', rejected_at: now, current_step_id: null, updated_at: now,
        })
        await trx('contracts').where({ id: approval.contract_id }).update({
          status: 'drafting', approval_id: null, updated_at: now,
        })
        await writeAction(trx, {
          approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
          action: 'reject_to_start', comment, companyId,
        })
        await sendApprovalNotice(trx, {
          approvalId: approval.id, senderId: req.user.id, recipientId: approval.initiator_id,
          body: buildNoticeBody({ contract, action: 'reject_to_start', actorName, extra: comment }),
          companyId,
        })
      } else {
        const finalStep = await trx('approval_steps')
          .where({ approval_id: approval.id, step_type: 'final-initiator' })
          .first()
        await trx('approvals').where({ id: approval.id }).update({
          current_step_id: finalStep.id, updated_at: now,
        })
        await writeAction(trx, {
          approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
          action: 'reject_to_step', comment, targetStepId: currentStep.id, companyId,
        })
        await sendApprovalNotice(trx, {
          approvalId: approval.id, senderId: req.user.id, recipientId: approval.initiator_id,
          body: buildNoticeBody({ contract, action: 'reject_to_step', actorName, extra: comment }),
          companyId,
        })
      }
    })

    await writeAudit({
      actorId: req.user.id, action: `approval.${mode === 'to_start' ? 'reject_to_start' : 'reject_to_step'}`,
      targetType: 'approval', targetId: approval.id,
      companyId,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── 加签（创建临时咨询节点） ───────────────────────────────────────────────
// POST /api/approvals/:id/add-consultee
//   body: { consulteeId, comment }
r.post('/:id/add-consultee', async (req, res, next) => {
  try {
    const { consulteeId, comment } = req.body || {}
    if (!consulteeId) return res.status(400).json({ error: '请选择加签人' })
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: '请填写加签说明' })

    const ctx = await loadActionContext(req.params.id, req.user.id, req.user.currentCompanyId)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep, companyId } = ctx

    if (currentStep.step_type !== 'approver') {
      return res.status(400).json({ error: '只能在审批节点加签' })
    }
    if (consulteeId === req.user.id) {
      return res.status(400).json({ error: '不能给自己加签' })
    }
    const consultee = await db('users').where({ id: consulteeId }).first()
    if (!consultee) return res.status(404).json({ error: '加签对象不存在' })

    const consulteeStepId = await db.transaction(async (trx) => {
      const [insertedRow] = await trx('approval_steps').insert({
        approval_id: approval.id,
        step_index: null,
        parent_step_id: currentStep.id,
        step_type: 'consultee',
        assignee_id: consulteeId,
        status: 'pending',
        comment: String(comment).trim(),
        company_id: companyId,
      }, ['id'])

      await trx('approvals').where({ id: approval.id }).update({
        current_step_id: insertedRow.id, updated_at: new Date(),
      })

      await writeAction(trx, {
        approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
        action: 'add_consultee', comment, targetStepId: insertedRow.id, companyId,
      })

      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      await sendApprovalNotice(trx, {
        approvalId: approval.id, senderId: req.user.id, recipientId: consulteeId,
        body: buildNoticeBody({
          contract, action: 'add_consultee',
          actorName: req.user.displayName || req.user.username,
          extra: comment,
        }),
        companyId,
      })

      return insertedRow.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.add_consultee',
      targetType: 'approval', targetId: approval.id,
      payload: { consulteeId, consulteeStepId },
      companyId,
    })
    res.json({ ok: true, consulteeStepId })
  } catch (e) { next(e) }
})

// POST /api/approvals/:id/submit-consultation — 加签人提交意见
//   body: { comment }
r.post('/:id/submit-consultation', async (req, res, next) => {
  try {
    const { comment } = req.body || {}
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: '请填写意见' })

    const ctx = await loadActionContext(req.params.id, req.user.id, req.user.currentCompanyId)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep, companyId } = ctx

    if (currentStep.step_type !== 'consultee') {
      return res.status(400).json({ error: '该节点不是加签节点' })
    }

    await db.transaction(async (trx) => {
      const now = new Date()
      await trx('approval_steps').where({ id: currentStep.id }).update({
        status: 'approved', comment: String(comment).trim(), actioned_at: now,
      })
      // 控制权回到加签人主节点
      await trx('approvals').where({ id: approval.id }).update({
        current_step_id: currentStep.parent_step_id, updated_at: now,
      })
      await writeAction(trx, {
        approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
        action: 'submit_consultation', comment, targetStepId: currentStep.parent_step_id,
        companyId,
      })

      const parentStep = await trx('approval_steps').where({ id: currentStep.parent_step_id }).first()
      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      if (parentStep) {
        await sendApprovalNotice(trx, {
          approvalId: approval.id, senderId: req.user.id, recipientId: parentStep.assignee_id,
          body: buildNoticeBody({
            contract, action: 'submit_consultation',
            actorName: req.user.displayName || req.user.username,
            extra: comment,
          }),
          companyId,
        })
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.submit_consultation',
      targetType: 'approval', targetId: approval.id,
      companyId,
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// ─── 经办人在驳回-到经办人节点 后重新提交 ────────────────────────────────────
// POST /api/approvals/:id/resubmit  multipart: 可选 cleanFile（替换清洁版）
//   body: { comment? }
r.post('/:id/resubmit', cleanUpload.single('cleanFile'), async (req, res, next) => {
  let savedAbsPath = req.file?.path || null
  try {
    const { comment } = req.body || {}

    const approval = await db('approvals').where({ id: req.params.id }).first()
    if (!approval) { if (savedAbsPath) await safeUnlink(savedAbsPath); return res.status(404).json({ error: '审批不存在' }) }
    if (approval.company_id !== req.user.currentCompanyId) {
      if (savedAbsPath) await safeUnlink(savedAbsPath)
      return res.status(403).json({ error: '该审批不属于当前公司' })
    }
    if (approval.status !== 'pending') { if (savedAbsPath) await safeUnlink(savedAbsPath); return res.status(400).json({ error: '审批不在进行中' }) }
    if (approval.initiator_id !== req.user.id) {
      if (savedAbsPath) await safeUnlink(savedAbsPath)
      return res.status(403).json({ error: '只有经办人可以重新提交' })
    }
    const companyId = approval.company_id
    const currentStep = await db('approval_steps').where({ id: approval.current_step_id }).first()
    if (!currentStep || currentStep.step_type !== 'final-initiator') {
      if (savedAbsPath) await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '当前不在等待经办人提交的状态' })
    }
    const lastReject = await db('approval_actions')
      .where({ approval_id: approval.id, action: 'reject_to_step' })
      .orderBy('created_at', 'desc')
      .first()
    if (!lastReject || !lastReject.target_step_id) {
      if (savedAbsPath) await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '该审批不是被驳回到经办人节点的状态' })
    }

    // 可选替换清洁版（搬 tmp 到 clean/<contractId>/）
    let newCleanStoragePath = null
    let newCleanFilename = null
    let oldCleanAbsToRemove = null
    if (req.file) {
      const contract = await db('contracts').where({ id: approval.contract_id }).first()
      const targetDir = path.join(CLEAN_ROOT, approval.contract_id)
      await ensureDir(targetDir)
      newCleanFilename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      const targetAbs = path.join(targetDir, `${Date.now()}_${safeFilename(newCleanFilename)}`)
      await fs.rename(req.file.path, targetAbs)
      savedAbsPath = targetAbs
      newCleanStoragePath = toStoragePath(targetAbs)
      oldCleanAbsToRemove = contract?.clean_storage_path ? toAbsolutePath(contract.clean_storage_path) : null
    }

    await db.transaction(async (trx) => {
      const now = new Date()

      if (newCleanStoragePath) {
        await trx('contracts').where({ id: approval.contract_id }).update({
          clean_filename: newCleanFilename,
          clean_storage_path: newCleanStoragePath,
          clean_size_bytes: req.file.size,
          clean_mime_type: req.file.mimetype,
          clean_uploaded_at: now,
          clean_uploaded_by: req.user.id,
          // 清洁版变了 → 摘要清空，等异步重新生成
          summary: null,
          summary_generated_at: null,
          updated_at: now,
        })
      }

      // 把驳回的那个 step 重置为 pending（comment 历史已经在 actions 里保留）
      await trx('approval_steps').where({ id: lastReject.target_step_id }).update({
        status: 'pending', comment: null, actioned_at: null,
      })
      await trx('approvals').where({ id: approval.id }).update({
        current_step_id: lastReject.target_step_id, updated_at: now,
      })
      await writeAction(trx, {
        approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
        action: 'resubmit', comment: comment ? String(comment).trim() : null,
        targetStepId: lastReject.target_step_id,
        companyId,
      })

      const targetStep = await trx('approval_steps').where({ id: lastReject.target_step_id }).first()
      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      if (targetStep) {
        await sendApprovalNotice(trx, {
          approvalId: approval.id, senderId: req.user.id, recipientId: targetStep.assignee_id,
          body: buildNoticeBody({
            contract, action: 'resubmit',
            actorName: req.user.displayName || req.user.username,
            extra: comment ? String(comment).trim() : '',
          }),
          companyId,
        })
      }
    })

    if (oldCleanAbsToRemove) await safeUnlink(oldCleanAbsToRemove)

    if (newCleanStoragePath) {
      const contract = await db('contracts').where({ id: approval.contract_id }).first()
      generateContractSummary(approval.contract_id, contract?.name)
        .then(async (summary) => {
          if (summary) {
            await db('contracts').where({ id: approval.contract_id }).update({
              summary, summary_generated_at: new Date(),
            })
          }
        })
        .catch(err => console.error('[summary] regenerate failed:', err?.message || err))
    }

    await writeAudit({
      actorId: req.user.id, action: 'approval.resubmit',
      targetType: 'approval', targetId: approval.id,
      payload: { cleanReplaced: !!newCleanStoragePath },
      companyId,
    })
    res.json({ ok: true })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// ─── 上传用印版（流程结束） ──────────────────────────────────────────────────
// POST /api/approvals/:id/upload-seal  multipart: file, comment?
r.post('/:id/upload-seal', sealUpload.single('file'), async (req, res, next) => {
  let savedAbsPath = null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传用印版文件' })
    savedAbsPath = req.file.path

    const approval = await db('approvals').where({ id: req.params.id }).first()
    if (!approval) { await safeUnlink(savedAbsPath); return res.status(404).json({ error: '审批不存在' }) }
    if (approval.company_id !== req.user.currentCompanyId) {
      await safeUnlink(savedAbsPath); return res.status(403).json({ error: '该审批不属于当前公司' })
    }
    if (approval.status !== 'pending') {
      await safeUnlink(savedAbsPath); return res.status(400).json({ error: '审批不在进行中' })
    }
    if (approval.initiator_id !== req.user.id) {
      await safeUnlink(savedAbsPath); return res.status(403).json({ error: '只有经办人可以上传用印版' })
    }
    const companyId = approval.company_id
    const currentStep = await db('approval_steps').where({ id: approval.current_step_id }).first()
    if (!currentStep || currentStep.step_type !== 'final-initiator') {
      await safeUnlink(savedAbsPath); return res.status(400).json({ error: '当前不在等待上传用印版的状态' })
    }
    // 还要确认确实是"全部审批通过"才到的 final-initiator（不是被驳回到这里）
    const lastReject = await db('approval_actions')
      .where({ approval_id: approval.id, action: 'reject_to_step' })
      .orderBy('created_at', 'desc')
      .first()
    if (lastReject) {
      const lastResubmit = await db('approval_actions')
        .where({ approval_id: approval.id, action: 'resubmit' })
        .orderBy('created_at', 'desc')
        .first()
      // 如果最后一次驳回比最后一次 resubmit 还新，说明现在是"被驳回等重新提交"状态
      if (!lastResubmit || new Date(lastReject.created_at) > new Date(lastResubmit.created_at)) {
        await safeUnlink(savedAbsPath)
        return res.status(400).json({ error: '当前是"被驳回待修改"状态，请先点击"重新提交"再上传用印版' })
      }
    }

    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8')

    // v1.4: 用印日期由用户传入（必填），原"自动 now()"语义改为用户手填
    const sealedAtRaw = String(req.body?.sealedAt || '').trim()
    if (!sealedAtRaw || !/^\d{4}-\d{2}-\d{2}$/.test(sealedAtRaw)) {
      await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '请填写用印日期（格式 YYYY-MM-DD）' })
    }
    const sealedAt = new Date(sealedAtRaw)
    if (isNaN(sealedAt.getTime())) {
      await safeUnlink(savedAbsPath)
      return res.status(400).json({ error: '用印日期无效' })
    }

    await db.transaction(async (trx) => {
      const now = new Date()
      const storagePath = toStoragePath(savedAbsPath)
      await trx('contracts').where({ id: approval.contract_id }).update({
        sealed_filename: original,
        sealed_storage_path: storagePath,
        sealed_size_bytes: req.file.size,
        sealed_mime_type: req.file.mimetype,
        sealed_at: sealedAt,             // v1.4: 用户手填
        sealed_by: req.user.id,
        status: 'sealed',
        approval_id: null,
        updated_at: now,
      })
      await trx('approval_steps').where({ id: currentStep.id }).update({
        status: 'approved',
        comment: req.body?.comment ? String(req.body.comment).trim() : null,
        actioned_at: now,
      })
      await trx('approvals').where({ id: approval.id }).update({
        status: 'completed', completed_at: now, current_step_id: null, updated_at: now,
      })
      await writeAction(trx, {
        approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
        action: 'upload_seal', comment: req.body?.comment || null,
        payload: { filename: original, size: req.file.size, sealedAt: sealedAtRaw },
        companyId,
      })
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.upload_seal',
      targetType: 'approval', targetId: approval.id,
      payload: { filename: original, size: req.file.size, sealedAt: sealedAtRaw },
      companyId,
    })
    res.json({ ok: true })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// ─── v2.1+: 一键导出"用印水印版" PDF ─────────────────────────────────────────
//
// GET /api/approvals/:id/export-watermark-pdf
//   - 权限：当前公司 seal_admin 或该审批的经办人
//   - 流程：合同 clean 版 Word → LibreOffice 转 PDF → pdf-lib 加公司全称水印 → 流式返回
//   - 环境：服务器需装 LibreOffice（`apt install libreoffice`）+ 中文字体（`apt install fonts-wqy-zenhei`）
//     LibreOffice 路径走 env LIBREOFFICE_PATH（默认 'soffice'，Windows 上默认装在 Program Files\LibreOffice）
//     字体路径走 env WATERMARK_FONT_PATH，缺省会按平台尝试常见路径（TTF/OTF/TTC 均可）

function resolveLibreOfficePath() {
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
  }
  return 'soffice'
}

// 注意：pdf-lib(fontkit) 只能嵌入「单体」.ttf / .otf 字体；
//   .ttc / .otc 字体集合会直接报错（createSubset / font.layout is not a function），不可用。
//   所以候选里只放单体字体，并避开微软雅黑(msyh.ttc)、宋体(simsun.ttc)、文泉驿(wqy-zenhei.ttc) 等集合字体。
async function resolveWatermarkFontBytes() {
  const candidates = process.env.WATERMARK_FONT_PATH
    ? [process.env.WATERMARK_FONT_PATH]
    : (process.platform === 'win32'
      ? [
          'C:\\Windows\\Fonts\\simhei.ttf',   // 黑体（单体）
          'C:\\Windows\\Fonts\\simkai.ttf',   // 楷体（单体）
          'C:\\Windows\\Fonts\\simfang.ttf',  // 仿宋（单体）
        ]
      : [
          '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf', // fonts-droid-fallback（单体，全 CJK）
          '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
          '/usr/share/fonts/truetype/arphic/ukai.ttc',                 // 仅作最后兜底（实际是 .ttc，可能不可用）
        ])
  let lastErr = null
  for (const p of candidates) {
    try {
      const ext = (p.split('.').pop() || '').toLowerCase()
      if (ext === 'ttc' || ext === 'otc') continue   // 集合字体跳过，pdf-lib 不支持
      return await fs.readFile(p)
    } catch (e) { lastErr = e /* try next */ }
  }
  throw Object.assign(new Error(
    '找不到可用的中文字体（需要单体 .ttf/.otf，不支持 .ttc 字体集合）。' +
    '请在 .env 设置 WATERMARK_FONT_PATH 指向一个单体中文字体；Linux 服务器可 apt install fonts-droid-fallback。' +
    (lastErr ? `（最后错误：${lastErr.message}）` : '')
  ), { status: 500 })
}

r.get('/:id/export-watermark-pdf', async (req, res, next) => {
  let tmpDir = null
  try {
    // 1. 鉴权
    const approval = await db('approvals').where({ id: req.params.id }).first()
    if (!approval) return res.status(404).json({ error: '审批不存在' })
    if (approval.company_id !== req.user.currentCompanyId) {
      return res.status(403).json({ error: '该审批不属于当前公司' })
    }
    const isSealAdmin = hasCompanyRole(req, 'seal_admin')
    const isInitiator = approval.initiator_id === req.user.id
    if (!isSealAdmin && !isInitiator) {
      return res.status(403).json({ error: '仅印章管理员或本审批的经办人可导出用印水印版' })
    }

    // 2. 取清洁版 + 公司名
    const contract = await db('contracts').where({ id: approval.contract_id }).first()
    if (!contract) return res.status(404).json({ error: '合同不存在' })
    if (!contract.clean_storage_path) {
      return res.status(400).json({ error: '该合同尚未上传清洁版文件，无法导出水印版' })
    }
    const cleanAbs = toAbsolutePath(contract.clean_storage_path)
    try { await fs.access(cleanAbs) } catch {
      return res.status(404).json({ error: '清洁版文件已丢失，请联系经办人重新上传' })
    }

    const company = await db('companies').where({ id: approval.company_id }).first()
    if (!company) return res.status(404).json({ error: '公司不存在' })
    const watermarkText = company.name

    // 3. 得到待加水印的 PDF 字节。
    //    清洁版本身就是 PDF → 直接读，跳过 LibreOffice（PDF→PDF 转换既多余又不可靠）。
    //    清洁版是 Word → 用 LibreOffice 转 PDF（临时目录）。
    const isPdfClean = path.extname(cleanAbs).toLowerCase() === '.pdf'
    let pdfBytes
    if (isPdfClean) {
      pdfBytes = await fs.readFile(cleanAbs)
    } else {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'watermark-'))
      const sofficeBin = resolveLibreOfficePath()
      // 独立 user profile，避免与本机其他 LibreOffice 实例的 profile 锁冲突导致转换失败
      const profileUrl = pathToFileURL(path.join(tmpDir, 'lo-profile')).href
      try {
        await execFileP(sofficeBin, [
          '-env:UserInstallation=' + profileUrl,
          '--headless',
          '--convert-to', 'pdf',
          '--outdir', tmpDir,
          cleanAbs,
        ], { timeout: 90_000 })
      } catch (e) {
        console.error('[watermark] libreoffice convert failed:', e?.message || e)
        throw Object.assign(new Error(
          'Word → PDF 转换失败：' + (e?.code === 'ENOENT'
            ? '未找到 LibreOffice，请在服务器安装（apt install libreoffice）或设置 LIBREOFFICE_PATH 环境变量'
            : (e?.message || '未知错误'))
        ), { status: 500 })
      }

      // LibreOffice 输出文件名 = <原文件名去扩展名>.pdf
      const baseName = path.parse(cleanAbs).name
      const pdfPath = path.join(tmpDir, `${baseName}.pdf`)
      try { pdfBytes = await fs.readFile(pdfPath) }
      catch {
        throw Object.assign(new Error('LibreOffice 转换完成但找不到输出 PDF 文件'), { status: 500 })
      }
    }

    // 4. pdf-lib 加水印
    const pdfDoc = await PDFDocument.load(pdfBytes)
    pdfDoc.registerFontkit(fontkit)
    const fontBytes = await resolveWatermarkFontBytes()
    const font = await pdfDoc.embedFont(fontBytes, { subset: true })

    const FONT_SIZE = 48
    const ANGLE = 45
    const OPACITY = 0.12
    const COLOR = rgb(0.5, 0.5, 0.5)
    const STEP_X = 320
    const STEP_Y = 220

    const pages = pdfDoc.getPages()
    for (const page of pages) {
      const { width, height } = page.getSize()
      // 旋转后水印会跑出可见区域，所以在 (-width..2*width, -height..2*height) 网格上铺
      for (let y = -height; y < height * 2; y += STEP_Y) {
        for (let x = -width; x < width * 2; x += STEP_X) {
          page.drawText(watermarkText, {
            x, y,
            size: FONT_SIZE,
            font,
            color: COLOR,
            opacity: OPACITY,
            rotate: degrees(ANGLE),
          })
        }
      }
    }

    const out = await pdfDoc.save()

    // 5. 返回流
    const fname = `${contract.code}_${contract.name}_用印版.pdf`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`)
    res.send(Buffer.from(out))

    await writeAudit({
      actorId: req.user.id, action: 'approval.export_watermark_pdf',
      targetType: 'approval', targetId: approval.id,
      payload: { contractCode: contract.code, contractName: contract.name },
      companyId: req.user.currentCompanyId,
    })
  } catch (e) {
    if (!res.headersSent) {
      if (e?.status) return res.status(e.status).json({ error: e.message })
      next(e)
    } else {
      console.error('[watermark] error after headers sent:', e?.message || e)
    }
  } finally {
    if (tmpDir) {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
})

// ─── 工具：加载操作上下文（v2.0: 校验 approval 存在 + 公司归属 + 当前步骤 + assignee）─
async function loadActionContext(approvalId, userId, currentCompanyId) {
  const approval = await db('approvals').where({ id: approvalId }).first()
  if (!approval) return { error: '审批不存在', status: 404 }
  if (approval.company_id !== currentCompanyId) return { error: '该审批不属于当前公司', status: 403 }
  if (approval.status !== 'pending') return { error: '审批不在进行中', status: 400 }
  if (!approval.current_step_id) return { error: '审批没有当前步骤（已结束）', status: 400 }

  const currentStep = await db('approval_steps').where({ id: approval.current_step_id }).first()
  if (!currentStep) return { error: '当前步骤不存在', status: 400 }
  if (currentStep.assignee_id !== userId) return { error: '当前步骤不归你处理', status: 403 }
  if (currentStep.status !== 'pending') return { error: '当前步骤已被处理过', status: 400 }

  return { approval, currentStep, companyId: approval.company_id }
}

export default r

// 让 superadmin 在系统设置里看 prompt 用：默认值导出
export const DEFAULT_CONTRACT_SUMMARY_PROMPT = DEFAULT_SUMMARY_PROMPT
