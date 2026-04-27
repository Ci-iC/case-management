// 后端代调 OpenAI（chat/completions）。Key 来自 .env，所有用户共用。

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

/** 调 chat/completions，返回 message.content 字符串 */
export async function chatCompletion({ system, user, model }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || apiKey === 'sk-replace-me') {
    throw new Error('后端未配置 OPENAI_API_KEY（请在 .env 中设置）')
  }
  const baseURL = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const useModel = model || process.env.OPENAI_MODEL_DEFAULT || DEFAULT_MODEL

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: useModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!resp.ok) {
    const txt = await resp.text()
    let msg = txt
    try { msg = JSON.parse(txt)?.error?.message || txt } catch { /* keep raw */ }
    throw new Error(`AI 调用失败 (${resp.status}): ${msg}`)
  }

  const result = await resp.json()
  const content = result?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 返回为空')
  return { content, model: useModel }
}
