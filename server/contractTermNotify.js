// v1.4/v2.0 合同到期提醒定时任务
//
// 规则：
//   - term_type='固定日期' 且 term_date 在未来 20 天内 且 term_notified_at IS NULL → 发站内信
//   - 收件人：handler（经办人），用合同所属公司发件人 = 该公司任意一个 manager（找不到则 fallback 用 NULL）
//   - 发送后 term_notified_at 置 now()
//   - term_date 被修改时业务层清空 term_notified_at（contracts.js PATCH /draft 已处理）
//
// 调度：server/index.js 启动时调一次 + 每 6 小时跑一次

import { db } from './db.js'

const DAYS_AHEAD = 20

export async function runContractTermNotify() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + DAYS_AHEAD)

  // 找出符合条件的合同
  //   - term_type='固定日期'
  //   - term_date 在 [today, today+20d] 内
  //   - term_notified_at IS NULL
  //   - handler_id 非 NULL
  //   - 公司还是 active
  const rows = await db('contracts as c')
    .innerJoin('companies as co', 'c.company_id', 'co.id')
    .where('c.term_type', '固定日期')
    .where('co.status', 'active')
    .whereNotNull('c.handler_id')
    .whereNull('c.term_notified_at')
    .whereBetween('c.term_date', [today, cutoff])
    .select('c.id', 'c.code', 'c.name', 'c.term_date', 'c.handler_id', 'c.company_id')

  if (rows.length === 0) return { sent: 0 }

  let sent = 0
  for (const row of rows) {
    try {
      // 找公司里任意一个 manager 作发件人（用于"系统通知"语义）
      const managerRow = await db('user_company_roles as ucr')
        .innerJoin('users as u', 'ucr.user_id', 'u.id')
        .whereNull('u.deleted_at')
        .where({ 'ucr.company_id': row.company_id, 'ucr.role': 'manager' })
        .select('u.id')
        .first()
      const senderId = managerRow?.id || row.handler_id  // fallback：自己给自己（messages 表 sender_id NOT NULL）

      const termDateStr = row.term_date instanceof Date
        ? row.term_date.toISOString().slice(0, 10)
        : String(row.term_date).slice(0, 10)

      const body =
        `合同到期提醒：${row.code} 《${row.name}》将于 ${termDateStr} 到期。\n` +
        `如需续约或调整期限，请尽早处理。`

      await db.transaction(async (trx) => {
        await trx('messages').insert({
          sender_id: senderId,
          receiver_id: row.handler_id,
          body,
          company_id: row.company_id,
          is_read: false,
        })
        await trx('contracts').where({ id: row.id }).update({ term_notified_at: new Date() })
      })
      sent++
    } catch (e) {
      console.error('[term-notify] failed for contract', row.code, e?.message || e)
    }
  }
  return { sent }
}
