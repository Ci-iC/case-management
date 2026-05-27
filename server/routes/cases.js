// 案件台账 v2.0：跨公司共享，无公司隔离
//
// 权限：
//   - 只要用户在任意一家 active 公司有 'legal' 或 'manager' 角色 → 能看 + 能改全部案件
//   - 平台超管：全读全写
//   - 其他角色（staff / seal_admin / finance）：无权限
//   - "company_id" 字段在 cases 表上不存在；不按公司过滤

import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs/promises'
import { db, cryptoId, rowToCase, caseToRow, writeAudit } from '../db.js'
import { requireAuth, isSuperAdmin } from '../auth.js'
import { extractCaseFields } from '../caseFieldExtract.js'
import { DATA_ROOT, ensureDir, safeFilename, safeUnlink } from '../storage.js'

const r = Router()
r.use(requireAuth)

// ─── multer 配置：案件智能录入上传（临时文件，处理完即删） ────────────────────
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 20 * 1024 * 1024
const TMP_ROOT = path.join(DATA_ROOT, 'tmp')
const caseExtractUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try { await ensureDir(TMP_ROOT); cb(null, TMP_ROOT) } catch (e) { cb(e) }
    },
    filename: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeFilename(original)}`)
    },
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 10 },
})

// 工具：用户是否在任意一家公司有 legal 或 manager 角色
async function userCanAccessCases(userId, reqUser) {
  if (isSuperAdmin(reqUser)) return true
  const row = await db('user_company_roles as ucr')
    .innerJoin('companies as c', 'ucr.company_id', 'c.id')
    .where('ucr.user_id', userId)
    .where('c.status', 'active')
    .whereIn('ucr.role', ['legal', 'manager'])
    .first()
  return !!row
}

// 中间件：案件接口的统一鉴权
async function requireCaseAccessV2(req, res, next) {
  try {
    if (await userCanAccessCases(req.user.id, req.user)) return next()
    return res.status(403).json({ error: '案件台账仅企业管理人员 / 法务岗可访问' })
  } catch (e) { next(e) }
}

r.use(requireCaseAccessV2)

const REQUIRED = ['caseNumber', 'caseName', 'causeOfAction', 'disputeType', 'stage', 'ourParty', 'opposingParty', 'currentProgress']

function validate(data) {
  for (const k of REQUIRED) {
    if (data[k] === undefined || data[k] === null || String(data[k]).trim() === '') {
      return `字段「${k}」不能为空`
    }
  }
  return null
}

function shallowDiff(before, after) {
  const changed = {}
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const k of keys) {
    if (k === 'updatedAt' || k === 'updatedBy' || k === 'version') continue
    const b = before?.[k]
    const a = after?.[k]
    if (b !== a) changed[k] = { before: b, after: a }
  }
  return changed
}

// GET /api/cases
r.get('/', async (_req, res, next) => {
  try {
    const rows = await db('cases').select('*').orderBy('updated_at', 'desc')
    res.json({ cases: rows.map(rowToCase) })
  } catch (e) { next(e) }
})

// GET /api/cases/:id
r.get('/:id', async (req, res, next) => {
  try {
    const row = await db('cases').where({ id: req.params.id }).first()
    if (!row) return res.status(404).json({ error: '案件不存在' })
    res.json({ case: rowToCase(row) })
  } catch (e) { next(e) }
})

// GET /api/cases/:id/history
r.get('/:id/history', async (req, res, next) => {
  try {
    const exists = await db('cases').select('id').where({ id: req.params.id }).first()
    if (!exists) return res.status(404).json({ error: '案件不存在' })
    const rows = await db('case_versions as v')
      .leftJoin('users as u', 'v.changed_by', 'u.id')
      .select(
        'v.id', 'v.version', 'v.snapshot', 'v.changed_at',
        'v.changed_by', 'u.username as changed_by_username', 'u.display_name as changed_by_display_name',
      )
      .where('v.case_id', req.params.id)
      .orderBy('v.version', 'desc')
    res.json({
      versions: rows.map(r => ({
        id: r.id,
        version: r.version,
        snapshot: r.snapshot,
        changedAt: r.changed_at instanceof Date ? r.changed_at.toISOString() : r.changed_at,
        changedBy: r.changed_by,
        changedByUsername: r.changed_by_username,
        changedByDisplayName: r.changed_by_display_name,
      })),
    })
  } catch (e) { next(e) }
})

// POST /api/cases
r.post('/', async (req, res, next) => {
  try {
    const err = validate(req.body)
    if (err) return res.status(400).json({ error: err })

    const id = cryptoId()
    const now = new Date()
    const row = caseToRow(req.body)

    try {
      await db('cases').insert({
        id,
        ...row,
        version: 1,
        is_archived: false,
        created_at: now,
        updated_at: now,
        created_by: req.user.id,
        updated_by: req.user.id,
      })
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({ error: `案件编号「${req.body.caseNumber}」已存在` })
      }
      throw dbErr
    }

    const created = await db('cases').where({ id }).first()
    const caseObj = rowToCase(created)

    await db('case_versions').insert({
      case_id: id,
      version: 1,
      snapshot: caseObj,
      changed_by: req.user.id,
      changed_at: now,
    })
    await writeAudit({
      actorId: req.user.id, action: 'case.create',
      targetType: 'case', targetId: id,
      payload: { caseNumber: caseObj.caseNumber, caseName: caseObj.caseName },
    })

    res.status(201).json({ case: caseObj })
  } catch (e) { next(e) }
})

// PUT /api/cases/:id  — 乐观锁
r.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const clientVersion = Number(req.body?.version)
    if (!Number.isInteger(clientVersion) || clientVersion < 1) {
      return res.status(400).json({ error: '请求缺少 version 字段（乐观锁）' })
    }

    const result = await db.transaction(async (trx) => {
      const existing = await trx('cases').where({ id }).first().forUpdate()
      if (!existing) return { kind: 'not_found' }
      if (existing.version !== clientVersion) {
        return { kind: 'conflict', current: rowToCase(existing) }
      }

      const before = rowToCase(existing)
      const merged = { ...before, ...req.body }
      const err = validate(merged)
      if (err) return { kind: 'validation', error: err }

      const row = caseToRow(merged)
      const now = new Date()
      const archivedFlag = typeof req.body.isArchived === 'boolean' ? req.body.isArchived : existing.is_archived
      const newVersion = existing.version + 1

      try {
        await trx('cases').where({ id }).update({
          ...row,
          version: newVersion,
          is_archived: archivedFlag,
          updated_at: now,
          updated_by: req.user.id,
        })
      } catch (dbErr) {
        if (dbErr.code === '23505') return { kind: 'duplicate_number' }
        throw dbErr
      }

      const updated = await trx('cases').where({ id }).first()
      const after = rowToCase(updated)

      await trx('case_versions').insert({
        case_id: id,
        version: newVersion,
        snapshot: after,
        changed_by: req.user.id,
        changed_at: now,
      })

      return { kind: 'ok', case: after, before }
    })

    if (result.kind === 'not_found') return res.status(404).json({ error: '案件不存在' })
    if (result.kind === 'conflict') {
      return res.status(409).json({ error: '该案件已被他人修改，请刷新后重试', current: result.current })
    }
    if (result.kind === 'validation') return res.status(400).json({ error: result.error })
    if (result.kind === 'duplicate_number') {
      return res.status(409).json({ error: `案件编号「${req.body.caseNumber}」已存在` })
    }

    await writeAudit({
      actorId: req.user.id, action: 'case.update',
      targetType: 'case', targetId: id,
      payload: { version: result.case.version, diff: shallowDiff(result.before, result.case) },
    })
    res.json({ case: result.case })
  } catch (e) { next(e) }
})

// DELETE /api/cases/:id
r.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const row = await db('cases').select('id', 'case_number', 'case_name').where({ id }).first()
    if (!row) return res.status(404).json({ error: '案件不存在' })
    await db('cases').where({ id }).delete()
    await writeAudit({
      actorId: req.user.id, action: 'case.delete',
      targetType: 'case', targetId: id,
      payload: { caseNumber: row.case_number, caseName: row.case_name },
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// POST /api/cases/ai-extract — 案件材料智能录入（multipart 上传多个 PDF/Word，服务端调 AI 提取字段）
//   body: ourRole=plaintiff|defendant
r.post('/ai-extract', caseExtractUpload.array('files', 10), async (req, res, next) => {
  const tmpFiles = (req.files || []).map(f => f.path)
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请至少上传一个文件' })
    }
    const ourRole = String(req.body?.ourRole || '').trim()
    if (ourRole !== 'plaintiff' && ourRole !== 'defendant') {
      return res.status(400).json({ error: 'ourRole 必须是 plaintiff 或 defendant' })
    }

    const fileInputs = req.files.map(f => ({
      absPath: f.path,
      originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
    }))

    const data = await extractCaseFields(fileInputs, ourRole)
    res.json({ data })
  } catch (e) {
    if (e?.code === 'AI_NOT_CONFIGURED') return res.status(400).json({ error: e.message })
    next(e)
  } finally {
    // 临时文件处理完立即清掉
    for (const p of tmpFiles) await safeUnlink(p)
  }
})

// POST /api/cases/bulk-import
r.post('/bulk-import', async (req, res, next) => {
  try {
    const { cases, mode = 'append' } = req.body || {}
    if (!Array.isArray(cases)) return res.status(400).json({ error: 'cases 必须是数组' })

    const result = await db.transaction(async (trx) => {
      let imported = 0, skipped = 0
      const now = new Date()

      if (mode === 'replace') {
        await trx('cases').delete()
      }

      const existingRows = await trx('cases').select('case_number')
      const existingNumbers = new Set(existingRows.map(r => r.case_number))

      let tempIndex = 0
      if (mode === 'renumber') {
        for (const n of existingNumbers) {
          const m = /^暂时(\d+)$/.exec(n)
          if (m) tempIndex = Math.max(tempIndex, parseInt(m[1], 10))
        }
      }

      for (const c of cases) {
        const err = validate(c)
        if (err) { skipped++; continue }

        let caseNumber = c.caseNumber
        if (mode === 'renumber') {
          tempIndex++
          caseNumber = `暂时${String(tempIndex).padStart(2, '0')}`
        } else if (mode === 'append' && existingNumbers.has(caseNumber)) {
          skipped++
          continue
        }

        const row = caseToRow({ ...c, caseNumber })
        const id = c.id || cryptoId()

        try {
          await trx('cases').insert({
            id,
            ...row,
            version: 1,
            is_archived: !!c.isArchived,
            created_at: c.createdAt ? new Date(c.createdAt) : now,
            updated_at: now,
            created_by: req.user.id,
            updated_by: req.user.id,
          })
        } catch (dbErr) {
          if (dbErr.code === '23505') { skipped++; continue }
          throw dbErr
        }

        const created = await trx('cases').where({ id }).first()
        await trx('case_versions').insert({
          case_id: id,
          version: 1,
          snapshot: rowToCase(created),
          changed_by: req.user.id,
          changed_at: now,
        })
        existingNumbers.add(caseNumber)
        imported++
      }
      return { imported, skipped }
    })

    await writeAudit({
      actorId: req.user.id, action: 'case.bulk_import',
      targetType: 'case', targetId: null,
      payload: { mode, imported: result.imported, skipped: result.skipped },
    })
    res.json(result)
  } catch (e) { next(e) }
})

export default r
