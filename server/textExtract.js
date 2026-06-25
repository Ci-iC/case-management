// 共享：从上传文件抽取纯文本（.txt / .docx / .doc）。
// 合同字段提取（contractFieldExtract.js）与合同起草（contractDraft.js / routes/draft.js）共用。
//   - .txt：直接按 utf8 读
//   - .docx：mammoth 提取纯文本
//   - .doc：word-extractor 提取正文
//   - 其它扩展名：返回空串（调用方自行决定如何兜底）

import fs from 'node:fs/promises'
import path from 'node:path'

export async function extractTextFromFile(absPath, mimeType, originalName) {
  const ext = path.extname(originalName || '').toLowerCase()
  if (ext === '.txt' || mimeType === 'text/plain') {
    return (await fs.readFile(absPath, 'utf8')).trim()
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default
    const buf = await fs.readFile(absPath)
    const result = await mammoth.extractRawText({ buffer: buf })
    return (result.value || '').trim()
  }
  if (ext === '.doc') {
    const WordExtractor = (await import('word-extractor')).default
    const extractor = new WordExtractor()
    const doc = await extractor.extract(absPath)
    return (doc.getBody() || '').trim()
  }
  return ''
}
