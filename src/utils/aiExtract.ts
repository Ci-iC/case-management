import mammoth from 'mammoth'
import type { CaseRecord, DisputeType, CaseStage, ClosingMethod } from '@/types'
import type { OpenAISettings } from '@/store/useSettingsStore'

// ─── File Utilities ────────────────────────────────────────────────────────────

export type FileKind = 'pdf' | 'docx' | 'unsupported'

export function detectFileKind(file: File): FileKind {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx') || name.endsWith('.doc')) return 'docx'
  return 'unsupported'
}

/** Extracts raw text from a .docx (or .doc) file using mammoth. */
async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value || ''
}

/** Reads a file as a data URL (base64-encoded) — format accepted by OpenAI's file input. */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

// ─── OpenAI Payload Construction ───────────────────────────────────────────────

export type OurRole = 'plaintiff' | 'defendant'

export const OUR_ROLE_LABEL: Record<OurRole, string> = {
  plaintiff: '原告 / 申请人（起诉或申请仲裁的一方）',
  defendant: '被告 / 被申请人（被起诉或被申请的一方）',
}

const SYSTEM_PROMPT_BASE = `你是一名法务助理，专门从案件材料（PDF、Word 全文）中抽取结构化信息，写入公司案件台账系统。

请严格按以下 JSON Schema 输出（仅输出 JSON 对象，不要解释、不要 Markdown）：

{
  "caseNumber": "string，案件编号，如「（2025）沪01民初1234号」或公司内部编号；无则为 null",
  "caseName": "string，案件名称，通常形式为「<我方> 诉 <对方> <案由> 一案」",
  "causeOfAction": "string，案由，如「建设工程施工合同纠纷」",
  "disputeType": "枚举: contract | labor | ip | tort | compliance | other —— 合同纠纷/劳动争议/知识产权/侵权/合规行政/其他",
  "court": "string，受理法院或仲裁机构或监管机关，多个用顿号分隔",
  "stage": "枚举: filed | hearing | first_trial | second_trial | execution | closed —— 立案/审理中/一审/二审/执行/结案",
  "judgmentDocumentNumber": "string，裁判文书编号；无则 null",
  "closingMethod": "枚举: withdrawal | settlement | judgment —— 撤诉/和解/判决；非执行或结案阶段返回 null",
  "assignedLawyer": "string，我方承办律师姓名",
  "businessDepartment": "string，对接业务部门",
  "ourParty": "string，我方主体完整名称",
  "opposingParty": "string，对方主体完整名称",
  "thirdParties": "string，第三人/关联方，多个用顿号分隔；无则 null",
  "opposingLawyer": "string，对方代理人姓名",
  "opposingFirm": "string，对方律所",
  "totalAmount": "number，涉案金额（单位：万元）",
  "ourClaimAmount": "number，我方主张金额（万元）",
  "opposingClaimAmount": "number，对方主张金额（万元）",
  "filingDate": "string，立案日期，格式 YYYY-MM-DD",
  "arbitrationHearingDate": "string，仲裁开庭时间 YYYY-MM-DD",
  "firstTrialHearingDate": "string，一审开庭时间 YYYY-MM-DD",
  "secondTrialHearingDate": "string，二审开庭时间 YYYY-MM-DD",
  "hearingDate": "string，通用开庭日期 YYYY-MM-DD",
  "judgmentDate": "string，判决/裁决日期 YYYY-MM-DD",
  "nextKeyDate": "string，下一关键节点日期 YYYY-MM-DD",
  "nextKeyDateLabel": "string，下一关键节点说明，如「第三次庭审」",
  "mainDisputes": "string，主要争议焦点",
  "ourPosition": "string，我方诉求/抗辩要点",
  "currentProgress": "string，当前进展；尽量根据材料内容合理归纳",
  "judgmentResult": "string，判决结果；无则 null",
  "executionProgress": "string，回款/执行进展；无则 null",
  "reviewNotes": "string，复盘要点；无则 null",
  "remarks": "string，备注；无则 null"
}

规则：
1. 所有字段若材料中找不到对应内容，一律返回 null（不要编造）
2. 金额必须统一换算成"万元"为单位的数字（例如 1,234,567 元 → 123.46）
3. 日期必须规范成 YYYY-MM-DD
4. 枚举字段必须严格返回英文 key，不要返回中文
5. 多个文件的信息需综合分析、合并成同一案件的统一视图
6. 不要返回 markdown、代码块，只返回裸 JSON 对象
7. 关于"我方 / 对方"的判定：用户会在下一条消息中告诉你"我方在本案中的身份"（原告或被告）。请据此从材料中识别：
   - 若我方=原告/申请人：材料中的"原告 / 申请人"就是 ourParty，"被告 / 被申请人"就是 opposingParty
   - 若我方=被告/被申请人：材料中的"被告 / 被申请人"就是 ourParty，"原告 / 申请人"就是 opposingParty
   - 我方主张金额（ourClaimAmount）= 我方在材料中提出的金额主张；对方主张金额（opposingClaimAmount）同理
   - opposingLawyer / opposingFirm 一律取对方委托的代理人和律所，不要填我方的`

// ─── Main Extraction Function ──────────────────────────────────────────────────

export interface ExtractInput {
  files: File[]
  model: string
  ourRole: OurRole
  settings: OpenAISettings
}

