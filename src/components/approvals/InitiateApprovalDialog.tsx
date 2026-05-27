import { useEffect, useState } from 'react'
import { Send, Loader2, Sparkles, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { contractsApi } from '@/api/contracts'
import { approvalsApi, type TemplatePreview } from '@/api/approvals'
import { APPROVAL_TEMPLATE_ROLE_LABEL } from '@/api/companies'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'
import { ContractFieldsCard, type ContractFieldsState } from '@/components/contracts/ContractFieldsCard'
import type { ContractRecord } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onInitiated: (approvalId: string) => void
  /** 可选：从合同台账上点"发起审批"时预填合同 */
  prefillContractId?: string
}

/**
 * v2.1 发起合同审批：
 * - 选择合同后调 /api/approvals/template-preview 拿到当前公司 active 模板 + 每步候选人
 * - 单人角色自动选定（只读展示）
 * - 多人角色让用户在下拉中选具体审批人
 * - 某角色在公司内没人 → 整体禁止发起，提示联系超管补人
 * - 无模板 → 整体禁止发起，提示联系超管配置模板
 */
export function InitiateApprovalDialog({ open, onClose, onInitiated, prefillContractId }: Props) {
  const me = useAuthStore(s => s.user)
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [contractId, setContractId] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingContracts, setLoadingContracts] = useState(false)

  // 模板预览状态
  const [preview, setPreview] = useState<TemplatePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  // stepIndex → userId
  const [assignments, setAssignments] = useState<Record<number, string>>({})

  // v1.3.1 清洁版
  const [cleanMode, setCleanMode] = useState<'new' | 'reuse'>('new')
  const [cleanFile, setCleanFile] = useState<File | null>(null)
  // v1.4 合同结构化字段（卡片状态）
  const [fields, setFields] = useState<ContractFieldsState>({})
  const [autoExtracting, setAutoExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  // 卡片是“挂载时读 initial”的非完全受控组件：每次程序化写入字段后 +1，强制卡片用新值重挂载
  const [cardKey, setCardKey] = useState(0)

  useEffect(() => {
    if (!open) return
    setError(null)
    setExtractError(null)
    setNote('')
    setContractId(prefillContractId || '')
    setCleanMode('new')
    setCleanFile(null)
    setFields({})
    setPreview(null)
    setPreviewError(null)
    setAssignments({})
    setLoadingContracts(true)
    contractsApi.list({ status: 'drafting' })
      .then(({ contracts }) => setContracts(contracts))
      .catch(e => setError(e instanceof Error ? e.message : '加载合同失败'))
      .finally(() => setLoadingContracts(false))
  }, [open, prefillContractId])

  // 程序化写入字段：同步 fields + 强制卡片重挂载（卡片只在挂载时读 initial）
  function applyFields(f: ContractFieldsState) {
    setFields(f)
    setCardKey(k => k + 1)
  }

  // 用合同已存的结构化字段预填卡片（不调 AI）
  function prefillFromContract(sc: ContractRecord) {
    applyFields({
      contractName: sc.name,
      ourParties: sc.ourParties || [],
      counterParties: sc.counterParties || [],
      contractType: sc.contractType || null,
      paymentType: sc.paymentType || null,
      contractAmount: sc.contractAmount ?? null,
      termType: sc.termType || null,
      termDate: sc.termDate || null,
      termText: sc.termText || null,
      handlerId: sc.handlerId || me?.id || null,
    })
  }

  // 以清洁版为准跑 AI 提取（新上传的清洁版文件，或沿用合同已存清洁版）
  async function runExtractFromClean(opts: { cleanFile?: File; reuseExistingClean?: boolean }) {
    if (!contractId) return
    const sc = contracts.find(c => c.id === contractId)
    setAutoExtracting(true)
    setExtractError(null)
    try {
      const { fields: f } = await contractsApi.extractFields(contractId, opts)
      applyFields({
        contractName: f.contractName || sc?.name || '',
        ourParties: f.ourParties || [],
        counterParties: f.counterParties || [],
        contractType: f.contractType || null,
        paymentType: f.paymentType || null,
        contractAmount: f.contractAmount ?? null,
        termType: f.termType || null,
        termDate: f.termDate || null,
        termText: f.termText || null,
        handlerId: me?.id || null,
      })
    } catch (e) {
      setExtractError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'AI 提取失败，请手动填写'))
      applyFields({ contractName: sc?.name || '', handlerId: me?.id || null })
    } finally {
      setAutoExtracting(false)
    }
  }

  // 选定合同 → 拉模板预览 + 预填已存字段。注意：AI 提取不在这里跑，改由“上传/沿用清洁版”触发
  useEffect(() => {
    if (!contractId) {
      applyFields({})
      setPreview(null)
      setPreviewError(null)
      setAssignments({})
      return
    }
    const sc = contracts.find(c => c.id === contractId)
    if (!sc) return

    // 切合同 → 重置清洁版选择与提取提示（需重新上传/沿用清洁版才会提取）
    setCleanFile(null)
    setCleanMode('new')
    setExtractError(null)

    // 模板预览
    setLoadingPreview(true)
    setPreviewError(null)
    setPreview(null)
    setAssignments({})
    approvalsApi.templatePreview(contractId)
      .then((pv) => {
        setPreview(pv)
        // 单人角色自动填，多人留空
        const init: Record<number, string> = {}
        for (const s of pv.steps) {
          if (s.candidates.length === 1) init[s.stepIndex] = s.candidates[0].userId
        }
        setAssignments(init)
      })
      .catch(e => setPreviewError(e instanceof ApiError ? e.message : '加载审批流模板失败'))
      .finally(() => setLoadingPreview(false))

    // 已有结构化字段 → 预填卡片（上传/沿用清洁版后会重新提取覆盖）；否则留空待提取
    if (sc.contractType || sc.paymentType) {
      prefillFromContract(sc)
    } else {
      applyFields({ contractName: sc.name, handlerId: me?.id || null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, contracts, me?.id])

  function validateFields(): string | null {
    if (!fields.contractName || !fields.contractName.trim()) return '请填写合同名称'
    if (!fields.contractType) return '请选择合同类型'
    if (!fields.paymentType) return '请选择收付款类型'
    if (['收款', '付款', '借贷'].includes(fields.paymentType || '') && (fields.contractAmount == null || !(fields.contractAmount >= 0))) {
      return '请填写合同款项金额'
    }
    if (!fields.termType) return '请选择合同期限类型'
    if (fields.termType === '固定日期' && !fields.termDate) return '请填写到期日期'
    if (fields.termType === '固定期限' && (!fields.termText || !fields.termText.trim())) return '请填写期限描述'
    return null
  }

  function validateAssignments(): string | null {
    if (!preview) return '尚未加载审批流模板'
    for (const s of preview.steps) {
      if (s.candidates.length === 0) {
        return `审批步骤 #${s.stepIndex}（${s.roleName || APPROVAL_TEMPLATE_ROLE_LABEL[s.role] || s.role}）在本公司没有候选人，请联系平台超管补充人员配置`
      }
      if (!assignments[s.stepIndex]) {
        return `请为步骤 #${s.stepIndex}（${s.roleName || APPROVAL_TEMPLATE_ROLE_LABEL[s.role] || s.role}）选择审批人`
      }
    }
    return null
  }

  async function onSubmit() {
    if (!contractId) { setError('请选择合同'); return }
    if (previewError) { setError(previewError); return }

    const fieldErr = validateFields()
    if (fieldErr) { setError(fieldErr); return }

    const assignErr = validateAssignments()
    if (assignErr) { setError(assignErr); return }

    const sc = contracts.find(c => c.id === contractId)
    if (cleanMode === 'reuse') {
      if (!sc?.cleanFilename) { setError('该合同没有可沿用的清洁版，请上传新清洁版'); return }
    } else {
      if (!cleanFile) { setError('请上传清洁版文件'); return }
    }

    setSubmitting(true)
    setError(null)
    try {
      await contractsApi.saveDraft(contractId, {
        ...fields,
        name: fields.contractName?.trim() || undefined,
        handlerId: me?.id || fields.handlerId || undefined,
      })

      const stepAssignments = preview!.steps.map(s => ({
        stepIndex: s.stepIndex,
        userId: assignments[s.stepIndex],
      }))

      const { approvalId } = await approvalsApi.initiate({
        contractId,
        stepAssignments,
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

  async function onSaveDraft() {
    if (!contractId) { setError('请选择合同'); return }
    setSubmitting(true)
    setError(null)
    try {
      await contractsApi.saveDraft(contractId, {
        ...fields,
        name: fields.contractName?.trim() || undefined,
        handlerId: me?.id || fields.handlerId || undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '保存失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const selectedContract = contracts.find(c => c.id === contractId)
  const hasBlockingError = !!previewError ||
    (preview != null && preview.steps.some(s => s.candidates.length === 0))

  return (
    <Modal open={open} onClose={onClose} title="发起合同审批">
      <div className="w-[640px] max-w-full space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">合同 *</label>
          {loadingContracts ? (
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

        {/* v1.3.1 清洁版上传（v2.1+: 置于最上方，发起前先确认待审批文件） */}
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
                    onChange={() => {
                      setCleanMode('reuse')
                      setCleanFile(null)
                      // 已有结构化字段 → 直接用，不重复调 AI；否则从已存清洁版提取
                      if (selectedContract.contractType || selectedContract.paymentType) {
                        prefillFromContract(selectedContract)
                      } else {
                        runExtractFromClean({ reuseExistingClean: true })
                      }
                    }}
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
                  <p className="text-[11px] text-slate-500 mt-0.5">仅支持 Word（.doc / .docx）；上传后自动提取合同信息</p>
                  {cleanMode === 'new' && (
                    <input
                      type="file"
                      accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={e => {
                        const f = e.target.files?.[0] || null
                        setCleanFile(f)
                        if (f) runExtractFromClean({ cleanFile: f })   // 上传清洁版 → 自动提取一次
                      }}
                      className="mt-2 block text-xs"
                    />
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        {selectedContract && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-700">合同结构化信息</p>
              {autoExtracting ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-primary-600">
                  <Loader2 size={11} className="animate-spin" /> AI 正在按清洁版提取，请稍候…
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">由 AI 按清洁版提取，提取完成后可手动调整</span>
              )}
            </div>
            {extractError && (
              <p className="mb-2 rounded bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] text-amber-700">{extractError}</p>
            )}
            <ContractFieldsCard
              key={cardKey}
              initial={fields}
              onChange={setFields}
              readOnly={autoExtracting}
              hideHandler
            />
          </div>
        )}

        {/* v2.1 审批流模板预览 + 审批人指派 */}
        {selectedContract && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              审批流程 *
              <span className="ml-2 text-[10px] text-slate-400">
                根据平台超管为本公司配置的模板按角色生成；单人角色自动选定，多人角色请指派具体审批人
              </span>
            </label>

            {loadingPreview && (
              <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 inline-flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> 加载模板中…
              </p>
            )}

            {previewError && !loadingPreview && (
              <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{previewError}</p>
                  <p className="mt-0.5 text-[11px]">请联系平台超管在"企业管理 → 审批流模板"中配置后再发起。</p>
                </div>
              </div>
            )}

            {preview && !loadingPreview && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-[11px] text-slate-400 flex items-center gap-1">
                  <span>使用模板</span>
                  <span className="text-slate-700 font-medium">《{preview.template.name}》</span>
                </div>
                <div className="flex items-center flex-wrap gap-x-1 gap-y-1 text-[11px] text-slate-500 mb-2">
                  <span className="text-slate-400">经办人发起</span>
                  {preview.steps.map((s) => (
                    <span key={s.stepIndex} className="inline-flex items-center gap-1">
                      <ChevronRight size={11} className="text-slate-300" />
                      <span className="text-slate-700">{s.roleName || APPROVAL_TEMPLATE_ROLE_LABEL[s.role] || s.role}</span>
                    </span>
                  ))}
                  <ChevronRight size={11} className="text-slate-300" />
                  <span className="text-slate-400">经办人用印</span>
                </div>

                <div className="space-y-1.5">
                  {preview.steps.map((s) => (
                    <StepAssignmentRow
                      key={s.stepIndex}
                      step={s}
                      value={assignments[s.stepIndex] || ''}
                      onChange={(uid) => setAssignments(a => ({ ...a, [s.stepIndex]: uid }))}
                    />
                  ))}
                </div>
              </div>
            )}
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

        <div className="flex justify-between gap-2 pt-1 border-t border-slate-100">
          <Button variant="secondary" size="md" onClick={onClose} disabled={submitting}>取消</Button>
          <div className="flex gap-2">
            {selectedContract && (
              <Button variant="secondary" size="md" onClick={onSaveDraft} disabled={submitting}
                icon={<Sparkles size={14} />} title="暂存合同结构化字段，稍后再发起审批">
                暂存草稿
              </Button>
            )}
            <Button
              variant="primary" size="md" icon={<Send size={14} />}
              loading={submitting} onClick={onSubmit}
              disabled={hasBlockingError}
              title={hasBlockingError ? '当前无法发起，请先解决上方提示' : undefined}
            >
              保存并发起审批
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function StepAssignmentRow({
  step, value, onChange,
}: {
  step: TemplatePreview['steps'][number]
  value: string
  onChange: (userId: string) => void
}) {
  const roleLabel = step.roleName || APPROVAL_TEMPLATE_ROLE_LABEL[step.role] || step.role

  if (step.candidates.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
        <span className="text-[11px] font-medium text-slate-500 w-7 shrink-0">#{step.stepIndex}</span>
        <span className="text-xs text-slate-700 w-24 shrink-0">{roleLabel}</span>
        <span className="text-[11px] text-amber-700 flex-1">
          ⚠ 本公司无该角色用户，请联系平台超管补充
        </span>
      </div>
    )
  }

  if (step.candidates.length === 1) {
    const c = step.candidates[0]
    return (
      <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
        <span className="text-[11px] font-medium text-slate-500 w-7 shrink-0">#{step.stepIndex}</span>
        <span className="text-xs text-slate-700 w-24 shrink-0">{roleLabel}</span>
        <span className="text-xs text-slate-800 flex-1 inline-flex items-center gap-1">
          <CheckCircle2 size={11} className="text-emerald-500" />
          {c.displayName || c.username}（{c.username}）
          <span className="text-[10px] text-slate-400 ml-1">本公司唯一，自动选定</span>
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
      <span className="text-[11px] font-medium text-slate-500 w-7 shrink-0">#{step.stepIndex}</span>
      <span className="text-xs text-slate-700 w-24 shrink-0">{roleLabel}</span>
      <select
        className="form-select flex-1"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">选择审批人…</option>
        {step.candidates.map(c => (
          <option key={c.userId} value={c.userId}>
            {c.displayName || c.username}（{c.username}）
          </option>
        ))}
      </select>
    </div>
  )
}
