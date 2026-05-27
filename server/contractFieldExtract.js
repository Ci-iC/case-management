// v1.4/v2.0：合同结构化字段 AI 提取
//
// 输入：合同文本（从 .docx/.doc/.txt 提取）+ 合同名称
// 输出：结构化字段 JSON（合同名称/我方/对方/类型/收付款/金额/期限/经办人）
// 设计：
//   - 调用 openai.js 的 chatCompletion，强制 JSON 输出
//   - prompt 内规定字段映射 + 枚举范围，模型不在枚举内的值落 null
//   - 经办人通常 AI 提取不到（合同里没明确"经办人"语义），返 null 让用户手填
//   - 提取失败 → 抛错（路由层兜底返 400 给前端）

import fs from 'node:fs/promises'
import path from 'node:path'
import { chatCompletion } from './openai.js'

const CONTRACT_TYPES = [
  '货物销售合同', '货物采购合同', '矿权转让合同', '研发实验类合同',
  '行政采购类合同', '人力资源服务类合同', '合作协议', '代理协议',
  '房屋租赁合同', '股权转让合同', '补充协议',
]
const PAYMENT_TYPES = ['收款', '付款', '借贷', '框架类', '无金额']
const TERM_TYPES = ['固定日期', '固定期限', '无期限']

function buildSystemPrompt(companyName) {
  // 我方公司名是判断"我方/对方、收付款方向、销售/采购"的关键锚点。
  // 没拿到名字（如默认公司）时退化为按甲方/买方推断。
  const ourHint = companyName && companyName.trim()
    ? `【我方公司】${companyName.trim()}
本系统是「我方公司」内部使用的合同审批系统，下面所有"我方"均指上述公司本身或其全资 / 关联子公司。`
    : `【我方公司】未提供（请按"甲方 / 买方 / 服务接受方 = 我方"推断）`

  return `你是一名专业的合同信息抽取助手，服务于我方公司的合同审批系统。请通读合同正文，抽取下列结构化字段，严格输出 JSON（不要 Markdown，不要任何解释性前后缀）。

${ourHint}

第一步——先判断"我方"是哪一方（这决定后面一连串字段，务必先做对）：
合同通常有甲方/乙方（或买方/卖方、出租方/承租方、转让方/受让方等两方）。
- 在合同里找到与"我方公司"名称相同或高度相似的一方（含全称、简称、其子公司 / 关联公司），那一方就是"我方"，另一方是"对方"。
- 若确实找不到能对应我方公司的一方，再退而按"甲方 / 买方 / 服务接受方 = 我方"推断。
- 后续 ourParties / counterParties / paymentType（收付款方向）/ contractType（销售 vs 采购）全部以这一步的结论为准。

字段定义：
1. _reasoning: 先用一两句话写出关键判断依据（谁是我方、合同性质、金额和期限是怎么读出来的）。仅供内部核对，可简短。
2. contractName: 合同名称，取合同标题原文，最长 40 字。
3. ourParties: 我方签署主体（数组，最多 3 个）。填营业执照式的主体全称，不要填"甲方""乙方"这类代称；无法确定填 []。
4. counterParties: 对方签署主体（数组，最多 3 个）。要求同上。
5. contractType: 合同类型，**只能从以下枚举中选 1 个**，判断不了填 null：
   - 货物销售合同：我方卖出货物 / 产品（我方收钱）
   - 货物采购合同：我方买入货物 / 原料 / 设备（我方付钱）
   - 矿权转让合同：探矿权或采矿权的转让
   - 研发实验类合同：技术开发、委托研发、检测、实验、技术服务
   - 行政采购类合同：办公行政类采买（物业、办公用品、广告、差旅、咨询等非生产性采购）
   - 人力资源服务类合同：劳务派遣、招聘、人事代理、培训
   - 合作协议：双方合作但不是单纯买卖（联营、战略合作、共建等）
   - 代理协议：委托代理关系（销售代理、采购代理等）
   - 房屋租赁合同：房屋 / 场地的租赁
   - 股权转让合同：股权 / 股份的转让
   - 补充协议：对某份已存在的主合同做补充或变更
6. paymentType: 收付款类型，**只能从以下枚举中选 1 个**，判断不了填 null：
   - 收款：对方付钱给我方
   - 付款：我方付钱给对方
   - 借贷：借款 / 贷款类的资金往来
   - 框架类：只约定合作框架、没有具体金额
   - 无金额：不涉及金钱
7. contractAmount: 合同总金额（数字，单位"元"）。规则：
   - 取合同总价款 / 合同总金额（含税总额优先），不要取单价、保证金、定金、违约金。
   - 统一换算成"元"的阿拉伯数字：「100 万元」→ 1000000；「人民币伍拾万元整」→ 500000；「12.5 万」→ 125000。
   - 仅当 paymentType 为 收款 / 付款 / 借贷 时填；框架类 / 无金额 一律 null。
   - 金额不明确、或为无法换算的外币 → null。
8. termType: 合同期限类型，**只能从以下枚举中选 1 个**，判断不了填 null：
   - 固定日期：写明到某个具体日历日截止（例："有效期至 2026 年 12 月 31 日"）
   - 固定期限：约定一段时长（例："自签订之日起一年""有效期 2 年""服务期 6 个月"）
   - 无期限：长期有效 / 未约定终止 / 至义务履行完毕为止
9. termDate: 仅当 termType="固定日期" 时填，格式 YYYY-MM-DD（合同到期日）；否则 null。
10. termText: 仅当 termType="固定期限" 时填，原文时长描述（如"一年""自签订之日起 6 个月"）；否则 null。

输出 JSON 结构（所有字段都必须出现，缺失填 null 或 空数组）：
{
  "_reasoning": string,
  "contractName": string | null,
  "ourParties": string[],
  "counterParties": string[],
  "contractType": string | null,
  "paymentType": string | null,
  "contractAmount": number | null,
  "termType": string | null,
  "termDate": string | null,
  "termText": string | null
}

输出原则：
- 只输出 JSON，无任何前后导语。
- 枚举字段必须落在给定枚举内，否则 null。
- 不确定 / 合同没写 → null（数组 → []），绝不编造。`
}

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

