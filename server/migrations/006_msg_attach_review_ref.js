// 优化磁盘占用：消息附件不再复制 review 的原文件，改成引用同一物理文件
//
// message_attachments 加 review_id (nullable, FK case_reviews ON DELETE SET NULL):
//   - 普通上传附件：review_id 为 null，storage_path 是自己的文件
//   - 来自审核记录的附件：review_id 指向 case_reviews，storage_path 留 null，
//     下载时实时从 case_reviews 找物理文件
//
// 删除 review 时，引用它的 message_attachments.review_id 自动变 NULL（FK SET NULL），
// 下载会 404 + 友好提示"原文件已被删除"。

export async function up(knex) {
  await knex.schema.alterTable('message_attachments', (t) => {
    t.uuid('review_id').references('id').inTable('case_reviews').onDelete('SET NULL')
    // storage_path 改成 nullable（review 引用模式下没有自己的物理文件）
    t.text('storage_path').nullable().alter()
  })
  await knex.schema.alterTable('message_attachments', (t) => {
    t.index(['review_id'], 'idx_message_attachments_review')
  })
}

export async function down(knex) {
  await knex.schema.alterTable('message_attachments', (t) => {
    t.dropIndex(['review_id'], 'idx_message_attachments_review')
    t.dropColumn('review_id')
  })
  // 不还原 storage_path 的 NOT NULL（可能有 NULL 行），保持 nullable
}
