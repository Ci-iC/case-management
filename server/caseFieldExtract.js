// v2.0 案件智能录入（服务端 AI 调用，原浏览器直调 OpenAI 改造为统一走平台 API Key）
//
// 输入：多个文件（.pdf / .docx / .doc）+ 我方身份（plaintiff / defendant）
// 输出：案件结构化字段（与 v1.x aiExtract.ts 的 schema 完全一致）
//
// 实现：服务端把所有文件提取为纯文本（PDF 走 pdfjs-dist，docx 走 mammoth，doc 走 word-extractor），
//       拼成一个长 user message，加 our_role 提示，调 chatCompletion 强制 JSON 输出。

import fs from 'node:fs/promises'
import path from 'node:path'
import { chatCompletion } from './openai.js'

const SYSTEM_PROMPT = `你是一名法务助理，专门从案件材料（PDF、Word 全文）中抽取结构化信息，写入公司案件台账系统。

请严格按以下 JSON Schema 输出（仅输出 JSON 对象，不要解释、不要 Markdown）：

{
  "caseNumber": "string，案件编号；无则 null",
  "caseName": "string，案件名称，通常形式为「<我方> 诉 <对方> <案由> 一案」",
  "causeOfAction": "string，案由，如「建设工程施工合同纠纷」",
  "disputeType": "枚举: contract | labor | ip | tort | compliance | other",
  "court": "string，受理法院或仲裁机构，多个用顿号分隔",
  "stage": "枚举: filed | hearing | first_trial | second_trial | execution | closed",
  "judgmentDocumentNumber": "string，裁判文书编号；无则 null",
  "closingMethod": "枚举: withdrawal | settlement | judgment；非结案阶段返回 null",
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
  "filingDate": "string YYYY-MM-DD",
  "arbitrationHearingDate": "string YYYY-MM-DD",
  "firstTrialHearingDate": "string YYYY-MM-DD",
  "secondTrialHearingDate": "string YYYY-MM-DD",
  "hearingDate": "string YYYY-MM-DD",
  "judgmentDate": "string YYYY-MM-DD",
  "nextKeyDate": "string YYYY-MM-DD",
  "nextKeyDateLabel": "string",
  "mainDisputes": "string",
  "ourPosition": "string",
  "currentProgress": "string",
  "judgmentResult": "string",
  "executionProgress": "string",
  "reviewNotes": "string",
  "remarks": "string"
}

规则：
1. 所有字段若材料中找不到对应内容，一律返回 null（不要编造）
2. 金额必须统一换算成"万元"为单位的数字（例如 1,234,567 元 → 123.46）
3. 日期必须规范成 YYYY-MM-DD
4. 枚举字段必须严格返回英文 key，不要返回中文
5. 多个文件的信息需综合分析、合并成同一案件的统一视图
6. 不要返回 markdown、代码块，只返回裸 JSON 对象
7. 关于"我方 / 对方"的判定：用户会在下一条消息中告诉你"我方在本案中的身份"（原告或被告）`

const OUR_ROLE_LABEL = {
  plaintiff: '原告 / 申请人（起诉或申请仲裁的一方）',
  defendant: '被告 / 被申请人（被起诉或被申请的一方）',
}

async function extractFileText(absPath, originalName) {
  const ext = path.extname(originalName).toLowerCase()
  if (ext === '.txt') return (await fs.readFile(absPath, 'utf8')).trim()
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
  if (ext === '.pdf') {
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
  throw new Error(`不支持的文件格式：${ext}（仅支持 .pdf / .docx / .doc）`)
}

/**
 * @param files [{ absPath, originalName }]
 * @param ourRole 'plaintiff' | 'defendant'
 */
export async function extractCaseFields(files, ourRole) {
  if (!files || files.length === 0) throw new Error('请至少上传一个文件')
  const roleLabel = OUR_ROLE_LABEL[ourRole]
  if (!roleLabel) throw new Error('请指定我方身份（plaintiff / defendant）')

  // 各文件提取文本
  const parts = []
  for (const f of files) {
    const text = await extractFileText(f.absPath, f.originalName)
    parts.push(`【文件：${f.originalName}】\n${text}`)
  }
  let combined = parts.join('\n\n')
  if (combined.length > 200_000) combined = combined.slice(0, 200_000)
  if (combined.trim().length < 20) throw new Error('文件中提取不到任何有效文字')

  const userMsg =
    `【重要】我方在本案中的身份是：${roleLabel}。\n` +
    `请据此把我方对应的当事人填入 ourParty、对方填入 opposingParty。\n\n` +
    `请根据以下材料综合抽取案件信息，严格按 system 指定的 JSON Schema 输出。\n\n` +
    combined

  let result
  try {
    result = await chatCompletion({
      system: SYSTEM_PROMPT,
      user: userMsg,
      responseFormat: 'json_object',
    })
  } catch (e) {
    if (/未配置 OpenAI/.test(e?.message || '')) {
      const err = new Error('平台尚未配置 OpenAI API Key，请联系平台超管在「平台设置」中填写')
      err.code = 'AI_NOT_CONFIGURED'
      throw err
    }
    throw e
  }

  let parsed
  try { parsed = JSON.parse(result.content) } catch {
    throw new Error('AI 返回不是合法 JSON，请重试或更换模型')
  }
  return parsed
}
