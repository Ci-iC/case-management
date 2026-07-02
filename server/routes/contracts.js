// 合同台账 v2.0：多租户 + 结构化字段 + 高级筛选 + Excel 导出
//
// 权限模型：
//   - 平台超管：可只读穿透看任意公司（带 cc 参数切换公司）；不能写
//   - 当前公司里：
//       任意角色 can_view_all_contracts=true → 看本公司全部
//       否则 → 只看自己创建 + 自己是 handler 的
//   - "全部公司"汇总视图（仅多公司 manager 可进入）：跨公司 list 只读
//
// v1.4 合并：
//   - 合同结构化字段（contract_type/payment_type/term_*/handler_id/our_parties/counter_parties/contract_amount）
//   - term_notified_at 字段：term_date 被修改时清空（业务层，下面 update 接口里处理）
//   - 高级筛选 + 排序（GET /api/contracts 接受 filter[字段][op] + sort 参数）
//   - Excel 导出（独立接口 GET /api/contracts/export）
//   - AI 提取结构化字段 + 暂存草稿（POST/PATCH 在下面）
//   - 不允许删除（沿用历史 — 审计完整性）

import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import {
  requireAuth, requireCompanyContext, requireCompanyRole,
  canReadContractRow, hasCompanyRole,
} from '../auth.js'
import { db, writeAudit } from '../db.js'
import { DATA_ROOT, toAbsolutePath, ensureDir, safeFilename, safeUnlink, wordOnlyFileFilter } from '../storage.js'
import { extractContractFields } from '../contractFieldExtract.js'

const r = Router()
r.use(requireAuth, requireCompanyContext)

