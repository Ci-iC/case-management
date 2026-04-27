import { useEffect, useState } from 'react'
import { Save, Sparkles, AlertCircle, CheckCircle2, Plug, Eye, EyeOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settings'

interface Props {
  open: boolean
  onClose: () => void
}

const REVIEW_PROMPT = 'review_prompt'
const OPENAI_API_KEY = 'openai_api_key'
const OPENAI_BASE_URL = 'openai_base_url'
const OPENAI_MODEL = 'openai_model_default'

interface OpenAIForm {
  apiKey: string
  apiKeyDisplay: string  // mask 后的，仅显示用
  apiKeyDirty: boolean   // 用户是否真的改过
  apiKeyIsSet: boolean
  baseURL: string
  model: string
}

export function SystemSettingsModal({ open, onClose }: Props) {
  // 提示词
  const [reviewPrompt, setReviewPrompt] = useState('')
  const [originalPrompt, setOriginalPrompt] = useState('')
  const [promptUpdatedAt, setPromptUpdatedAt] = useState<string | null>(null)

  // OpenAI 配置
  const [openai, setOpenai] = useState<OpenAIForm>({
    apiKey: '',
    apiKeyDisplay: '',
    apiKeyDirty: false,
    apiKeyIsSet: false,
    baseURL: '',
    model: '',
  })
  const [originalOpenai, setOriginalOpenai] = useState<OpenAIForm | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  const [loading, setLoading] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [savingOpenai, setSavingOpenai] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { settings } = await settingsApi.list()
      const m = Object.fromEntries(settings.map(s => [s.key, s]))

      const prompt = m[REVIEW_PROMPT]
      setReviewPrompt(prompt?.value || '')
      setOriginalPrompt(prompt?.value || '')
      setPromptUpdatedAt(prompt?.updatedAt || null)

      const ai: OpenAIForm = {
        apiKey: '',  // 永远不预填，用户必须重新输入才会改
        apiKeyDisplay: m[OPENAI_API_KEY]?.value || '',
        apiKeyDirty: false,
        apiKeyIsSet: !!m[OPENAI_API_KEY]?.isSet,
        baseURL: m[OPENAI_BASE_URL]?.value || '',
        model: m[OPENAI_MODEL]?.value || '',
      }
      setOpenai(ai)
      setOriginalOpenai(ai)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) load() }, [open])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])

  const promptDirty = reviewPrompt !== originalPrompt
  const openaiDirty = !!originalOpenai && (
    openai.apiKeyDirty ||
    openai.baseURL !== originalOpenai.baseURL ||
    openai.model !== originalOpenai.model
  )

  async function savePrompt() {
    if (!reviewPrompt.trim()) { setError('提示词不能为空'); return }
    setSavingPrompt(true)
    setError(null)
    try {
      const { setting } = await settingsApi.update(REVIEW_PROMPT, reviewPrompt)
      setOriginalPrompt(setting.value)
      setPromptUpdatedAt(setting.updatedAt)
      setFlash('提示词已保存，下次审核立即生效')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingPrompt(false)
    }
  }

  async function saveOpenAI() {
    setSavingOpenai(true)
    setError(null)
    try {
      // 只更新真改过的字段
      if (openai.apiKeyDirty) {
        await settingsApi.update(OPENAI_API_KEY, openai.apiKey)
      }
      if (!originalOpenai || openai.baseURL !== originalOpenai.baseURL) {
        await settingsApi.update(OPENAI_BASE_URL, openai.baseURL)
      }
      if (!originalOpenai || openai.model !== originalOpenai.model) {
        await settingsApi.update(OPENAI_MODEL, openai.model)
      }
      setFlash('OpenAI 配置已保存，下次审核立即生效')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingOpenai(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setError(null)
    try {
      // 如果有未保存的改动，先提示
      if (openaiDirty) {
        setError('请先保存当前修改再测试连通性')
        setTesting(false)
        return
      }
      await settingsApi.testOpenAI()
      setFlash('✓ 连接成功，AI 服务可用')
    } catch (e) {
      setError(`连接失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="系统设置">
      <div className="w-[760px] space-y-5">
        {flash && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 size={14} /> {flash}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs">关闭</button>
          </div>
        )}

        {/* OpenAI 连接配置 */}
        <section className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <Plug size={14} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-800">OpenAI 连接配置</h4>
            <span className="ml-auto text-[11px] text-slate-400">
              {openai.apiKeyIsSet ? '✓ Key 已配置' : '未配置'}
            </span>
          </div>

          <Field label="API Key">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  className="form-input pr-9"
                  disabled={loading}
                  value={openai.apiKey}
                  placeholder={openai.apiKeyIsSet ? `当前：${openai.apiKeyDisplay}（输入新值以替换）` : 'sk-...'}
                  onChange={(e) => setOpenai(s => ({ ...s, apiKey: e.target.value, apiKeyDirty: true }))}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  title={showApiKey ? '隐藏' : '显示'}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              提交后立即生效，不会重启服务。Key 只 admin 能查看，普通用户不可见。
            </p>
          </Field>

          <Field label="Base URL">
            <input
              type="text"
              className="form-input"
              disabled={loading}
              value={openai.baseURL}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => setOpenai(s => ({ ...s, baseURL: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              留空使用 OpenAI 官方地址。如走代理或用兼容服务（如 DeepSeek、Moonshot、Azure 兼容端点）填这里。
            </p>
          </Field>

          <Field label="默认模型">
            <input
              type="text"
              className="form-input"
              disabled={loading}
              value={openai.model}
              placeholder="gpt-4o-mini"
              onChange={(e) => setOpenai(s => ({ ...s, model: e.target.value }))}
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              size="md"
              icon={<Plug size={14} />}
              loading={testing}
              disabled={!openai.apiKeyIsSet && !openai.apiKeyDirty}
              onClick={testConnection}
            >
              测试连通性
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Save size={14} />}
              loading={savingOpenai}
              disabled={!openaiDirty}
              onClick={saveOpenAI}
            >
              保存
            </Button>
          </div>
        </section>

        {/* AI 审核提示词 */}
        <section className="space-y-2 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-800">AI 审核提示词</h4>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            发起合同审核时，AI 按这段提示词产出审核意见。下一步会扩展成可视化工作流（多节点串联）。
          </p>
          <textarea
            className="form-textarea font-mono text-xs"
            rows={12}
            disabled={loading}
            value={reviewPrompt}
            onChange={(e) => setReviewPrompt(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              {promptUpdatedAt ? `上次更新：${new Date(promptUpdatedAt).toLocaleString('zh-CN')}` : ''}
              {' '}· {reviewPrompt.length} 字
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="md"
                disabled={!promptDirty || savingPrompt}
                onClick={() => setReviewPrompt(originalPrompt)}
              >
                重置
              </Button>
              <Button
                variant="primary"
                size="md"
                icon={<Save size={14} />}
                loading={savingPrompt}
                disabled={!promptDirty}
                onClick={savePrompt}
              >
                保存
              </Button>
            </div>
          </div>
        </section>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}
