import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { contractsApi } from '@/api/contracts'
import { messagesApi } from '@/api/messages'
import { approvalsApi } from '@/api/approvals'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import type { ContractRecord, Contact } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onInitiated: (approvalId: string) => void
  /** 可选：从合同台账上点"发起审批"时预填合同 */
  prefillContractId?: string
}

export function InitiateApprovalDialog({ open, onClose, onInitiated, prefillContractId }: Props) {
  const me = useAuthStore(s => s.user)
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [superAdmins, setSuperAdmins] = useState<Contact[]>([])
  const [contractId, setContractId] = useState<string>('')
  const [firstApproverId, setFirstApproverId] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  // v1.3.1 清洁版
  const [cleanMode, setCleanMode] = useState<'new' | 'reuse'>('new')
  const [cleanFile, setCleanFile] = useState<File | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setNote('')
    setContractId(prefillContractId || '')
    setCleanMode('new')
    setCleanFile(null)
    setLoadingData(true)
    Promise.all([
      contractsApi.list({ status: 'drafting' }),
      messagesApi.contacts(),
    ])
      .then(([{ contracts }, { contacts }]) => {
        setContracts(contracts)
        const sas = contacts.filter(c => c.role === 'superadmin')
        setSuperAdmins(sas)
        // 如果当前用户自己是 superadmin，把自己也算一个备选（messagesApi.contacts 返回的是"非自己"列表，所以自己不会在里面）
        if (me?.role === 'superadmin' && me) {
          sas.push({
            id: me.id,
            username: me.username,
            displayName: me.displayName || null,
            role: 'superadmin',
          })
          setSuperAdmins([...sas])
        }
        if (sas.length === 1) setFirstApproverId(sas[0].id)
        else setFirstApproverId('')
      })
      .catch(e => setError(e instanceof Error ? e.message : '加载数据失败'))
      .finally(() => setLoadingData(false))
  }, [open, prefillContractId, me])

  async function onSubmit() {
    if (!contractId) { setError('请选择合同'); return }
    if (!firstApproverId) { setError('请选择第一审批人（超级管理员）'); return }
    const sc = contracts.find(c => c.id === contractId)
    if (cleanMode === 'reuse') {
      if (!sc?.cleanFilename) { setError('该合同没有可沿用的清洁版，请上传新清洁版'); return }
    } else {
      if (!cleanFile) { setError('请上传清洁版文件'); return }
    }

    setSubmitting(true)
    setError(null)
    try {
      const { approvalId } = await approvalsApi.initiate({
        contractId,
        firstApproverId,
        initiationNote: note.trim() || undefined,
        reuseExistingClean: cleanMode === 'reuse',
        cleanFile: cleanMode === 'new' ? cleanFile! : undefined,
      })
      onInitiated(approvalId)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '发起审批失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const selectedContract = contracts.find(c => c.id === contractId)

  return (
    <Modal open={open} onClose={onClose} title="发起合同审批">
      <div className="w-[520px] max-w-full space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">合同 *</label>
          {loadingData ? (
            <p className="text-xs text-slate-400">加载中…</p>
          ) : contracts.length === 0 ? (
            <p className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              当前没有可发起审批的合同。<br />
              发起审批要求合同处于"起草中"状态且已经过法务审核（已上传法务修订版）。
            </p>
          ) : (
            <select
              className="form-select"
              value={contractId}
              onChange={e => setContractId(e.target.value)}
              disabled={!!prefillContractId}
            >
              <option value="">选择合同…</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          )}
          {selectedContract && (
            <p className="mt-1 text-[11px] text-slate-400">
              已审 {selectedContract.versionCount} 次 · 创建人 {selectedContract.createdByDisplayName || selectedContract.createdByUsername || '—'}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            第一审批人 *
            <span className="ml-2 text-[10px] text-slate-400">必须是超级管理员，由其指派后续审批人</span>
          </label>
          {superAdmins.length === 0 ? (
            <p className="text-xs text-amber-600">系统中没有超级管理员账号</p>
          ) : superAdmins.length === 1 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              📧 {superAdmins[0].displayName || superAdmins[0].username}（{superAdmins[0].username}）
              <span className="ml-2 text-[10px] text-slate-400">系统唯一超管，自动选定</span>
            </div>
          ) : (
            <select
              className="form-select"
              value={firstApproverId}
              onChange={e => setFirstApproverId(e.target.value)}
            >
              <option value="">选择超级管理员…</option>
              {superAdmins.map(s => (
                <option key={s.id} value={s.id}>
                  {s.displayName || s.username}（{s.username}）
                </option>
              ))}
            </select>
          )}
        </div>

        {/* v1.3.1 清洁版上传 */}
        {selectedContract && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              清洁版 *
              <span className="ml-2 text-[10px] text-slate-400">
                根据法务意见整合好的最终待审批版本，AI 摘要也基于此生成
              </span>
            </label>
            <div className="space-y-2">
              {selectedContract.cleanFilename && (
                <label className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50 has-[:checked]:bg-blue-50 has-[:checked]:border-blue-300">
                  <input
                    type="radio"
                    checked={cleanMode === 'reuse'}
                    onChange={() => setCleanMode('reuse')}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800">沿用现有清洁版</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      《{selectedContract.cleanFilename}》
                      {selectedContract.cleanUploadedAt && ` · ${new Date(selectedContract.cleanUploadedAt).toLocaleString('zh-CN')}`}
                    </p>
                  </div>
                </label>
              )}
              <label className="flex items-start gap-2 rounded border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50 has-[:checked]:bg-blue-50 has-[:checked]:border-blue-300">
                <input
                  type="radio"
                  checked={cleanMode === 'new'}
                  onChange={() => setCleanMode('new')}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800">上传新清洁版</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">支持 .doc / .docx / .pdf</p>
                  {cleanMode === 'new' && (
                    <input
                      type="file"
                      accept=".doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                      onChange={e => setCleanFile(e.target.files?.[0] || null)}
                      className="mt-2 block text-xs"
                    />
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">发起说明（可选）</label>
          <textarea
            className="form-textarea"
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="简短说明本合同的关键点，方便审批人快速了解"
          />
        </div>

        {error && (
          <p className="rounded bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <Button variant="primary" size="md" icon={<Send size={14} />} loading={submitting} onClick={onSubmit}>
            发起审批
          </Button>
        </div>
      </div>
    </Modal>
  )
}
