// v2.0: 首次登录强制改密码（与 v1.4 同名功能，多租户版）
//
// 触发：
//   - superadmin 创建用户 → must_change_password=true
//   - 公司管理员（manager）在本公司新建用户（如有此接口）→ true
//   - 任何角色重置某用户密码 → true
//   - 用户自助改密码成功 → false
//
// 本 migration：
//   - users 加 must_change_password，列默认 true
//   - 存量用户置 false（不强制老用户立刻改）

export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('must_change_password').notNullable().defaultTo(true)
  })
  await knex('users').update({ must_change_password: false })
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('must_change_password')
  })
}
