// One-shot admin seeding. Idempotent: skips if any admin already exists.
// Run via: node server/seed.js

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { db, cryptoId } from './db.js'

async function seedAdmin() {
  const existing = await db('users').where({ role: 'admin' }).first()
  if (existing) {
    console.log('[seed] admin already exists, skipping.')
    return
  }
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const displayName = process.env.ADMIN_DISPLAY_NAME || '系统管理员'
  const id = cryptoId()
  const hash = await bcrypt.hash(password, 10)
  await db('users').insert({
    id,
    username,
    password_hash: hash,
    role: 'admin',
    display_name: displayName,
    created_at: new Date(),
    created_by: 'system',
  })
  console.log(`[seed] created admin: username="${username}" password="${password}"`)
  console.log('[seed] please change the password after first login.')
}

seedAdmin()
  .catch((e) => { console.error('[seed] failed:', e); process.exitCode = 1 })
  .finally(() => db.destroy())
