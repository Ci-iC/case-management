// v1.3 合同审批流程
//
// 流程语义：
//   - 经办人（contract.created_by）发起审批 → 第一步必须是 superadmin
//   - 超管审批通过时填后续审批人列表（按顺序）
//   - 后续审批人按顺序流转：通过/驳回/加签
//   - 加签：临时分支咨询某人 → 那人只能"提交意见"无通过/驳回 → 控制权回到加签人
//   - 驳回-到经办人节点：经办人改完直接跳回驳回人（不重走中间已通过节点）
//   - 驳回-重提：当前 approval 关闭，经办人需重新发起
//   - 全部通过 → 流转到经办人节点 → 经办人传用印版 → 合同状态 'sealed'

import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { db, writeAudit } from '../db.js'
import { requireAuth, isAdminOrAbove, isSuperAdmin } from '../auth.js'
import { chatCompletion } from '../openai.js'
import { DATA_ROOT, ensureDir, toStoragePath, toAbsolutePath, safeFilename, safeUnlink } from '../storage.js'

const r = Router()
r.use(requireAuth)

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
  'a.id', 'a.contract_id', 'a.initiator_id', 'a.status', 'a.initiation_note',
  'a.current_step_id', 'a.created_at', 'a.updated_at', 'a.completed_at', 'a.rejected_at',
  'c.code as contract_code', 'c.name as contract_name', 'c.status as contract_status',
  'iu.username as initiator_username', 'iu.display_name as initiator_display_name',
  'cs.assignee_id as current_assignee_id',
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
async function writeAction(trx, { approvalId, stepId, actorId, action, comment, targetStepId, payload }) {
  await trx('approval_actions').insert({
    approval_id: approvalId,
    step_id: stepId || null,
    actor_id: actorId,
    action,
    comment: comment || null,
    target_step_id: targetStepId || null,
    payload: payload ? JSON.stringify(payload) : null,
  })
}

// ─── 工具：审批流转通知 ──────────────────────────────────────────────────────
//   每次状态流转后给当前 assignee 发一条站内信（带 approval_id，前端识别后给"跳转到审批"按钮）
async function sendApprovalNotice(trx, { approvalId, senderId, recipientId, body }) {
  if (!recipientId || recipientId === senderId) return
  await trx('messages').insert({
    sender_id: senderId,
    receiver_id: recipientId,
    body,
    approval_id: approvalId,
    is_read: false,
  })
}

