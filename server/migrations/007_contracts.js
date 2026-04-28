// M6: 合同台账（contracts）+ case_reviews 关联到合同
//
// 业务模型：
//   - 一份"合同"由用户取个名字（如"采购合同 - 某供应商"）
//   - 同一份合同的多次审核 = 多个 review 挂在同一 contract 下
//   - 系统按时间序展示版本（v1, v2, ...）
//
// 老审核记录（contract_id 为 NULL）以"未归类"展示在合同台账里

export async function up(knex) {
  await knex.schema.createTable('contracts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('name').notNullable()
    t.text('description')
    t.text('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    // 同一用户同名合同算同一份；不同用户同名合同各自独立（避免命名冲突干扰）
    t.unique(['name', 'created_by'], { indexName: 'uniq_contracts_name_owner' })
    t.index(['created_by'], 'idx_contracts_owner')
    t.index(['updated_at'], 'idx_contracts_updated_at')
  })

  await knex.schema.alterTable('case_reviews', (t) => {
    t.uuid('contract_id').references('id').inTable('contracts').onDelete('SET NULL')
    t.index(['contract_id'], 'idx_case_reviews_contract')
  })
}

export async function down(knex) {
  await knex.schema.alterTable('case_reviews', (t) => {
    t.dropIndex(['contract_id'], 'idx_case_reviews_contract')
    t.dropColumn('contract_id')
  })
  await knex.schema.dropTableIfExists('contracts')
}
