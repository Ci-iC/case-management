import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SystemSettingsModal } from './SystemSettingsModal'

/** v2.0 平台设置入口（OpenAI Key、合同摘要 prompt 等平台级配置）。 */
export function PlatformSettingsPanel() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">平台设置</h2>
        <p className="text-xs text-slate-500 mt-0.5">OpenAI 接口、合同摘要 prompt 等平台级配置（不区分公司）</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <Settings size={28} className="mx-auto text-slate-300 mb-2" />
        <Button variant="primary" size="md" onClick={() => setOpen(true)}>打开系统设置</Button>
      </div>

      <SystemSettingsModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
