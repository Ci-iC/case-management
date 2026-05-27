// v2.0 全新空库 seed：建一个 superadmin（平台超管），不归属公司。
// 公司、其他用户都由超管登录后在控制台里建。
//
// 运行：node server/seed.js
// 幂等：若已存在 superadmin / platform_user 则跳过（包括 v1.x 升级 v2.0 后 migration 自动创建的 superadmin）

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db, cryptoId } from './db.js'

async function seedSuperAdmin() {
  const existing = await db('users')
    .where('role', 'superadmin')
    .whereNull('deleted_at')
    .first()
  if (existing) {
    console.log(`[seed] superadmin already exists (${existing.username}), skipping.`)
    return
  }

  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD
  const displayName = process.env.ADMIN_DISPLAY_NAME || '系统管理员'
  if (!username || !password) {
    console.error('[seed] 必须在 .env 中设置 ADMIN_USERNAME 和 ADMIN_PASSWORD 后再运行 seed')
    process.exitCode = 1
    return
  }

  const id = cryptoId()
  const hash = await bcrypt.hash(password, 10)
  await db('users').insert({
    id,
    username,
    password_hash: hash,
    role: 'superadmin',
    display_name: displayName,
    can_view_cases: false,        // v2.0: 公司层权限不再用这个字段
    can_view_contracts: false,
    must_change_password: true,   // v2.0: 首次登录强制改密
    created_at: new Date(),
    created_by: 'system',
  })
  console.log(`[seed] created superadmin: username="${username}"`)
  console.log('[seed] 首次登录会被强制改密码。请妥善保管初始密码。')
}

seedSuperAdmin()
  .catch((e) => { console.error('[seed] failed:', e); process.exitCode = 1 })
  .finally(() => db.destroy())
