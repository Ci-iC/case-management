import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Save } from 'lucide-react'
import { useCaseStore, useCaseById } from '@/store/useCaseStore'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { DISPUTE_TYPE_OPTIONS, CASE_STAGE_OPTIONS, CLOSING_METHOD_OPTIONS } from '@/constants'
import type { CaseRecord, DisputeType, CaseStage } from '@/types'

type FormValues = Omit<CaseRecord, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'isArchived'>

const EMPTY_FORM: FormValues = {
  caseNumber: '',
  caseName: '',
  causeOfAction: '',
  disputeType: 'contract',
  court: '',
  stage: 'filed',
  assignedLawyer: '',
  businessDepartment: '',
  ourParty: '',
  opposingParty: '',
  thirdParties: '',
  opposingLawyer: '',
  opposingFirm: '',
  totalAmount: undefined,
  ourClaimAmount: undefined,
  opposingClaimAmount: undefined,
  filingDate: '',
  arbitrationHearingDate: '',
  firstTrialHearingDate: '',
  secondTrialHearingDate: '',
  hearingDate: '',
  judgmentDate: '',
  nextKeyDate: '',
  nextKeyDateLabel: '',
  judgmentDocumentNumber: '',
  closingMethod: undefined,
  mainDisputes: '',
  ourPosition: '',
  currentProgress: '',
  judgmentResult: '',
  executionProgress: '',
  reviewNotes: '',
  remarks: '',
}

