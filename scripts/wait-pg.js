// Block until Postgres accepts a connection. Used in `npm run db:reset`.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) { console.error('[wait-pg] DATABASE_URL not set'); process.exit(1) }

const TIMEOUT_MS = 30_000
const start = Date.now()

async function tryOnce() {
  const client = new pg.Client({ connectionString: url })
  try {
    await client.connect()
    await client.query('SELECT 1')
    await client.end()
    return true
  } catch {
    try { await client.end() } catch { /* ignore */ }
    return false
  }
}

(async () => {
  while (Date.now() - start < TIMEOUT_MS) {
    if (await tryOnce()) {
      console.log(`[wait-pg] ready in ${Date.now() - start}ms`)
      return
    }
    await new Promise(r => setTimeout(r, 500))
  }
  console.error(`[wait-pg] timeout after ${TIMEOUT_MS}ms`)
  process.exit(1)
})()
