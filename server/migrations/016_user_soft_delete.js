// v1.3.2: users 软删除
//
// 背景：v1.3 起删用户经常被外键卡住（migration 014 引入的 approvals/approval_steps/approval_actions
// 三处 assignee_id/initiator_id/actor_id 是 NOT NULL + ON DELETE SET NULL，自相矛盾），而且
// 即便能删，所有历史记录里"经办人/审批人"字段会变 NULL，前端无法显示"原经办人是谁"。
//
// 改造：改成软删除。
//   - users 加 deleted_at（NULL = 在用；非 NULL = 已删除）
//   - username 的 unique 约束改成 partial unique（仅对未删除用户唯一），允许用户名复用
//   - 用户行永远不真删，所有历史外键 JOIN 出来仍能拿到原 username/display_name
//   - 登录、用户列表、联系人选择都要过滤 deleted_at IS NULL
//   - 删用户接口同时把 token_version 加 1，立即踢下线
//
// 此 migration 只动 users 表结构，不动 014 那三处 NOT NULL —— 因为软删除下用户行不删，
// 那三处 SET NULL 永远不会触发。如未来需要支持"硬删除"再开新 migration 处理。

export async function up(knex) {
  // 1. 加 deleted_at
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('deleted_at', { useTz: true })
  })

  // 2. 把 username 的全表 unique 改成 partial unique（仅对未删除用户唯一）
  //    旧约束名 = users_username_unique（knex 默认命名）
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_username_unique')
  await knex.raw(
    'CREATE UNIQUE INDEX users_username_active_unique ON users (username) WHERE deleted_at IS NULL'
  )

  // 3. 加常用查询索引：登录/列表都过滤 deleted_at IS NULL
  await knex.raw('CREATE INDEX idx_users_active ON users (deleted_at) WHERE deleted_at IS NULL')
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_users_active')
  await knex.raw('DROP INDEX IF EXISTS users_username_active_unique')
  // 回退到全表 unique（如已存在重复用户名会失败，回滚前先清理）
  await knex.raw('ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username)')
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('deleted_at')
  })
}
