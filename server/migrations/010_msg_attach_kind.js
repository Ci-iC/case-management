// 区分消息附件中"引用合同原版"和"引用法务修订版"
//
// 背景：009 之前 message_attachments.review_id 引用 case_reviews，下载时一律
// 跟到 uploaded_storage_path（原合同）。引入"法务修订版回传业务方"流程后，
// 同一个 review 可能被两份附件引用：
//   - 业务发法务时引用"原合同"
//   - 法务上传修订版后自动回传时引用"法务版"
//
// 加 review_file_kind 列：
//   - 'original' → 下载时跟 case_reviews.uploaded_storage_path
//   - 'legal'    → 下载时跟 case_reviews.reviewed_storage_path
//   - NULL       → 不是 review 引用（普通自传附件，用自己的 storage_path）
//
// 历史数据：现有 review_id 非空的全部 backfill 为 'original'

export async function up(knex) {
  await knex.schema.alterTable('message_attachments', (t) => {
    t.text('review_file_kind').nullable()
  })
  await knex('message_attachments')
    .whereNotNull('review_id')
    .whereNull('review_file_kind')
    .update({ review_file_kind: 'original' })
}

export async function down(knex) {
  await knex.schema.alterTable('message_attachments', (t) => {
    t.dropColumn('review_file_kind')
  })
}
