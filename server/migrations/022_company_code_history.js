// v2.1+: 公司简称历史 + 合同编号绑定公司简称
//
// 业务背景：
//   v2.0 起 companies.code 字段已经存在（nullable，UI 上选填、没什么用）。
//   v2.1+ 合同编号格式改为 {code}-HT-YYYY-NNN（按公司+年独立序号），
//   简称必填、必须 2-8 位大写字母数字、且不能与系统中任何公司"现役 + 历史"用过的简称冲突。
//
//   为了实现"历史也不能撞"，新增 company_code_history 表，记录每家公司用过的简称及生效区间。
//   公司创建 / 改简称时，应用层写入一行。
//
// 设计要点：
//   - companies.code 保持 nullable（沿用现有 schema），应用层强校验非空
//     （改成 NOT NULL 会强迫每次插入都填 code，但 v2.0 数据迁移期可能漏掉，先稳一点）
//   - company_code_history 表：
//       valid_from   生效时间（默认 now()）
//       valid_until  作废时间（NULL = 当前还在用；改名时把上一条更新为非空）
//   - 唯一性校验交给应用层（CHECK 跨表 / 复杂查询，PG 不好做强约束）

export async function up(knex) {
  await knex.schema.createTable('company_code_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
    t.text('code').notNullable()
    t.timestamp('valid_from', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('valid_until', { useTz: true })
    t.text('changed_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['company_id'], 'idx_company_code_history_company')
    t.index(['code'], 'idx_company_code_history_code')
  })
  // 同一公司同一时刻只能有一条 valid_until=NULL（当前在用的）
  await knex.raw(
    `CREATE UNIQUE INDEX uniq_company_code_history_current
     ON company_code_history (company_id) WHERE valid_until IS NULL`
  )
  // 简称格式：2-8 位大写字母数字
  await knex.raw(
    `ALTER TABLE company_code_history ADD CONSTRAINT company_code_history_code_chk
     CHECK (code ~ '^[A-Z0-9]{2,8}$')`
  )

  // 给 companies.code 也加格式约束（应用层先校验，DB 兜底）
  await knex.raw(
    `ALTER TABLE companies ADD CONSTRAINT companies_code_format_chk
     CHECK (code IS NULL OR code ~ '^[A-Z0-9]{2,8}$')`
  )
}

export async function down(knex) {
  await knex.raw('ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_code_format_chk')
  await knex.schema.dropTableIfExists('company_code_history')
}
