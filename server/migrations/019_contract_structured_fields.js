// v2.0: 合同结构化字段（来自 v1.4 合并）
//
// 业务背景：v1.x 合同表只有 name + summary 等少数字段，无法做台账筛选 / 到期提醒 / Excel 导出。
// v2.0 在「发起审批」阶段引入结构化字段（AI 预填、用户二次确认），写回 contracts 表。
//
// 注意：本 migration 在 017 之后跑，contracts 表已经有 company_id 字段。
//
// 字段说明：
//   - 沿用现有 name 字段做合同名称（不再新建 contract_name）
//   - our_parties / counter_parties: 各最多 3 个签署主体（text[] 数组）
//   - contract_type / payment_type / term_type: 枚举值（CHECK 约束兜底）
//   - contract_amount: DECIMAL(20, 2)，payment_type=收款/付款/借贷 时业务层必填
//   - term_date / term_text: term_type 决定哪个有值（业务层校验）
//   - handler_id: 经办人 FK → users，默认是发起审批的用户
//   - term_notified_at: 到期提醒已发送时间戳，term_date 修改时业务层清空（展期重新提醒）

const CONTRACT_TYPES = [
  '货物销售合同',
  '货物采购合同',
  '矿权转让合同',
  '研发实验类合同',
  '行政采购类合同',
  '人力资源服务类合同',
  '合作协议',
  '代理协议',
  '房屋租赁合同',
  '股权转让合同',
  '补充协议',
]
const PAYMENT_TYPES = ['收款', '付款', '借贷', '框架类', '无金额']
const TERM_TYPES = ['固定日期', '固定期限', '无期限']

function quoteList(arr) {
  return arr.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
}

export async function up(knex) {
  await knex.schema.alterTable('contracts', (t) => {
    t.specificType('our_parties', 'text[]')
    t.specificType('counter_parties', 'text[]')
    t.text('contract_type')
    t.text('payment_type')
    t.decimal('contract_amount', 20, 2)
    t.text('term_type')
    t.date('term_date')
    t.text('term_text')
    t.text('handler_id').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('term_notified_at', { useTz: true })

    t.index(['handler_id'], 'idx_contracts_handler')
    t.index(['term_type', 'term_date'], 'idx_contracts_term')
    t.index(['contract_type'], 'idx_contracts_contract_type')
    t.index(['payment_type'], 'idx_contracts_payment_type')
  })

  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_contract_type_chk
     CHECK (contract_type IS NULL OR contract_type IN (${quoteList(CONTRACT_TYPES)}))`
  )
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_payment_type_chk
     CHECK (payment_type IS NULL OR payment_type IN (${quoteList(PAYMENT_TYPES)}))`
  )
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_term_type_chk
     CHECK (term_type IS NULL OR term_type IN (${quoteList(TERM_TYPES)}))`
  )
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_our_parties_max_chk
     CHECK (our_parties IS NULL OR array_length(our_parties, 1) <= 3)`
  )
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_counter_parties_max_chk
     CHECK (counter_parties IS NULL OR array_length(counter_parties, 1) <= 3)`
  )
}

export async function down(knex) {
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_counter_parties_max_chk')
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_our_parties_max_chk')
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_term_type_chk')
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_payment_type_chk')
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_contract_type_chk')

  await knex.schema.alterTable('contracts', (t) => {
    t.dropIndex(['payment_type'], 'idx_contracts_payment_type')
    t.dropIndex(['contract_type'], 'idx_contracts_contract_type')
    t.dropIndex(['term_type', 'term_date'], 'idx_contracts_term')
    t.dropIndex(['handler_id'], 'idx_contracts_handler')

    t.dropColumn('term_notified_at')
    t.dropColumn('handler_id')
    t.dropColumn('term_text')
    t.dropColumn('term_date')
    t.dropColumn('term_type')
    t.dropColumn('contract_amount')
    t.dropColumn('payment_type')
    t.dropColumn('contract_type')
    t.dropColumn('counter_parties')
    t.dropColumn('our_parties')
  })
}
