// 合同模板库管理 API（仅超管）：编辑「模板说明.md」指引 + 增删改下载 .docx 模板。
import { apiFetch, apiFetchForm, downloadFile } from './client'

export interface TemplateFileInfo {
  name: string
  sizeBytes: number
  updatedAt: string
}

export const contractTemplatesApi = {
  /** 取指引正文 + 模板文件清单 */
  load() {
    return apiFetch<{ manifest: string; files: TemplateFileInfo[] }>(`/api/contract-templates`)
  },
  /** 保存「模板说明.md」指引 */
  saveManifest(content: string) {
    return apiFetch<{ ok: true }>(`/api/contract-templates/manifest`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
  },
  /** 上传 / 替换模板（同名覆盖） */
  uploadFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    return apiFetchForm<{ ok: true; filename: string }>(`/api/contract-templates/files`, form)
  },
  /** 删除模板 */
  deleteFile(name: string) {
    return apiFetch<{ ok: true }>(`/api/contract-templates/files/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
  },
  /** 下载模板 */
  downloadFile(name: string) {
    return downloadFile(`/api/contract-templates/files/${encodeURIComponent(name)}`, name)
  },
}
