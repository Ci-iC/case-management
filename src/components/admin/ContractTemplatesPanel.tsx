import { useEffect, useRef, useState } from 'react'
import { Save, Upload, Download, Trash2, FileText, BookText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { contractTemplatesApi, type TemplateFileInfo } from '@/api/contractTemplates'

/**
 * 合同模板库（起草用）—— 超管侧栏独立 Tab。
 * 形式固定为「一个模板说明 + 若干合同模板文件」：
 *   - 查看：现有模板清单 + 模板说明
 *   - 编辑模板说明（模板说明.md）正文
 *   - 新增 / 删除 / 下载模板（同名上传即替换）
 * 后端已全部支持（/api/contract-templates），此处仅前端 UI。
 */
export function ContractTemplatesPanel() {
  const [manifest, setManifest] = useState('')
  const [originalManifest, setOriginalManifest] = useState('')
  const [files, setFiles] = useState<TemplateFileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [savingManifest, setSavingManifest] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { manifest, files } = await contractTemplatesApi.load()
      setManifest(manifest)
      setOriginalManifest(manifest)
      setFiles(files)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function reloadFiles() {
    const { manifest, files } = await contractTemplatesApi.load()
    setManifest(manifest)
    setOriginalManifest(manifest)
    setFiles(files)
  }

  async function saveManifest() {
    setSavingManifest(true)
    setError(null)
    try {
      await contractTemplatesApi.saveManifest(manifest)
      setOriginalManifest(manifest)
      setFlash('模板说明已保存，下次起草选模板时生效')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingManifest(false)
    }
  }

  async function uploadTemplate(file: File) {
    setUploading(true)
    setError(null)
    try {
      const { filename } = await contractTemplatesApi.uploadFile(file)
      const replaced = files.some((f) => f.name === filename)
      await reloadFiles()
      setFlash(replaced ? `模板「${filename}」已替换` : `模板「${filename}」已新增`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function deleteTemplate(name: string) {
    if (!window.confirm(`确定删除模板「${name}」？删除后起草将不再使用它，且不可恢复。`)) return
    setError(null)
    try {
      await contractTemplatesApi.deleteFile(name)
      await reloadFiles()
      setFlash(`模板「${name}」已删除`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4 flex items-center gap-2">
        <BookText size={18} className="text-primary-600" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900">合同模板</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            合同起草时，AI 先读「模板说明」判断该用哪个模板，再套用对应的 Word 模板生成草稿。说明与模板跨公司共享，改完即时生效。
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4">
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

        {/* 模板说明（模板说明.md） */}
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-primary-600" />
            <h3 className="text-sm font-semibold text-slate-800">模板说明</h3>
            <span className="ml-2 text-[11px] text-slate-400">描述每个模板的适用场景，供 AI 选模板</span>
          </div>
          <textarea
            className="form-textarea font-mono text-xs"
            rows={10}
            value={manifest}
            disabled={loading}
            onChange={(e) => setManifest(e.target.value)}
            placeholder={'例：\n## 矿产品购销合同_卖方出厂交货模板.docx\n适用：我方作为卖方、在出厂地交货的矿产品购销。\n...'}
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="md"
              icon={<Save size={14} />}
              loading={savingManifest}
              disabled={loading || manifest === originalManifest}
              onClick={saveManifest}
            >
              保存说明
            </Button>
          </div>
        </section>

        {/* 模板文件列表 */}
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookText size={14} className="text-primary-600" />
              <h3 className="text-sm font-semibold text-slate-800">模板文件</h3>
              <span className="ml-2 text-[11px] text-slate-400">仅 Word .docx / .doc</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={13} />}
              loading={uploading}
              disabled={loading}
              onClick={() => inputRef.current?.click()}
            >
              新增模板
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadTemplate(f)
              }}
            />
          </div>
          {files.length === 0 ? (
            <p className="rounded-md bg-slate-50 px-3 py-6 text-xs text-slate-400 text-center">
              {loading ? '加载中…' : '暂无模板，点「新增模板」添加。无模板时起草将由 AI 自行拟稿。'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {files.map((f) => (
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
          <p className="text-[11px] text-slate-400">
            上传同名文件会替换原模板；如需修改模板内容，请下载、本地编辑后重新上传同名文件。
          </p>
        </section>
      </div>
    </div>
  )
}

function fmtSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