// AI 提取用：把上传的清洁版临时落到 tmp/，提取完即删（不入库）。只收 Word。
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const extractUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(TMP_ROOT); cb(null, TMP_ROOT) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `extract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: wordOnlyFileFilter,
})

// ─── 静态枚举（供前端拉取 + 后端校验） ────────────────────────────────────────
const CONTRACT_TYPES = [
  '货物销售合同', '货物采购合同', '矿权转让合同', '研发实验类合同',
  '行政采购类合同', '人力资源服务类合同', '合作协议', '代理协议',
  '房屋租赁合同', '股权转让合同', '补充协议',
]
const PAYMENT_TYPES = ['收款', '付款', '借贷', '框架类', '无金额']
const TERM_TYPES = ['固定日期', '固定期限', '无期限']
const REQUIRES_AMOUNT = new Set(['收款', '付款', '借贷'])
const CONTRACT_STATUSES = ['drafting', 'approving', 'pending_seal', 'sealed']

// ─── 行 → JSON ───────────────────────────────────────────────────────────────
function rowToContract(row) {
  if (!row) return null
  const toIso = (v) => v instanceof Date ? v.toISOString() : (v || null)
  const toIsoDate = (v) => {
    if (!v) return null
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return String(v).slice(0, 10)
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status || 'drafting',
    companyId: row.company_id,
    companyName: row.company_name || null,
    approvalId: row.approval_id || null,
    summary: row.summary || null,
    summaryGeneratedAt: toIso(row.summary_generated_at),
    sealedFilename: row.sealed_filename || null,
    sealedSizeBytes: row.sealed_size_bytes != null ? Number(row.sealed_size_bytes) : null,
    sealedMimeType: row.sealed_mime_type || null,
    sealedAt: toIso(row.sealed_at),
    sealedBy: row.sealed_by || null,
    cleanFilename: row.clean_filename || null,
    cleanSizeBytes: row.clean_size_bytes != null ? Number(row.clean_size_bytes) : null,
    cleanMimeType: row.clean_mime_type || null,
    cleanUploadedAt: toIso(row.clean_uploaded_at),
    cleanUploadedBy: row.clean_uploaded_by || null,
    // v2.0 结构化字段
    ourParties: row.our_parties || [],
    counterParties: row.counter_parties || [],
    contractType: row.contract_type || null,
    paymentType: row.payment_type || null,
    contractAmount: row.contract_amount != null ? Number(row.contract_amount) : null,
    termType: row.term_type || null,
    termDate: toIsoDate(row.term_date),
    termText: row.term_text || null,
    handlerId: row.handler_id || null,
    handlerUsername: row.handler_username || null,
    handlerDisplayName: row.handler_display_name || null,
    termNotifiedAt: toIso(row.term_notified_at),
    // 元数据
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdByDisplayName: row.created_by_display_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    approvalStartedAt: toIso(row.approval_started_at),
    versionCount: row.version_count != null ? Number(row.version_count) : 0,
    lastReviewedAt: toIso(row.last_reviewed_at),
  }
}

const CONTRACT_SELECT = [
  'c.id', 'c.code', 'c.name', 'c.description', 'c.company_id',
  'c.status', 'c.approval_id', 'c.summary', 'c.summary_generated_at',
  'c.sealed_filename', 'c.sealed_size_bytes', 'c.sealed_mime_type', 'c.sealed_at', 'c.sealed_by',
  'c.clean_filename', 'c.clean_size_bytes', 'c.clean_mime_type', 'c.clean_uploaded_at', 'c.clean_uploaded_by',
  'c.our_parties', 'c.counter_parties', 'c.contract_type', 'c.payment_type',
  'c.contract_amount', 'c.term_type', 'c.term_date', 'c.term_text',
  'c.handler_id', 'c.term_notified_at',
  'c.created_by', 'c.created_at', 'c.updated_at', 'c.approval_started_at',
  'u.username as created_by_username', 'u.display_name as created_by_display_name',
  'h.username as handler_username', 'h.display_name as handler_display_name',
  'co.name as company_name',
  db.raw('(SELECT count(*) FROM case_reviews r WHERE r.contract_id = c.id AND r.is_draft = false) AS version_count'),
  db.raw('(SELECT max(created_at) FROM case_reviews r WHERE r.contract_id = c.id AND r.is_draft = false) AS last_reviewed_at'),
]

function baseQuery() {
  return db('contracts as c')
    .leftJoin('users as u', 'c.created_by', 'u.id')
    .leftJoin('users as h', 'c.handler_id', 'h.id')
    .leftJoin('companies as co', 'c.company_id', 'co.id')
    .select(CONTRACT_SELECT)
}

// ─── 公司范围裁剪 ────────────────────────────────────────────────────────────
//   - superadmin + cc 设定 → 只看该公司
//   - "全部公司"模式：拿 user 在所有 manager 公司的合集
//   - 单公司模式：限定该公司
function applyCompanyScope(q, reqUser) {
  if (reqUser.isSuperAdmin) {
    if (reqUser.currentCompanyId) return q.where('c.company_id', reqUser.currentCompanyId)
    return q  // 超管未选公司 = 全平台只读（不常见，但允许）
  }
  if (reqUser.isAllCompaniesView) {
    // manager 多公司汇总：只看用户是 manager 的公司
    return q.whereIn('c.company_id',
      db('user_company_roles')
        .select('company_id')
        .where({ user_id: reqUser.id, role: 'manager' })
    )
  }
  return q.where('c.company_id', reqUser.currentCompanyId)
}

// v2.1+: 没有"看全部合同"权限的用户，只能看自己创建 / 自己 handler 的
function applyStaffScope(q, reqUser) {
  if (reqUser.isSuperAdmin || reqUser.isAllCompaniesView) return q
  if (reqUser.canViewAllContracts) return q
  return q.where(function () {
    this.where('c.created_by', reqUser.id).orWhere('c.handler_id', reqUser.id)
  })
}

// ─── 高级筛选解析 ────────────────────────────────────────────────────────────
//
// 入参示例（查询字符串）：
//   filter[name][op]=contains&filter[name][value]=采购
//   filter[contractAmount][op]=between&filter[contractAmount][min]=10000&filter[contractAmount][max]=500000
//   filter[termDate][op]=before&filter[termDate][value]=2027-01-01
//   filter[contractType][op]=in&filter[contractType][values][]=货物销售合同&filter[contractType][values][]=货物采购合同
//   sort=updatedAt:desc
//
// 安全：白名单字段映射到 DB 列，op 也是白名单。
const FIELD_MAP = {
  name: 'c.name',
  code: 'c.code',
  contractType: 'c.contract_type',
  paymentType: 'c.payment_type',
  contractAmount: 'c.contract_amount',
  termType: 'c.term_type',
  termDate: 'c.term_date',
  status: 'c.status',
  sealedAt: 'c.sealed_at',
  createdAt: 'c.created_at',
  updatedAt: 'c.updated_at',
  handlerDisplayName: 'h.display_name',
  createdByDisplayName: 'u.display_name',
  companyId: 'c.company_id',
}
const TEXT_FIELDS = new Set(['name', 'code', 'handlerDisplayName', 'createdByDisplayName'])
const NUM_FIELDS = new Set(['contractAmount'])
const DATE_FIELDS = new Set(['termDate', 'sealedAt', 'createdAt', 'updatedAt'])
const ENUM_FIELDS = new Set(['contractType', 'paymentType', 'termType', 'status', 'companyId'])

function applyFilters(q, filterObj) {
  if (!filterObj || typeof filterObj !== 'object') return q
  for (const [key, f] of Object.entries(filterObj)) {
    const col = FIELD_MAP[key]
    if (!col || !f || typeof f !== 'object') continue
    const op = f.op
    if (TEXT_FIELDS.has(key)) {
      if (op === 'contains' && f.value) q = q.where(col, 'ilike', `%${f.value}%`)
      else if (op === 'not_contains' && f.value) q = q.whereNot(col, 'ilike', `%${f.value}%`)
      else if (op === 'equals' && f.value) q = q.where(col, f.value)
    } else if (NUM_FIELDS.has(key)) {
      const v = f.value != null ? Number(f.value) : null
      const min = f.min != null ? Number(f.min) : null
      const max = f.max != null ? Number(f.max) : null
      if (op === 'gt' && Number.isFinite(v)) q = q.where(col, '>', v)
      else if (op === 'lt' && Number.isFinite(v)) q = q.where(col, '<', v)
      else if (op === 'eq' && Number.isFinite(v)) q = q.where(col, '=', v)
      else if (op === 'between' && Number.isFinite(min) && Number.isFinite(max)) q = q.whereBetween(col, [min, max])
    } else if (DATE_FIELDS.has(key)) {
      if (op === 'before' && f.value) q = q.where(col, '<=', f.value)
      else if (op === 'after' && f.value) q = q.where(col, '>=', f.value)
      else if (op === 'between' && f.min && f.max) q = q.whereBetween(col, [f.min, f.max])
    } else if (ENUM_FIELDS.has(key)) {
      const arr = Array.isArray(f.values) ? f.values : (f.value ? [f.value] : [])
      if (arr.length > 0) q = q.whereIn(col, arr)
    }
  }
  return q
}

function applySort(q, sortStr) {
  // 安全：仅允许 FIELD_MAP 中的字段 + asc/desc
  let col = 'c.updated_at'
  let dir = 'desc'
  if (typeof sortStr === 'string' && sortStr.includes(':')) {
    const [field, d] = sortStr.split(':')
    if (FIELD_MAP[field]) col = FIELD_MAP[field]
    if (d === 'asc' || d === 'desc') dir = d
  }
  return q.orderBy(col, dir)
}

// ─── 列表 ────────────────────────────────────────────────────────────────────
// GET /api/contracts?status=...&onlyUnapproved=1&filter[xxx][op]=...&sort=...
r.get('/', async (req, res, next) => {
  try {
    let q = applyCompanyScope(baseQuery(), req.user)
    q = applyStaffScope(q, req.user)

    const status = String(req.query?.status || '').trim()
    if (status && CONTRACT_STATUSES.includes(status)) {
      q = q.where('c.status', status)
    }
    if (req.query?.onlyUnapproved === '1' || req.query?.onlyUnapproved === 'true') {
      q = q.where('c.status', 'drafting')
    }
    q = applyFilters(q, req.query?.filter)
    q = applySort(q, req.query?.sort)

    const rows = await q.limit(1000)
    res.json({ contracts: rows.map(rowToContract) })
  } catch (e) { next(e) }
})

// GET /api/contracts/meta — 前端取枚举/字段清单
r.get('/meta', (_req, res) => {
  res.json({
    contractTypes: CONTRACT_TYPES,
    paymentTypes: PAYMENT_TYPES,
    termTypes: TERM_TYPES,
    requiresAmountPaymentTypes: [...REQUIRES_AMOUNT],
    contractStatuses: CONTRACT_STATUSES,
  })
})

// GET /api/contracts/export?mode=filtered|all & ...（同 list 的 filter/sort 参数）
//   用 exceljs 流式生成 xlsx
r.get('/export', requireCompanyRole('manager', 'legal', 'finance'), async (req, res, next) => {
  try {
    const ExcelJS = (await import('exceljs')).default
    let q = applyCompanyScope(baseQuery(), req.user)
    q = applyStaffScope(q, req.user)
    if (req.query?.mode !== 'all') {
      q = applyFilters(q, req.query?.filter)
    }
    q = applySort(q, req.query?.sort)
    const rows = await q.limit(50_000)

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('合同台账')
    ws.columns = [
      { header: '合同编号', key: 'code', width: 18 },
      { header: '合同名称', key: 'name', width: 28 },
      { header: '合同类型', key: 'contractType', width: 14 },
      { header: '我方签署主体', key: 'ourParties', width: 24 },
      { header: '对方签署主体', key: 'counterParties', width: 24 },
      { header: '收付款类型', key: 'paymentType', width: 12 },
      { header: '合同款项', key: 'contractAmount', width: 14 },
      { header: '合同期限', key: 'term', width: 18 },
      { header: '经办人', key: 'handler', width: 14 },
      { header: '用印日期', key: 'sealedAt', width: 14 },
      { header: '合同状态', key: 'status', width: 12 },
      { header: '创建人', key: 'createdBy', width: 14 },
      { header: '创建时间', key: 'createdAt', width: 18 },
    ]
    const STATUS_LABEL = {
      drafting: '起草中', approving: '审批中', pending_seal: '待签署', sealed: '已签署',
    }
    for (const row of rows) {
      const c = rowToContract(row)
      ws.addRow({
        code: c.code,
        name: c.name,
        contractType: c.contractType || '',
        ourParties: (c.ourParties || []).join('、'),
        counterParties: (c.counterParties || []).join('、'),
        paymentType: c.paymentType || '',
        contractAmount: c.contractAmount ?? '',
        term:
          c.termType === '固定日期' ? (c.termDate || '') :
          c.termType === '固定期限' ? (c.termText || '') :
          c.termType === '无期限' ? '无期限' : '',
        handler: c.handlerDisplayName || c.handlerUsername || '',
        sealedAt: c.sealedAt ? c.sealedAt.slice(0, 10) : '',
        status: STATUS_LABEL[c.status] || c.status,
        createdBy: c.createdByDisplayName || c.createdByUsername || '',
        createdAt: c.createdAt ? c.createdAt.slice(0, 19).replace('T', ' ') : '',
      })
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('合同台账.xlsx')}`)
    await wb.xlsx.write(res)
    res.end()
  } catch (e) { next(e) }
})