function buildNoticeBody({ contract, action, actorName, extra }) {
  const head = `${contract.code} 《${contract.name}》`
  switch (action) {
    case 'submit':              return `您有一份合同待审批：${head}（由 ${actorName} 发起）${extra ? `\n\n发起说明：${extra}` : ''}`
    case 'approve_next':        return `合同审批流转到您：${head}（上一步由 ${actorName} 通过）${extra ? `\n\n上一步意见：${extra}` : ''}`
    case 'approve_final':       return `合同审批已全部通过，请您上传用印版：${head}${extra ? `\n\n上一步意见：${extra}` : ''}`
    case 'reject_to_step':      return `您的合同审批被驳回，请修改材料后在审批界面点【重新提交】：${head}（驳回人：${actorName}）${extra ? `\n\n驳回意见：${extra}` : ''}`
    case 'reject_to_start':     return `您的合同审批被驳回（重新发起）：${head}（驳回人：${actorName}）${extra ? `\n\n驳回意见：${extra}` : ''}\n\n如需继续，请到合同审批页重新发起。`
    case 'add_consultee':       return `您被 ${actorName} 加签到合同审批：${head}${extra ? `\n\n加签说明：${extra}` : ''}\n\n请在审批界面提交您的意见。`
    case 'submit_consultation': return `您加签的咨询已完成，请继续审批：${head}（咨询人：${actorName}）${extra ? `\n\n咨询意见：${extra}` : ''}`
    case 'resubmit':            return `经办人已重新提交合同，请继续审批：${head}（经办人：${actorName}）${extra ? `\n\n补充说明：${extra}` : ''}`
    default: return `合同审批有更新：${head}`
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/approvals — 发起审批
//   body: contractId, firstApproverId (superadmin), initiationNote?
// 发起审批：multipart，含可选清洁版文件 + reuseExistingClean=true 时沿用合同已有的清洁版
r.post('/', cleanUpload.single('cleanFile'), async (req, res, next) => {
  let savedAbsPath = req.file?.path || null
  try {
    const { contractId, firstApproverId, initiationNote } = req.body || {}
    const reuseClean = req.body?.reuseExistingClean === 'true' || req.body?.reuseExistingClean === true
    if (!contractId) return res.status(400).json({ error: '请选择合同' })
    if (!firstApproverId) return res.status(400).json({ error: '请选择第一位审批人（必须是超级管理员）' })

    const contract = await db('contracts').where({ id: contractId }).first()
    if (!contract) return res.status(404).json({ error: '合同不存在' })
    if (contract.status !== 'drafting') {
      return res.status(400).json({ error: '该合同当前不是"起草中"状态，不能发起审批' })
    }
    if (contract.created_by !== req.user.id && !isAdminOrAbove(req.user)) {
      return res.status(403).json({ error: '无权对该合同发起审批' })
    }

    // v1.3.1: 必须经过法务（reviewed_storage_path 非空 OR legal_approved=true）
    const reviewedRow = await db('case_reviews')
      .where({ contract_id: contractId, is_draft: false })
      .where(function () {
        this.whereNotNull('reviewed_storage_path').orWhere('legal_approved', true)
      })
      .orderBy('created_at', 'desc')
      .first()
    if (!reviewedRow) {
      return res.status(400).json({ error: '该合同尚未经法务审核（法务上传修订版或点过"无需修订直接通过"），不能发起审批' })
    }

    const firstApprover = await db('users').where({ id: firstApproverId }).first()
    if (!firstApprover) return res.status(404).json({ error: '指定的第一审批人不存在' })
    if (firstApprover.role !== 'superadmin') {
      return res.status(400).json({ error: '第一审批人必须是超级管理员' })
    }

    const activeApproval = await db('approvals')
      .where({ contract_id: contractId, status: 'pending' })
      .first()
    if (activeApproval) {
      return res.status(409).json({ error: '该合同已有进行中的审批' })
    }

    // v1.3.1: 清洁版处理
    if (reuseClean) {
      if (!contract.clean_storage_path) {
        return res.status(400).json({ error: '该合同没有可沿用的清洁版，请上传新清洁版' })
      }
      if (req.file) await safeUnlink(req.file.path)  // 既然 reuse 就忽略上传的文件
      savedAbsPath = null
    } else {
      if (!req.file) {
        return res.status(400).json({ error: '请上传清洁版文件' })
      }
    }

    const initiatorId = contract.created_by

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
      // 换了清洁版 → 同时清空旧摘要（让外面异步重新生成）
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
      }, ['id'])
      const approvalId = approvalRow.id

      const [step1Row] = await trx('approval_steps').insert({
        approval_id: approvalId,
        step_index: 1,
        step_type: 'approver',
        assignee_id: firstApproverId,
        status: 'pending',
      }, ['id'])

      await trx('approval_steps').insert({
        approval_id: approvalId,
        step_index: 999,
        step_type: 'final-initiator',
        assignee_id: initiatorId,
        status: 'pending',
      })

      await trx('approvals').where({ id: approvalId }).update({
        current_step_id: step1Row.id,
      })
      await trx('contracts').where({ id: contractId }).update({
        status: 'approving',
        approval_id: approvalId,
        updated_at: new Date(),
      })

      await writeAction(trx, {
        approvalId, stepId: null, actorId: req.user.id,
        action: 'submit', comment: initiationNote || null,
      })

      // 通知第一审批人
      await sendApprovalNotice(trx, {
        approvalId, senderId: req.user.id, recipientId: firstApproverId,
        body: buildNoticeBody({
          contract, action: 'submit',
          actorName: req.user.displayName || req.user.username,
          extra: initiationNote ? String(initiationNote).trim() : '',
        }),
      })

      return { approvalId, currentStepId: step1Row.id }
    })

    // 删除旧清洁版（事务成功后清理）
    if (oldCleanAbsToRemove) await safeUnlink(oldCleanAbsToRemove)

    // 摘要异步生成（换了清洁版 或 之前没生成过）
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
      payload: { contractId, firstApproverId, reuseClean, cleanReplaced: !!newCleanStoragePath },
    })

    res.status(201).json({ approvalId: result.approvalId })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// GET /api/approvals?role=todo|initiated|all — 列表
r.get('/', async (req, res, next) => {
  try {
    const role = req.query.role || 'todo'
    let q = joinApproval(db.select(APPROVAL_SELECT)).orderBy('a.updated_at', 'desc')

    if (role === 'todo') {
      // 待我审批：当前 step 的 assignee 是我，且 step.status=pending
      q = q
        .where('cs.assignee_id', req.user.id)
        .where('cs.status', 'pending')
        .where('a.status', 'pending')
    } else if (role === 'initiated') {
      q = q.where('a.initiator_id', req.user.id)
    } else if (role === 'all') {
      if (!isAdminOrAbove(req.user)) {
        return res.status(403).json({ error: '需要管理员权限' })
      }
    } else {
      return res.status(400).json({ error: '不支持的 role 参数' })
    }

    const rows = await q.limit(500)
    res.json({ approvals: rows.map(rowToApproval) })
  } catch (e) { next(e) }
})

