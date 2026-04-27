// M4: AI 审核 + 站内消息 + 系统设置 + 案件查看权限

export async function up(knex) {
  // ─── 1. users 加 can_view_cases ────────────────────────────────────────────
  await knex.schema.alterTable('users', (t) => {
    t.boolean('can_view_cases').notNullable().defaultTo(false)
  })
  // 现存 admin 自动开权限
  await knex('users').where({ role: 'admin' }).update({ can_view_cases: true })

  // ─── 2. app_settings：key-value 存系统配置（提示词、未来扩展） ──────────
  await knex.schema.createTable('app_settings', (t) => {
    t.text('key').primary()
    t.text('value').notNullable()
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.text('updated_by').references('id').inTable('users')
  })
  // 默认审核提示词
  await knex('app_settings').insert({
    key: 'review_prompt',
    value: DEFAULT_REVIEW_PROMPT,
    updated_at: new Date(),
  })

  // ─── 3. case_reviews：AI 审核记录 ──────────────────────────────────────────
  await knex.schema.createTable('case_reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('case_id').references('id').inTable('cases').onDelete('SET NULL')
    t.text('uploaded_filename').notNullable()
    t.text('uploaded_storage_path').notNullable()
    t.bigInteger('uploaded_size_bytes')
    t.text('uploaded_mime_type')
    t.text('review_text').notNullable()
    t.text('model')
    t.text('created_by').notNullable().references('id').inTable('users')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['case_id'], 'idx_case_reviews_case_id')
    t.index(['created_by'], 'idx_case_reviews_created_by')
    t.index(['created_at'], 'idx_case_reviews_created_at')
  })

  // ─── 4. messages：站内消息 ────────────────────────────────────────────────
  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('sender_id').notNullable().references('id').inTable('users')
    t.text('receiver_id').notNullable().references('id').inTable('users')
    t.text('body').notNullable()
    t.text('case_id').references('id').inTable('cases').onDelete('SET NULL')
    t.uuid('review_id').references('id').inTable('case_reviews').onDelete('SET NULL')
    t.boolean('is_read').notNullable().defaultTo(false)
    t.timestamp('read_at', { useTz: true })
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['receiver_id', 'is_read'], 'idx_messages_receiver_unread')
    t.index(['sender_id'], 'idx_messages_sender')
    t.index(['case_id'], 'idx_messages_case')
    t.index(['created_at'], 'idx_messages_created_at')
  })

  // ─── 5. message_attachments：消息附件 ──────────────────────────────────────
  await knex.schema.createTable('message_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.uuid('message_id').notNullable().references('id').inTable('messages').onDelete('CASCADE')
    t.text('filename').notNullable()
    t.text('storage_path').notNullable()
    t.bigInteger('size_bytes')
    t.text('mime_type')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['message_id'], 'idx_message_attachments_message')
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('message_attachments')
  await knex.schema.dropTableIfExists('messages')
  await knex.schema.dropTableIfExists('case_reviews')
  await knex.schema.dropTableIfExists('app_settings')
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('can_view_cases')
  })
}

// ─── Default Review Prompt ───────────────────────────────────────────────────
// 后期可在 admin 后台「系统设置」里改，不需要重启服务

const DEFAULT_REVIEW_PROMPT = `你是一名资深企业法务，专门审核公司内部的合同、协议、法律文件初稿。

请阅读用户上传的全部文件内容，输出一份**纯文字**的审核意见（不要 Markdown、不要表格、不要代码块）。

审核意见必须满足：
1. **结论先行**：第一段先说本文件总体可签 / 需修改 / 不建议签，并说明核心理由
2. **逐条列问题**：用「问题 1：」「问题 2：」…的形式，每条说清楚：
   - 文件中的原文位置或原句（用引号引出）
   - 这里有什么问题（法律风险 / 商业损失 / 表述歧义 / 缺失条款）
   - 建议改成什么样（给出具体的替换文字或补充条款）
3. **给出量级**：每条问题标注严重程度——【严重】【重要】【建议】三档
4. **末尾总结**：列一份"必改清单"和"可改清单"，方便业务人员决策

不要客套话、不要免责声明、不要重复贴原文。直接给最实用的修改建议。
`
