import { useEffect, useState } from 'react'
import { Save, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { settingsApi } from '@/api/settings'

interface Props {
  open: boolean
  onClose: () => void
}

const REVIEW_PROMPT_KEY = 'review_prompt'

export function SystemSettingsModal({ open, onClose }: Props) {
  const [reviewPrompt, setReviewPrompt] = useState('')
  const [originalPrompt, setOriginalPrompt] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { setting } = await settingsApi.get(REVIEW_PROMPT_KEY)
      setReviewPrompt(setting.value)
      setOriginalPrompt(setting.value)
      setUpdatedAt(setting.updatedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) load() }, [open])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(t)
  }, [flash])

  const dirty = reviewPrompt !== originalPrompt

  async function onSave() {
    if (!reviewPrompt.trim()) { setError('提示词不能为空'); return }
    setSaving(true)
    setError(null)
    try {
      const { setting } = await settingsApi.update(REVIEW_PROMPT_KEY, reviewPrompt)
      setOriginalPrompt(setting.value)
      setUpdatedAt(setting.updatedAt)
      setFlash('已保存，下次审核立即生效')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="系统设置">
      <div className="w-[720px] space-y-4">
        {flash && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 size={14} /> {flash}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* AI 审核提示词 */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary-600" />
            <h4 className="text-sm font-semibold text-slate-800">AI 审核提示词</h4>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            发起合同审核时，AI 会按这段提示词产出审核意见。修改后下一次审核立即生效，无需重启服务。
          </p>
          <textarea
            className="form-textarea font-mono text-xs"
            rows={16}
            disabled={loading}
            value={reviewPrompt}
            onChange={(e) => setReviewPrompt(e.target.value)}
            placeholder={loading ? '加载中…' : ''}
          />
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              {updatedAt ? `上次更新：${new Date(updatedAt).toLocaleString('zh-CN')}` : ''}
              {' '}· {reviewPrompt.length} 字
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                disabled={!dirty || saving}
                onClick={() => setReviewPrompt(originalPrompt)}
              >
                重置
              </Button>
              <Button
                variant="primary"
                size="md"
                icon={<Save size={14} />}
                loading={saving}
                disabled={!dirty}
                onClick={onSave}
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
