import 'dotenv/config'
import knex from 'knex'

// ─── Knex instance ─────────────────────────────────────────────────────────────

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[db] DATABASE_URL not set — see .env.example')
  process.exit(1)
}

export const db = knex({
  client: 'pg',
  connection: databaseUrl,
  pool: { min: 2, max: 10 },
})

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function cryptoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

// ─── Case row mapping (DB snake_case ↔ API camelCase) ──────────────────────────

const CASE_FIELDS = [
  ['case_number', 'caseNumber'],
  ['case_name', 'caseName'],
  ['cause_of_action', 'causeOfAction'],
  ['dispute_type', 'disputeType'],
  ['court', 'court'],
  ['stage', 'stage'],
  ['judgment_document_number', 'judgmentDocumentNumber'],
  ['closing_method', 'closingMethod'],
  ['assigned_lawyer', 'assignedLawyer'],
  ['business_department', 'businessDepartment'],
  ['our_party', 'ourParty'],
  ['opposing_party', 'opposingParty'],
  ['third_parties', 'thirdParties'],
  ['opposing_lawyer', 'opposingLawyer'],
  ['opposing_firm', 'opposingFirm'],
  ['total_amount', 'totalAmount'],
  ['our_claim_amount', 'ourClaimAmount'],
  ['opposing_claim_amount', 'opposingClaimAmount'],
  ['filing_date', 'filingDate'],
  ['arbitration_hearing_date', 'arbitrationHearingDate'],
  ['first_trial_hearing_date', 'firstTrialHearingDate'],
  ['second_trial_hearing_date', 'secondTrialHearingDate'],
  ['hearing_date', 'hearingDate'],
  ['judgment_date', 'judgmentDate'],
  ['next_key_date', 'nextKeyDate'],
  ['next_key_date_label', 'nextKeyDateLabel'],
  ['main_disputes', 'mainDisputes'],
  ['our_position', 'ourPosition'],
  ['current_progress', 'currentProgress'],
  ['judgment_result', 'judgmentResult'],
  ['execution_progress', 'executionProgress'],
  ['review_notes', 'reviewNotes'],
  ['remarks', 'remarks'],
]

const NUMERIC_KEYS = new Set(['totalAmount', 'ourClaimAmount', 'opposingClaimAmount'])
const DATE_KEYS = new Set([
  'filingDate', 'arbitrationHearingDate', 'firstTrialHearingDate',
  'secondTrialHearingDate', 'hearingDate', 'judgmentDate', 'nextKeyDate',
])

function toIsoDate(v) {
  if (!v) return undefined
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

function toIsoTimestamp(v) {
  if (!v) return v
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export function rowToCase(row) {
  if (!row) return null
  const out = { id: row.id }
  for (const [col, key] of CASE_FIELDS) {
    let v = row[col]
    if (v === null || v === undefined) { out[key] = undefined; continue }
    if (NUMERIC_KEYS.has(key)) v = typeof v === 'string' ? Number(v) : v
    if (DATE_KEYS.has(key)) v = toIsoDate(v)
    out[key] = v
  }
  out.createdAt = toIsoTimestamp(row.created_at)
  out.updatedAt = toIsoTimestamp(row.updated_at)
  out.createdBy = row.created_by
  out.updatedBy = row.updated_by ?? undefined
  out.version = row.version
  out.isArchived = !!row.is_archived
  return out
}

export function caseToRow(data) {
  const row = {}
  for (const [col, key] of CASE_FIELDS) {
    const v = data[key]
    if (v === undefined || v === '') { row[col] = null; continue }
    if (DATE_KEYS.has(key)) { row[col] = toIsoDate(v); continue }
    row[col] = v
  }
  return row
}

export const CASE_DB_COLUMNS = CASE_FIELDS.map(([col]) => col)

// ─── Audit log helper ──────────────────────────────────────────────────────────

export async function writeAudit({ actorId, action, targetType, targetId, payload }) {
  await db('audit_logs').insert({
    actor_id: actorId || null,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    payload: payload ?? null,    // pg driver auto-stringifies for JSONB
    created_at: new Date(),
  })
}
