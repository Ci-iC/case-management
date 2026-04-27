import { useEffect, useState } from 'react'
import { Key, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  useSettingsStore,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MODEL_OPTIONS,
} from '@/store/useSettingsStore'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const { apiKey, baseURL, defaultModel, setSettings } = useSettingsStore()

  const [localKey, setLocalKey] = useState(apiKey)
  const [localBase, setLocalBase] = useState(baseURL)
  const [localModel, setLocalModel] = useState(defaultModel)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  // Sync when modal re-opens
  useEffect(() => {
    if (open) {
      setLocalKey(apiKey)
      setLocalBase(baseURL)
      setLocalModel(defaultModel)
      setSaved(false)
    }
  }, [open, apiKey, baseURL, defaultModel])

  function handleSave() {
    setSettings({
      apiKey: localKey.trim(),
      baseURL: localBase.trim() || DEFAULT_BASE_URL,
      defaultModel: localModel || DEFAULT_MODEL,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <Modal open={open} onClose={onClose} title="系统设置">
      <div className="w-[520px] space-y-5">
        <div>
          <p className="text-sm text-slate-600">
            配置 OpenAI 接口信息，用于「智能录入」功能自动从上传材料中提取案件信息。
          </p>
          <p className="mt-1 text-xs text-slate-400">
            密钥仅保存在本机浏览器存储中，不会上传至任何服务器。
          </p>
        </div>

        {/* API Key */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
            API Key <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type={showKey ? 'text' : 'password'}
              value={localKey}
              onChange={(e) => setLocalKey(e.target.value)}
              placeholder="sk-..."
              className="form-input pl-9 pr-10 font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              title={showKey ? '隐藏' : '显示'}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Base URL */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
            Base URL
          </label>
          <input
            type="text"
            value={localBase}
            onChange={(e) => setLocalBase(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            className="form-input font-mono"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            如使用代理或兼容接口可修改，默认：{DEFAULT_BASE_URL}
          </p>
        </div>

        {/* Default model */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
            默认模型
          </label>
          <select
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            className="form-select"
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}{o.note ? `（${o.note}）` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="text-xs">
            {saved && (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 size={13} /> 已保存
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
            <Button variant="primary" size="md" onClick={handleSave}>保存</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
