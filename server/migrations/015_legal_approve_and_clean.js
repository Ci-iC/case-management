// v1.3.1 微调
//
//   1) case_reviews 加 legal_approved
//      - 法务可以"无需修订直接通过"，不上传修订版也算"已经过法务审核"
//      - 发起审批的判断：reviewed_storage_path 非空 OR legal_approved=true
//
//   2) contracts 加 clean_* （清洁版）
//      - 经办人发起审批时上传一份"清洁版"作为最终待审批材料
//      - AI 摘要基于清洁版生成
//      - 审批界面优先展示清洁版，历史修订记录折叠
//
//   3) messages 加 approval_id
//      - 审批流转时给当前 assignee 自动发站内信通知
//      - 前端识别 approval_id 显示"跳转到审批"按钮

export async function up(knex) {
  // 1) case_reviews.legal_approved
  await knex.schema.alterTable('case_reviews', (t) => {
    t.boolean('legal_approved').notNullable().defaultTo(false)
    t.index(['legal_approved'], 'idx_case_reviews_legal_approved')
  })

  // 2) contracts.clean_*
  await knex.schema.alterTable('contracts', (t) => {
    t.text('clean_filename')
    t.text('clean_storage_path')
    t.bigInteger('clean_size_bytes')
    t.text('clean_mime_type')
    t.timestamp('clean_uploaded_at', { useTz: true })
    t.text('clean_uploaded_by').references('id').inTable('users').onDelete('SET NULL')
  })

  // 3) messages.approval_id
  await knex.schema.alterTable('messages', (t) => {
    t.uuid('approval_id').references('id').inTable('approvals').onDelete('SET NULL')
    t.index(['approval_id'], 'idx_messages_approval')
  })
}

export async function down(knex) {
  await knex.schema.alterTable('messages', (t) => {
    t.dropIndex(['approval_id'], 'idx_messages_approval')
    t.dropColumn('approval_id')
  })

  await knex.schema.alterTable('contracts', (t) => {
    t.dropColumn('clean_uploaded_by')
    t.dropColumn('clean_uploaded_at')
    t.dropColumn('clean_mime_type')
    t.dropColumn('clean_size_bytes')
    t.dropColumn('clean_storage_path')
    t.dropColumn('clean_filename')
  })

  await knex.schema.alterTable('case_reviews', (t) => {
    t.dropIndex(['legal_approved'], 'idx_case_reviews_legal_approved')
    t.dropColumn('legal_approved')
  })
}
