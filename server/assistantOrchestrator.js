// AI 工作台编排：JSON 协议自驱动的工具循环 + 待办推送生成。
//
// 协议：模型每轮严格输出 { thought, action:{tool,args}|null, reply:string|null }
//   - action 是只读工具 → 后端执行、把结果作为【工具结果】注回，继续循环
//   - action 是写工具   → 停止，返回 pending_action（由前端弹确认框、用户确认后执行）
//   - 只有 reply        → 作为助手回复返回
// 解析失败 / 超过轮数 → 安全降级为普通文本回复，绝不执行任何写操作。

import { chatCompletion } from './openai.js'
import { getTool, buildCatalogForUser } from './assistantTools.js'

const MAX_STEPS = 6

function buildSystemPrompt(reqUser, catalog) {
  const toolLines = catalog.map((t) => {
    const args = Object.keys(t.args || {}).length
      ? Object.entries(t.args).map(([k, v]) => `${k}(${v})`).join('；')
      : '无参数'
    return `- ${t.name} [${t.kind === 'read' ? '只读' : '写操作'}]：${t.description} 参数：${args}`
  }).join('\n')

  const company = reqUser?.currentCompanyId ? '当前已选定公司。' : '当前未选定具体公司（部分功能不可用）。'
  const myRoles = (reqUser?.companyRoles || []).join('、') || '（无公司角色）'

  return `你是 GlobalX 法律事务管理系统的 AI 工作台助手，通过调用下列工具帮用户查询和办理法务事务。${company}用户角色：${myRoles}。
能力：查待办/合同/审批/案件/文件、AI 审合同、提交法务、发起审批、起草合同、审批通过或驳回。页面下方有同名快捷按钮，用户也可直接和你说要做什么。

【可用工具】（已按角色权限过滤，列表外的你没有权限）
${toolLines}

【协议】严格输出 JSON，无任何前后缀：
{ "thought": string, "action": {"tool":string,"args":object}|null, "reply": string|null }
- 调工具时给 action、reply 置 null，一次只调一个；只读工具系统自动执行并把【工具结果】回传给你，据此继续或作答。
- 写工具你只"提议"：系统会弹确认框、用户确认后才执行，绝不能假装已完成；提议前用一句话说明要做什么。

【关键规则】
- 合同编号系统自动生成（如 天弘-HT-2026-001），绝不向用户要编号；新建只需合同名称，定位已有合同用名称/编号查。状态：起草中→审批中→待签署→已签署。站内信由系统自动发，你无法手动发。
- 审合同两种用法：①「AI 前置审核 + 提交法务」(常规推荐)：先 submit_review 由 AI 预审产出结构化意见，再 submit_to_legal 连同 AI 意见一起提交本公司法务正式审核（自动建/挂合同并通知法务，约 1~2 个工作日回复）；②「仅 AI 审核」：只 submit_review 供用户自己参考、不提交法务。submit_review 产出结构化意见表，你别口头复述、只简述结论方向。
- 审核首轮说明：当用户首次表达"审核/提交审核"意图、聊天里还没有可审的合同文件时，先用一小段话讲清工作模式再请用户上传清洁版 Word——要点：合同审核既能 AI 单审供你自己看，也能(更常用)AI 先预审、再把合同连同 AI 意见一起提交法务正式审核；AI 审核仅供参考、不能替代法务，正式发起审批/用印前一般都需经法务一轮把关。说明完请用户上传文件，别一上来只让传文件、也别让用户误以为这功能只是给 AI 看。已有文件时直接进入审核、不必重复这段说明。
- 起草合同：用户要"起草/拟一份合同"→ 提议 draft_contract 打开起草工具（引导收集要素、匹配模板或自行起草、生成 Word），args 留空。
- 发起审批：聊天里已有用户上传的清洁版 Word 才提议 initiate_approval（打开发起表单，自动预填+列合同/审批人）；还没上传就请用户先传、别提议。别自己查合同状态、别因"起草中/可能没过法务"就拒绝或追问——能否发起由表单和后端把关；contractId/审批人/字段都在表单里填。
- 收尾两节点（到此实质审批已结束）：用印=印章管理员核对终稿盖章（常由财务/人力兼任，但职责是盖章不是再审）；上传盖章扫描件=经办人归档。
- 批量指令（"都通过"等）：一次只提议一个写操作；每个成功后系统会再交给你，先用 list_todos 等确认仍待处理的项再提下一个，全部做完一句话汇总并停止；不重复已完成的、不擅自发起没要求的操作。
- 发文件：用户要某合同清洁版/用印版→ get_contract_files，系统自动在回复下附下载按钮，你说明"已附上，可点击下载"即可。
- 聊天里出现【参考文件：xxx】/【系统提示：已上传…】即文件已真实存在：只读问答直接据正文答；带文件的写操作（submit_review/upload_legal_revision/initiate_approval）把该文件名填入 attachmentFilename，别要求重传；确无文件而写操作又必须时才请用户上传。
- 写操作确认项（立场/幅度/接收法务/留言/意见等）用户会在确认框改，你只给合理默认（立场甲方、幅度 medium），缺则留空，别反复追问。
- 不向用户展示 reviewId 等内部 ID；信息不足或无权限时 reply 说明并把 action 置 null。始终简体中文、结论先行。`
}

