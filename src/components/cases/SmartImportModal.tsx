import { useRef, useState } from 'react'
import { UploadCloud, Sparkles, AlertCircle, X, FileText } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useCaseStore } from '@/store/useCaseStore'
import { casesApi } from '@/api/cases'
import { ApiError } from '@/api/client'
import { cn } from '@/utils/helpers'

type OurRole = 'plaintiff' | 'defendant'

// v2.0：模型/API Key 由平台超管在「平台设置」里配，业务用户不在这里选模型
const SUPPORTED_EXT = ['.pdf', '.docx', '.doc']
function detectFileKind(file: File): 'pdf' | 'docx' | 'unsupported' {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.docx') || name.endsWith('.doc')) return 'docx'
  return 'unsupported'
}

interface Props {
  open: boolean
  onClose: () => void
  /** 兼容历史 prop，v2.0 不再使用 */
  onOpenSettings?: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SmartImportModal({ open, onClose }: Props) {
  const { openFormWithPrefill } = useCaseStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [ourRole, setOurRole] = useState<OurRole | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  function reset() {
    setFiles([])
    setError(undefined)
    setLoading(false)
    setDragging(false)
    setOurRole(null)
  }

  function handleClose() {
    if (loading) return
    onClose()
    setTimeout(reset, 300)
  }

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming)
    const supported: File[] = []
    const rejected: string[] = []
    for (const f of arr) {
      if (detectFileKind(f) === 'unsupported') rejected.push(f.name)
      else supported.push(f)
    }
    // Dedup by name + size
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}_${f.size}`))
      const merged = [...prev]
      for (const f of supported) {
        const key = `${f.name}_${f.size}`
        if (!seen.has(key)) {
          merged.push(f)
          seen.add(key)
        }
      }
      return merged
    })
    if (rejected.length > 0) {
      setError(`已忽略不支持的文件：${rejected.join('、')}（仅支持 PDF / Word）`)
    } else {
      setError(undefined)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleExtract() {
    if (!ourRole) {
      setError('请先选择我方在本案中的身份')
      return
    }
    if (files.length === 0) return
    setError(undefined)
    setLoading(true)
    try {
      const { data } = await casesApi.aiExtract(files, ourRole)
      // Hand off to CaseFormDrawer for user review
      openFormWithPrefill(data)
      onClose()
      setTimeout(reset, 300)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }

  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  return (
    <Modal open={open} onClose={handleClose} title="案件材料智能录入">
      <div className="w-[560px] space-y-4">
        <p className="text-sm text-slate-600">
          上传一个案件的相关材料（PDF / Word），AI 将自动综合提取案件信息，结果可在下一步手动核对后入库。
        </p>

        {/* Our role selector */}
        <div>
          <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-600">
            我方身份 <span className="text-red-400">*</span>
            <span className="ml-1 text-[11px] font-normal text-slate-400">
              （告诉 AI 哪一方是我方，以便正确区分 ourParty / opposingParty）
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'plaintiff', label: '原告 / 申请人', desc: '起诉或申请仲裁的一方' },
              { value: 'defendant', label: '被告 / 被申请人', desc: '被起诉或被申请的一方' },
            ] as { value: OurRole; label: string; desc: string }[]).map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors',
                  ourRole === opt.value
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-slate-200 hover:bg-slate-50',
                  loading && 'pointer-events-none opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="ourRole"
                  value={opt.value}
                  checked={ourRole === opt.value}
                  onChange={() => setOurRole(opt.value)}
                  className="mt-0.5"
                  disabled={loading}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700">{opt.label}</p>
                  <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* v2.0: 模型由平台超管在「平台设置」统一管理，此处不暴露 */}

        {/* Drop zone */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">案件材料</label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !loading && fileInputRef.current?.click()}
            className={cn(
              'rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer',
              dragging
                ? 'border-primary-400 bg-primary-50'
                : 'border-slate-200 hover:border-primary-400 hover:bg-primary-50/50',
              loading && 'pointer-events-none opacity-50',
            )}
          >
            <UploadCloud size={28} className="mx-auto mb-2 text-slate-400" />
            <p className="text-sm font-medium text-slate-600">
              拖拽文件到此处，或点击选择
            </p>
            <p className="mt-1 text-xs text-slate-400">
              支持多选 · PDF / Word（.pdf、.docx、.doc）
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs text-slate-500 border-b border-slate-200">
              <span>
                已选 <strong className="text-slate-700">{files.length}</strong> 个文件 · 共 {formatSize(totalSize)}
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setFiles([])}
                disabled={loading}
              >
                清空
              </button>
            </div>
            <div className="max-h-[180px] overflow-y-auto divide-y divide-slate-100">
              {files.map((f, idx) => {
                const kind = detectFileKind(f)
                return (
                  <div key={`${f.name}_${f.size}_${idx}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <FileText size={14} className={cn(
                      'shrink-0',
                      kind === 'pdf' ? 'text-red-400' : 'text-blue-400',
                    )} />
                    <span className="flex-1 truncate text-slate-700">{f.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{formatSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      disabled={loading}
                      className="shrink-0 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30"
                      title="移除"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <p className="text-[11px] text-slate-400">
            {loading ? 'AI 正在分析材料，请稍候…' : '提取完成后将跳转到案件表单供你核对'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={handleClose} disabled={loading}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Sparkles size={14} />}
              onClick={handleExtract}
              loading={loading}
              disabled={!ourRole || files.length === 0 || loading}
            >
              开始识别
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
