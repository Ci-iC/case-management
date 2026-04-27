import { useRef, useState } from 'react'
import { Upload, AlertCircle, CheckCircle2, FileText } from 'lucide-react'
import { useCaseStore } from '@/store/useCaseStore'
import { parseCasesFromText } from '@/utils/importExport'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { CaseRecord } from '@/types'
import { cn } from '@/utils/helpers'

interface Props {
  open: boolean
  onClose: () => void
}

type ImportMode = 'append' | 'replace' | 'renumber'
type Step = 'select' | 'preview' | 'done'

export function ImportModal({ open, onClose }: Props) {
  const { importCases } = useCaseStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('select')
  const [mode, setMode] = useState<ImportMode>('append')
  const [parsedCases, setParsedCases] = useState<CaseRecord[]>([])
  const [exportDate, setExportDate] = useState<string | undefined>()
  const [parseError, setParseError] = useState<string | undefined>()
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  function handleClose() {
    onClose()
    // Reset state after animation
    setTimeout(() => {
      setStep('select')
      setMode('append')
      setParsedCases([])
      setParseError(undefined)
      setFileName('')
      setResult(null)
    }, 300)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError(undefined)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const { cases, exportDate: date, error } = parseCasesFromText(text)
      if (error) {
        setParseError(error)
        setParsedCases([])
      } else {
        setParsedCases(cases)
        setExportDate(date)
        setStep('preview')
      }
    }
    reader.readAsText(file, 'utf-8')
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  async function handleConfirm() {
    try {
      const res = await importCases(parsedCases, mode)
      setResult(res)
      setStep('done')
    } catch (e) {
      setParseError(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="导入案件数据">
      <div className="w-[480px]">
        {/* Step: select file */}
        {step === 'select' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              请选择由本系统导出的 <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.txt</code> 文件，系统将解析并导入其中的案件数据。
            </p>

            {/* Drop zone */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'w-full rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                'border-slate-200 hover:border-primary-400 hover:bg-primary-50',
              )}
            >
              <Upload size={28} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-medium text-slate-600">点击选择文件</p>
              <p className="mt-1 text-xs text-slate-400">支持导出的 .txt 格式文件</p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={handleFileChange}
            />

            {parseError && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="secondary" size="md" onClick={handleClose}>取消</Button>
            </div>
          </div>
        )}

        {/* Step: preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* File info */}
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
              <FileText size={15} className="text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700 truncate">{fileName}</p>
                {exportDate && (
                  <p className="text-xs text-slate-400">导出日期：{exportDate}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-semibold text-primary-700">
                {parsedCases.length} 件
              </span>
            </div>

            {/* Case preview list */}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 border-b border-slate-200">
                将导入的案件（最多显示前 10 条）
              </div>
              <div className="max-h-[180px] overflow-y-auto divide-y divide-slate-100">
                {parsedCases.slice(0, 10).map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-slate-500 shrink-0 mr-2">{c.caseNumber}</span>
                    <span className="text-slate-700 truncate">{c.caseName}</span>
                  </div>
                ))}
                {parsedCases.length > 10 && (
                  <div className="px-3 py-2 text-center text-xs text-slate-400">
                    …还有 {parsedCases.length - 10} 件
                  </div>
                )}
              </div>
            </div>

            {/* Import mode */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">导入方式</p>
              <label className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                mode === 'append' ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:bg-slate-50',
              )}>
                <input
                  type="radio"
                  name="importMode"
                  value="append"
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700">追加新案件</p>
                  <p className="text-xs text-slate-500">仅导入案件编号不重复的案件，已有数据不受影响</p>
                </div>
              </label>
              <label className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                mode === 'renumber' ? 'border-primary-400 bg-primary-50' : 'border-slate-200 hover:bg-slate-50',
              )}>
                <input
                  type="radio"
                  name="importMode"
                  value="renumber"
                  checked={mode === 'renumber'}
                  onChange={() => setMode('renumber')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700">覆盖原编号并全部导入</p>
                  <p className="text-xs text-slate-500">忽略原有案件编号，自动赋予暂时01、暂时02…临时编号，全部追加导入</p>
                </div>
              </label>
              <label className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors',
                mode === 'replace' ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:bg-slate-50',
              )}>
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700">覆盖全部数据</p>
                  <p className="text-xs text-red-500">将删除当前所有案件并替换为文件中的数据，此操作不可撤销</p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-600"
                onClick={() => { setStep('select'); setParsedCases([]); setFileName('') }}
              >
                重新选择文件
              </button>
              <div className="flex gap-2">
                <Button variant="secondary" size="md" onClick={handleClose}>取消</Button>
                <Button
                  variant={mode === 'replace' ? 'danger' : 'primary'}
                  size="md"
                  onClick={handleConfirm}
                >
                  确认导入
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && result && (
          <div className="space-y-4 text-center py-2">
            <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
            <div>
              <p className="text-base font-semibold text-slate-800">导入完成</p>
              <p className="mt-1 text-sm text-slate-500">
                成功导入 <strong className="text-emerald-600">{result.imported}</strong> 件
                {result.skipped > 0 && (
                  <span>，跳过重复 <strong className="text-amber-600">{result.skipped}</strong> 件</span>
                )}
              </p>
            </div>
            <Button variant="primary" size="md" onClick={handleClose}>完成</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
