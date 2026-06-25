// 把结构化合同正文渲染成 .docx Buffer（合同起草用）。
//
// 输入结构（由 AI 产出，contractDraft.js 已做兜底校验）：
//   {
//     title: string,                              // 合同标题
//     sections: [                                 // 顺序渲染：前言 / 各条款 / 落款 都是 section
//       { heading?: string, paragraphs: string[] }
//     ]
//   }
// 渲染约定（贴近中文合同习惯）：
//   - 标题：居中、加粗、二号（16pt）
//   - 条款标题（heading）：加粗、小四（12pt），段前留白
//   - 正文段落：宋体五号（10.5pt）、首行缩进 2 字符、1.5 倍行距
//   - 字体统一「宋体」，Word 会按文档字体解析中文

import {
  Document, Packer, Paragraph, TextRun, PageBreak, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'

const FONT = '宋体'
const BODY_SIZE = 21      // half-points = 10.5pt（五号）
const HEADING_SIZE = 24   // 12pt（小四）
const TITLE_SIZE = 32     // 16pt（二号）

// 段内「软换行」的内部标记：渲染成 <w:br/>（同一段内换行，续行不再首行缩进）。
// 用 U+2028 当标记——它本身就是「行分隔符」，语义吻合。
const SOFT_BREAK = '\u2028'

// 把模型可能吐出的各种「换行 / 换页」写法，归一化成内部可渲染的形式。
//   背景：docx 只认 \n / \r 作换行；而模型生成 JSON 时，串内的换行常常是
//     - U+2028 行分隔 / U+2029 段分隔 / U+0085 NEL / U+000B 垂直制表 / U+000C 换页
//     - 字面量 "\n"（反斜杠+n，模型多转义一层）
//     - <br> / </p><p> 等 HTML
//   这些若不归一化，会以「看得见、却不起作用的符号」留在 Word 里（用户反馈的格式问题）。
//   归一化结果：\f = 换页（真分页符）；\n = 段落分隔（另起新段）；U+2028 = 段内软换行。
function normalizeBreaks(input) {
  let s = String(input ?? '')
  // 1) 字面量转义序列（模型常多转义一层）：\\r\\n \\n \\r → 换行；\\f → 换页；\\t → 制表
  s = s.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\\f/g, '\f').replace(/\\t/g, '\t')
  // 2) HTML：<br> 作段内软换行；</p><p> 与孤立的 <p>/</p> 作段落分隔
  s = s.replace(/<\s*br\s*\/?\s*>/gi, SOFT_BREAK)
    .replace(/<\/\s*p\s*>\s*<\s*p[^>]*>/gi, '\n')
    .replace(/<\/?\s*p[^>]*>/gi, '\n')
  // 3) 换页标记（U+000C 或文字写法）→ \f
  s = s.replace(
    /\f|\[\s*分页符?\s*\]|【\s*分页符?\s*】|<\s*分页符?\s*\/?\s*>|-{3,}\s*(?:page\s*break|分页符?)\s*-{3,}/gi,
    '\f',
  )
  // 4) Unicode 段分隔（U+2029 / NEL U+0085）→ 新段；垂直制表 U+000B → 段内软换行
  s = s.replace(/[\u2029\u0085]/g, '\n').replace(/\u000B/g, SOFT_BREAK)
  return s
}

function titlePara(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [new TextRun({ text: text || '合同', bold: true, size: TITLE_SIZE, font: FONT })],
  })
}

function headingPara(text) {
  // 标题为单行：把任何换行/换页符压成空格，避免标题里冒出符号
  const clean = normalizeBreaks(text).replace(/[\f\n\u2028]+/g, ' ').trim()
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: clean, bold: true, size: HEADING_SIZE, font: FONT })],
  })
}