// GET /api/contracts/:id — 详情 + 所有 review 版本
r.get('/:id', async (req, res, next) => {
  try {
    const cRow = await baseQuery().where('c.id', req.params.id).first()
    if (!cRow) return res.status(404).json({ error: '合同不存在' })
    if (!canReadContractRow(req.user, cRow)) {
      return res.status(403).json({ error: '无权查看该合同' })
    }

    const reviews = await db('case_reviews as r')
      .leftJoin('users as u', 'r.created_by', 'u.id')
      .leftJoin('users as rv', 'r.reviewed_by', 'rv.id')
      .select(
        'r.id', 'r.uploaded_filename', 'r.uploaded_size_bytes', 'r.uploaded_mime_type',
        'r.review_text', 'r.model', 'r.pipeline_id', 'r.created_by', 'r.created_at',
        'r.reviewed_filename', 'r.reviewed_size_bytes', 'r.reviewed_mime_type',
        'r.reviewed_by', 'r.reviewed_at',
        'u.username as created_by_username', 'u.display_name as created_by_display_name',
        'rv.username as reviewed_by_username', 'rv.display_name as reviewed_by_display_name',
      )
      .where('r.contract_id', req.params.id)
      .where('r.is_draft', false)
      .orderBy('r.created_at', 'asc')

    let latestApprovalId = cRow.approval_id || null
    if (!latestApprovalId) {
      const latest = await db('approvals')
        .select('id')
        .where({ contract_id: req.params.id })
        .orderBy('created_at', 'desc')
        .first()
      latestApprovalId = latest?.id || null
    }

    res.json({
      contract: {
        ...rowToContract(cRow),
        latestApprovalId,
        reviews: reviews.map((rv, idx) => ({
          id: rv.id,
          version: idx + 1,
          uploadedFilename: rv.uploaded_filename,
          uploadedSizeBytes: rv.uploaded_size_bytes != null ? Number(rv.uploaded_size_bytes) : null,
          uploadedMimeType: rv.uploaded_mime_type,
          reviewText: rv.review_text,
          model: rv.model,
          pipelineId: rv.pipeline_id,
          createdBy: rv.created_by,
          createdByUsername: rv.created_by_username,
          createdByDisplayName: rv.created_by_display_name,
          createdAt: rv.created_at instanceof Date ? rv.created_at.toISOString() : rv.created_at,
          reviewedFilename: rv.reviewed_filename || null,
          reviewedSizeBytes: rv.reviewed_size_bytes != null ? Number(rv.reviewed_size_bytes) : null,
          reviewedMimeType: rv.reviewed_mime_type || null,
          reviewedBy: rv.reviewed_by || null,
          reviewedByUsername: rv.reviewed_by_username || null,
          reviewedByDisplayName: rv.reviewed_by_display_name || null,
          reviewedAt: rv.reviewed_at instanceof Date ? rv.reviewed_at.toISOString() : (rv.reviewed_at || null),
        })),
      },
    })
  } catch (e) { next(e) }
})

