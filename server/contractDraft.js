// 合同起草编排（聊天引导 → 选模板 → 生成结构化正文）。
//
// 三个步骤都走 openai.js 的 chatCompletion：
//   1. chatDraft     —— 多轮引导对话，返回 { reply, readyToDraft }
//   2. pickTemplate  —— 读「模板说明.md」+ 对话，选出最合适的模板文件名（或 null）
//   3. draftContract —— 结合已收集信息 + 选中模板正文，产出结构化合同 JSON
//
// 设计：
//   - 前端持有完整对话历史，每次把 messages 传进来（后端无状态）
//   - readyToDraft 由模型判断 7 项必填是否齐全；前端据此高亮「开始起草」
//   - 模型不在配置时抛 AI_NOT_CONFIGURED，路由层兜底返 400

import { chatCompletion } from './openai.js'

// 7 项必填（产品需求固定）
export const REQUIRED_FIELDS = [
  '合同类型', '甲方全称', '乙方全称', '合同标的',
  '合同金额及币种', '付款方式', '合同期限',
]

function ourCompanyHint(companyName) {
  return companyName && companyName.trim()
    ? `本系统由「${companyName.trim()}」内部使用，用户通常代表该公司或其关联公司起草合同；若信息缺失可优先把我方主体默认理解为该公司。`
    : ''
}

function wrapAiNotConfigured(e) {
  if (/未配置 OpenAI/.test(e?.message || '')) {
    const err = new Error(e.message)
    err.code = 'AI_NOT_CONFIGURED'
    return err
  }
  return e
}

// ─── 步骤 1：引导对话 ──────────────────────────────────────────────────────────

function buildChatSystem(companyName, templateText) {
  const templateBlock = templateText
    ? `【已匹配参考模板】系统已为本次起草匹配到一个合同模板，其条款结构与要点如下（节选）：
${templateText.slice(0, 4000)}
请对照该模板，重点确认"模板要求、但用户尚未提供或表述不清"的关键信息（如模板里出现的规格/数量、验收、违约、税率发票、特殊交付或保密条款等）。`
    : `【无匹配模板】未匹配到现成模板，将按该类合同的通用规范起草；请据合同常识确认起草所必需的关键信息。`

  return `你是一名专业的合同起草助手，服务于企业法务场景。用户已通过表单提交了一份合同的基本信息，你要先和用户确认必要信息，再交由系统生成 Word 草稿。

${ourCompanyHint(companyName)}

${templateBlock}

【你的工作方式】
- 用户提交的基本信息已包含这 7 项必填：${REQUIRED_FIELDS.join('、')}。**拿到信息后，你必须先结合上面的模板/合同常识，至少进行一轮追问**：挑出真正必要、而用户还没说清的点（如标的的具体规格与数量、验收标准、违约责任、争议解决、发票与税率、特殊交付/保密要求等），一次问 1~5 个最关键的，简洁口语化。
- 非关键条款用户没提的，起草时套用通用默认即可，不必逐条追问。
- **用户对某项明确表示"留空 / 不确定 / 暂无 / 没有 / 以后再定 / 先空着"时，立刻停止追问该项，不要再换着法子问** —— 起草阶段大多数不确定的信息都可以留空（生成时用【】占位），尊重用户的留空选择。
- 用户可能上传参考文件（以"【参考文件：文件名】…"出现），从中自动提取信息，提取到的就不再重复问。
- 记住上下文，不要重复追问已明确的信息。
- **第一轮回复 readyToDraft 一律为 false**（必须先至少问一轮）。之后，当必要信息都已确认、用户也表示无补充时，才把 readyToDraft 置 true，并提示"信息已齐全，可点击【生成草稿】"。
- 全程中文，专业友好。

【输出格式】严格输出 JSON，不要任何前后缀：
{
  "reply": string,          // 你这一轮要对用户说的话
  "readyToDraft": boolean   // 必要信息是否已确认、可以生成
}`
}

/** 引导对话一轮。messages：[{role,content}]；templateText：已匹配模板正文或 null。返回 { reply, readyToDraft } */
export async function chatDraft({ messages, companyName, templateText = null }) {
  let result
  try {
    result = await chatCompletion({
      system: buildChatSystem(companyName, templateText),
      messages,
      responseFormat: 'json_object',
    })
  } catch (e) {
    throw wrapAiNotConfigured(e)
  }
  let parsed = {}
  try { parsed = JSON.parse(result.content) } catch { /* keep {} */ }
  return {
    reply: typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : '抱歉，我没太理解，可以再说一下吗？',
    readyToDraft: parsed.readyToDraft === true,
  }
}

// ─── 步骤 2：选模板 ────────────────────────────────────────────────────────────

function buildPickSystem(manifest, templateFiles) {
  return `你是合同模板匹配助手。下面是模板库里的「模板说明」和可用模板文件清单。请根据用户对话里的合同需求，判断哪个模板最合适。

【可用模板文件】
${templateFiles.map((f) => `- ${f}`).join('\n')}

【模板说明.md】
${manifest}

【规则】
- 只能从上面"可用模板文件"清单里原样选 1 个文件名；都不合适就返回 null。
- 拿不准、说明里没有对得上的场景 → null（让系统自行起草，比硬套错模板好）。

严格输出 JSON：{ "templateFile": string | null, "reason": string }`
}

/** 选模板。templateFiles 为空或无 manifest 时直接返回 null（不调用 AI）。
 *  conversationText：把对话压成一段纯文本喂进去。
 *  返回 { templateFile: string|null, reason }，templateFile 一定在 templateFiles 内或为 null。 */
