// 统一管理上传/附件存储。所有相对路径都以 server/data/ 为根。

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = path.resolve(__dirname, 'data')

/** 把绝对路径转成相对 server/data/ 的存储路径（POSIX 风格，跨平台稳定） */
export function toStoragePath(absPath) {
  const rel = path.relative(DATA_ROOT, absPath)
  return rel.split(path.sep).join('/')
}

/** 把 storage_path 还原成绝对路径 */
export function toAbsolutePath(storagePath) {
  return path.join(DATA_ROOT, storagePath)
}

/** 安全文件名（去掉路径分隔符、控制字符；保留原扩展名） */
export function safeFilename(name) {
  return String(name || '').replace(/[\\/]/g, '_').replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'file'
}

/** 确保目录存在 */
export async function ensureDir(absDir) {
  await fs.mkdir(absDir, { recursive: true })
}

/** 删除文件（不存在不报错） */
export async function safeUnlink(absPath) {
  try { await fs.unlink(absPath) } catch { /* ignore */ }
}

/** 读文件为 Buffer */
export async function readFileBuffer(absPath) {
  return fs.readFile(absPath)
}

export { DATA_ROOT }