// POST /api/contracts — 直接新建占位合同（不通过 submit 流程，少用）
//   传 name；当前公司绑定；自动 code
r.post('/', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'), async (req, res, next) => {
  try {
    const { name, description } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写合同名称' })

    const created = await db.transaction(async (trx) => {
      return await createContractWithCode(trx, {
        name,
        description,
        ownerId: req.user.id,
        companyId: req.user.currentCompanyId,
      })
    })

    const row = await baseQuery().where('c.id', created.id).first()
    res.status(201).json({ contract: rowToContract(row) })
  } catch (e) { next(e) }
})

// PUT /api/contracts/:id — 改名 / 描述（不动结构化字段，用 PATCH /draft）
r.put('/:id', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'), async (req, res, next) => {
  try {
    const existing = await db('contracts').where({ id: req.params.id }).first()
    if (!existing) return res.status(404).json({ error: '合同不存在' })
    if (existing.company_id !== req.user.currentCompanyId) {
      return res.status(403).json({ error: '该合同不属于当前公司' })
    }
    // staff 只能改自己创建/handler 的
    if (!canReadContractRow(req.user, existing)) {
      return res.status(403).json({ error: '无权修改该合同' })
    }
    const { name, description } = req.body || {}
    const update = { updated_at: new Date() }
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: '合同名称不能为空' })
      update.name = String(name).trim()
    }
    if (description !== undefined) {
      update.description = description ? String(description).trim() : null
    }
    await db('contracts').where({ id: existing.id }).update(update)
    const row = await baseQuery().where('c.id', existing.id).first()
    res.json({ contract: rowToContract(row) })
  } catch (e) { next(e) }
})