export async function pickTemplate({ conversationText, manifest, templateFiles }) {
  if (!manifest || !Array.isArray(templateFiles) || templateFiles.length === 0) {
    return { templateFile: null, reason: '无可用模板，AI 自行起草' }
  }
  let result
  try {
    result = await chatCompletion({
      system: buildPickSystem(manifest, templateFiles),
      user: `【用户合同需求对话】\n${conversationText}`,
      responseFormat: 'json_object',
      temperature: 0,
    })
  } catch (e) {
    // 选模板失败不致命：退化为无模板自行起草
    return { templateFile: null, reason: '模板匹配失败，AI 自行起草' }
  }
  let parsed = {}
  try { parsed = JSON.parse(result.content) } catch { /* keep {} */ }
  const file = typeof parsed.templateFile === 'string' && templateFiles.includes(parsed.templateFile)
    ? parsed.templateFile : null
  return { templateFile: file, reason: typeof parsed.reason === 'string' ? parsed.reason : '' }
}

// ─── 步骤 3：生成结构化合同正文 ────────────────────────────────────────────────

function buildDraftSystem(companyName, templateText) {
  const templateBlock = templateText
    ? `【参考模板正文 —— 起草必须严格以它为准】
${templateText}

【套用模板的硬性要求】
- **以上模板是本次起草的蓝本**：必须沿用它的条款顺序、条款标题、章节结构、措辞风格和默认表述，逐条改写成正式合同。
- 不要新增模板里没有的条款，也不要删减模板里有的条款；只是把对话中收集到的具体信息填进对应位置。
- 模板里的占位/示例内容，用用户提供的信息替换；用户没提供的，保留模板的默认表述或用"【】"占位，**不要凭空编造**。
- 仅当模板确实缺少某类合同必备的法律条款时，才补充少量必要条款。`
    : `【无匹配模板】请按该类合同的通用规范自行起草，条款齐全、措辞严谨。`

  return `你是一名资深合同起草律师，服务于企业法务。请根据对话里收集到的信息，起草一份完整、规范、可直接使用的中文合同草稿。

${ourCompanyHint(companyName)}

${templateBlock}

【起草要求】
- ${templateText ? '在严格遵循上述模板结构的前提下，' : ''}合同要素齐全：标题、缔约双方信息、鉴于条款（如适用）、各项实质条款（标的、金额与支付、期限、双方权利义务、违约责任、争议解决、保密、不可抗力、其他/附则）、落款签署区。
- 用户已明确的信息务必准确写入；用户未提供或明确表示留空的信息，用"【】"占位提示（如"【甲方开户行】"），不要编造具体数字 / 名称。
- 金额同时写大写和小写。条款用"第一条""第二条"式编号。
- 落款署名区采用甲乙双方左右两栏：**每一行用一个制表符（Tab，即 \t）分隔左栏（甲方）与右栏（乙方）**，左右两栏的条目要一一对应（如「甲方（签章）：________\t乙方（签章）：________」「法定代表人：________\t法定代表人：________」「日期：____年__月__日\t日期：____年__月__日」）。除落款分栏外，正文其他地方不要使用制表符。

【输出格式】严格输出 JSON（不要 Markdown、不要前后缀）：
{
  "title": string,                       // 合同标题
  "fileMeta": {
    "contractType": string,              // 合同类型（用于文件名，如"采购合同"）
    "counterShortName": string           // 对方（乙方）简称（用于文件名，如"某某公司"）
  },
  "sections": [                          // 顺序即正文顺序：前言、各条款、落款都各占一项
    { "heading": string | null,          // 条款标题；前言 / 落款等无标题段落填 null
      "paragraphs": string[] }           // 该部分的段落，每段一个字符串
  ]
}`
}

function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') raw = {}
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '合同'
  const fm = raw.fileMeta && typeof raw.fileMeta === 'object' ? raw.fileMeta : {}
  const contractType = typeof fm.contractType === 'string' && fm.contractType.trim()
    ? fm.contractType.trim() : '合同'
  const counterShortName = typeof fm.counterShortName === 'string' && fm.counterShortName.trim()
    ? fm.counterShortName.trim() : '乙方'
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          heading: typeof s.heading === 'string' && s.heading.trim() ? s.heading.trim() : null,
          paragraphs: Array.isArray(s.paragraphs)
            ? s.paragraphs.filter((p) => typeof p === 'string').map((p) => p)
            : [],
        }))
        .filter((s) => s.heading || s.paragraphs.length)
    : []
  return { title, fileMeta: { contractType, counterShortName }, sections }
}

/** 生成结构化合同。messages：完整对话历史；templateText：选中模板正文或 null。 */
export async function draftContract({ messages, templateText, companyName }) {
  // 用对话历史 + 一条起草指令收尾
  const draftMessages = [
    ...messages,
    { role: 'user', content: '以上信息已确认完毕，请据此起草正式合同草稿，按要求输出 JSON。' },
  ]
  let result
  try {
    result = await chatCompletion({
      system: buildDraftSystem(companyName, templateText),
      messages: draftMessages,
      responseFormat: 'json_object',
    })
  } catch (e) {
    throw wrapAiNotConfigured(e)
  }
  let parsed = {}
  try { parsed = JSON.parse(result.content) } catch { /* keep {} */ }
  return normalizeDraft(parsed)
}

/** 把对话历史压成一段纯文本（给选模板用） */
export function conversationToText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((m) => `${m.role === 'assistant' ? 'AI' : '用户'}：${m.content}`)
    .join('\n')
    .slice(0, 12000)
}
