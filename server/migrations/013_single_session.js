// v1.2 单设备登录：同账号在新设备登录会把旧设备顶下来
//
// 实现方式：users 加 token_version 字段。
//   - 每次登录前 increment token_version
//   - 签 JWT 时把当前 token_version 放进 payload (字段 tv)
//   - middleware 验签后多查一次 users.token_version，不匹配返回 401 + sessionRevoked
//   - 旧设备的 JWT 还能解码但 tv 比 DB 值小 → 拒绝
//
// 这样不需要 Redis 不需要换掉 JWT，只多一个 INT 字段

export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.integer('token_version').notNullable().defaultTo(1)
  })
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('token_version')
  })
}