// 一个正文段落：段内若含软换行（U+2028），用 <w:br/> 续行（续行不再首行缩进）。
function bodyPara(text) {
  const lines = String(text).split(SOFT_BREAK)
  const children = lines.map((ln, i) => new TextRun(
    i === 0
      ? { text: ln, size: BODY_SIZE, font: FONT }
      : { text: ln, size: BODY_SIZE, font: FONT, break: 1 },   // break:1 = 段内 <w:br/>
  ))
  return new Paragraph({
    spacing: { line: 360, lineRule: 'auto' },     // 1.5 倍行距（240 = 单倍）
    indent: { firstLine: 480 },                   // 首行缩进 2 字符（240 twips/字符）
    children,
  })
}

function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] })
}

// 无边框（落款分栏表格用：只借表格做对齐，不显示框线）
const NO_EDGE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = {
  top: NO_EDGE, bottom: NO_EDGE, left: NO_EDGE, right: NO_EDGE,
  insideHorizontal: NO_EDGE, insideVertical: NO_EDGE,
}

// 单元格段落：同 bodyPara 但不首行缩进（落款分栏里每格自成一栏）。
function cellPara(text) {
  const lines = String(text).split(SOFT_BREAK)
  const children = lines.map((ln, i) => new TextRun(
    i === 0
      ? { text: ln, size: BODY_SIZE, font: FONT }
      : { text: ln, size: BODY_SIZE, font: FONT, break: 1 },
  ))
  return new Paragraph({ spacing: { line: 360, lineRule: 'auto' }, children })
}

// 把一组「含制表符 \t」的行渲染成无边框表格，借表格列实现绝对对齐。
//   背景：落款署名区常是「甲方…\t乙方…」两栏，仅靠 \t 没有制表位会忽左忽右、对不齐。
//   连续的分栏行合成一个表格，各行同列对齐；列数取该组里最多的列数，列宽均分。
function columnTable(lines) {
  const rows = lines.map((l) => l.split('\t'))
  const cols = Math.max(...rows.map((r) => r.length))
  const colW = Math.floor(100 / cols)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: rows.map((cells) => new TableRow({
      children: Array.from({ length: cols }, (_, i) => new TableCell({
        width: { size: colW, type: WidthType.PERCENTAGE },
        margins: { top: 20, bottom: 20, left: 0, right: 120 },
        borders: NO_BORDERS,
        children: [cellPara(cells[i] ?? '')],
      })),
    })),
  })
}

// 把一个 section 的所有段落展开成有序「块」：
//   { kind: 'page' }（换页） | { kind: 'line', text }（一行正文，text 可能含 \t 与软换行）
function sectionToBlocks(paras) {
  const blocks = []
  for (const p of paras) {
    const text = normalizeBreaks(p)
    const pages = text.split('\f')
    pages.forEach((page, pi) => {
      if (pi > 0) blocks.push({ kind: 'page' })
      for (const line of page.split(/\r?\n/)) blocks.push({ kind: 'line', text: line })
    })
  }
  return blocks
}

/** 把结构化合同渲染成 .docx Buffer */
export async function renderContractDocx(contract) {
  const children = []
  children.push(titlePara(contract?.title))

  const sections = Array.isArray(contract?.sections) ? contract.sections : []
  for (const sec of sections) {
    if (sec?.heading && String(sec.heading).trim()) {
      children.push(headingPara(String(sec.heading).trim()))
    }
    const paras = Array.isArray(sec?.paragraphs) ? sec.paragraphs : []
    const blocks = sectionToBlocks(paras)

    // 顺序输出；连续的「含 \t 分栏行」合并成一个对齐表格
    let i = 0
    while (i < blocks.length) {
      const b = blocks[i]
      if (b.kind === 'page') { children.push(pageBreakPara()); i += 1; continue }
      if (b.text.includes('\t')) {
        const group = []
        while (i < blocks.length && blocks[i].kind === 'line' && blocks[i].text.includes('\t')) {
          group.push(blocks[i].text); i += 1
        }
        children.push(columnTable(group))
        continue
      }
      children.push(bodyPara(b.text)); i += 1
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  })
  return Packer.toBuffer(doc)
}
