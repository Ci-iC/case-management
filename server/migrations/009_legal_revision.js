// case_reviews 加法务审核版字段：法务收到送审后上传修订版，业务人员能下载

export async function up(knex) {
  await knex.schema.alterTable('case_reviews', (t) => {
    t.text('reviewed_filename')
    t.text('reviewed_storage_path')
    t.bigInteger('reviewed_size_bytes')
    t.text('reviewed_mime_type')
    t.text('reviewed_by').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('reviewed_at', { useTz: true })
  })
}

export async function down(knex) {
  await knex.schema.alterTable('case_reviews', (t) => {
    t.dropColumn('reviewed_filename')
    t.dropColumn('reviewed_storage_path')
    t.dropColumn('reviewed_size_bytes')
    t.dropColumn('reviewed_mime_type')
    t.dropColumn('reviewed_by')
    t.dropColumn('reviewed_at')
  })
}
