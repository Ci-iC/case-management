import { useState } from 'react'
import { Plus, Download, Upload, X, Sparkles, Settings } from 'lucide-react'
import { useCaseStore } from '@/store/useCaseStore'
import { Button } from '@/components/ui/Button'
import { CaseStatsBar } from '@/components/cases/CaseStatsBar'
import { CaseFilters } from '@/components/cases/CaseFilters'
import { CaseTable } from '@/components/cases/CaseTable'
import { CaseDetailDrawer } from '@/components/cases/CaseDetailDrawer'
import { CaseFormDrawer } from '@/components/cases/CaseFormDrawer'
import { ImportModal } from '@/components/cases/ImportModal'
import { SmartImportModal } from '@/components/cases/SmartImportModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { exportCasesToTxt } from '@/utils/importExport'

/**
 * Main cases docket page.
 * Composes all sub-components: stats bar, filters, table, and drawers.
 */
export default function CasesPage() {
  const { openForm, totalCount, filteredCases, selectedIds, clearSelection } = useCaseStore()
  const [importOpen, setImportOpen] = useState(false)
  const [smartOpen, setSmartOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const hasSelection = selectedIds.length > 0

  function handleExport() {
    if (hasSelection) {
      const selectedSet = new Set(selectedIds)
      exportCasesToTxt(filteredCases.filter(c => selectedSet.has(c.id)))
    } else {
      exportCasesToTxt(filteredCases)
    }
  }

  return (
    <>
      {/* Page content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex-shrink-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-3.5">
          <div>
            <h1 className="text-base font-bold text-slate-900">案件台账</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              共管理 {totalCount} 件案件
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasSelection && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary-50 border border-primary-200">
                <span className="text-xs font-medium text-primary-700">
                  已选 {selectedIds.length} 件
                </span>
                <button
                  onClick={clearSelection}
                  title="取消选择"
                  className="text-primary-400 hover:text-primary-600 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <Button
              variant="outline"
              size="md"
              icon={<Sparkles size={14} />}
              onClick={() => setSmartOpen(true)}
              title="上传材料由 AI 自动提取案件信息"
            >
              智能录入
            </Button>
            <Button
              variant="outline"
              size="md"
              icon={<Upload size={14} />}
              onClick={() => setImportOpen(true)}
            >
              导入
            </Button>
            <Button
              variant="outline"
              size="md"
              icon={<Download size={14} />}
              onClick={handleExport}
              title={
                hasSelection
                  ? `导出已选 ${selectedIds.length} 件`
                  : `导出当前筛选结果（${filteredCases.length} 件）`
              }
            >
              {hasSelection ? `导出已选（${selectedIds.length}）` : '导出'}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Plus size={14} />}
              onClick={() => openForm(null)}
            >
              新增案件
            </Button>
            <button
              onClick={() => setSettingsOpen(true)}
              title="系统设置"
              className="ml-1 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Stats */}
          <CaseStatsBar />

          {/* Filters */}
          <CaseFilters />

          {/* Table */}
          <CaseTable />
        </div>
      </div>

      {/* Drawers (rendered outside the scroll container) */}
      <CaseDetailDrawer />
      <CaseFormDrawer />

      {/* Import modal */}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Smart import (AI) */}
      <SmartImportModal
        open={smartOpen}
        onClose={() => setSmartOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Settings */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
