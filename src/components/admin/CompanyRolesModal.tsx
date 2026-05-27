import { useEffect, useState } from 'react'
import { Plus, Trash2, AlertCircle, Edit3, Eye, EyeOff, Shield, Check, X as XIcon } from 'lucide-react'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ApiError } from '@/api/client'
import { companiesApi, type CompanyRoleInfo } from '@/api/companies'

interface Props {
  open: boolean
  onClose: () => void
  companyId: string
  companyName: string
}

/**
 * v2.1+ 平台超管：管理某家公司的角色清单（系统内置 5 个 + 任意数量自定义角色）。
 *
 * 系统角色：名字 / key 锁定不允许改/删，仅"看本公司全部合同"开关可调。
 * 自定义角色：可改名 / 可勾开关 / 可删（没人在用、没模板在用时）。
 */
export function CompanyRolesModal({ open, onClose, companyId, companyName }: Props) {
  const [roles, setRoles] = useState<CompanyRoleInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CompanyRoleInfo | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { roles } = await companiesApi.listRoles(companyId)
      setRoles(roles)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载角色失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setEditingId(null)
    load()
  }, [open, companyId])

  async function toggleViewAll(role: CompanyRoleInfo) {
    try {
      await companiesApi.updateRole(companyId, role.id, {
        canViewAllContracts: !role.canViewAllContracts,
      })
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '更新失败')
    }
  }

  async function onConfirmDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await companiesApi.deleteRole(companyId, confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败')
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`角色管理 · ${companyName}`}>
      <div className="w-[680px] max-w-full space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs text-slate-500 leading-relaxed flex-1">
            为这家公司维护角色清单。
            <strong>系统内置 5 个角色</strong>名字锁定，但「看全部合同」开关允许调整；
            <strong>自定义角色</strong>可改名、可勾开关、可删除。<br />
            「看全部合同」勾上的用户能浏览本公司所有合同；不勾的只看自己创建/经办的。
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            新建自定义角色
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
          {!loading && roles.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-xs">还没有角色</div>
          )}
          {!loading && roles.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              isEditing={editingId === role.id}
              onStartEdit={() => setEditingId(role.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); load() }}
              onToggleViewAll={() => toggleViewAll(role)}
              onDelete={() => setConfirmDelete(role)}
              companyId={companyId}
            />
          ))}
        </div>
      </div>

      <CreateRoleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        companyId={companyId}
        onCreated={() => { setCreateOpen(false); load() }}
      />

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={onConfirmDelete}
        title="删除角色"
        message={
          <span>
            确认删除「{confirmDelete?.name}」？该操作不可撤销。
            {!!confirmDelete && (confirmDelete.memberCount > 0 || confirmDelete.templateRefCount > 0) && (
              <span className="block mt-2 text-amber-700">
                删除后会自动：
                {confirmDelete.memberCount > 0 && (
                  <span className="block">· 把 {confirmDelete.memberCount} 名当前用该角色的账号转为「普通员工」</span>
                )}
                {confirmDelete.templateRefCount > 0 && (
                  <span className="block">· 移除审批流模板里引用该角色的 {confirmDelete.templateRefCount} 个步骤</span>
                )}
              </span>
            )}
          </span>
        }
        confirmLabel="删除"
        confirmVariant="danger"
        loading={deleting}
      />
    </Modal>
  )
}

