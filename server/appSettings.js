// app_settings 读取辅助 + 敏感值 AES 加解密。
//
// 加密：AES-256-GCM。主密钥由 JWT_SECRET 派生（scrypt），主密钥只存在于 .env（已 gitignore），
//       绝不进 Git，也不硬编码。加密后的值带 "enc:v1:" 前缀，便于识别 / 平滑兼容历史明文。
// 邮件等配置全部存 DB 的 app_settings 表，不走 .env。

import crypto from 'node:crypto'
import { db } from './db.js'

const ENC_PREFIX = 'enc:v1:'
let _key = null
function aesKey() {
  if (_key) return _key
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET 未配置，无法加解密敏感设置')
  _key = crypto.scryptSync(secret, 'globalx-app-settings-aes-v1', 32)
  return _key
}

/** AES-256-GCM 加密，返回 "enc:v1:<base64(iv|tag|cipher)>"。空值原样返回。 */
export function encryptSecret(plain) {
  if (plain == null || plain === '') return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

/** 解密 encryptSecret 的产物。非 "enc:v1:" 前缀（历史明文 / 空）原样返回，保证容错。 */
export function decryptSecret(stored) {
  if (!stored || !String(stored).startsWith(ENC_PREFIX)) return stored || ''
  try {
    const raw = Buffer.from(String(stored).slice(ENC_PREFIX.length), 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const enc = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch (e) {
    console.error('[appSettings] 敏感值解密失败:', e?.message || e)
    return ''
  }
}

/** 是否为已加密的密文（用于设置接口判断"前端没改"等场景）。 */
export function isEncrypted(stored) {
  return !!stored && String(stored).startsWith(ENC_PREFIX)
}

// ─── 邮件配置 ──────────────────────────────────────────────────────────────────

export const EMAIL_KEYS = [
  'email_enabled', 'email_from', 'smtp_host', 'smtp_port', 'smtp_auth_code', 'app_base_url',
]

/** 读取邮件配置（授权码已解密）。 */
export async function getEmailConfig() {
  const rows = await db('app_settings').whereIn('key', EMAIL_KEYS).select('key', 'value')
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    enabled: m.email_enabled === '1' || m.email_enabled === 'true',
    from: m.email_from || '',
    host: m.smtp_host || '',
    port: Number(m.smtp_port) || 465,
    authCode: decryptSecret(m.smtp_auth_code),
    baseUrl: (m.app_base_url || '').replace(/\/+$/, ''),
  }
}
