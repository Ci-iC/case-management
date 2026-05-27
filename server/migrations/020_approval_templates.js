// v2.1: 审批流模板
//
// 业务背景：
//   v1.x / v2.0 的审批第一步固定流到 superadmin，由 superadmin 手填后续审批人；
//   v2.0 设计中 superadmin 已经脱离业务，不应出现在任何审批节点里。
//   v2.1 改造：由 superadmin 在控制台为每家公司预先配置"审批流模板"（中间步骤按角色顺序），
//             经办人发起审批时自动套用模板，按角色匹配本公司当前在职用户作为审批人。
//
// 数据模型：
//   approval_templates       一家公司若干模板，同时只允许一条 is_active=true（生效中）
//   approval_template_steps  模板的中间步骤（首尾两个经办人节点不进库）
//                            step_index 从 1 开始连续递增
//                            role 限定为 legal / finance / manager / seal_admin
//
// 约束设计：
//   - 唯一 active 约束：CREATE UNIQUE INDEX ... WHERE is_active = true
//   - (template_id, step_index) 唯一：避免重复 step_index
//   - role CHECK 约束：只允许 4 个公司层角色，superadmin 不允许出现

const TEMPLATE_STEP_ROLES = ['legal', 'finance', 'manager', 'seal_admin']

export async function up(knex) {
  // ─── approval_templates ───────────────────────────────────────────────────
  await knex.schema.createTable('approval_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
    t.text('name').notNullable()
    t.boolean('is_active').notNullable().defaultTo(false)
    t.text('created_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['company_id'], 'idx_approval_templates_company')
  })
  // 每个公司同时只能有一条 active
  await knex.raw(
    `CREATE UNIQUE INDEX uniq_approval_templates_active_per_company
     ON approval_templates (company_id) WHERE is_active = true`
  )

  // ─── approval_template_steps ──────────────────────────────────────────────
  await knex.schema.createTable('approval_template_steps', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('template_id').notNullable().references('id').inTable('approval_templates').onDelete('CASCADE')
    t.integer('step_index').notNullable()
    t.text('role').notNullable()
    t.text('step_label')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.unique(['template_id', 'step_index'], { indexName: 'uniq_template_step_index' })
    t.index(['template_id'], 'idx_approval_template_steps_template')
  })
  await knex.raw(
    `ALTER TABLE approval_template_steps ADD CONSTRAINT approval_template_steps_role_chk
     CHECK (role IN ('${TEMPLATE_STEP_ROLES.join("','")}'))`
  )
  await knex.raw(
    `ALTER TABLE approval_template_steps ADD CONSTRAINT approval_template_steps_index_chk
     CHECK (step_index >= 1)`
  )
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('approval_template_steps')
  await knex.raw('DROP INDEX IF EXISTS uniq_approval_templates_active_per_company')
  await knex.schema.dropTableIfExists('approval_templates')
}