// 把库里的历史消息转成发给模型的消息数组
function historyToModel(messages) {
  const out = []
  for (const m of messages) {
    if (m.kind === 'todo') {
      out.push({ role: 'assistant', content: m.content })
    } else if (m.kind === 'file') {
      // content 已含「【参考文件：文件名】+正文」。额外明确告诉模型：这是一份真实已上传、
      // 可被写操作直接引用的附件——避免模型把"已看到的正文"和"需要上传的文件"当成两回事。
      const fn = m.data?.filename || '附件'
      out.push({
        role: 'user',
        content: `【系统提示：用户已在本次聊天中上传文件「${fn}」。该文件真实存在于会话附件中，可被写操作直接引用——需要文件参数时把 attachmentFilename 填为「${fn}」即可，切勿再要求用户重新上传。文件正文如下，可据此直接阅读/分析/回答：】\n${m.content}`,
      })
    } else if (m.kind === 'pending_action') {
      const s = m.data?.summary ? JSON.stringify(m.data.summary) : ''
      out.push({ role: 'assistant', content: `【我已提议操作，等待用户确认】${s}` })
    } else if (m.kind === 'review_result') {
      // AI 审核意见已用结构化表格展示给用户，模型只需知道"已完成审核 + reviewId"以便后续提交法务
      const d = m.data || {}
      out.push({
        role: 'assistant',
        content: `【已向用户展示 AI 审核意见，文件「${d.filename || ''}」，我方立场「${d.ourRole || ''}」，系统记录 reviewId=${d.reviewId || ''}。如用户接着要"提交法务审核"，对该 reviewId 调用 submit_to_legal 即可，无需重新审核。】`,
      })
    } else if (m.kind === 'action_result') {
      // reviewId 等内部 id 只给模型看（用于串联后续工具），不展示给用户
      const rid = m.data?.reviewId ? `（系统记录 reviewId=${m.data.reviewId}）` : ''
      out.push({ role: 'user', content: `【操作结果】${m.content}${rid}` })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

// 选出"最像协议对象"的那个：优先含 action/reply/thought 的，再退而求其次。
function pickProtocol(objs) {
  if (!objs.length) return null
  const proto = objs.find((o) => 'action' in o || 'reply' in o || 'thought' in o)
  return proto || objs[objs.length - 1]
}

// 扫描字符串里所有"括号平衡"的顶层 JSON 对象（容忍模型偶发输出多个对象/带前后缀）。
function extractJsonObjects(str) {
  const out = []
  let depth = 0, start = -1, inStr = false, esc = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { const v = JSON.parse(str.slice(start, i + 1)); if (v && typeof v === 'object') out.push(v) }
        catch { /* skip */ }
        start = -1
      }
    }
  }
  return out
}

function parseModel(content) {
  if (!content) return null
  // 1) 直接解析（正常情况）
  try {
    const v = JSON.parse(content)
    if (v && typeof v === 'object') return v
  } catch { /* fall through */ }
  // 2) 去掉 ```json ... ``` 围栏后再试
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try { const v = JSON.parse(fenced[1].trim()); if (v && typeof v === 'object') return v } catch { /* fall through */ }
  }
  // 3) 容忍模型偶发输出多个/带前后缀的 JSON 对象：扫描所有对象，挑协议对象
  const objs = extractJsonObjects(content)
  return pickProtocol(objs)
}

/**
 * 跑一轮工具循环。
 * @param history 当天消息（getTodayMessages 的结果，已含最新一条 user 消息）
 * @returns { type:'text', reply } | { type:'pending_action', tool, label, args, summary }
 */
