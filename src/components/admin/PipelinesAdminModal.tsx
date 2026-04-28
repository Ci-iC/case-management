import { useEffect, useState } from 'react'
import {
  Plus, Trash2, ArrowUp, ArrowDown, Save, AlertCircle, CheckCircle2,
  Workflow, Star, GripVertical, Power,
} from 'lucide-react'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { pipelinesApi } from '@/api/pipelines'
import type { Pipeline } from '@/types'
import { cn } from '@/utils/helpers'

interface Props {
  open: boolean
  onClose: () => void
}

interface DraftStep {
  // 临时 id（仅前端用，提交时不发）
  key: string
  name: string
  prompt: string
  enabled: boolean
}

interface Draft {
  id: string | null  // null = 新建未保存
  name: string
  description: string
  isDefault: boolean
  steps: DraftStep[]
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: '',
  description: '',
  isDefault: false,
  steps: [{ key: 'k1', name: '', prompt: '', enabled: true }],
}

function pipelineToDraft(p: Pipeline): Draft {
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    isDefault: p.isDefault,
    steps: p.steps.map((s, i) => ({ key: s.id || `k${i}`, name: s.name, prompt: s.prompt, enabled: s.enabled })),
  }
}

export function PipelinesAdminModal({ open, onClose }: Props) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Pipeline | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { pipelines } = await pipelinesApi.list()
      setPipelines(pipelines)
      if (!selectedId && pipelines.length > 0) {
        const d = pipelines.find(p => p.isDefault) || pipelines[0]
        setSelectedId(d.id)
        setDraft(pipelineToDraft(d))
      } else if (selectedId) {
        const cur = pipelines.find(p => p.id === selectedId)
        if (cur) setDraft(pipelineToDraft(cur))
        else { setSelectedId(null); setDraft(null) }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open) load() }, [open])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [flash])

  function pickPipeline(p: Pipeline) {
    setSelectedId(p.id)
    setDraft(pipelineToDraft(p))
    setError(null)
  }

  function startNew() {
    setSelectedId(null)
    setDraft({
      ...EMPTY_DRAFT,
      steps: [{ key: `k${Date.now()}`, name: '', prompt: '', enabled: true }],
    })
    setError(null)
  }

  function addStep() {
    if (!draft) return
    setDraft({
      ...draft,
      steps: [...draft.steps, { key: `k${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, name: '', prompt: '', enabled: true }],
    })
  }

  function removeStep(idx: number) {
    if (!draft) return
    if (draft.steps.length <= 1) { setError('至少保留一个节点'); return }
    setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== idx) })
  }

  function moveStep(idx: number, dir: -1 | 1) {
    if (!draft) return
    const next = [...draft.steps]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setDraft({ ...draft, steps: next })
  }

  function patchStep(idx: number, patch: Partial<DraftStep>) {
    if (!draft) return
    setDraft({
      ...draft,
      steps: draft.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    })
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) { setError('请填写审核模型名称'); return }
    if (draft.steps.length === 0) { setError('至少添加一个节点'); return }
    for (let i = 0; i < draft.steps.length; i++) {
      const s = draft.steps[i]
      if (!s.name.trim()) { setError(`第 ${i + 1} 个节点：名称不能为空`); return }
      if (!s.prompt.trim()) { setError(`第 ${i + 1} 个节点：提示词不能为空`); return }
    }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        isDefault: draft.isDefault,
        steps: draft.steps.map(s => ({ name: s.name.trim(), prompt: s.prompt.trim(), enabled: s.enabled })),
      }
      if (draft.id) {
        const { pipeline } = await pipelinesApi.update(draft.id, payload)
        setFlash(`已保存「${pipeline.name}」`)
      } else {
        const { pipeline } = await pipelinesApi.create(payload)
        setSelectedId(pipeline.id)
        setFlash(`已创建「${pipeline.name}」`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!deleteConfirm) return
    try {
      await pipelinesApi.remove(deleteConfirm.id)
      setFlash(`已删除「${deleteConfirm.name}」`)
      if (selectedId === deleteConfirm.id) {
        setSelectedId(null)
        setDraft(null)
      }
      setDeleteConfirm(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
      setDeleteConfirm(null)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="AI 审核模型管理">
        <div className="w-[1080px] h-[640px] flex">
          {/* 左侧列表 */}
          <aside className="w-64 border-r border-slate-200 flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">审核模型</p>
              <Button variant="primary" size="sm" icon={<Plus size={11} />} onClick={startNew}>
                新建
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {loading && pipelines.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-6">加载中…</p>
              )}
              {pipelines.map(p => (
                <button
                  key={p.id}
                  onClick={() => pickPipeline(p)}
                  className={cn(
                    'w-full rounded px-2.5 py-2 text-left text-sm transition-colors',
                    selectedId === p.id
                      ? 'bg-primary-50 text-primary-700'
                      : 'hover:bg-slate-50 text-slate-700',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Workflow size={12} className={selectedId === p.id ? 'text-primary-600' : 'text-slate-400'} />
                    <span className="flex-1 truncate text-xs font-medium">{p.name}</span>
                    {p.isDefault && <Star size={10} className="text-amber-500 fill-amber-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{p.steps.length} 个节点</p>
                </button>
              ))}
              {!loading && draft && draft.id === null && (
                <div className="rounded px-2.5 py-2 bg-amber-50 text-xs">
                  <span className="font-medium text-amber-700">新建（未保存）</span>
                </div>
              )}
            </div>
          </aside>

          {/* 右侧编辑器 */}
          <section className="flex-1 flex flex-col overflow-hidden">
            {flash && (
              <div className="mx-4 mt-3 flex items-center gap-2 rounded bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700">
                <CheckCircle2 size={12} /> {flash}
              </div>
            )}
            {error && (
              <div className="mx-4 mt-3 flex items-start gap-2 rounded bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
              </div>
            )}

            {!draft ? (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <Workflow size={32} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm">选左侧审核模型编辑，或点"新建"</p>
                </div>
              </div>
            ) : (
              <>
                {/* 元信息 */}
                <div className="px-4 py-3 border-b border-slate-100 space-y-2.5">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">审核模型名称 *</label>
                      <input
                        className="form-input"
                        value={draft.name}
                        onChange={e => setDraft({ ...draft, name: e.target.value })}
                        placeholder="如：劳动合同审核"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer pb-1">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300"
                          checked={draft.isDefault}
                          onChange={e => setDraft({ ...draft, isDefault: e.target.checked })}
                        />
                        <Star size={12} className={draft.isDefault ? 'text-amber-500 fill-amber-400' : 'text-slate-300'} />
                        <span>设为默认审核模型</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 mb-1">描述</label>
                    <input
                      className="form-input"
                      value={draft.description}
                      onChange={e => setDraft({ ...draft, description: e.target.value })}
                      placeholder="什么场景下用、跟其他审核模型有什么区别"
                    />
                  </div>
                </div>

                {/* 节点列表 */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      并行节点（{draft.steps.length}）
                    </p>
                    <p className="text-[10px] text-slate-400">
                      所有启用的节点会同时调用 AI，输出按下方顺序拼接
                    </p>
                  </div>

                  {draft.steps.map((s, idx) => (
                    <div
                      key={s.key}
                      className={cn(
                        'rounded-lg border p-3',
                        s.enabled ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/60',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <GripVertical size={14} className="text-slate-300 shrink-0" />
                        <span className="text-[10px] font-mono text-slate-400 w-6 text-center shrink-0">#{idx + 1}</span>
                        <input
                          className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm font-medium focus:outline-none focus:border-primary-400"
                          value={s.name}
                          onChange={e => patchStep(idx, { name: e.target.value })}
                          placeholder="节点名称（如：风险扫描）"
                        />
                        <button
                          onClick={() => patchStep(idx, { enabled: !s.enabled })}
                          title={s.enabled ? '点击禁用此节点' : '点击启用此节点'}
                          className={cn(
                            'p-1.5 rounded',
                            s.enabled
                              ? 'text-emerald-600 hover:bg-emerald-50'
                              : 'text-slate-300 hover:bg-slate-100',
                          )}
                        >
                          <Power size={12} />
                        </button>
                        <button
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                          title="上移"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === draft.steps.length - 1}
                          className="p-1.5 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                          title="下移"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          onClick={() => removeStep(idx)}
                          disabled={draft.steps.length <= 1}
                          className="p-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                          title="删除节点"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <textarea
                        className={cn(
                          'w-full rounded border border-slate-200 px-2 py-1.5 text-xs font-mono leading-relaxed focus:outline-none focus:border-primary-400 resize-none',
                          !s.enabled && 'opacity-60',
                        )}
                        rows={6}
                        value={s.prompt}
                        onChange={e => patchStep(idx, { prompt: e.target.value })}
                        placeholder="给这个节点的提示词。例如：你是劳动法专家，请只关注合同中关于薪酬、社保、加班费的条款，给出修改建议。"
                      />
                    </div>
                  ))}

                  <button
                    onClick={addStep}
                    className="w-full rounded-lg border-2 border-dashed border-slate-200 py-3 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                  >
                    <Plus size={12} className="inline mr-1" />
                    添加节点
                  </button>
                </div>

                {/* 底栏 */}
                <div className="border-t border-slate-100 px-4 py-2.5 flex items-center justify-between">
                  <div>
                    {draft.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={11} />}
                        onClick={() => {
                          const p = pipelines.find(x => x.id === draft.id)
                          if (p) setDeleteConfirm(p)
                        }}
                      >
                        删除审核模型
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
                    <Button
                      variant="primary"
                      size="md"
                      icon={<Save size={13} />}
                      loading={saving}
                      onClick={save}
                    >
                      {draft.id ? '保存修改' : '创建审核模型'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={doDelete}
        title="删除审核模型"
        confirmLabel="确认删除"
        confirmVariant="danger"
        message={
          <>
            确认删除审核模型「<strong>{deleteConfirm?.name}</strong>」？<br />
            该审核模型下的所有节点会一起删除。已用过这条审核模型的历史审核记录不受影响。
          </>
        }
      />
    </>
  )
}
