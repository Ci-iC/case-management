// 合同模板库读取（合同起草用）。
//
// 约定：模板文件夹固定在 server/data/contract-templates/，里面放：
//   - 若干 Word 模板（.docx）
//   - 一个「模板说明.md」，描述每个模板的适用场景 / 使用条件
//
// AI 起草前读「模板说明.md」判断用哪个模板；选中后读该模板正文当参考。
// 文件夹 / 说明文件不存在都视为"无模板"，让 AI 自行起草（不报错）。
// 模板文件全程只读，绝不修改。

import fs from 'node:fs/promises'
import path from 'node:path'
import { DATA_ROOT, ensureDir, safeFilename } from './storage.js'
import { extractTextFromFile } from './textExtract.js'

const TEMPLATE_DIR = path.join(DATA_ROOT, 'contract-templates')
const MANIFEST_NAME = '模板说明.md'
const TEMPLATE_EXTS = new Set(['.docx', '.doc'])

export function getTemplateDir() {
  return TEMPLATE_DIR
}

/** 列出模板库里的 .docx / .doc 文件名（不含说明文件）。文件夹不存在返回 []。 */
export async function listTemplateFiles() {
  try {
    const names = await fs.readdir(TEMPLATE_DIR)
    return names
      .filter((n) => {
        const ext = path.extname(n).toLowerCase()
        return ext === '.docx' || ext === '.doc'
      })
      .sort()
  } catch {
    return []
  }
}

/** 读「模板说明.md」全文，没有则返回 null。 */
export async function readManifest() {
  try {
    const txt = await fs.readFile(path.join(TEMPLATE_DIR, MANIFEST_NAME), 'utf8')
    return txt.trim() || null
  } catch {
    return null
  }
}

/** 读指定模板正文（纯文本），用于喂给 AI 当起草参考。
 *  防目录穿越：只接受模板库里实际存在的文件名。 */
export async function readTemplateText(filename) {
  if (!filename) return null
  const safe = path.basename(filename)          // 去掉任何路径成分
  const files = await listTemplateFiles()
  if (!files.includes(safe)) return null
  const abs = path.join(TEMPLATE_DIR, safe)
  try {
    const text = await extractTextFromFile(abs, null, safe)
    return text || null
  } catch {
    return null
  }
}

// ─── 管理（admin 编辑模板库 / 指引）────────────────────────────────────────────

/** 模板文件清单（含大小、修改时间）。文件夹不存在返回 []。 */
export async function listTemplateFileStats() {
  try {
    const names = await fs.readdir(TEMPLATE_DIR)
    const out = []
    for (const n of names) {
      if (!TEMPLATE_EXTS.has(path.extname(n).toLowerCase())) continue
      try {
        const st = await fs.stat(path.join(TEMPLATE_DIR, n))
        out.push({ name: n, sizeBytes: st.size, updatedAt: st.mtime.toISOString() })
      } catch { /* 跳过读不到的 */ }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return out
  } catch {
    return []
  }
}

/** 写入「模板说明.md」（给 AI 选模板用的指引）。允许写空内容。 */
export async function writeManifest(content) {
  await ensureDir(TEMPLATE_DIR)
  await fs.writeFile(path.join(TEMPLATE_DIR, MANIFEST_NAME), String(content ?? ''), 'utf8')
}

/** 把上传的模板文件从 tmp 移入模板库；仅接受 .docx/.doc，同名覆盖（即"替换"）。返回最终文件名。 */
export async function saveTemplateFile(tmpAbsPath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase()
  if (!TEMPLATE_EXTS.has(ext)) {
    const err = new Error('模板文件只支持 Word（.docx/.doc）'); err.status = 400; throw err
  }
  await ensureDir(TEMPLATE_DIR)
  const safe = safeFilename(path.basename(originalName))
  await fs.rename(tmpAbsPath, path.join(TEMPLATE_DIR, safe))
  return safe
}

/** 删除一个模板文件（basename 防穿越，必须确实在库里）。 */
export async function deleteTemplateFile(filename) {
  const safe = path.basename(String(filename || ''))
  const files = await listTemplateFiles()
  if (!files.includes(safe)) {
    const err = new Error('模板文件不存在'); err.status = 404; throw err
  }
  await fs.unlink(path.join(TEMPLATE_DIR, safe))
}

/** 取模板文件绝对路径（下载用，防穿越；不存在返回 null）。 */
export async function templateFileAbsPath(filename) {
  const safe = path.basename(String(filename || ''))
  const files = await listTemplateFiles()
  if (!files.includes(safe)) return null
  return path.join(TEMPLATE_DIR, safe)
}