// GET /api/approvals/:id — 详情（含合同摘要 / 全部 steps / 全部 actions）
r.get('/:id', async (req, res, next) => {
  try {
    const row = await joinApproval(db.select(APPROVAL_SELECT)).where('a.id', req.params.id).first()
    if (!row) return res.status(404).json({ error: '审批不存在' })

    const isAdmin = isAdminOrAbove(req.user)
    const isInitiator = row.initiator_id === req.user.id

    // 还要看是不是 step 中的 assignee（历史或当前都算）
    const involved = await db('approval_steps').where({ approval_id: row.id, assignee_id: req.user.id }).first()
    if (!isAdmin && !isInitiator && !involved) {
      return res.status(403).json({ error: '无权查看该审批' })
    }

    const steps = await db('approval_steps as s')
      .leftJoin('users as u', 's.assignee_id', 'u.id')
      .select(
        's.id', 's.approval_id', 's.step_index', 's.parent_step_id', 's.step_type',
        's.assignee_id', 's.status', 's.comment', 's.actioned_at', 's.created_at',
        'u.username as assignee_username', 'u.display_name as assignee_display_name',
      )
      .where('s.approval_id', row.id)
      .orderBy([
        { column: 's.created_at', order: 'asc' },
      ])

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
      steps: steps.map(rowToStep),
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
//   body: { comment, nextApprovers?: string[] }
//   nextApprovers: 仅当当前步是 step_index=1（超管）且首次通过时必填
r.post('/:id/approve', async (req, res, next) => {
  try {
    const { comment, nextApprovers } = req.body || {}
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: '请填写审批意见' })

    const ctx = await loadActionContext(req.params.id, req.user.id)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep } = ctx

    if (currentStep.step_type === 'consultee') {
      return res.status(400).json({ error: '加签节点不能"通过"，请使用"提交意见"' })
    }
    if (currentStep.step_type === 'final-initiator') {
      return res.status(400).json({ error: '经办人节点应使用"上传用印版"完成流程' })
    }

    await db.transaction(async (trx) => {
      const now = new Date()
      await trx('approval_steps').where({ id: currentStep.id }).update({
        status: 'approved', comment: String(comment).trim(), actioned_at: now,
      })

      let payloadForAction = null

      // 超管首次通过：创建后续审批人 steps
      if (currentStep.step_index === 1) {
        const list = Array.isArray(nextApprovers) ? nextApprovers : []
        // 校验都是真实用户
        if (list.length > 0) {
          const users = await trx('users').select('id').whereIn('id', list)
          const validIds = new Set(users.map(u => u.id))
          for (const id of list) {
            if (!validIds.has(id)) {
              throw Object.assign(new Error('指定的后续审批人中存在无效用户'), { status: 400 })
            }
            if (id === approval.initiator_id) {
              throw Object.assign(new Error('经办人会自动作为最后节点上传用印版，不需要重复加入审批链'), { status: 400 })
            }
          }
          // 创建 step 2..N
          for (let i = 0; i < list.length; i++) {
            await trx('approval_steps').insert({
              approval_id: approval.id,
              step_index: 2 + i,
              step_type: 'approver',
              assignee_id: list[i],
              status: 'pending',
            })
          }
        }
        payloadForAction = { nextApprovers: list }
      }

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
        action: 'approve', comment, payload: payloadForAction,
      })

      // 通知下一节点 assignee
      const targetStep = await trx('approval_steps').where({ id: nextStepId }).first()
      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      await sendApprovalNotice(trx, {
        approvalId: approval.id,
        senderId: req.user.id,
        recipientId: targetStep.assignee_id,
        body: buildNoticeBody({
          contract,
          action: isFinalInitiator ? 'approve_final' : 'approve_next',
          actorName: req.user.displayName || req.user.username,
          extra: comment,
        }),
      })
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.approve',
      targetType: 'approval', targetId: approval.id,
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

    const ctx = await loadActionContext(req.params.id, req.user.id)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep } = ctx

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
          action: 'reject_to_start', comment,
        })
        // 通知经办人
        await sendApprovalNotice(trx, {
          approvalId: approval.id, senderId: req.user.id, recipientId: approval.initiator_id,
          body: buildNoticeBody({ contract, action: 'reject_to_start', actorName, extra: comment }),
        })
      } else {
        // to_step：流转到经办人节点等待重新提交
        const finalStep = await trx('approval_steps')
          .where({ approval_id: approval.id, step_type: 'final-initiator' })
          .first()
        await trx('approvals').where({ id: approval.id }).update({
          current_step_id: finalStep.id, updated_at: now,
        })
        await writeAction(trx, {
          approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
          action: 'reject_to_step', comment, targetStepId: currentStep.id,
        })
        // 通知经办人
        await sendApprovalNotice(trx, {
          approvalId: approval.id, senderId: req.user.id, recipientId: approval.initiator_id,
          body: buildNoticeBody({ contract, action: 'reject_to_step', actorName, extra: comment }),
        })
      }
    })

    await writeAudit({
      actorId: req.user.id, action: `approval.${mode === 'to_start' ? 'reject_to_start' : 'reject_to_step'}`,
      targetType: 'approval', targetId: approval.id,
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

    const ctx = await loadActionContext(req.params.id, req.user.id)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep } = ctx

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
        comment: String(comment).trim(),  // 加签理由先写在 comment 上
      }, ['id'])

      await trx('approvals').where({ id: approval.id }).update({
        current_step_id: insertedRow.id, updated_at: new Date(),
      })

      await writeAction(trx, {
        approvalId: approval.id, stepId: currentStep.id, actorId: req.user.id,
        action: 'add_consultee', comment, targetStepId: insertedRow.id,
      })

      // 通知加签对象
      const contract = await trx('contracts').where({ id: approval.contract_id }).first()
      await sendApprovalNotice(trx, {
        approvalId: approval.id, senderId: req.user.id, recipientId: consulteeId,
        body: buildNoticeBody({
          contract, action: 'add_consultee',
          actorName: req.user.displayName || req.user.username,
          extra: comment,
        }),
      })

      return insertedRow.id
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.add_consultee',
      targetType: 'approval', targetId: approval.id,
      payload: { consulteeId, consulteeStepId },
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

    const ctx = await loadActionContext(req.params.id, req.user.id)
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error })
    const { approval, currentStep } = ctx

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
      })

      // 通知加签人（控制权回到他）
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
        })
      }
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.submit_consultation',
      targetType: 'approval', targetId: approval.id,
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
    if (approval.status !== 'pending') { if (savedAbsPath) await safeUnlink(savedAbsPath); return res.status(400).json({ error: '审批不在进行中' }) }
    if (approval.initiator_id !== req.user.id) {
      if (savedAbsPath) await safeUnlink(savedAbsPath)
      return res.status(403).json({ error: '只有经办人可以重新提交' })
    }
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
      })

      // 通知驳回的那个审批人
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
    if (approval.status !== 'pending') {
      await safeUnlink(savedAbsPath); return res.status(400).json({ error: '审批不在进行中' })
    }
    if (approval.initiator_id !== req.user.id) {
      await safeUnlink(savedAbsPath); return res.status(403).json({ error: '只有经办人可以上传用印版' })
    }
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

    await db.transaction(async (trx) => {
      const now = new Date()
      const storagePath = toStoragePath(savedAbsPath)
      await trx('contracts').where({ id: approval.contract_id }).update({
        sealed_filename: original,
        sealed_storage_path: storagePath,
        sealed_size_bytes: req.file.size,
        sealed_mime_type: req.file.mimetype,
        sealed_at: now,
        sealed_by: req.user.id,
        status: 'sealed',
        approval_id: null,    // 流程结束，清当前活跃 approval 引用（历史在 approvals 表里）
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
        payload: { filename: original, size: req.file.size },
      })
    })

    await writeAudit({
      actorId: req.user.id, action: 'approval.upload_seal',
      targetType: 'approval', targetId: approval.id,
      payload: { filename: original, size: req.file.size },
    })
    res.json({ ok: true })
  } catch (e) {
    if (savedAbsPath) await safeUnlink(savedAbsPath)
    next(e)
  }
})

// ─── 工具：加载操作上下文（校验 approval 存在 + 当前步骤 + assignee 是当前用户） ──
async function loadActionContext(approvalId, userId) {
  const approval = await db('approvals').where({ id: approvalId }).first()
  if (!approval) return { error: '审批不存在', status: 404 }
  if (approval.status !== 'pending') return { error: '审批不在进行中', status: 400 }
  if (!approval.current_step_id) return { error: '审批没有当前步骤（已结束）', status: 400 }

  const currentStep = await db('approval_steps').where({ id: approval.current_step_id }).first()
  if (!currentStep) return { error: '当前步骤不存在', status: 400 }
  if (currentStep.assignee_id !== userId) return { error: '当前步骤不归你处理', status: 403 }
  if (currentStep.status !== 'pending') return { error: '当前步骤已被处理过', status: 400 }

  return { approval, currentStep }
}

export default r

// 让 superadmin 在系统设置里看 prompt 用：默认值导出
export const DEFAULT_CONTRACT_SUMMARY_PROMPT = DEFAULT_SUMMARY_PROMPT
