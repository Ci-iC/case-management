// 后端代调 OpenAI（chat/completions）
// 配置优先级：DB（app_settings）> .env > 内置默认值
// admin 在「系统设置」里改的 Key/BaseURL/Model 立即生效（不用重启）

import { db } from './db.js'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

async function getOpenAIConfig() {
  const rows = await db('app_settings')
    .whereIn('key', ['openai_api_key', 'openai_base_url', 'openai_model_default'])
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    apiKey: m.openai_api_key || process.env.OPENAI_API_KEY || '',
    baseURL: (m.openai_base_url || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    defaultModel: m.openai_model_default || process.env.OPENAI_MODEL_DEFAULT || DEFAULT_MODEL,
  }
}

/** 调 chat/completions，返回 message.content 字符串 */
export async function chatCompletion({ system, user, model }) {
  const cfg = await getOpenAIConfig()
  if (!cfg.apiKey || cfg.apiKey === 'sk-replace-me') {
    throw new Error('未配置 OpenAI API Key（admin 请到「系统设置 → OpenAI 连接」填写）')
  }
  const apiKey = cfg.apiKey
  const baseURL = cfg.baseURL
  const useModel = model || cfg.defaultModel

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
