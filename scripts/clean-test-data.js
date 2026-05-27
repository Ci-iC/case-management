// 一次性清空合同 / 审核 / 审批 / 消息 / 审计日志测试数据
//
// 用途：v1.3 → v1.4 过渡前清空所有业务数据（用户确认全是测试数据）
//
// 保留：users / pipelines / pipeline_steps / app_settings
// 清空：approval_actions / approval_steps / approvals
//       message_attachments / messages
//       case_reviews / case_versions
//       contracts
//       audit_logs
//
// 运行方式：
//   本地：node scripts/clean-test-data.js
//   服务器：cd /opt/case-management && node scripts/clean-test-data.js
//
// 注意：不删落盘的合同文件（server/data/reviews 等）；如需一并清理可手动 rm -rf。

import { db } from '../server/db.js'

const TABLES_IN_ORDER = [
  'approval_actions',
  'approval_steps',
  'approvals',
  'message_attachments',
  'messages',
  'case_reviews',
  'case_versions',
  'contracts',
  'audit_logs',
]

async function run() {
  console.log('[clean] 即将清空以下表（按 FK 依赖顺序）：')
  for (const t of TABLES_IN_ORDER) console.log('  -', t)
  console.log('')

  for (const table of TABLES_IN_ORDER) {
    const before = await db(table).count('* as n').first()
    await db(table).delete()
    const after = await db(table).count('* as n').first()
    console.log(`[clean] ${table}: ${before?.n ?? '?'} → ${after?.n ?? '?'}`)
  }

  console.log('')
  console.log('[clean] 完成。users / pipelines / app_settings 已保留。')
}

run()
  .catch((e) => { console.error('[clean] failed:', e); process.exitCode = 1 })
  .finally(() => db.destroy())
