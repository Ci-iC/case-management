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
    onUnauthorized?.()
    let msg = '登录已过期，请重新登录'
    try { msg = (await resp.json())?.error || msg } catch { /* ignore */ }
    throw new ApiError(msg, 401)
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
