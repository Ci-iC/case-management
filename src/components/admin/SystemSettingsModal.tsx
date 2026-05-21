import { useEffect, useState } from 'react'
import { Save, AlertCircle, CheckCircle2, Plug, Eye, EyeOff, Workflow, FileText } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settings'

interface Props {
  open: boolean
  onClose: () => void
}

const OPENAI_API_KEY = 'openai_api_key'
const OPENAI_BASE_URL = 'openai_base_url'
const OPENAI_MODEL = 'openai_model_default'
const CONTRACT_SUMMARY_PROMPT = 'contract_summary_prompt'

interface OpenAIForm {
  apiKey: string
  apiKeyDisplay: string  // mask 后的，仅显示用
  apiKeyDirty: boolean
  apiKeyIsSet: boolean
  baseURL: string
  model: string
}

export function SystemSettingsModal({ open, onClose }: Props) {
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

  // v1.3 合同审批 AI 摘要的 prompt
  const [summaryPrompt, setSummaryPrompt] = useState('')
  const [originalSummaryPrompt, setOriginalSummaryPrompt] = useState('')
  const [savingSummary, setSavingSummary] = useState(false)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { settings } = await settingsApi.list()
      const m = Object.fromEntries(settings.map(s => [s.key, s]))
      const ai: OpenAIForm = {
        apiKey: '',  // 永远不预填，用户输入新值才会触发更新
        apiKeyDisplay: m[OPENAI_API_KEY]?.value || '',
        apiKeyDirty: false,
        apiKeyIsSet: !!m[OPENAI_API_KEY]?.isSet,
        baseURL: m[OPENAI_BASE_URL]?.value || '',
        model: m[OPENAI_MODEL]?.value || '',
      }
      setOpenai(ai)
      setOriginalOpenai(ai)
      const sp = m[CONTRACT_SUMMARY_PROMPT]?.value || ''
      setSummaryPrompt(sp)
      setOriginalSummaryPrompt(sp)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function saveSummaryPrompt() {
    setSavingSummary(true)
    setError(null)
    try {
      await settingsApi.update(CONTRACT_SUMMARY_PROMPT, summaryPrompt)
      setFlash('合同摘要 prompt 已保存，下次发起审批生成摘要时生效')
      setOriginalSummaryPrompt(summaryPrompt)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingSummary(false)
    }
  }

  useEffect(() => { if (open) load() }, [open])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])

  const dirty = !!originalOpenai && (
    openai.apiKeyDirty ||
    openai.baseURL !== originalOpenai.baseURL ||
    openai.model !== originalOpenai.model
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
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
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setError(null)
    try {
      if (dirty) {
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
      <div className="w-[640px] space-y-4">
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
            <div className="relative">
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
              loading={saving}
              disabled={!dirty}
              onClick={save}
            >
              保存
            </Button>
          </div>
        </section>

        {/* 提示词管理跳转提示 */}
        <section className="rounded-lg border border-dashed border-slate-200 px-4 py-3 flex items-center gap-3 text-xs text-slate-500">
          <Workflow size={16} className="text-slate-400 shrink-0" />
          <p className="flex-1 leading-relaxed">
            AI 审核提示词已升级为「审核模型」管理 —— 一个模型由多个并行节点组成，每个节点有独立提示词。
            到侧栏「<span className="text-slate-700 font-medium">审核模型</span>」编辑。
          </p>
        </section>

        {/* v1.3 合同审批 AI 摘要 prompt */}
        <section className="space-y-2 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-800">合同审批 - AI 摘要 Prompt</h4>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            发起审批时调用 OpenAI 生成合同摘要的 system prompt。改完保存即时生效（下次发起审批时使用）。
          </p>
          <textarea
            className="form-textarea font-mono text-xs"
            rows={8}
            value={summaryPrompt}
            disabled={loading}
            onChange={(e) => setSummaryPrompt(e.target.value)}
            placeholder="请输入合同摘要 system prompt"
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="md"
              icon={<Save size={14} />}
              loading={savingSummary}
              disabled={summaryPrompt === originalSummaryPrompt}
              onClick={saveSummaryPrompt}
            >
              保存 Prompt
            </Button>
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
