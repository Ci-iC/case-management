import { useEffect, useState } from 'react'
import {
  Plus, Trash2, ArrowUp, ArrowDown, CheckCircle2, AlertCircle,
  Workflow, Edit3, ChevronRight, Power,
} from 'lucide-react'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/api/client'
import {
  companiesApi,
  type ApprovalTemplate,
  type ApprovalTemplateStepInput,
  type CompanyRoleInfo,
  APPROVAL_TEMPLATE_ROLE_LABEL,
} from '@/api/companies'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
  companyName: string
}

type View =
  | { kind: 'list' }
  | { kind: 'edit'; templateId: string | null; initialName: string; initialSteps: ApprovalTemplateStepInput[] }

/**
 * v2.1+ 平台超管面板：管理某家公司的审批流模板。
 *
 * 模板只定义中间步骤；首尾"经办人发起 / 经办人上传用印版"是固定节点不入库。
 * 每家公司同时只能有一条 active，激活某条会自动停用其他。
 * v2.1+: 角色下拉项动态从 listRoles 拉（含系统内置 + 自定义），过滤掉 staff。
 */
export function ApprovalTemplatesModal({ open, onClose, companyId, companyName }: Props) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [templates, setTemplates] = useState<ApprovalTemplate[]>([])
  const [availableRoles, setAvailableRoles] = useState<CompanyRoleInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ApprovalTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [{ templates }, { roles }] = await Promise.all([
        companiesApi.listTemplates(companyId),
        companiesApi.listRoles(companyId),
      ])
      setTemplates(templates)
      // 过滤掉 staff —— 经办人是首尾固定节点，不参与中间步骤
      setAvailableRoles(roles.filter(r => r.key !== 'staff'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载模板失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setView({ kind: 'list' })
    load()
  }, [open, companyId])

  async function onActivate(t: ApprovalTemplate) {
    if (t.isActive) return
    try {
      await companiesApi.activateTemplate(companyId, t.id)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '启用失败')
    }
  }

  async function onConfirmDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await companiesApi.deleteTemplate(companyId, confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败')
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const defaultRoleKey = availableRoles[0]?.key || 'legal'

  return (
    <Modal open={open} onClose={onClose} title={`审批流模板 · ${companyName}`}>
      <div className="w-[720px] max-w-full">
        {view.kind === 'list' && (
          <TemplateListView
            templates={templates}
            availableRoles={availableRoles}
            loading={loading}
            error={error}
            onCreate={() => setView({
              kind: 'edit', templateId: null,
              initialName: '', initialSteps: [{ role: defaultRoleKey }],
            })}
            onEdit={(t) => setView({
              kind: 'edit', templateId: t.id,
              initialName: t.name,
              initialSteps: t.steps.map(s => ({ role: s.role, stepLabel: s.stepLabel || undefined })),
            })}
            onActivate={onActivate}
            onDelete={setConfirmDelete}
          />
        )}

        {view.kind === 'edit' && (
          <TemplateEditView
            companyId={companyId}
            templateId={view.templateId}
            initialName={view.initialName}
            initialSteps={view.initialSteps}
            availableRoles={availableRoles}
            isFirstTemplate={view.templateId === null && templates.length === 0}
            onCancel={() => setView({ kind: 'list' })}
            onSaved={() => { setView({ kind: 'list' }); load() }}
          />
        )}
      </div>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={onConfirmDelete}
        title="删除模板"
        message={`确认删除「${confirmDelete?.name}」？该操作不可撤销。`}
        confirmLabel="删除"
        confirmVariant="danger"
        loading={deleting}
      />
    </Modal>
  )
}

// ─── 列表 View ──────────────────────────────────────────────────────────────