export async function runTurn({ reqUser, history }) {
  const catalog = buildCatalogForUser(reqUser)
  const system = buildSystemPrompt(reqUser, catalog)
  const messages = historyToModel(history)

  // 只读工具产出的"可下载文件链接"——累积到本轮末尾，附在最终文本回复上由前端渲染下载按钮
  const collectedFileLinks = []

  for (let step = 0; step < MAX_STEPS; step++) {
    let result
    try {
      result = await chatCompletion({ system, messages, responseFormat: 'json_object' })
    } catch (e) {
      if (/未配置 OpenAI/.test(e?.message || '')) {
        const err = new Error(e.message); err.code = 'AI_NOT_CONFIGURED'; throw err
      }
      throw e
    }
    const parsed = parseModel(result.content)
    if (!parsed) {
      // 解析失败：把原文当普通回复，安全降级
      return { type: 'text', reply: (result.content || '抱歉，我没太理解，请再说一次。').slice(0, 4000) }
    }

    const action = parsed.action
    if (action && action.tool) {
      const tool = getTool(action.tool)
      if (!tool || !tool.available(reqUser)) {
        messages.push({ role: 'assistant', content: result.content })
        messages.push({ role: 'user', content: `【工具结果 ${action.tool}】该工具不存在或你没有权限使用，请换一种方式或在 reply 里告知用户。` })
        continue
      }
      if (tool.kind === 'read') {
        let toolResult
        try {
          toolResult = await tool.run({ reqUser }, action.args || {})
        } catch (e) {
          toolResult = { error: e?.message || '工具执行失败' }
        }
        // 抽走 _fileLinks（仅用于前端渲染下载按钮，不喂给模型——避免它复述内部 id）
        let modelResult = toolResult
        if (toolResult && Array.isArray(toolResult._fileLinks)) {
          collectedFileLinks.push(...toolResult._fileLinks)
          const { _fileLinks, ...rest } = toolResult
          modelResult = rest
        }
        messages.push({ role: 'assistant', content: result.content })
        messages.push({ role: 'user', content: `【工具结果 ${tool.name}】\n${JSON.stringify(modelResult).slice(0, 12000)}` })
        continue
      }
      // 写工具：提议 → 停止，交前端确认
      let summary = { 操作: tool.label }
      try { summary = await tool.summarize(action.args || {}, { reqUser }) } catch { /* keep default */ }
      // 可编辑确认项（用户在确认框里填空/选择，确认后回填到 args）
      let fields = null
      if (typeof tool.fields === 'function') {
        try { fields = await tool.fields(action.args || {}, { reqUser }) } catch { fields = null }
      }
      return {
        type: 'pending_action',
        tool: tool.name,
        label: tool.label,
        executor: tool.executor,
        args: action.args || {},
        summary,
        fields,
        autoConfirm: tool.autoConfirm === true,   // 无害动作：前端直接打开窗口，免"确认执行"卡
      }
    }

    // 普通回复（附上本轮累积的可下载文件链接，供前端渲染下载按钮）
    return {
      type: 'text',
      reply: (parsed.reply || '好的。').toString().slice(0, 4000),
      fileLinks: collectedFileLinks.length ? collectedFileLinks : undefined,
    }
  }
  return { type: 'text', reply: '这个请求步骤太多，我暂时没能完成。请把需求说得更具体一些，或分步告诉我。' }
}

/** 确定性生成"待办推送"开场白（不走 AI），返回 { content, data:{jumpLinks} } */
export async function generateTodoPush(reqUser) {
  const tool = getTool('list_todos')
  let data = { pendingApprovals: [], pendingReviews: [] }
  if (tool && tool.available(reqUser)) {
    try { data = await tool.run({ reqUser }, {}) } catch { /* keep empty */ }
  }
  const { pendingApprovals = [], pendingReviews = [] } = data
  const jumpLinks = []
  const lines = []
  let n = 0
  for (const a of pendingApprovals) {
    n++
    const name = a.contractName || a.contractCode || a.approvalId
    let line
    if (a.nodeKind === 'seal') {
      // 用印节点：处理人常由财务/人力兼任，点明这是"用印"步骤，实质审批已结束
      line = `${n}. 【待用印】合同《${name}》已通过全部实质性审批，等待你核对终稿后加盖公章`
    } else if (a.nodeKind === 'upload_scan') {
      line = `${n}. 【待上传扫描件】合同《${name}》用印已完成，等待你上传盖章扫描件归档（流程最后一步）`
    } else {
      line = `${n}. 【待审批】合同《${name}》等待你审批`
    }
    lines.push(line)
    jumpLinks.push({ index: n, label: '跳转查看', nav: 'approvals', approvalId: a.approvalId })
  }
  for (const r of pendingReviews) {
    n++
    const name = r.contractName || r.filename || '合同审核'
    lines.push(`${n}. 【待审核】《${name}》已提交，等待你处理`)
    jumpLinks.push({ index: n, label: '跳转查看', nav: 'reviews', reviewId: r.reviewId })
  }

  const greeting = '你好，我是你的 AI 工作台助手。'
  let content
  if (n === 0) {
    content = `${greeting}\n当前没有需要你处理的待办。你可以让我帮你查询合同状态、起草合同，或直接告诉我要做什么。`
  } else {
    content = `${greeting}今天有以下待办需要处理：\n\n${lines.join('\n')}\n\n如需直接处理，可以告诉我，我来帮你完成。`
  }
  return { content, data: { jumpLinks } }
}
