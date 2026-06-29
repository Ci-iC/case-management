// 邮件通知服务（nodemailer）。
//
// 设计原则：
//   - SMTP 配置、系统域名、启用开关全部从 DB(app_settings) 读取，不硬编码、不走 .env
//   - 发送失败只记日志，绝不抛错、不影响站内信主流程（sendNotificationEmail / notifyNewMessageEmail）
//   - 邮件同时带 text(纯文本) 与 html 两个字段，兼容不支持 HTML 的客户端
//   - sendTestEmail 例外：供 admin「发送测试邮件」用，会把错误抛出，让管理员看到失败原因

import nodemailer from 'nodemailer'
import { db } from './db.js'
import { getEmailConfig } from './appSettings.js'

const SUBJECT = '【GlobalX】你有一条新通知'
const FROM_NAME = 'GlobalX 法律管理平台'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// 渲染邮件正文（text + html）。body 截取前 100 字。
function renderTemplate({ userName, title, body, baseUrl }) {
  const name = (userName && String(userName).trim()) || '用户'
  const snippet = String(body || '').slice(0, 100)
  const link = `${(baseUrl || '').replace(/\/+$/, '')}/messages`

  const text =
`你好，${name}：

你在 GlobalX 收到一条新消息：

${title}
${snippet}

点击登录系统查看完整内容：${link}

---
GlobalX 法律管理平台
如不希望收到邮件通知，请登录后在个人设置中关闭。`

  const html =
`<div style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#1e293b;padding:18px 24px;">
      <span style="color:#ffffff;font-size:16px;font-weight:600;">GlobalX 法律管理平台</span>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 12px;font-size:14px;">你好，${escapeHtml(name)}：</p>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">你在 GlobalX 收到一条新消息：</p>
      <div style="border-left:3px solid #6366f1;background:#f8fafc;padding:12px 16px;border-radius:0 6px 6px 0;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(title)}</p>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">${escapeHtml(snippet)}</p>
      </div>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;">点击登录系统查看完整内容</a>
      </p>
    </div>
    <div style="border-top:1px solid #f1f5f9;padding:16px 24px;background:#fafafa;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
        GlobalX 法律管理平台<br/>
        如不希望收到邮件通知，请登录后在个人设置中关闭。
      </p>
    </div>
  </div>
</div>`

  return { text, html }
}

function buildTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465 || cfg.port === 994,  // 465/994 = 隐式 SSL；587/25 = STARTTLS
    auth: { user: cfg.from, pass: cfg.authCode },
    // 设超时，避免端口被网络拦截时无限等待（前端测试一直"转圈"）；失败会快速抛出明确错误
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
}

/**
 * 对外主方法：给某个邮箱发一条通知邮件。
 * 任何失败（配置缺失 / SMTP 报错 / 网络问题）都只记日志，绝不抛出。
 */
export async function sendNotificationEmail(to, title, body, userName) {
  try {
    if (!to) return
    const cfg = await getEmailConfig()
    if (!cfg.enabled) return
    if (!cfg.host || !cfg.from || !cfg.authCode) {
      console.warn('[email] 邮件配置不完整（host/from/authCode），跳过发送')
      return
    }
    const { text, html } = renderTemplate({ userName, title, body, baseUrl: cfg.baseUrl })
    await buildTransport(cfg).sendMail({
      from: `"${FROM_NAME}" <${cfg.from}>`,
      to,
      subject: SUBJECT,
      text,
      html,
    })
  } catch (e) {
    console.error('[email] 发送失败（不影响主流程）:', e?.message || e)
  }
}

/**
 * 站内信钩子：根据 receiverId 查用户的通知邮箱 + 个人开关，满足条件才发。
 * 全程容错，绝不抛出。路由层创建站内信后 fire-and-forget 调用（不 await）。
 */
export async function notifyNewMessageEmail({ receiverId, title, body }) {
  try {
    if (!receiverId) return
    const cfg = await getEmailConfig()
    if (!cfg.enabled) return                         // 系统总开关关闭
    const u = await db('users')
      .select('notification_email', 'email_notify_enabled', 'display_name', 'username')
      .where({ id: receiverId })
      .first()
    if (!u) return
    if (u.email_notify_enabled === false) return     // 用户个人关闭了邮件通知
    const to = u.notification_email
    if (!to) return                                  // 用户没填通知邮箱
    await sendNotificationEmail(to, title, body, u.display_name || u.username)
  } catch (e) {
    console.error('[email] 通知钩子失败（不影响主流程）:', e?.message || e)
  }
}

/**
 * 发送测试邮件（admin 验证配置用）。忽略"系统启用开关"（允许启用前先测），
 * 但配置必须完整；失败会抛出，便于把原因显示给管理员。
 */
export async function sendTestEmail(to) {
  if (!to || !String(to).trim()) throw new Error('请填写测试收件地址')
  const cfg = await getEmailConfig()
  if (!cfg.host || !cfg.from || !cfg.authCode) {
    throw new Error('邮件配置不完整：请先填写并保存「SMTP 服务器 / 发信邮箱 / 授权码」')
  }
  const { text, html } = renderTemplate({
    userName: '管理员',
    title: '这是一封测试邮件',
    body: '如果你收到这封邮件，说明 GlobalX 邮件通知配置正确，可以正常发送。',
    baseUrl: cfg.baseUrl,
  })
  await buildTransport(cfg).sendMail({
    from: `"${FROM_NAME}" <${cfg.from}>`,
    to: String(to).trim(),
    subject: SUBJECT,
    text,
    html,
  })
}