// ─── v1.4 合同结构化字段 ──────────────────────────────────────────────────────

// POST /api/contracts/extract-fields — 无合同版 AI 提取（用于"不经审核直接发起"：合同尚未创建）
//   multipart 入参：cleanFile（必填，新上传的清洁版 Word，提取后即删、不入库）
//                   contractName（可选，用于辅助 AI 判断）
//   不写库，返回字段给前端填充编辑卡片。
r.post('/extract-fields', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'),
  extractUpload.single('cleanFile'), async (req, res, next) => {
  const uploadedTmp = req.file?.path || null
  try {
    if (!req.file) return res.status(400).json({ error: '请上传清洁版（Word）后再提取' })
    const company = req.user.currentCompanyId
      ? await db('companies').where({ id: req.user.currentCompanyId }).first()
      : null
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    const fields = await extractContractFields({
      absPath: req.file.path,
      mimeType: req.file.mimetype,
      originalName: filename,
      contractName: (req.body?.contractName && String(req.body.contractName).trim()) || filename,
      companyName: company?.name || null,
    })
    res.json({ fields })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  } finally {
    if (uploadedTmp) await safeUnlink(uploadedTmp)
  }
})

// POST /api/contracts/:id/extract-fields — 触发 AI 提取（**以清洁版为准**）
//   multipart 入参（二选一）：
//     - cleanFile           新上传的清洁版 Word（提取后即删，不入库）
//     - reuseExistingClean  'true' 时改用合同已存的清洁版（contracts.clean_*）
//   不写库，返回字段给前端填充编辑卡片。需 staff/manager/legal/seal_admin/finance 任一。
r.post('/:id/extract-fields', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'),
  extractUpload.single('cleanFile'), async (req, res, next) => {
  const uploadedTmp = req.file?.path || null
  try {
    const contract = await db('contracts').where({ id: req.params.id }).first()
    if (!contract) return res.status(404).json({ error: '合同不存在' })
    if (contract.company_id !== req.user.currentCompanyId) {
      return res.status(403).json({ error: '该合同不属于当前公司' })
    }
    if (!canReadContractRow(req.user, contract)) {
      return res.status(403).json({ error: '无权操作该合同' })
    }
    if (contract.status !== 'drafting') {
      return res.status(400).json({ error: '该合同已发起审批，不能重新 AI 提取' })
    }

    // 抽取源 = 清洁版：优先用本次上传的新清洁版，否则用合同已存的清洁版
    let absPath, mime, filename
    if (req.file) {
      absPath = req.file.path
      mime = req.file.mimetype
      filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    } else if (String(req.body?.reuseExistingClean) === 'true' && contract.clean_storage_path) {
      absPath = toAbsolutePath(contract.clean_storage_path)
      mime = contract.clean_mime_type
      filename = contract.clean_filename
    } else {
      return res.status(400).json({ error: '请先上传清洁版（Word）后再提取，或沿用已有清洁版' })
    }

    // 我方公司名：用于让 AI 判断合同里"我方"是哪一方（决定收付款方向、销售/采购等）
    const company = await db('companies').where({ id: contract.company_id }).first()

    const fields = await extractContractFields({
      absPath,
      mimeType: mime,
      originalName: filename,
      contractName: contract.name,
      companyName: company?.name || null,
    })
    res.json({ fields })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  } finally {
    // 上传的临时清洁版仅用于本次提取，用完即删
    if (uploadedTmp) await safeUnlink(uploadedTmp)
  }
})

