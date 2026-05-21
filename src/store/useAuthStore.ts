import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, type AuthUser } from '@/api/auth'
import { setAuthToken, setUnauthorizedHandler, ApiError } from '@/api/client'
import { useCaseStore } from '@/store/useCaseStore'

interface AuthState {
  token: string | null
  user: AuthUser | null
  status: 'idle' | 'loading' | 'authed' | 'guest'
  error: string | null
  /** v1.2: 被其他设备登录顶下来时显示的提示文案；用户关闭后清空 */
  sessionRevokedMessage: string | null

  login: (username: string, password: string) => Promise<void>
  logout: () => void
  /** On app mount: if we have a persisted token, verify it with the server. */
  bootstrap: () => Promise<void>
  /** 关闭"账号被顶下"提示 */
  clearSessionRevoked: () => void
}

const SESSION_REVOKED_MESSAGE =
  '您的账号已在其他设备登录，本设备已自动退出。如果不是您本人操作，请立即修改密码。'

export const useAuthStore = create<AuthState>()(persist((set, get) => ({
  token: null,
  user: null,
  status: 'idle',
  error: null,
  sessionRevokedMessage: null,

  async login(username, password) {
    set({ status: 'loading', error: null, sessionRevokedMessage: null })
    try {
      const { token, user } = await authApi.login(username, password)
      setAuthToken(token)
      set({ token, user, status: 'authed' })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '登录失败')
      set({ status: 'guest', error: msg })
      throw e
    }
  },

  logout() {
    setAuthToken(null)
    set({ token: null, user: null, status: 'guest', error: null })
    // Clear cached case data so the next user doesn't briefly see stale rows
    useCaseStore.setState({ cases: [], filteredCases: [], totalCount: 0, selectedIds: [] })
  },

  async bootstrap() {
    const { token } = get()
    if (!token) {
      set({ status: 'guest' })
      return
    }
    setAuthToken(token)
    set({ status: 'loading' })
    try {
      const { user } = await authApi.me()
      set({ user, status: 'authed' })
    } catch {
      setAuthToken(null)
      set({ token: null, user: null, status: 'guest' })
    }
  },

  clearSessionRevoked() {
    set({ sessionRevokedMessage: null })
  },
}), {
  name: 'case-management-auth',
  partialize: (s) => ({ token: s.token, user: s.user }),
}))

// Wire 401 → logout (runs once at module load)
// 如果是被其他设备登录顶下（sessionRevoked=true），登出时附带提示文案给 UI 显示
setUnauthorizedHandler((sessionRevoked) => {
  const store = useAuthStore.getState()
  store.logout()
  if (sessionRevoked) {
    useAuthStore.setState({ sessionRevokedMessage: SESSION_REVOKED_MESSAGE })
  }
})
