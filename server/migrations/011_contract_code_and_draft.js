// v1.2 合同编号 + 草稿标记 + 数据清空
//
// 改造背景：
//   - 之前合同名手填、按 (name, created_by) 去重，会乱
//   - 新流程：审核完点"发送给法务审核"才创建合同，自动生成编号 YYYY-HT-NNNN（年内序号、全局唯一）
//   - 用户审核完没发法务就退出 → review 是草稿，定时清理（is_draft 标志）
//   - 预留审批流程入口（approval_started_at）
//
// 数据：用户确认所有数据都是测试数据，本 migration 直接清空相关表
//   清：message_attachments / messages / case_reviews / case_versions / contracts / audit_logs
//   留：users / pipelines / pipeline_steps / app_settings

export async function up(knex) {
  // ─── 1) 清空旧数据（按 FK 依赖顺序，避免 RESTRICT 报错） ────────────────────
  // message_attachments → messages（CASCADE 删父表行就够）但保险起见显式清子表
  await knex('message_attachments').delete()
  await knex('messages').delete()
  await knex('case_reviews').delete()
  await knex('case_versions').delete()
  await knex('contracts').delete()
  await knex('audit_logs').delete()

  // ─── 2) contracts 改造 ────────────────────────────────────────────────────
  await knex.schema.alterTable('contracts', (t) => {
    t.text('code')                           // 合同编号 YYYY-HT-NNNN
    t.timestamp('approval_started_at', { useTz: true })  // 审批开始时间，NULL=未审批
  })

  // 编号 UNIQUE NOT NULL（数据已清空，可以直接加 NOT NULL 不会冲突）
  // 但 ALTER TABLE 上 NOT NULL 加约束需要表里所有行都符合——已 truncate，无行，直接加
  await knex.schema.alterTable('contracts', (t) => {
    t.text('code').notNullable().alter()
    t.unique(['code'], { indexName: 'uniq_contracts_code' })
    t.index(['approval_started_at'], 'idx_contracts_approval_started')
  })

  // 去掉旧的 (name, created_by) UNIQUE：加了 code 后名称允许重名
  await knex.schema.alterTable('contracts', (t) => {
    t.dropUnique(['name', 'created_by'], 'uniq_contracts_name_owner')
  })

  // ─── 3) case_reviews 加 is_draft ─────────────────────────────────────────
  await knex.schema.alterTable('case_reviews', (t) => {
    t.boolean('is_draft').notNullable().defaultTo(false)
    t.index(['is_draft'], 'idx_case_reviews_is_draft')
  })
}

export async function down(knex) {
  // 注意：down 只回滚 schema，不恢复被清空的数据（数据本来就是测试数据）

  await knex.schema.alterTable('case_reviews', (t) => {
    t.dropIndex(['is_draft'], 'idx_case_reviews_is_draft')
    t.dropColumn('is_draft')
  })

  await knex.schema.alterTable('contracts', (t) => {
    t.dropIndex(['approval_started_at'], 'idx_contracts_approval_started')
    t.dropUnique(['code'], 'uniq_contracts_code')
    t.dropColumn('approval_started_at')
    t.dropColumn('code')
    // 恢复旧的 (name, created_by) UNIQUE
    t.unique(['name', 'created_by'], { indexName: 'uniq_contracts_name_owner' })
  })
}