// PATCH /api/contracts/:id/draft — 暂存结构化字段（status 仍 drafting）
//   body: { name?, ourParties?, counterParties?, contractType?, paymentType?,
//           contractAmount?, termType?, termDate?, termText?, handlerId? }
r.patch('/:id/draft', requireCompanyRole('manager', 'legal', 'seal_admin', 'finance', 'staff'), async (req, res, next) => {
  try {
    const contract = await db('contracts').where({ id: req.params.id }).first()
    if (!contract) return res.status(404).json({ error: '合同不存在' })
    if (contract.company_id !== req.user.currentCompanyId) {
      return res.status(403).json({ error: '该合同不属于当前公司' })
    }
    if (!canReadContractRow(req.user, contract)) {
      return res.status(403).json({ error: '无权修改该合同' })
    }
    if (contract.status !== 'drafting') {
      return res.status(400).json({ error: '只能在"起草中"状态修改结构化字段' })
    }

    const body = req.body || {}
    const update = { updated_at: new Date() }

    if (typeof body.name === 'string') {
      const n = body.name.trim()
      if (!n) return res.status(400).json({ error: '合同名称不能为空' })
      update.name = n
    }
    if (body.ourParties !== undefined) {
      if (!Array.isArray(body.ourParties)) return res.status(400).json({ error: '我方签署主体应为数组' })
      if (body.ourParties.length > 3) return res.status(400).json({ error: '我方签署主体最多 3 个' })
      update.our_parties = body.ourParties.map(s => String(s).trim()).filter(Boolean)
    }
    if (body.counterParties !== undefined) {
      if (!Array.isArray(body.counterParties)) return res.status(400).json({ error: '对方签署主体应为数组' })
      if (body.counterParties.length > 3) return res.status(400).json({ error: '对方签署主体最多 3 个' })
      update.counter_parties = body.counterParties.map(s => String(s).trim()).filter(Boolean)
    }
    if (body.contractType !== undefined) {
      if (body.contractType && !CONTRACT_TYPES.includes(body.contractType)) {
        return res.status(400).json({ error: '合同类型不在枚举范围内' })
      }
      update.contract_type = body.contractType || null
    }
    if (body.paymentType !== undefined) {
      if (body.paymentType && !PAYMENT_TYPES.includes(body.paymentType)) {
        return res.status(400).json({ error: '收付款类型不在枚举范围内' })
      }
      update.payment_type = body.paymentType || null
    }
    if (body.contractAmount !== undefined) {
      if (body.contractAmount === null || body.contractAmount === '') {
        update.contract_amount = null
      } else {
        const n = Number(body.contractAmount)
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: '合同款项必须是非负数' })
        update.contract_amount = n
      }
    }
    if (body.termType !== undefined) {
      if (body.termType && !TERM_TYPES.includes(body.termType)) {
        return res.status(400).json({ error: '合同期限类型不在枚举范围内' })
      }
      update.term_type = body.termType || null
    }
    if (body.termDate !== undefined) {
      update.term_date = body.termDate || null
      // 展期 → 清空 term_notified_at（重新计算到期提醒）
      if (contract.term_notified_at && body.termDate !== contract.term_date) {
        update.term_notified_at = null
      }
    }
    if (body.termText !== undefined) {
      update.term_text = body.termText ? String(body.termText).trim() : null
    }
    if (body.handlerId !== undefined) {
      if (body.handlerId) {
        // 校验 handler 是当前公司的成员
        const ok = await db('user_company_roles').where({
          user_id: body.handlerId,
          company_id: req.user.currentCompanyId,
        }).first()
        if (!ok) return res.status(400).json({ error: '经办人必须是当前公司的成员' })
        update.handler_id = body.handlerId
      } else {
        update.handler_id = null
      }
    }

    await db('contracts').where({ id: contract.id }).update(update)
    const row = await baseQuery().where('c.id', contract.id).first()
    res.json({ contract: rowToContract(row) })
  } catch (e) { next(e) }
})

