import { useEffect, useRef, useState } from 'react'
import { Send, Upload, FileText, Download, Sparkles, PenLine, Loader2, FileSignature } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/api/client'
import { draftApi, type DraftMessage, type GenerateResult } from '@/api/draft'
import { DraftFormModal, type DraftFormPayload } from '@/components/draft/DraftFormModal'

// 一条 UI 消息（比发给后端的多带展示用的元信息）
interface UiMsg {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'file' | 'result' | 'notice'   // notice 仅本地展示，不发给后端
  content: string                                 // 发给后端的内容
  filename?: string                               // kind=file 时的文件名
  result?: GenerateResult                         // kind=result 时的生成结果
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const STORAGE_KEY = 'draft-chat'
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// UI 消息 → 发给后端的对话历史（跳过本地 notice）
function toApiMessages(msgs: UiMsg[]): DraftMessage[] {
  return msgs
    .filter((m) => m.kind !== 'notice')
    .map((m) => ({ role: m.role, content: m.content }))
}

const WELCOME: UiMsg = {
  id: 'welcome',
  role: 'assistant',
  kind: 'notice',
  content: '',
}

export default function DraftPage() {
  const [msgs, setMsgs] = useState<UiMsg[]>([WELCOME])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [readyToDraft, setReadyToDraft] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const busy = sending || generating || uploading

  // 载入当天会话（隔天自动清空）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as { date: string; msgs: UiMsg[]; ready?: boolean }
        if (data.date === todayStr() && Array.isArray(data.msgs) && data.msgs.length) {
          setMsgs(data.msgs)
          setReadyToDraft(!!data.ready)
        } else {
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch { /* ignore */ }
  }, [])

  // 持久化（仅当天，刷新可恢复；隔天 / 关闭标签页清空）
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayStr(), msgs, ready: readyToDraft }))
    } catch { /* ignore */ }
  }, [msgs, readyToDraft])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, busy])

  // 跑一轮对话：基于最新消息列表请求 AI 回复
  async function runChat(nextMsgs: UiMsg[]) {
    setSending(true)
    setError(null)
    try {
      const res = await draftApi.chat(toApiMessages(nextMsgs))
      setMsgs((prev) => [...prev, { id: newId(), role: 'assistant', kind: 'text', content: res.reply }])
      setReadyToDraft(res.readyToDraft)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '对话失败'))
    } finally {
      setSending(false)
    }
  }

  async function sendText() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const userMsg: UiMsg = { id: newId(), role: 'user', kind: 'text', content: text }
    const next = [...msgs, userMsg]
    setMsgs(next)
    await runChat(next)
  }

  // 上传参考文件：抽取文本后作为 user 消息进入对话，再让 AI 继续
  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).slice(0, 5)
    if (files.length === 0 || busy) return
    setUploading(true)
    setError(null)
    const added: UiMsg[] = []
    try {
      for (const f of files) {
        const { filename, text } = await draftApi.upload(f)
        added.push({
          id: newId(),
          role: 'user',
          kind: 'file',
          filename,
          content: text
            ? `【参考文件：${filename}】\n${text}`
            : `【参考文件：${filename}】（未能提取到文本内容）`,
        })
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '上传失败'))
      if (added.length === 0) { setUploading(false); return }
    }
    const next = [...msgs, ...added]
    setMsgs(next)
    setUploading(false)
    await runChat(next)
  }

  // 表单提交：拼好的字段文本 + 补充材料一起进对话
  async function handleFormSubmit(payload: DraftFormPayload) {
    setFormOpen(false)
    const added: UiMsg[] = [{ id: newId(), role: 'user', kind: 'text', content: payload.text }]
    if (payload.files.length > 0) {
      setUploading(true)
      try {
        for (const f of payload.files) {
          const { filename, text } = await draftApi.upload(f)
          added.push({
            id: newId(), role: 'user', kind: 'file', filename,
            content: text ? `【参考文件：${filename}】\n${text}` : `【参考文件：${filename}】（未能提取到文本内容）`,
          })
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '材料上传失败')
      } finally {
        setUploading(false)
      }
    }
    const next = [...msgs, ...added]
    setMsgs(next)
    await runChat(next)
  }

  async function handleGenerate() {
    if (generating || sending) return
    const apiMsgs = toApiMessages(msgs)
    if (apiMsgs.length === 0) return
    setGenerating(true)
    setError(null)
    try {
      const result = await draftApi.generate(apiMsgs)
      setMsgs((prev) => [...prev, {
        id: newId(), role: 'assistant', kind: 'result',
        content: `已生成《${result.title}》草稿。`, result,
      }])
      setReadyToDraft(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '起草失败'))
    } finally {
      setGenerating(false)
    }
  }

  function clearAll() {
    setMsgs([WELCOME])
    setReadyToDraft(false)
    setError(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  async function downloadResult(r: GenerateResult) {
    try {
      await draftApi.download(r.downloadId, r.filename)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
            <FileSignature size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">合同起草</p>
            <p className="text-[11px] text-slate-400 leading-tight">和 AI 对话起草合同 · 当天对话不做长期存储</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clearAll} disabled={busy}>清空对话</Button>
      </div>

      {/* 消息区 */}
      <div
        className={cn('relative flex-1 overflow-y-auto px-4 py-5', dragOver && 'ring-2 ring-inset ring-primary-400 bg-primary-50/40')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {msgs.map((m) => (
            <MessageBubble key={m.id} msg={m} onDownload={downloadResult} />
          ))}
          {(sending || generating) && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={15} className="animate-spin" />
              {generating ? '正在起草合同，请稍候…' : 'AI 正在思考…'}
            </div>
          )}
          {dragOver && (
            <p className="text-center text-sm text-primary-600">松手上传参考文件</p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-slate-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-center gap-2">
            <Button
              variant="outline" size="sm" icon={<PenLine size={14} />}
              onClick={() => setFormOpen(true)} disabled={busy}
            >
              起草合同
            </Button>
            <Button
              variant={readyToDraft ? 'primary' : 'secondary'} size="sm"
              icon={<Sparkles size={14} />}
              onClick={handleGenerate}
              loading={generating}
              disabled={busy || toApiMessages(msgs).length === 0}
              className={readyToDraft ? 'animate-pulse' : ''}
            >
              开始起草
            </Button>
            {readyToDraft && <span className="text-xs text-emerald-600">信息已齐全，可以生成草稿了</span>}
          </div>

          <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/20">
            <input
              ref={fileRef} type="file" multiple accept=".doc,.docx,.txt" className="hidden"
              onChange={(e) => { handleFiles(e.target.files || []); if (fileRef.current) fileRef.current.value = '' }}
            />
            <button
              type="button" title="上传参考文件"
              onClick={() => fileRef.current?.click()} disabled={busy}
              className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 disabled:opacity-50"
            >
              <Upload size={18} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }}
              rows={1}
              placeholder="直接说『帮我起草一份采购合同』，或点左侧上传参考文件…"
              className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none"
            />
            <Button
              variant="primary" size="md" icon={<Send size={15} />}
              onClick={sendText} disabled={busy || !input.trim()}
            >
              发送
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Enter 发送，Shift+Enter 换行 · 支持拖拽上传 Word/txt</p>
        </div>
      </div>

      <DraftFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleFormSubmit} />
    </div>
  )
}

