import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Loader2, AlertCircle } from 'lucide-react'

// pdfjs 的 worker：用 Vite 的 ?url 拿到打包后地址，一次性配置全局
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  /** 返回 PDF blob URL 的加载函数（调用方负责鉴权）。组件会在卸载时 revoke。 */
  loadUrl: () => Promise<string>
  /** 依赖变化时重新加载（如 approvalId） */
  reloadKey?: string
  /** 预览视口高度，默认 70vh */
  className?: string
}

export function PdfPreview({ loadUrl, reloadKey, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    let pdfDoc: import('pdfjs-dist').PDFDocumentProxy | null = null

    async function run() {
      setLoading(true)
      setError(null)
      setPageCount(0)
      const container = containerRef.current
      if (container) container.innerHTML = ''

      try {
        objectUrl = await loadUrl()
        if (cancelled) return
        pdfDoc = await pdfjsLib.getDocument(objectUrl).promise
        if (cancelled || !containerRef.current) return

        setPageCount(pdfDoc.numPages)
        // 以容器宽度为准计算缩放；devicePixelRatio 提升清晰度
        const dpr = window.devicePixelRatio || 1
        const containerWidth = containerRef.current.clientWidth || 800

        for (let n = 1; n <= pdfDoc.numPages; n++) {
          if (cancelled) return
          const page = await pdfDoc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const cssScale = (containerWidth - 4) / base.width
          const viewport = page.getViewport({ scale: cssScale * dpr })

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.style.display = 'block'
          canvas.className = 'mx-auto mb-3 rounded shadow-sm bg-white'
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          containerRef.current?.appendChild(canvas)
          await page.render({ canvas, canvasContext: ctx, viewport }).promise
        }
        if (!cancelled) setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '预览加载失败')
          setLoading(false)
        }
      }
    }
    run()

    return () => {
      cancelled = true
      if (pdfDoc) pdfDoc.destroy().catch(() => {})
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [loadUrl, reloadKey])

  return (
    <div className={className ?? 'relative max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-100 p-2'}>
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-100/80 text-sm text-slate-500">
          <Loader2 size={22} className="animate-spin" />
          <span>正在生成预览…（Word 首次转换需几秒）</span>
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-red-600">
          <AlertCircle size={22} />
          <span>{error}</span>
        </div>
      )}
      <div ref={containerRef} />
      {!loading && !error && pageCount > 0 && (
        <p className="py-1 text-center text-[11px] text-slate-400">共 {pageCount} 页</p>
      )}
    </div>
  )
}