// ─── 文件下载（清洁版 / 用印版） ─────────────────────────────────────────────
r.get('/:id/clean-file', async (req, res, next) => {
  try {
    const row = await db('contracts')
      .select('clean_filename', 'clean_storage_path', 'clean_mime_type', 'created_by', 'company_id', 'handler_id')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '合同不存在' })
    if (!row.clean_storage_path) return res.status(404).json({ error: '该合同还没有清洁版' })
    if (!canReadContractRow(req.user, row)) return res.status(403).json({ error: '无权下载清洁版' })

    res.setHeader('Content-Type', row.clean_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.clean_filename)}`)
    res.sendFile(toAbsolutePath(row.clean_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

r.get('/:id/sealed-file', async (req, res, next) => {
  try {
    const row = await db('contracts')
      .select('sealed_filename', 'sealed_storage_path', 'sealed_mime_type', 'created_by', 'company_id', 'handler_id', 'status')
      .where({ id: req.params.id })
      .first()
    if (!row) return res.status(404).json({ error: '合同不存在' })
    if (!row.sealed_storage_path) return res.status(404).json({ error: '该合同还没有用印版' })
    if (!canReadContractRow(req.user, row)) return res.status(403).json({ error: '无权下载用印版' })

    res.setHeader('Content-Type', row.sealed_mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.sealed_filename)}`)
    res.sendFile(toAbsolutePath(row.sealed_storage_path), (err) => { if (err && !res.headersSent) next(err) })
  } catch (e) { next(e) }
})

