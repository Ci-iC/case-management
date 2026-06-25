// v2.3：AI 工作台对话存储
//   - assistant_messages：按用户维度的对话记录（跨公司不清空，当天保留次日清空）
//   - assistant_attachments：聊天里上传的参考/材料文件（抽取文本一并存，便于 AI 读取）
// 说明：users.id 是 text 类型，故 user_id 用 t.text；company_id 仅记录产生时上下文。

export async function up(knex) {
  await knex.schema.createTable('assistant_messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.text('role').notNullable()                 // 'user' | 'assistant'
    t.text('kind').notNullable().defaultTo('text') // text|file|todo|pending_action|action_result
    t.text('content')                            // 展示/发给模型的文本
    t.jsonb('data')                              // pending_action 的 tool/args/摘要、todo 的 jumpLinks、附件引用、执行结果等
    t.uuid('company_id')                         // 产生时的公司上下文（可空，便于排查）
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['user_id', 'created_at'], 'idx_assistant_messages_user_time')
  })

  await knex.schema.createTable('assistant_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.text('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.uuid('message_id').references('id').inTable('assistant_messages').onDelete('CASCADE')
    t.text('filename').notNullable()
    t.text('storage_path').notNullable()
    t.bigInteger('size_bytes')
    t.text('mime_type')
    t.text('extracted_text')                     // 上传即抽取，AI 读文件内容直接取此字段
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['user_id', 'created_at'], 'idx_assistant_attachments_user_time')
  })
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('assistant_attachments')
  await knex.schema.dropTableIfExists('assistant_messages')
}
