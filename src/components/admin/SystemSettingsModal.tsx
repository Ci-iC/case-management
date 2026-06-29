import { useEffect, useState } from 'react'
import { Save, AlertCircle, CheckCircle2, Plug, Eye, EyeOff, Workflow, FileText, Mail, Send } from 'lucide-react'
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
// 邮件通知配置 key
const EMAIL_ENABLED = 'email_enabled'
const EMAIL_FROM = 'email_from'
const SMTP_HOST = 'smtp_host'
const SMTP_PORT = 'smtp_port'
const SMTP_AUTH_CODE = 'smtp_auth_code'
const APP_BASE_URL = 'app_base_url'

interface EmailForm {
  enabled: boolean
  from: string
  host: string
  port: string
  baseUrl: string
  authCode: string        // 仅在用户输入新值时有内容
  authCodeDirty: boolean
  authCodeIsSet: boolean
}

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

  // 邮件通知配置
  const [email, setEmail] = useState<EmailForm>({
    enabled: false, from: '', host: '', port: '', baseUrl: '',
    authCode: '', authCodeDirty: false, authCodeIsSet: false,
  })
  const [originalEmail, setOriginalEmail] = useState<EmailForm | null>(null)
  const [savingEmail, setSavingEmail] = useState(false)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

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
      const ef: EmailForm = {
        enabled: m[EMAIL_ENABLED]?.value === '1',
        from: m[EMAIL_FROM]?.value || '',
        host: m[SMTP_HOST]?.value || '',
        port: m[SMTP_PORT]?.value || '',
        baseUrl: m[APP_BASE_URL]?.value || '',
        authCode: '',
        authCodeDirty: false,
        authCodeIsSet: !!m[SMTP_AUTH_CODE]?.isSet,
      }
      setEmail(ef)
      setOriginalEmail(ef)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const emailDirty = !!originalEmail && (
    email.enabled !== originalEmail.enabled ||
    email.from !== originalEmail.from ||
    email.host !== originalEmail.host ||
    email.port !== originalEmail.port ||
    email.baseUrl !== originalEmail.baseUrl ||
    email.authCodeDirty
  )

  async function saveEmail() {
    setSavingEmail(true)
    setError(null)
    try {
      if (!originalEmail || email.enabled !== originalEmail.enabled) {
        await settingsApi.update(EMAIL_ENABLED, email.enabled ? '1' : '0')
      }
      if (!originalEmail || email.from !== originalEmail.from) await settingsApi.update(EMAIL_FROM, email.from.trim())
      if (!originalEmail || email.host !== originalEmail.host) await settingsApi.update(SMTP_HOST, email.host.trim())
      if (!originalEmail || email.port !== originalEmail.port) await settingsApi.update(SMTP_PORT, email.port.trim())
      if (!originalEmail || email.baseUrl !== originalEmail.baseUrl) await settingsApi.update(APP_BASE_URL, email.baseUrl.trim())
      // 授权码：仅在用户输入了新值时提交（提交明文，后端 AES 加密入库）
      if (email.authCodeDirty && email.authCode) await settingsApi.update(SMTP_AUTH_CODE, email.authCode)
      setFlash('邮件配置已保存')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingEmail(false)
    }
  }

  async function sendTestEmail() {
    if (!testEmailTo.trim()) { setError('请填写测试收件地址'); return }
    if (emailDirty) { setError('请先保存邮件配置，再发送测试'); return }
    setSendingTest(true)
    setError(null)
    try {
      const res = await settingsApi.testEmail(testEmailTo.trim())
      setFlash(res.message || '测试邮件已发送')
    } catch (e) {
      setError(`测试邮件发送失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSendingTest(false)
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
      <div className="w-[640px] max-h-[calc(100vh-9rem)] space-y-4 overflow-y-auto pr-1">
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

        {/* 邮件通知配置 */}
        <section className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <Mail size={14} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-800">邮件通知配置</h4>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={email.enabled}
                disabled={loading}
                onChange={(e) => setEmail(s => ({ ...s, enabled: e.target.checked }))}
              />
              启用邮件通知
            </label>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            开启后，用户收到站内信时若填写了通知邮箱且未关闭个人开关，系统会异步发送邮件提醒（失败不影响站内信）。授权码加密存储，保存后不回显。
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="发信邮箱">
              <input type="text" className="form-input" disabled={loading}
                value={email.from} placeholder="globalx_notice@163.com"
                onChange={(e) => setEmail(s => ({ ...s, from: e.target.value }))} />
            </Field>
            <Field label="系统访问域名">
              <input type="text" className="form-input" disabled={loading}
                value={email.baseUrl} placeholder="https://legal.globalxpharma.studio"
                onChange={(e) => setEmail(s => ({ ...s, baseUrl: e.target.value }))} />
            </Field>
            <Field label="SMTP 服务器">
              <input type="text" className="form-input" disabled={loading}
                value={email.host} placeholder="smtp.163.com"
                onChange={(e) => setEmail(s => ({ ...s, host: e.target.value }))} />
            </Field>
            <Field label="端口">
              <input type="text" className="form-input" disabled={loading}
                value={email.port} placeholder="465"
                onChange={(e) => setEmail(s => ({ ...s, port: e.target.value }))} />
              <p className="mt-1 text-[11px] text-slate-400">
                465 / 994 为 SSL，587 / 25 为 STARTTLS。若 465 发不出（部分网络会封），163 可改用 994。
              </p>
            </Field>
          </div>

          <Field label="SMTP 授权码">
            <input
              type="password" className="form-input" disabled={loading}
              value={email.authCode}
              placeholder={email.authCodeIsSet ? '已配置（输入新值以替换）' : '请输入邮箱 SMTP 授权码'}
              onChange={(e) => setEmail(s => ({ ...s, authCode: e.target.value, authCodeDirty: true }))}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {email.authCodeIsSet ? '✓ 已配置（不回显明文）。' : '未配置。'}加密存储，不会出现在数据库明文或代码中。
            </p>
          </Field>

          <div className="flex justify-end">
            <Button variant="primary" size="md" icon={<Save size={14} />}
              loading={savingEmail} disabled={!emailDirty} onClick={saveEmail}>
              保存邮件配置
            </Button>
          </div>

          {/* 发送测试邮件 */}
          <div className="rounded-md border border-dashed border-slate-200 p-3">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">发送测试邮件</label>
            <div className="flex gap-2">
              <input type="text" className="form-input flex-1" disabled={loading || sendingTest}
                value={testEmailTo} placeholder="填入测试收件地址，如 you@example.com"
                onChange={(e) => setTestEmailTo(e.target.value)} />
              <Button variant="secondary" size="md" icon={<Send size={14} />}
                loading={sendingTest} onClick={sendTestEmail}>
                发送
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">用当前已保存的配置发送一封测试邮件，验证是否正确（测试不受"启用开关"限制）。</p>
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