function TemplateListView({
  templates, availableRoles, loading, error,
  onCreate, onEdit, onActivate, onDelete,
}: {
  templates: ApprovalTemplate[]
  availableRoles: CompanyRoleInfo[]
  loading: boolean
  error: string | null
  onCreate: () => void
  onEdit: (t: ApprovalTemplate) => void
  onActivate: (t: ApprovalTemplate) => void
  onDelete: (t: ApprovalTemplate) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-slate-500 leading-relaxed flex-1">
          模板定义经办人发起后到上传用印版前的中间步骤。<br />
          完整流程：<span className="text-slate-700">经办人发起 → 模板步骤 → 经办人上传用印版</span>。
          同公司同时只允许一条模板生效。
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onCreate}>
          新建模板
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {loading && (
          <div className="text-center py-8 text-slate-400 text-xs">加载中…</div>
        )}
        {!loading && templates.length === 0 && (
          <div className="text-center py-10 text-slate-400 text-sm">
            <Workflow size={28} className="mx-auto text-slate-300 mb-2" />
            <p>还没有模板，点右上角"新建模板"开始配置</p>
            <p className="text-[11px] text-slate-400 mt-1">该公司的经办人需要在配置模板后才能发起审批</p>
          </div>
        )}
        {!loading && templates.map((t) => (
          <div key={t.id} className="border-b last:border-b-0 border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900 truncate">{t.name}</span>
                  {t.isActive
                    ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 size={10} /> 生效中
                      </span>
                    : <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500">未启用</span>
                  }
                </div>
                <StepFlowPreview steps={t.steps} availableRoles={availableRoles} />
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {!t.isActive && (
                  <button
                    onClick={() => onActivate(t)}
                    className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded hover:bg-emerald-50"
                    title="启用并停用其他模板"
                  >
                    <Power size={12} />启用
                  </button>
                )}
                <button
                  onClick={() => onEdit(t)}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
                >
                  <Edit3 size={12} />编辑
                </button>
                <button
                  onClick={() => onDelete(t)}
                  className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                  title={t.isActive ? '请先启用其他模板' : '删除模板'}
                >
                  <Trash2 size={12} />删除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepFlowPreview({
  steps, availableRoles,
}: {
  steps: ApprovalTemplate['steps']
  availableRoles: CompanyRoleInfo[]
}) {
  if (steps.length === 0) {
    return <p className="text-[11px] text-amber-600 mt-1">⚠ 模板没有步骤</p>
  }
  const roleNameByKey = new Map(availableRoles.map(r => [r.key, r.name]))
  function nameOf(role: string, fallback?: string) {
    return fallback || roleNameByKey.get(role) || APPROVAL_TEMPLATE_ROLE_LABEL[role] || role
  }
  return (
    <div className="mt-1 flex items-center flex-wrap gap-x-1 gap-y-1 text-[11px] text-slate-500">
      <span className="text-slate-400">经办人发起</span>
      {steps.map((s, i) => (
        <span key={s.id || i} className="inline-flex items-center gap-1">
          <ChevronRight size={11} className="text-slate-300" />
          <span className="text-slate-700">{nameOf(s.role, s.roleName)}</span>
          {s.stepLabel && <span className="text-slate-400">（{s.stepLabel}）</span>}
        </span>
      ))}
      <ChevronRight size={11} className="text-slate-300" />
      <span className="text-slate-400">经办人用印</span>
    </div>
  )
}

// ─── 编辑 View ──────────────────────────────────────────────────────────────

function TemplateEditView({
  companyId, templateId, initialName, initialSteps,
  availableRoles, isFirstTemplate,
  onCancel, onSaved,
}: {
  companyId: string
  templateId: string | null
  initialName: string
  initialSteps: ApprovalTemplateStepInput[]
  availableRoles: CompanyRoleInfo[]
  isFirstTemplate: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initialName)
  const [steps, setSteps] = useState<ApprovalTemplateStepInput[]>(initialSteps)
  const [activateOnSave, setActivateOnSave] = useState(isFirstTemplate)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCreate = templateId === null
  const defaultRoleKey = availableRoles[0]?.key || 'legal'

  function addStep() {
    setSteps([...steps, { role: defaultRoleKey }])
  }
  function removeStep(i: number) {
    if (steps.length === 1) return
    setSteps(steps.filter((_, idx) => idx !== i))
  }
  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSteps(next)
  }
  function updateStep(i: number, patch: Partial<ApprovalTemplateStepInput>) {
    setSteps(steps.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  async function submit() {
    if (!name.trim()) { setError('请填写模板名称'); return }
    if (steps.length === 0) { setError('请至少添加一个步骤'); return }
    setSubmitting(true)
    setError(null)
    try {
      const payloadSteps = steps.map(s => ({
        role: s.role,
        stepLabel: s.stepLabel?.trim() || undefined,
      }))
      if (isCreate) {
        await companiesApi.createTemplate(companyId, {
          name: name.trim(),
          steps: payloadSteps,
          isActive: activateOnSave,
        })
      } else {
        await companiesApi.updateTemplate(companyId, templateId!, {
          name: name.trim(),
          steps: payloadSteps,
        })
      }
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">
        {isCreate ? '新建审批流模板' : '编辑模板'} —— 按"经办人发起 → 步骤 1 → 步骤 2 → … → 经办人用印"顺序排列中间步骤
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">模板名称 *</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="form-input"
          placeholder="如：标准合同审批流"
          maxLength={50}
          autoFocus
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-slate-600">审批步骤 *</label>
          <Button size="sm" variant="outline" icon={<Plus size={12} />} onClick={addStep}>添加步骤</Button>
        </div>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50/50 px-3 py-2">
              <span className="text-xs font-medium text-slate-400 w-6 shrink-0">#{i + 1}</span>
              <select
                value={s.role}
                onChange={e => updateStep(i, { role: e.target.value })}
                className="form-select w-40 shrink-0"
              >
                {availableRoles.length === 0 && <option value="">无可用角色</option>}
                {availableRoles.map(r => (
                  <option key={r.key} value={r.key}>
                    {r.name}{r.isSystem ? '' : '（自定义）'}
                  </option>
                ))}
              </select>
              <input
                value={s.stepLabel || ''}
                onChange={e => updateStep(i, { stepLabel: e.target.value })}
                className="form-input flex-1"
                placeholder="步骤说明（可选），如：法务审核 / 财务确认"
                maxLength={100}
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                  title="上移"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  onClick={() => moveStep(i, 1)}
                  disabled={i === steps.length - 1}
                  title="下移"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  onClick={() => removeStep(i)}
                  disabled={steps.length === 1}
                  title="删除"
                  className="p-1 rounded text-red-400 hover:text-red-700 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isCreate && (
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={activateOnSave}
            onChange={e => setActivateOnSave(e.target.checked)}
          />
          创建后立即启用（会自动停用同公司其他模板{isFirstTemplate ? '，本公司首个模板建议启用' : ''}）
        </label>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <Button variant="secondary" size="md" onClick={onCancel} disabled={submitting}>取消</Button>
        <Button variant="primary" size="md" loading={submitting} onClick={submit}>
          {isCreate ? '创建模板' : '保存修改'}
        </Button>
      </div>
    </div>
  )
}