export function CaseFormDrawer() {
  const { isFormOpen, editingCaseId, pendingSmartCase, closeForm, addCase, updateCase } = useCaseStore()
  const existingCase = useCaseById(editingCaseId)
  const isEditing = !!editingCaseId
  const isSmartPrefill = !isEditing && !!pendingSmartCase

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormValues>()
  const stage = watch('stage')
  const requireClosingMethod = stage === 'execution' || stage === 'closed'

  // Populate form when editing / prefilling / creating fresh
  useEffect(() => {
    if (!isFormOpen) return
    if (existingCase) {
      reset(existingCase)
    } else if (pendingSmartCase) {
      reset({ ...EMPTY_FORM, ...pendingSmartCase } as FormValues)
    } else {
      reset(EMPTY_FORM)
    }
  }, [isFormOpen, existingCase, pendingSmartCase, reset])

  async function onSubmit(data: FormValues) {
    // Clean up empty strings → undefined for optional fields
    const clean = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v === '' ? undefined : v])
    ) as FormValues

    try {
      if (isEditing && editingCaseId) {
        await updateCase(editingCaseId, clean)
      } else {
        await addCase(clean)
      }
      closeForm()
    } catch (e) {
      window.alert(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const R = register  // shorthand

  return (
    <Drawer
      open={isFormOpen}
      onClose={closeForm}
      width="w-[760px]"
      title={isEditing ? '编辑案件' : isSmartPrefill ? '智能录入 · 确认案件信息' : '新增案件'}
      subtitle={
        isEditing
          ? existingCase?.caseNumber
          : isSmartPrefill
            ? '以下字段由 AI 从上传材料自动抽取，请核对后保存'
            : '请填写案件基本信息'
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="md" onClick={closeForm}>取消</Button>
          <Button
            variant="primary" size="md"
            icon={<Save size={14} />}
            loading={isSubmitting}
            onClick={handleSubmit(onSubmit)}
          >
            {isEditing ? '保存修改' : '创建案件'}
          </Button>
        </div>
      }
    >
      <form className="px-6 py-5 space-y-8" onSubmit={handleSubmit(onSubmit)}>

        {/* ── 第一节：基本信息 ── */}
        <FormSection title="基本信息">
          <div className="grid grid-cols-3 gap-4">
            <Field label="案件编号" required error={errors.caseNumber?.message}>
              <input
                {...R('caseNumber', { required: '请填写案件编号' })}
                className="form-input"
                placeholder="如 SH2026-001"
              />
            </Field>

            <Field label="案件名称" required error={errors.caseName?.message} span={2}>
              <input
                {...R('caseName', { required: '请填写案件名称' })}
                className="form-input"
                placeholder="请输入案件完整名称"
              />
            </Field>

            <Field label="案由" required error={errors.causeOfAction?.message} span={2}>
              <input
                {...R('causeOfAction', { required: '请填写案由' })}
                className="form-input"
                placeholder="如：建设工程施工合同纠纷"
              />
            </Field>

            <Field label="争议类型" required>
              <select {...R('disputeType')} className="form-select">
                {DISPUTE_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field label="受理法院 / 仲裁机构 / 监管机关" span={2}>
              <input
                {...R('court')}
                className="form-input"
                placeholder="填写所有涉案机构，如存在一审、二审请逐一列明，用顿号分隔"
              />
            </Field>

            <Field label="案件阶段" required>
              <select {...R('stage')} className="form-select">
                {CASE_STAGE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field
              label="结案方式"
              required={requireClosingMethod}
              error={errors.closingMethod?.message}
            >
              <select
                {...R('closingMethod', {
                  validate: v => !requireClosingMethod || !!v || '案件阶段为执行或结案时必填',
                })}
                className="form-select"
              >
                <option value="">请选择</option>
                {CLOSING_METHOD_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field label="裁判文书编号">
              <input
                {...R('judgmentDocumentNumber')}
                className="form-input"
                placeholder="如：（2025）沪01民初1234号"
              />
            </Field>

            <Field label="承办律师">
              <input {...R('assignedLawyer')} className="form-input" placeholder="律师姓名" />
            </Field>

            <Field label="对接业务部门">
              <input {...R('businessDepartment')} className="form-input" placeholder="如：工程事业部" />
            </Field>
          </div>
        </FormSection>

        {/* ── 第二节：当事人及金额 ── */}
        <FormSection title="当事人及金额">
          <div className="grid grid-cols-3 gap-4">
            <Field label="我方主体" required error={errors.ourParty?.message} span={2}>
              <input
                {...R('ourParty', { required: '请填写我方主体' })}
                className="form-input"
                placeholder="完整公司/个人名称"
              />
            </Field>

            <Field label="对方主体" required error={errors.opposingParty?.message} span={2}>
              <input
                {...R('opposingParty', { required: '请填写对方主体' })}
                className="form-input"
                placeholder="完整公司/个人名称"
              />
            </Field>

            <Field label="第三人 / 关联方" span={3}>
              <input {...R('thirdParties')} className="form-input" placeholder="如有多方，用顿号分隔" />
            </Field>

            <Field label="对方代理人">
              <input {...R('opposingLawyer')} className="form-input" placeholder="代理律师姓名" />
            </Field>

            <Field label="对方律所" span={2}>
              <input {...R('opposingFirm')} className="form-input" placeholder="律所全称" />
            </Field>

            <Field label="涉案金额（万元）">
              <input
                type="number"
                step="0.01"
                {...R('totalAmount', { valueAsNumber: true })}
                className="form-input"
                placeholder="0.00"
              />
            </Field>

            <Field label="我方主张金额（万元）">
              <input
                type="number"
                step="0.01"
                {...R('ourClaimAmount', { valueAsNumber: true })}
                className="form-input"
                placeholder="0.00"
              />
            </Field>

            <Field label="对方主张金额（万元）">
              <input
                type="number"
                step="0.01"
                {...R('opposingClaimAmount', { valueAsNumber: true })}
                className="form-input"
                placeholder="0.00"
              />
            </Field>
          </div>
        </FormSection>

        {/* ── 第三节：时间节点 ── */}
        <FormSection title="时间节点">
          <div className="grid grid-cols-3 gap-4">
            <Field label="立案日期">
              <input type="date" {...R('filingDate')} className="form-input" />
            </Field>

            <Field label="仲裁开庭时间">
              <input type="date" {...R('arbitrationHearingDate')} className="form-input" />
            </Field>

            <Field label="一审开庭时间">
              <input type="date" {...R('firstTrialHearingDate')} className="form-input" />
            </Field>

            <Field label="二审开庭时间">
              <input type="date" {...R('secondTrialHearingDate')} className="form-input" />
            </Field>

            <Field label="开庭日期（通用）">
              <input type="date" {...R('hearingDate')} className="form-input" />
            </Field>

            <Field label="判决 / 裁决日期">
              <input type="date" {...R('judgmentDate')} className="form-input" />
            </Field>

            <Field label="下一关键节点日期">
              <input type="date" {...R('nextKeyDate')} className="form-input" />
            </Field>

            <Field label="下一关键节点说明" span={2}>
              <input
                {...R('nextKeyDateLabel')}
                className="form-input"
                placeholder="如：第三次庭审、一审判决宣判"
              />
            </Field>
          </div>
        </FormSection>

        {/* ── 第四节：当前情况 ── */}
        <FormSection title="当前情况">
          <div className="space-y-4">
            <Field label="主要争议焦点">
              <textarea
                {...R('mainDisputes')}
                className="form-textarea"
                rows={3}
                placeholder="列举各方争议的核心法律和事实问题"
              />
            </Field>

            <Field label="我方诉求 / 抗辩要点">
              <textarea
                {...R('ourPosition')}
                className="form-textarea"
                rows={3}
                placeholder="我方的主要主张、法律依据及核心论点"
              />
            </Field>

            <Field label="当前进展" required error={errors.currentProgress?.message}>
              <textarea
                {...R('currentProgress', { required: '请填写当前进展' })}
                className="form-textarea"
                rows={3}
                placeholder="最新进展情况，包括最近一次庭审结果、阶段性结论等"
              />
            </Field>

            <Field label="判决结果">
              <textarea
                {...R('judgmentResult')}
                className="form-textarea"
                rows={2}
                placeholder="可简要填写判决金额等结果，如：判决被告赔偿原告XXX万元"
              />
            </Field>

            <Field label="回款 / 执行进展">
              <textarea
                {...R('executionProgress')}
                className="form-textarea"
                rows={2}
                placeholder="已执行金额、执行措施、剩余执行进度等"
              />
            </Field>

            <Field label="复盘要点">
              <textarea
                {...R('reviewNotes')}
                className="form-textarea"
                rows={2}
                placeholder="需要注意的风险、关键判断点、经验教训"
              />
            </Field>

            <Field label="备注">
              <textarea
                {...R('remarks')}
                className="form-textarea"
                rows={2}
                placeholder="其他需要记录的信息"
              />
            </Field>
          </div>
        </FormSection>
      </form>
    </Drawer>
  )
}

// ─── Form Sub-components ───────────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Field({
  label, required, error, span, children,
}: {
  label: string
  required?: boolean
  error?: string
  span?: 2 | 3
  children: React.ReactNode
}) {
  const spanClass = span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : ''
  return (
    <div className={spanClass}>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
