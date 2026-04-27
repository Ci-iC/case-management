// Initial schema: users + cases (with version + unique caseNumber)

export async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto')

  await knex.schema.createTable('users', (t) => {
    t.text('id').primary()
    t.text('username').notNullable().unique()
    t.text('password_hash').notNullable()
    t.text('role').notNullable()
    t.text('display_name')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.text('created_by')
  })
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('admin','user'))`)

  await knex.schema.createTable('cases', (t) => {
    t.text('id').primary()

    t.text('case_number').notNullable()
    t.text('case_name').notNullable()
    t.text('cause_of_action').notNullable()
    t.text('dispute_type').notNullable()
    t.text('court')
    t.text('stage').notNullable()
    t.text('judgment_document_number')
    t.text('closing_method')
    t.text('assigned_lawyer')
    t.text('business_department')

    t.text('our_party').notNullable()
    t.text('opposing_party').notNullable()
    t.text('third_parties')
    t.text('opposing_lawyer')
    t.text('opposing_firm')
    t.decimal('total_amount', 18, 2)
    t.decimal('our_claim_amount', 18, 2)
    t.decimal('opposing_claim_amount', 18, 2)

    t.date('filing_date')
    t.date('arbitration_hearing_date')
    t.date('first_trial_hearing_date')
    t.date('second_trial_hearing_date')
    t.date('hearing_date')
    t.date('judgment_date')
    t.date('next_key_date')
    t.text('next_key_date_label')

    t.text('main_disputes')
    t.text('our_position')
    t.text('current_progress').notNullable()
    t.text('judgment_result')
    t.text('execution_progress')
    t.text('review_notes')
    t.text('remarks')

    t.integer('version').notNullable().defaultTo(1)
    t.boolean('is_archived').notNullable().defaultTo(false)
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.text('created_by').notNullable().references('id').inTable('users')
    t.text('updated_by').references('id').inTable('users')

    t.unique(['case_number'], { indexName: 'uniq_cases_case_number' })
    t.index(['updated_at'], 'idx_cases_updated_at')
    t.index(['is_archived'], 'idx_cases_is_archived')
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('cases')
  await knex.schema.dropTableIfExists('users')
}
