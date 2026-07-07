// "记住我"多账号选择器的本地存储。
// 只存 username / displayName / 长效 token —— 绝不存密码。
// token 本身受服务端 token_version 单设备机制约束：
//   该账号在任何设备重新登录、修改密码、被管理员删除 → 存着的 token 立即失效，
//   选择器点进去会 401，自动回退到密码登录。

export interface SavedAccount {
  username: string
  displayName: string | null
  token: string
  savedAt: string          // ISO 时间，用于展示"上次登录"
}

const KEY = 'case-management-saved-accounts'
const MAX_ACCOUNTS = 5

export function listSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(a => a && typeof a.username === 'string' && typeof a.token === 'string')
  } catch {
    return []
  }
}

function persist(list: SavedAccount[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS))) } catch { /* ignore */ }
}

/** 登录成功（勾了记住我）后调用：新增或更新该账号的 token，放到列表最前 */
export function saveAccount(a: { username: string; displayName?: string | null; token: string }) {
  const rest = listSavedAccounts().filter(x => x.username !== a.username)
  persist([{ username: a.username, displayName: a.displayName || null, token: a.token, savedAt: new Date().toISOString() }, ...rest])
}

/** token 被重签（切公司/改密码）后同步，避免存着的旧 token 白白过期 */
export function updateAccountToken(username: string, token: string) {
  const list = listSavedAccounts()
  const hit = list.find(x => x.username === username)
  if (!hit) return
  hit.token = token
  hit.savedAt = new Date().toISOString()
  persist(list)
}

/** 用户点 × 移除，或 token 失效后清理 */
export function removeAccount(username: string) {
  persist(listSavedAccounts().filter(x => x.username !== username))
}
