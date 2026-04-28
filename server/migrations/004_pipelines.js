// M5: AI 审核流水线（并行节点 + 汇总）
//
// 旧的"单一 review_prompt"被升级为"多节点流水线"。这次迁移会：
//   1. 建 pipelines / pipeline_steps 表
//   2. 给 case_reviews 加 pipeline_id 列（追溯哪个流水线产出的）
//   3. 把现有 app_settings.review_prompt 迁成一条名为「通用合同审核」的默认流水线，
//      其下唯一节点 name="综合审核"，prompt 为旧 review_prompt 内容

export async function up(knex) {
  // ─── 1. pipelines ────────────────────────────────────────────────────────────
  await knex.schema.createTable('pipelines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('name').notNullable()
    t.text('description')
    t.boolean('is_default').notNullable().defaultTo(false)
    t.text('created_by').references('id').inTable('users')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
  })
  // 全表只能有 1 条 is_default=true
  await knex.raw(`CREATE UNIQUE INDEX uniq_pipelines_default ON pipelines (is_default) WHERE is_default = true`)

  // ─── 2. pipeline_steps ───────────────────────────────────────────────────────
  await knex.schema.createTable('pipeline_steps', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('pipeline_id').notNullable().references('id').inTable('pipelines').onDelete('CASCADE')
    t.integer('position').notNullable()
    t.text('name').notNullable()
    t.text('prompt').notNullable()
    t.boolean('enabled').notNullable().defaultTo(true)
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.unique(['pipeline_id', 'position'], { indexName: 'uniq_pipeline_steps_position' })
    t.index(['pipeline_id'], 'idx_pipeline_steps_pipeline')
  })

  // ─── 3. case_reviews 加 pipeline_id ──────────────────────────────────────────
  await knex.schema.alterTable('case_reviews', (t) => {
    t.uuid('pipeline_id').references('id').inTable('pipelines')
  })

  // ─── 4. 数据迁移：从 app_settings.review_prompt 拉旧提示词，建默认流水线 ──
  const promptRow = await knex('app_settings').where({ key: 'review_prompt' }).first()
  const legacyPrompt = promptRow?.value || `请审核用户上传的法律文件，给出修改建议。`

  const [pipeline] = await knex('pipelines').insert({
    name: '通用合同审核',
    description: '系统初始审核模型，可在「审核模型管理」里复制后修改提示词',
    is_default: true,
    created_by: null,
  }, ['id'])

  await knex('pipeline_steps').insert({
    pipeline_id: pipeline.id,
    position: 0,
    name: '综合审核',
    prompt: legacyPrompt,
    enabled: true,
  })
}

export async function down(knex) {
  await knex.schema.alterTable('case_reviews', (t) => {
    t.dropColumn('pipeline_id')
  })
  await knex.schema.dropTableIfExists('pipeline_steps')
  await knex.schema.dropTableIfExists('pipelines')
}
