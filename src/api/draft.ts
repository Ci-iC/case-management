import { apiFetch, apiFetchForm, downloadFile } from './client'

export interface DraftMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface DraftSection {
  heading: string | null
  paragraphs: string[]
}

export interface GenerateResult {
  downloadId: string
  filename: string
  title: string
  sections: DraftSection[]
  templateUsed: string | null
}

export const draftApi = {
  /** 引导对话一轮。templateFile：首轮由后端选定后回传，后续带上复用（省一次模板匹配） */
  chat(messages: DraftMessage[], templateFile?: string | null) {
    return apiFetch<{ reply: string; readyToDraft: boolean; templateFile: string | null }>('/api/draft/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, templateFile: templateFile || undefined }),
    })
  },

  /** 上传参考文件 → 抽取纯文本 */
  upload(file: File) {
    const form = new FormData()
    form.append('file', file)
    return apiFetchForm<{ filename: string; text: string; chars: number }>('/api/draft/upload', form)
  },

  /** 生成合同草稿 */
  generate(messages: DraftMessage[], templateFile?: string | null) {
    return apiFetch<GenerateResult>('/api/draft/generate', {
      method: 'POST',
      body: JSON.stringify({ messages, templateFile: templateFile || undefined }),
    })
  },

  /** 下载生成的 .docx */
  download(downloadId: string, filename: string) {
    return downloadFile(`/api/draft/download/${downloadId}`, filename)
  },
}

// 起草表单的 7 项必填（与后端 REQUIRED_FIELDS 对应）
export const DRAFT_FORM_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'contractType', label: '合同类型', placeholder: '如：货物采购合同 / 服务合同 / 租赁合同' },
  { key: 'partyA', label: '甲方全称', placeholder: '签约一方的营业执照全称' },
  { key: 'partyB', label: '乙方全称', placeholder: '签约另一方的营业执照全称' },
  { key: 'subject', label: '合同标的', placeholder: '采购/服务/租赁的具体内容' },
  { key: 'amount', label: '合同金额及币种', placeholder: '如：人民币 100 万元（含税）' },
  { key: 'payment', label: '付款方式', placeholder: '如：签订后预付 30%，验收后付清' },
  { key: 'term', label: '合同期限', placeholder: '如：自签订之日起一年 / 至 2026-12-31' },
]