// ─── 单条消息气泡 ────────────────────────────────────────────────────────────────
function MessageBubble({ msg, onDownload }: { msg: UiMsg; onDownload: (r: GenerateResult) => void }) {
  const isUser = msg.role === 'user'

  // 欢迎语
  if (msg.kind === 'notice') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">👋 你好，我是合同起草助手</p>
        <p className="mt-1.5 leading-relaxed text-slate-500">
          你可以直接对我说「帮我起草一份采购合同」，我会一步步问你需要的信息；
          也可以点下方的「起草合同」按钮，先填好基本信息。随时可以上传参考文件，我会自动读取其中的内容。
        </p>
      </div>
    )
  }

  // 生成结果卡片（带下载）
  if (msg.kind === 'result' && msg.result) {
    const r = msg.result
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <Sparkles size={16} />
            <span className="text-sm font-semibold">合同草稿已生成</span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800">{r.title}</p>
          {r.templateUsed
            ? <p className="mt-0.5 text-[11px] text-slate-500">参考模板：{r.templateUsed}</p>
            : <p className="mt-0.5 text-[11px] text-slate-500">未匹配到模板，由 AI 自行起草</p>}
          <Button
            variant="primary" size="sm" icon={<Download size={14} />}
            className="mt-3" onClick={() => onDownload(r)}
          >
            下载 {r.filename}
          </Button>
          <p className="mt-2 text-[11px] text-slate-400">提示：草稿当天有效，请及时下载；如需调整可继续对话后重新生成。</p>
        </div>
      </div>
    )
  }

  // 文件消息
  if (msg.kind === 'file') {
    return (
      <div className="flex justify-end">
        <div className="flex items-center gap-2 rounded-2xl rounded-tr-sm bg-primary-600 px-3 py-2 text-white">
          <FileText size={15} />
          <span className="text-sm">{msg.filename}</span>
        </div>
      </div>
    )
  }

  // 普通文本
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-sm bg-primary-600 text-white'
            : 'rounded-tl-sm border border-slate-200 bg-white text-slate-700',
        )}
      >
        {msg.content}
      </div>
    </div>
  )
}
