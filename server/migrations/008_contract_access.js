// 合同台账权限：只有 admin 或 can_view_contracts=true 的用户能看合同台账
//
// 权限模型跟 can_view_cases 一致：
//   - admin 自动 true
//   - 普通用户默认 false（看不到合同台账菜单）
//   - admin 在「用户管理」里可单独勾选某用户开权限
//
// 注：业务人员日常上传合同审核仍正常使用，"合同审核"菜单不受影响；
// "合同台账"是聚合追溯入口，需要权限。

export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('can_view_contracts').notNullable().defaultTo(false)
  })
  await knex('users').where({ role: 'admin' }).update({ can_view_contracts: true })
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('can_view_contracts')
  })
}
