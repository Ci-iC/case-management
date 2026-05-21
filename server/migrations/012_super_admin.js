// v1.2 三层角色：superadmin / admin / user
//
// 现状（v1.1 及更早）：role 只支持 'admin' / 'user'
//   - admin 同时承担"系统管理员"（改设置、增删账号）和"法务"（看全部台账、上传修订版）两个角色
//
// 现在（v1.2）：拆成三层
//   - superadmin = 系统管理员（管账号、改设置、管审核模型、改任意权限）
//   - admin      = 法务 / 业务审计（看全部台账、上传修订版、接收业务发的审核）
//   - user       = 业务人员（按 can_view_cases / can_view_contracts 看自己的）
//
// 升级策略：
//   - 表里现有所有 admin 中，按 created_at 升序的"第一个" → 自动升级为 superadmin
//     （即历史上最早创建的那个 admin / 系统管理员）
//   - 其他 admin 保持 admin 不变（继续做法务）
//   - 系统至少有一个 superadmin 才不会失锁

export async function up(knex) {
  // 1) 先放宽 CHECK constraint：删旧的，加新的
  //    旧约束名是 'users_role_chk'（见 001_init.js）
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk`)
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('superadmin','admin','user'))`
  )

  // 2) 升级第一个 admin 为 superadmin
  //    用 ORDER BY created_at LIMIT 1 + UPDATE WHERE id IN (...) 的写法保证只升一个
  const firstAdmin = await knex('users')
    .select('id', 'username', 'created_at')
    .where({ role: 'admin' })
    .orderBy('created_at', 'asc')
    .limit(1)
    .first()
  if (firstAdmin) {
    await knex('users').where({ id: firstAdmin.id }).update({ role: 'superadmin' })
    console.log(`[migration 012] promoted first admin to superadmin: ${firstAdmin.username} (${firstAdmin.id})`)
  } else {
    console.log('[migration 012] no admin user found, skipping superadmin promotion')
  }
}

export async function down(knex) {
  // 把 superadmin 都降回 admin（保留权限），再恢复旧 CHECK
  await knex('users').where({ role: 'superadmin' }).update({ role: 'admin' })
  await knex.raw(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk`)
  await knex.raw(
    `ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('admin','user'))`
  )
}
