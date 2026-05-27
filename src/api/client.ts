// Low-level fetch wrapper: auto-attaches Bearer token, parses JSON, surfaces API errors uniformly.

let currentToken: string | null = null
/** 401 处理：第二参数 sessionRevoked=true 表示账号在其他设备登录被踢，需要弹提示 */
let onUnauthorized: ((sessionRevoked?: boolean) => void) | null = null
/** v1.4: 423 处理。后端返回 423 + mustChangePassword=true，意味着用户必须先改密码 */
let onMustChangePassword: (() => void) | null = null

export function setAuthToken(token: string | null) {
  currentToken = token
}

/** 给 multipart / 直接 fetch 用 */
export function getAuthHeader(): Record<string, string> {
  return currentToken ? { Authorization: `Bearer ${currentToken}` } : {}
}

/** multipart/form-data 请求（不能用 apiFetch，会被强制设置 Content-Type） */
export async function apiFetchForm<T = unknown>(
  path: string,
  form: FormData,
  init: Omit<RequestInit, 'body' | 'headers'> = {},
): Promise<T> {
  const headers = getAuthHeader()
  const resp = await fetch(path, { method: 'POST', ...init, headers, body: form })
  if (resp.status === 401) {
    let msg = '登录已过期，请重新登录'
    let sessionRevoked = false
    try {
      const body = await resp.json() as { error?: string; sessionRevoked?: boolean }
      msg = body?.error || msg
      sessionRevoked = !!body?.sessionRevoked
    } catch { /* ignore */ }
    onUnauthorized?.(sessionRevoked)
    throw new ApiError(msg, 401)
  }
  if (resp.status === 423) {
    let msg = '请先修改初始密码后再使用其他功能'
    try {
      const body = await resp.json() as { error?: string; mustChangePassword?: boolean }
      msg = body?.error || msg
      if (body?.mustChangePassword) onMustChangePassword?.()
    } catch { /* ignore */ }
    throw new ApiError(msg, 423)
  }
  if (!resp.ok) {
    let msg = `请求失败 (${resp.status})`
    let body: unknown = undefined
    try { body = await resp.json(); msg = (body as { error?: string })?.error || msg } catch { /* ignore */ }
    throw new ApiError(msg, resp.status, body)
  }
  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}

/** 下载文件并触发浏览器保存 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers = getAuthHeader()
  const resp = await fetch(path, { headers })
  if (!resp.ok) {
    // 失败时后端通常返回 JSON { error }，把真实原因透出来（而不是笼统的"下载失败"）
    let msg = `下载失败 (${resp.status})`
    try {
      const ct = resp.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const body = await resp.json() as { error?: string }
        if (body?.error) msg = body.error
      }
    } catch { /* ignore */ }
    throw new ApiError(msg, resp.status)
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function setUnauthorizedHandler(fn: (sessionRevoked?: boolean) => void) {
  onUnauthorized = fn
}

export function setMustChangePasswordHandler(fn: () => void) {
  onMustChangePassword = fn
}

export class ApiError extends Error {
  status: number
  body: unknown          // raw JSON body from server (e.g. { error, current } on 409)
  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`)

  const resp = await fetch(path, { ...init, headers })

  if (resp.status === 401) {
    let msg = '登录已过期，请重新登录'
    let sessionRevoked = false
    try {
      const body = await resp.json() as { error?: string; sessionRevoked?: boolean }
      msg = body?.error || msg
      sessionRevoked = !!body?.sessionRevoked
    } catch { /* ignore */ }
    onUnauthorized?.(sessionRevoked)
    throw new ApiError(msg, 401)
  }

  if (resp.status === 423) {
    let msg = '请先修改初始密码后再使用其他功能'
    try {
      const body = await resp.json() as { error?: string; mustChangePassword?: boolean }
      msg = body?.error || msg
      if (body?.mustChangePassword) onMustChangePassword?.()
    } catch { /* ignore */ }
    throw new ApiError(msg, 423)
  }

  if (!resp.ok) {
    let msg = `请求失败 (${resp.status})`
    let body: unknown = undefined
    try {
      body = await resp.json()
      msg = (body as { error?: string })?.error || msg
    } catch { /* ignore */ }
    throw new ApiError(msg, resp.status, body)
  }

  // 204 or empty body
  if (resp.status === 204) return undefined as T
  const text = await resp.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}
