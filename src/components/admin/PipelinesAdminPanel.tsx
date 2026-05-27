import { useState } from 'react'
import { Workflow } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PipelinesAdminModal } from './PipelinesAdminModal'

/**
 * v2.0 平台控制台「审批流配置」入口。
 * 当前直接复用历史的 PipelinesAdminModal 弹窗形态。
 * （后续如需 inline 化，可把 Modal 的核心列表+编辑逻辑拆成 Panel 内嵌。）
 */
export function PipelinesAdminPanel() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">AI 审核模型</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          管理「法务 AI 审核」用的模型（合同上传后跑的智能检查流水线）；可指定归属公司或设为"全平台共享"。
        </p>
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-2 inline-block">
          注意：这里不是"审批流程"配置。要按公司配置合同审批步骤，请到「企业管理」→ 对应公司行 →「审批流模板」。
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <Workflow size={28} className="mx-auto text-slate-300 mb-2" />
        <p className="text-sm text-slate-600 mb-3">点击下方按钮打开 AI 审核模型管理面板</p>
        <Button variant="primary" size="md" onClick={() => setOpen(true)}>打开模型管理</Button>
        <p className="text-[11px] text-slate-400 mt-3">
          v2.0 新增：每条模型可绑定到具体公司，未绑定的视为"全平台共享"，所有公司都能用。
        </p>
      </div>

      <PipelinesAdminModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
