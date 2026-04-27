// Low-level fetch wrapper: auto-attaches Bearer token, parses JSON, surfaces API errors uniformly.

let currentToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setAuthToken(token: string | null) {
  currentToken = token
}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
    onUnauthorized?.()
    let msg = '登录已过期，请重新登录'
    try { msg = (await resp.json())?.error || msg } catch { /* ignore */ }
    throw new ApiError(msg, 401)
  }

  if (!resp.ok) {
    let msg = `请求失败 (${resp.status})`
    try {
      const body = await resp.json()
      msg = body?.error || msg
    } catch { /* ignore */ }
    throw new ApiError(msg, resp.status)
  }

  // 204 or empty body
  if (resp.status === 204) return undefined as T
  const text = await resp.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}