function RoleRow({
  role, isEditing, onStartEdit, onCancelEdit, onSaved, onToggleViewAll, onDelete, companyId,
}: {
  role: CompanyRoleInfo
  isEditing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaved: () => void
  onToggleViewAll: () => void
  onDelete: () => void
  companyId: string
}) {
  const [editName, setEditName] = useState(role.name)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isEditing) { setEditName(role.name); setError(null) }
  }, [isEditing, role.name])

  async function saveName() {
    if (!editName.trim()) { setError('名称不能为空'); return }
    if (editName.trim() === role.name) { onCancelEdit(); return }
    setSubmitting(true)
    setError(null)
    try {
      await companiesApi.updateRole(companyId, role.id, { name: editName.trim() })
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  // v2.1+: 自定义角色总是可删（后端级联处理：账号转普通员工、移除模板步骤）；系统角色不可删
  const canDelete = !role.isSystem
  const deleteHint = role.isSystem
    ? '系统内置角色不能删除'
    : (role.memberCount > 0 || role.templateRefCount > 0)
      ? '删除（会把在用账号转为普通员工、移除相关模板步骤）'
      : '删除角色'

  return (
    <div className="border-b last:border-b-0 border-slate-100 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Shield size={14} className={role.isSystem ? 'text-rose-400 shrink-0' : 'text-slate-400 shrink-0'} />

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') onCancelEdit() }}
                className="form-input h-7 text-sm flex-1 max-w-xs"
                maxLength={50}
                autoFocus
              />
              <button
                onClick={saveName}
                disabled={submitting}
                className="p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
              >
                <Check size={14} />
              </button>
              <button
                onClick={onCancelEdit}
                className="p-1 rounded text-slate-400 hover:bg-slate-100"
              >
                <XIcon size={14} />
              </button>
              {error && <span className="text-[11px] text-red-600">{error}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-900 text-sm">{role.name}</span>
              {role.isSystem && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-50 text-rose-600 border border-rose-100">
                  系统内置
                </span>
              )}
              <span className="text-[11px] text-slate-400">
                {role.memberCount} 人在用
                {role.templateRefCount > 0 && ` · ${role.templateRefCount} 个模板引用`}
              </span>
            </div>
          )}
        </div>

        {/* 开关 */}
        <button
          onClick={onToggleViewAll}
          title={role.canViewAllContracts ? '点击关闭：仅看自己创建/经办的' : '点击开启：看本公司全部合同'}
          className={`shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors ${
            role.canViewAllContracts
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
              : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
          }`}
        >
          {role.canViewAllContracts ? <Eye size={12} /> : <EyeOff size={12} />}
          {role.canViewAllContracts ? '看全部合同' : '只看自己的'}
        </button>

        {/* 操作 */}
        <div className="shrink-0 flex items-center gap-0.5">
          {!role.isSystem && !isEditing && (
            <button
              onClick={onStartEdit}
              title="改名"
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <Edit3 size={13} />
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={!canDelete}
            title={deleteHint}
            className="p-1 rounded text-red-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-red-400 disabled:cursor-not-allowed"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateRoleDialog({
  open, onClose, companyId, onCreated,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [canViewAllContracts, setCanViewAllContracts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setName(''); setCanViewAllContracts(false); setError(null) }
  }, [open])

  async function submit() {
    if (!name.trim()) { setError('请填写角色名称'); return }
    setSubmitting(true)
    setError(null)
    try {
      await companiesApi.createRole(companyId, {
        name: name.trim(),
        canViewAllContracts,
      })
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新建自定义角色">
      <div className="w-[420px] space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            角色名称 <span className="text-red-400">*</span>
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            className="form-input"
            placeholder="如：董事长 / 分管副总 / 业务总监"
            maxLength={50}
            autoFocus
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer rounded border border-slate-200 px-3 py-2 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={canViewAllContracts}
            onChange={e => setCanViewAllContracts(e.target.checked)}
          />
          <span>
            可看本公司全部合同
            <span className="ml-2 text-[11px] text-slate-400">不勾就只看自己创建/经办的</span>
          </span>
        </label>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          自定义角色除了上面这个开关外，无其他业务能力：不能审合同、不能上传用印版、不能看案件。<br />
          但可以被审批流模板引用作为审批步骤。
        </p>
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="mt-0.5" /><span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="primary" size="md" loading={submitting} onClick={submit}>创建</Button>
        </div>
      </div>
    </Modal>
  )
}
