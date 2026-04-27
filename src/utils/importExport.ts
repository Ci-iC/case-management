import type { CaseRecord } from '@/types'

const EXPORT_VERSION = '1.0'

export interface ExportPayload {
  exportVersion: string
  exportDate: string
  caseCount: number
  cases: CaseRecord[]
}

/**
 * Serialises the given cases to a JSON .txt file and triggers browser download.
 */
export function exportCasesToTxt(cases: CaseRecord[], filename?: string): void {
  const payload: ExportPayload = {
    exportVersion: EXPORT_VERSION,
    exportDate: new Date().toISOString().slice(0, 10),
    caseCount: cases.length,
    cases,
  }
  const content = JSON.stringify(payload, null, 2)
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `案件台账导出_${new Date().toISOString().slice(0, 10)}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ParseResult {
  cases: CaseRecord[]
  exportDate?: string
  error?: string
}

/**
 * Parses a .txt file exported by this system.
 * Returns the array of CaseRecord objects or an error message.
 */
export function parseCasesFromText(text: string): ParseResult {
  try {
    const data = JSON.parse(text) as Partial<ExportPayload>
    if (!data.cases || !Array.isArray(data.cases)) {
      return { cases: [], error: '文件格式不正确，未找到案件数据（cases 字段缺失）' }
    }
    // Basic structural check on first item
    const first = data.cases[0]
    if (first && (typeof first.id !== 'string' || typeof first.caseName !== 'string')) {
      return { cases: [], error: '案件数据格式异常，请确认文件来源正确' }
    }
    return { cases: data.cases, exportDate: data.exportDate }
  } catch {
    return { cases: [], error: '文件解析失败，请确认文件内容为有效的 JSON 格式' }
  }
}
