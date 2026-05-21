// v1.3 合同审批流程
//
// 数据模型：
//   contracts.status: 'drafting' | 'approving' | 'pending_seal' | 'sealed'
//                     起草中     | 审批中    | 待签署       | 已签署
//   contracts.approval_id   当前活跃审批（同一合同同时只能有一条）
//   contracts.summary       AI 合同摘要（双方/标的/金额/期限），发起审批时生成
//   contracts.sealed_*      用印版文件元数据
//
// approvals               审批流实例：1 合同对应 0~N 条 approval（驳回-重提会建多条）
// approval_steps          流水节点：主链 step_index=1..N + 经办人最终节点 step_type=final-initiator
//                          加签产生的咨询节点：step_type=consultee, parent_step_id 指向被加签主步骤
// approval_actions        操作日志：所有用户动作都落这表，便于审计 + UI 渲染时间线

export async function up(knex) {
  // ─── contracts 加字段 ────────────────────────────────────────────────────
  await knex.schema.alterTable('contracts', (t) => {
    t.text('status').notNullable().defaultTo('drafting')
    t.uuid('approval_id')   // FK 在 approvals 表建好后再加
    t.text('summary')
    t.timestamp('summary_generated_at', { useTz: true })
    t.text('sealed_filename')
    t.text('sealed_storage_path')
    t.bigInteger('sealed_size_bytes')
    t.text('sealed_mime_type')
    t.timestamp('sealed_at', { useTz: true })
    t.text('sealed_by').references('id').inTable('users').onDelete('SET NULL')
  })
  await knex.raw(
    `ALTER TABLE contracts ADD CONSTRAINT contracts_status_chk
     CHECK (status IN ('drafting','approving','pending_seal','sealed'))`
  )
  await knex.schema.alterTable('contracts', (t) => {
    t.index(['status'], 'idx_contracts_status')
  })

  // ─── approvals ──────────────────────────────────────────────────────────
  await knex.schema.createTable('approvals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('contract_id').notNullable().references('id').inTable('contracts').onDelete('CASCADE')
    t.text('initiator_id').notNullable().references('id').inTable('users').onDelete('SET NULL')
    t.text('status').notNullable().defaultTo('pending')
    t.uuid('current_step_id')   // FK 到 approval_steps，循环引用，单独 ALTER 加
    t.text('initiation_note')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('completed_at', { useTz: true })
    t.timestamp('rejected_at', { useTz: true })
    t.index(['contract_id'], 'idx_approvals_contract')
    t.index(['initiator_id'], 'idx_approvals_initiator')
    t.index(['status'], 'idx_approvals_status')
  })
  await knex.raw(
    `ALTER TABLE approvals ADD CONSTRAINT approvals_status_chk
     CHECK (status IN ('pending','completed','rejected'))`
  )

  // ─── approval_steps ─────────────────────────────────────────────────────
  await knex.schema.createTable('approval_steps', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('approval_id').notNullable().references('id').inTable('approvals').onDelete('CASCADE')
    t.integer('step_index')                    // 主链 1..N；最终经办人节点 = 999；consultee 节点为 NULL
    t.uuid('parent_step_id').references('id').inTable('approval_steps').onDelete('CASCADE')  // 加签节点指向加签人主节点
    t.text('step_type').notNullable()          // 'approver' | 'consultee' | 'final-initiator'
    t.text('assignee_id').notNullable().references('id').inTable('users').onDelete('SET NULL')
    t.text('status').notNullable().defaultTo('pending')   // pending | approved | rejected | skipped
    t.text('comment')
    t.timestamp('actioned_at', { useTz: true })
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['approval_id'], 'idx_approval_steps_approval')
    t.index(['assignee_id', 'status'], 'idx_approval_steps_assignee_status')
  })
  await knex.raw(
    `ALTER TABLE approval_steps ADD CONSTRAINT approval_steps_type_chk
     CHECK (step_type IN ('approver','consultee','final-initiator'))`
  )
  await knex.raw(
    `ALTER TABLE approval_steps ADD CONSTRAINT approval_steps_status_chk
     CHECK (status IN ('pending','approved','rejected','skipped'))`
  )

  // 现在 approvals.current_step_id 才能加 FK（步骤表已建好）
  await knex.schema.alterTable('approvals', (t) => {
    t.foreign('current_step_id').references('id').inTable('approval_steps').onDelete('SET NULL')
  })

  // 现在才能给 contracts.approval_id 加 FK
  await knex.schema.alterTable('contracts', (t) => {
    t.foreign('approval_id').references('id').inTable('approvals').onDelete('SET NULL')
    t.index(['approval_id'], 'idx_contracts_approval')
  })

  // ─── approval_actions ───────────────────────────────────────────────────
  await knex.schema.createTable('approval_actions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('approval_id').notNullable().references('id').inTable('approvals').onDelete('CASCADE')
    t.uuid('step_id').references('id').inTable('approval_steps').onDelete('SET NULL')
    t.text('actor_id').notNullable().references('id').inTable('users').onDelete('SET NULL')
    t.text('action').notNullable()              // 见下面注释
    t.text('comment')
    t.uuid('target_step_id').references('id').inTable('approval_steps').onDelete('SET NULL')
    t.jsonb('payload')                          // 例如超管通过时填的后续审批人列表
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['approval_id', 'created_at'], 'idx_approval_actions_approval_created')
  })
  await knex.raw(`
    ALTER TABLE approval_actions ADD CONSTRAINT approval_actions_action_chk
    CHECK (action IN (
      'submit',
      'approve',
      'reject_to_step',
      'reject_to_start',
      'add_consultee',
      'submit_consultation',
      'resubmit',
      'upload_seal'
    ))
  `)

  // ─── 默认 AI 合同摘要 prompt ─────────────────────────────────────────────
  const SUMMARY_PROMPT_DEFAULT = `你是一名资深合同审阅助理，请用简洁的中文段落总结以下合同的关键信息，方便审批人快速了解。

按下列 4 个方面输出（每项一段，约 1-3 句）：

1. 双方主体：明确列出甲方和乙方（含身份/资质）
2. 合同标的：简述本合同的标的物 / 服务内容
3. 金额与支付节奏：总金额、币种、付款方式、各期付款条件和比例
4. 关键期限：合同期限、履行期限、关键节点

只输出上述 4 个段落，不要 Markdown 标题、不要列表符号、不要前后导语。如某项合同未明确，写"合同未明确"即可，不要编造。`

  await knex('app_settings')
    .insert({
      key: 'contract_summary_prompt',
      value: SUMMARY_PROMPT_DEFAULT,
      updated_at: new Date(),
    })
    .onConflict('key')
    .ignore()
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('approval_actions')
  // 先清掉循环 FK
  await knex.schema.alterTable('contracts', (t) => {
    t.dropForeign('approval_id')
    t.dropIndex(['approval_id'], 'idx_contracts_approval')
  })
  await knex.schema.alterTable('approvals', (t) => {
    t.dropForeign('current_step_id')
  })
  await knex.schema.dropTableIfExists('approval_steps')
  await knex.schema.dropTableIfExists('approvals')

  await knex.raw('ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_chk')
  await knex.schema.alterTable('contracts', (t) => {
    t.dropIndex(['status'], 'idx_contracts_status')
    t.dropColumn('sealed_by')
    t.dropColumn('sealed_at')
    t.dropColumn('sealed_mime_type')
    t.dropColumn('sealed_size_bytes')
    t.dropColumn('sealed_storage_path')
    t.dropColumn('sealed_filename')
    t.dropColumn('summary_generated_at')
    t.dropColumn('summary')
    t.dropColumn('approval_id')
    t.dropColumn('status')
  })

  await knex('app_settings').where({ key: 'contract_summary_prompt' }).delete()
}
