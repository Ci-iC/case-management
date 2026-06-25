import { useEffect, useRef, useState } from 'react'
import { Send, Loader2, Sparkles, FileSignature } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/api/client'
import { draftApi, type DraftMessage, type GenerateResult } from '@/api/draft'
import { cn } from '@/utils/helpers'

export interface DraftChatInitial {
  /** 表单拼好的基本信息（第一条 user 消息） */
  text: string
  /** 随表单上传的补充材料 */
  files: File[]
}

interface Props {
  open: boolean
  initial: DraftChatInitial | null
  onClose: () => void
  onGenerated: (result: GenerateResult) => void
}

/**
 * 起草引导对话：表单提交后，AI 先核对模板 + 已填信息，至少追问一轮，
 * 用户答复确认后再点【生成草稿】。template 在首轮由后端选定并回传，后续复用。
 */
export function DraftChatModal({ open, initial, onClose, onGenerated }: Props) {
  const [messages, setMessages] = useState<DraftMessage[]>([])
  const [templateFile, setTemplateFile] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [booting, setBooting] = useState(false)   // 首轮（上传+第一次追问）
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [readyToDraft, setReadyToDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const busy = booting || sending || generating

  useEffect(() => {
    if (open && initial && !startedRef.current) {
      startedRef.current = true
      void boot(initial)
    }
    if (!open) {
      // 关闭后复位，供下次打开
      startedRef.current = false
      setMessages([]); setTemplateFile(null); setInput(''); setReadyToDraft(false); setError(null)
    }
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function boot(init: DraftChatInitial) {
    setBooting(true); setError(null)
    try {
      // 1) 先上传补充材料，拼进首条消息
      let firstContent = init.text
      for (const f of init.files) {
        try {
          const { filename, text } = await draftApi.upload(f)
          firstContent += text ? `\n\n【参考文件：${filename}】\n${text}` : `\n\n【参考文件：${filename}】`
        } catch { /* 单个文件失败不阻断起草 */ }
      }
      const initialMsgs: DraftMessage[] = [{ role: 'user', content: firstContent }]
      // 2) 首轮引导：后端选模板 + 至少追问一轮
      const out = await draftApi.chat(initialMsgs)
      setTemplateFile(out.templateFile)
      setReadyToDraft(out.readyToDraft)
      setMessages([...initialMsgs, { role: 'assistant', content: out.reply }])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '起草引导失败，请重试')
    } finally {
      setBooting(false)
    }
  }

  async function send() {
    const t = input.trim()
    if (!t || busy) return
    setInput('')
    setError(null)
    const next = [...messages, { role: 'user' as const, content: t }]
    setMessages(next)
    setSending(true)
    try {
      const out = await draftApi.chat(next, templateFile)
      setReadyToDraft(out.readyToDraft)
      if (out.templateFile) setTemplateFile(out.templateFile)
      setMessages([...next, { role: 'assistant', content: out.reply }])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '对话失败，请重试')
    } finally {
      setSending(false)
    }
  }

  async function generate() {
    if (busy || messages.length === 0) return
    setGenerating(true)
    setError(null)
    try {
      const result = await draftApi.generate(messages, templateFile)
      onGenerated(result)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  // 首条 user 消息是表单拼的基本信息，对话区不重复展示，从第 2 条起渲染
  const shown = messages.slice(1)

  return (
    <Modal open={open} onClose={onClose} title="起草合同 · 信息确认">
      <div className="flex w-[600px] max-w-full flex-col" style={{ height: 'min(70vh, 560px)' }}>
        <div className="flex-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-3">
          {templateFile && (
            <p className="text-[11px] text-slate-500">
              已匹配模板：<span className="font-medium text-primary-700">{templateFile}</span>
            </p>
          )}
          {booting && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={15} className="animate-spin" /> AI 正在核对模板与你填写的信息…
            </div>
          )}
          {shown.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                m.role === 'user' ? 'rounded-tr-sm bg-primary-600 text-white' : 'rounded-tl-sm border border-slate-200 bg-white text-slate-700',
              )}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={15} className="animate-spin" /> AI 正在思考…
            </div>
          )}
          {readyToDraft && !booting && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600">
              <Sparkles size={13} /> 信息已齐全，可以点击下方【生成草稿】。
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            rows={1}
            disabled={booting || generating}
            placeholder="回答 AI 的问题，或补充其他要求；信息齐了点右侧【生成草稿】"
            className="max-h-32 flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50"
          />
          <Button variant="secondary" size="md" icon={sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            onClick={() => void send()} disabled={busy || !input.trim()}>
            回复
          </Button>
          <Button variant="primary" size="md" icon={generating ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
            onClick={() => void generate()} disabled={busy || messages.length === 0}>
            生成草稿
          </Button>
        </div>
      </div>
    </Modal>
  )
}
