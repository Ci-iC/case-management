// 用户邮件通知：个人通知邮箱 + 个人开关 + 功能介绍弹窗"已看过"标记。
//
//   - notification_email：用户的通知邮箱，可空、可与登录账号无关；为空则不发邮件
//   - email_notify_enabled：用户个人邮件通知开关，默认 true（填了邮箱即默认接收，可手动关）
//   - email_feature_notice_seen：是否已看过"邮件通知功能"介绍弹窗，默认 false
//        本次更新后所有存量用户均为 false → 首次登录各弹一次介绍，看过即置 true

export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.text('notification_email')
    t.boolean('email_notify_enabled').notNullable().defaultTo(true)
    t.boolean('email_feature_notice_seen').notNullable().defaultTo(false)
  })
}

export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('notification_email')
    t.dropColumn('email_notify_enabled')
    t.dropColumn('email_feature_notice_seen')
  })
}
