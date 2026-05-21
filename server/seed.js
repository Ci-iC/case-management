// One-shot superadmin seeding. Idempotent: skips if any admin/superadmin already exists.
// Run via: node server/seed.js
//
// v1.3 起：默认创建 role='superadmin'（系统至少要有一个超管才能管账号、改设置）
// 老环境（v1.1 时已有 admin）migration 012 会自动把首个 admin 升级为 superadmin，
// 此处仅处理"全新空库"场景下的首次种子。

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db, cryptoId } from './db.js'

async function seedAdmin() {
  // 任何已存在（未删除）的 admin 或 superadmin 都视为"已 seed 过"
  // v1.3.2 起 users 是软删除，要排除 deleted_at 非空的行，否则把已删除的 admin 当成"存在"会跳过种子
  const existing = await db('users')
    .whereIn('role', ['admin', 'superadmin'])
    .whereNull('deleted_at')
    .first()
  if (existing) {
    console.log(`[seed] ${existing.role} already exists (${existing.username}), skipping.`)
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
    can_view_cases: true,
    can_view_contracts: true,
    created_at: new Date(),
    created_by: 'system',
  })
  console.log(`[seed] created superadmin: username="${username}" (password is from ADMIN_PASSWORD env)`)
  console.log('[seed] please change the password after first login.')
}

seedAdmin()
  .catch((e) => { console.error('[seed] failed:', e); process.exitCode = 1 })
  .finally(() => db.destroy())
