import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface OpenAISettings {
  apiKey: string
  baseURL: string
  defaultModel: string
}

interface SettingsState extends OpenAISettings {
  setSettings: (partial: Partial<OpenAISettings>) => void
  reset: () => void
}

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_MODEL = 'gpt-5-mini'

export const MODEL_OPTIONS: { value: string; label: string; note?: string }[] = [
  { value: 'gpt-5-mini',  label: 'gpt-5-mini',  note: '默认推荐' },
  { value: 'gpt-4o',      label: 'gpt-4o' },
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'o3-mini',     label: 'o3-mini',     note: '推理模型，不支持 PDF 图文输入' },
]

const initial: OpenAISettings = {
  apiKey: '',
  baseURL: DEFAULT_BASE_URL,
  defaultModel: DEFAULT_MODEL,
}

export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  ...initial,
  setSettings: (partial) => set(partial),
  reset: () => set(initial),
}), {
  name: 'case-management-settings',
}))