export default r

// ─── 工具：自动生成编号并创建合同（v2.0 加 companyId 必填） ─────────────────
//
// v2.1+ 编号规则：{公司简称}-HT-YYYY-NNN（按公司 + 年独立序号，3 位 0 补齐，超 999 自然扩位）
//   - 序号空间按 (company_id, year) 分桶，advisory lock key 用 hashtext 防并发
//   - 公司必须有简称（创建/改名时已强校验），缺失则报错
export async function createContractWithCode(trx, { name, description, ownerId, companyId, handlerId }) {
  if (!companyId) throw new Error('createContractWithCode: companyId is required')

  const company = await trx('companies').where({ id: companyId }).first()
  if (!company) throw Object.assign(new Error('合同所属公司不存在'), { status: 400 })
  if (!company.code) {
    throw Object.assign(
      new Error('该公司尚未配置简称（合同编号前缀），请联系平台超管在企业管理中补充'),
      { status: 400 },
    )
  }

  const year = new Date().getFullYear()
  const lockKey = `${companyId}_${year}`
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey])

  const prefix = `${company.code}-HT-${year}-`
  const last = await trx('contracts')
    .where({ company_id: companyId })
    .where('code', 'like', `${prefix}%`)
    .orderBy('code', 'desc')
    .limit(1)
    .first()

  let nextSeq = 1
  if (last?.code) {
    const tail = last.code.slice(prefix.length)
    const lastSeq = parseInt(tail, 10)
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1
  }
  // 3 位 0 补齐；序号 ≥1000 时自然扩位（4 位、5 位...）不再补零
  const seqText = nextSeq < 1000 ? String(nextSeq).padStart(3, '0') : String(nextSeq)
  const code = `${prefix}${seqText}`

  const [inserted] = await trx('contracts').insert({
    code,
    name: String(name).trim(),
    description: description ? String(description).trim() : null,
    created_by: ownerId,
    company_id: companyId,
    handler_id: handlerId || ownerId,
  }, ['id', 'code'])

  return inserted
}
