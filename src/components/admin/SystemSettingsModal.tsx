import { useEffect, useRef, useState } from 'react'
import { Save, AlertCircle, CheckCircle2, Plug, Eye, EyeOff, Workflow, FileText, BookText, Upload, Download, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settings'
import { contractTemplatesApi, type TemplateFileInfo } from '@/api/contractTemplates'

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

  // 合同模板库：指引（模板说明.md）+ 模板文件清单
  const [tplManifest, setTplManifest] = useState('')
  const [originalTplManifest, setOriginalTplManifest] = useState('')
  const [tplFiles, setTplFiles] = useState<TemplateFileInfo[]>([])
  const [savingManifest, setSavingManifest] = useState(false)
  const [uploadingTpl, setUploadingTpl] = useState(false)
  const tplInputRef = useRef<HTMLInputElement>(null)

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
      await loadTemplates()
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadTemplates() {
    const { manifest, files } = await contractTemplatesApi.load()
    setTplManifest(manifest)
    setOriginalTplManifest(manifest)
    setTplFiles(files)
  }

  async function saveManifest() {
    setSavingManifest(true)
    setError(null)
    try {
      await contractTemplatesApi.saveManifest(tplManifest)
      setOriginalTplManifest(tplManifest)
      setFlash('模板指引已保存，下次起草选模板时生效')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingManifest(false)
    }
  }

  async function uploadTemplate(file: File) {
    setUploadingTpl(true)
    setError(null)
    try {
      const { filename } = await contractTemplatesApi.uploadFile(file)
      const replaced = tplFiles.some((f) => f.name === filename)
      await loadTemplates()
      setFlash(replaced ? `模板「${filename}」已替换` : `模板「${filename}」已上传`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploadingTpl(false)
      if (tplInputRef.current) tplInputRef.current.value = ''
    }
  }

  async function deleteTemplate(name: string) {
    if (!window.confirm(`确定删除模板「${name}」？删除后起草将不再使用它，且不可恢复。`)) return
    setError(null)
    try {
      await contractTemplatesApi.deleteFile(name)
      await loadTemplates()
      setFlash(`模板「${name}」已删除`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
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

        {/* 合同模板库：指引（模板说明.md）+ 模板文件 */}
        <section className="space-y-3 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <BookText size={14} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-800">合同模板库（起草用）</h4>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            合同起草时，AI 会先读「模板指引」判断该用哪个模板，再套用对应的 Word 模板生成草稿。指引与模板跨公司共享，改完即时生效。
          </p>

          {/* 模板指引（模板说明.md） */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              模板指引（模板说明.md）
              <span className="ml-2 text-[10px] text-slate-400">描述每个模板的适用场景，供 AI 选模板</span>
            </label>
            <textarea
              className="form-textarea font-mono text-xs"
              rows={8}
              value={tplManifest}
              disabled={loading}
              onChange={(e) => setTplManifest(e.target.value)}
              placeholder="例：&#10;## 矿产品购销合同_卖方出厂交货模板.docx&#10;适用：我方作为卖方、在出厂地交货的矿产品购销。&#10;..."
            />
            <div className="mt-1 flex justify-end">
              <Button
                variant="primary"
                size="md"
                icon={<Save size={14} />}
                loading={savingManifest}
                disabled={tplManifest === originalTplManifest}
                onClick={saveManifest}
              >
                保存指引
              </Button>
            </div>
          </div>

          {/* 模板文件列表 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-600">
                模板文件（仅 Word .docx / .doc）
              </label>
              <Button
                variant="secondary"
                size="sm"
                icon={<Upload size={13} />}
                loading={uploadingTpl}
                disabled={loading}
                onClick={() => tplInputRef.current?.click()}
              >
                上传模板
              </Button>
              <input
                ref={tplInputRef}
                type="file"
                accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadTemplate(f)
                }}
              />
            </div>
            {tplFiles.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-3 py-3 text-xs text-slate-400 text-center">
                暂无模板，点「上传模板」添加。无模板时起草将由 AI 自行拟稿。
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {tplFiles.map((f) => (
                  <li key={f.name} className="flex items-center gap-2 px-3 py-2">
                    <FileText size={14} className="shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{f.name}</p>
                      <p className="text-[11px] text-slate-400">{fmtSize(f.sizeBytes)} · {new Date(f.updatedAt).toLocaleString('zh-CN')}</p>
                    </div>
                    <button
                      type="button"
                      title="下载"
                      className="p-1.5 text-slate-400 hover:text-primary-600"
                      onClick={() => void contractTemplatesApi.downloadFile(f.name)}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      type="button"
                      title="删除"
                      className="p-1.5 text-slate-400 hover:text-red-600"
                      onClick={() => void deleteTemplate(f.name)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              上传同名文件会替换原模板；改模板内容请下载、本地编辑后重新上传。
            </p>
          </div>
        </section>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Modal>
  )
}

function fmtSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  )
}
