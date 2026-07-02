// v2.x：合同类型枚举新增「保密协议」「其他」
//
// 业务背景：019 migration 用 CHECK 约束 contracts_contract_type_chk 兜底了合同类型枚举。
// 该约束已在既有库上生效，直接改 019 的数组不会更新线上约束——插入新类型会被 Postgres 拒绝。
// 本 migration 重建约束，把枚举扩展为 13 项（新增 保密协议、其他）。
//
// 注意：枚举的权威副本还存在于 server/routes/contracts.js、server/contractFieldExtract.js、
// src/components/contracts/ContractFieldsCard.tsx，需同步维护（本次已一并更新）。

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
  '保密协议',
  '其他',
]

function quoteList(arr) {
  return arr.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')
}

export async function up(knex) {
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_contract_type_chk')
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_contract_type_chk
     CHECK (contract_type IS NULL OR contract_type IN (${quoteList(CONTRACT_TYPES)}))`
  )
}

export async function down(knex) {
  // 回滚为 019 的原始 11 项枚举
  const ORIGINAL = CONTRACT_TYPES.filter((v) => v !== '保密协议' && v !== '其他')
  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_contract_type_chk')
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_contract_type_chk
     CHECK (contract_type IS NULL OR contract_type IN (${quoteList(ORIGINAL)}))`
  )
}