function normalize(raw) {
  // 兜底校验：保证返回字段都在 + 枚举值合法
  if (!raw || typeof raw !== 'object') raw = {}
  const out = {
    contractName: typeof raw.contractName === 'string' ? raw.contractName.trim().slice(0, 40) || null : null,
    ourParties: Array.isArray(raw.ourParties)
      ? raw.ourParties.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()).slice(0, 3)
      : [],
    counterParties: Array.isArray(raw.counterParties)
      ? raw.counterParties.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()).slice(0, 3)
      : [],
    contractType: CONTRACT_TYPES.includes(raw.contractType) ? raw.contractType : null,
    paymentType: PAYMENT_TYPES.includes(raw.paymentType) ? raw.paymentType : null,
    contractAmount: Number.isFinite(Number(raw.contractAmount)) && Number(raw.contractAmount) >= 0
      ? Number(raw.contractAmount) : null,
    termType: TERM_TYPES.includes(raw.termType) ? raw.termType : null,
    termDate: typeof raw.termDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.termDate) ? raw.termDate : null,
    termText: typeof raw.termText === 'string' ? raw.termText.trim() || null : null,
  }
  // 一致性兜底：paymentType=无金额/框架类 → amount 强制 null
  if (out.paymentType === '无金额' || out.paymentType === '框架类') out.contractAmount = null
  // termType 与 date/text 一致性
  if (out.termType !== '固定日期') out.termDate = null
  if (out.termType !== '固定期限') out.termText = null
  return out
}

export async function extractContractFields({ absPath, mimeType, originalName, contractName, companyName }) {
  let text
  try {
    text = await extractTextFromFile(absPath, mimeType, originalName)
  } catch (e) {
    const err = new Error('合同文件解析失败：' + (e?.message || e))
    err.code = 'EXTRACT_PARSE_FAILED'
    throw err
  }
  if (!text || text.trim().length < 10) {
    return normalize({})   // 文本太短，直接返回全 null 让用户手填
  }
  if (text.length > 80_000) text = text.slice(0, 80_000)

  const userMsg = `【合同名称】${contractName || '未命名'}\n\n【合同正文】\n${text}`
  let result
  try {
    result = await chatCompletion({
      system: buildSystemPrompt(companyName),
      user: userMsg,
      responseFormat: 'json_object',
      temperature: 0,
    })
  } catch (e) {
    if (/未配置 OpenAI/.test(e?.message || '')) {
      const err = new Error(e.message)
      err.code = 'AI_NOT_CONFIGURED'
      throw err
    }
    throw e
  }

  let parsed
  try { parsed = JSON.parse(result.content) } catch {
    parsed = {}
  }
  return normalize(parsed)
}