export async function extractCaseFromFiles(
  input: ExtractInput,
): Promise<{ data: Partial<CaseRecord>; raw: string }> {
  const { files, model, ourRole, settings } = input
  if (!settings.apiKey) throw new Error('尚未配置 OpenAI API Key，请先到「设置」填写')
  if (files.length === 0) throw new Error('请至少上传一个文件')

  // Build user multimodal content
  const userContent: Array<Record<string, unknown>> = []
  for (const file of files) {
    const kind = detectFileKind(file)
    if (kind === 'pdf') {
      const dataUrl = await fileToDataURL(file)
      userContent.push({
        type: 'file',
        file: { filename: file.name, file_data: dataUrl },
      })
    } else if (kind === 'docx') {
      const text = await parseDocx(file)
      userContent.push({
        type: 'text',
        text: `【文件：${file.name}（Word 全文）】\n${text}`,
      })
    } else {
      throw new Error(`不支持的文件格式：${file.name}（仅支持 .pdf / .docx / .doc）`)
    }
  }
  // Final instruction anchor with role disambiguation
  userContent.push({
    type: 'text',
    text:
      `【重要】我方在本案中的身份是：${OUR_ROLE_LABEL[ourRole]}。\n` +
      `请据此把我方对应的当事人填入 ourParty、对方填入 opposingParty。\n\n` +
      `请根据以上全部材料综合抽取案件信息，严格按 system 指定的 JSON Schema 输出。`,
  })

  const baseURL = (settings.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const url = `${baseURL}/chat/completions`

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_BASE },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    let msg = errText
    try {
      const parsed = JSON.parse(errText)
      msg = parsed?.error?.message || errText
    } catch { /* keep raw */ }
    throw new Error(`OpenAI 调用失败（${resp.status}）：${msg}`)
  }

  const result = await resp.json()
  const content: string = result?.choices?.[0]?.message?.content || ''
  if (!content) throw new Error('OpenAI 返回为空')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('OpenAI 返回不是合法 JSON，请重试或更换模型：\n' + content.slice(0, 500))
  }

  return { data: normalize(parsed), raw: content }
}

// ─── Post-processing / Normalization ───────────────────────────────────────────

const DISPUTE_TYPES: DisputeType[] = ['contract', 'labor', 'ip', 'tort', 'compliance', 'other']
const CASE_STAGES: CaseStage[] = ['filed', 'hearing', 'first_trial', 'second_trial', 'execution', 'closed']
const CLOSING_METHODS: ClosingMethod[] = ['withdrawal', 'settlement', 'judgment']

function strOrUndef(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' || s.toLowerCase() === 'null' ? undefined : s
}

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function enumOrUndef<T extends string>(v: unknown, allowed: T[]): T | undefined {
  const s = strOrUndef(v)?.toLowerCase()
  if (!s) return undefined
  return (allowed as string[]).includes(s) ? (s as T) : undefined
}

function dateOrUndef(v: unknown): string | undefined {
  const s = strOrUndef(v)
  if (!s) return undefined
  // Accept YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY年M月D日
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!m) return undefined
  const [, y, mo, d] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function normalize(raw: Record<string, unknown>): Partial<CaseRecord> {
  return {
    caseNumber:              strOrUndef(raw.caseNumber) || '',
    caseName:                strOrUndef(raw.caseName) || '',
    causeOfAction:           strOrUndef(raw.causeOfAction) || '',
    disputeType:             enumOrUndef(raw.disputeType, DISPUTE_TYPES),
    court:                   strOrUndef(raw.court) || '',
    stage:                   enumOrUndef(raw.stage, CASE_STAGES),
    judgmentDocumentNumber:  strOrUndef(raw.judgmentDocumentNumber),
    closingMethod:           enumOrUndef(raw.closingMethod, CLOSING_METHODS),
    assignedLawyer:          strOrUndef(raw.assignedLawyer) || '',
    businessDepartment:      strOrUndef(raw.businessDepartment) || '',
    ourParty:                strOrUndef(raw.ourParty) || '',
    opposingParty:           strOrUndef(raw.opposingParty) || '',
    thirdParties:            strOrUndef(raw.thirdParties),
    opposingLawyer:          strOrUndef(raw.opposingLawyer),
    opposingFirm:            strOrUndef(raw.opposingFirm),
    totalAmount:             numOrUndef(raw.totalAmount),
    ourClaimAmount:          numOrUndef(raw.ourClaimAmount),
    opposingClaimAmount:     numOrUndef(raw.opposingClaimAmount),
    filingDate:              dateOrUndef(raw.filingDate),
    arbitrationHearingDate:  dateOrUndef(raw.arbitrationHearingDate),
    firstTrialHearingDate:   dateOrUndef(raw.firstTrialHearingDate),
    secondTrialHearingDate:  dateOrUndef(raw.secondTrialHearingDate),
    hearingDate:             dateOrUndef(raw.hearingDate),
    judgmentDate:            dateOrUndef(raw.judgmentDate),
    nextKeyDate:             dateOrUndef(raw.nextKeyDate),
    nextKeyDateLabel:        strOrUndef(raw.nextKeyDateLabel),
    mainDisputes:            strOrUndef(raw.mainDisputes),
    ourPosition:             strOrUndef(raw.ourPosition),
    currentProgress:         strOrUndef(raw.currentProgress) || '',
    judgmentResult:          strOrUndef(raw.judgmentResult),
    executionProgress:       strOrUndef(raw.executionProgress),
    reviewNotes:             strOrUndef(raw.reviewNotes),
    remarks:                 strOrUndef(raw.remarks),
  }
}
