// Audit + version snapshot tables

export async function up(knex) {
  await knex.schema.createTable('case_versions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('case_id').notNullable().references('id').inTable('cases').onDelete('CASCADE')
    t.integer('version').notNullable()
    t.jsonb('snapshot').notNullable()
    t.text('changed_by').references('id').inTable('users')
    t.timestamp('changed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['case_id', 'version'], 'idx_case_versions_case_version')
  })

  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('actor_id').references('id').inTable('users')
    t.text('action').notNullable()        // e.g. 'case.create' / 'case.update' / 'auth.login'
    t.text('target_type')                 // 'case' / 'user' / null
    t.text('target_id')
    t.jsonb('payload')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['target_type', 'target_id'], 'idx_audit_logs_target')
    t.index(['actor_id'], 'idx_audit_logs_actor')
    t.index(['created_at'], 'idx_audit_logs_created_at')
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs')
  await knex.schema.dropTableIfExists('case_versions')
}
