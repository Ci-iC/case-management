import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, type AuthUser } from '@/api/auth'
import { setAuthToken, setUnauthorizedHandler, setMustChangePasswordHandler, ApiError } from '@/api/client'
import { useCaseStore } from '@/store/useCaseStore'

interface AuthState {
  token: string | null
  user: AuthUser | null
  status: 'idle' | 'loading' | 'authed' | 'guest'
  error: string | null
  sessionRevokedMessage: string | null

  login: (username: string, password: string) => Promise<void>
  logout: () => void
  bootstrap: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<void>
  /** v2.0: 切换公司，重签 token + 重新加载 me。
   *  opts.reload 默认 true（整页刷新）；超管"数据查询"按公司查数据时传 false，避免跳出当前面板 */
  switchCompany: (companyId: string, opts?: { reload?: boolean }) => Promise<void>
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

  async changePassword(currentPassword, newPassword, confirmPassword) {
    const { token: newToken, user: newUser } = await authApi.changePassword(
      currentPassword, newPassword, confirmPassword,
    )
    setAuthToken(newToken)
    set({ token: newToken, user: newUser })
  },

  async switchCompany(companyId, opts) {
    const reload = opts?.reload !== false   // 默认 true
    const { token: newToken } = await authApi.switchCompany(companyId)
    setAuthToken(newToken)
    set({ token: newToken })
    // 重新拉 me（拿新的 companyRoles / currentCompany）
    const { user } = await authApi.me()
    set({ user })
    // 清空缓存，避免上一家公司的数据残留
    useCaseStore.setState({ cases: [], filteredCases: [], totalCount: 0, selectedIds: [] })
    // v2.1+: 整页刷新，确保各页面（合同台账 / 审批 / 消息等）都重新按新公司加载数据。
    //   超管"数据查询"按公司查数据时传 reload:false —— 它不希望跳出查询面板。
    if (reload && typeof window !== 'undefined') {
      window.location.reload()
    }
  },

  clearSessionRevoked() {
    set({ sessionRevokedMessage: null })
  },
}), {
  name: 'case-management-auth',
  partialize: (s) => ({ token: s.token, user: s.user }),
}))

setUnauthorizedHandler((sessionRevoked) => {
  const store = useAuthStore.getState()
  store.logout()
  if (sessionRevoked) {
    useAuthStore.setState({ sessionRevokedMessage: SESSION_REVOKED_MESSAGE })
  }
})

setMustChangePasswordHandler(() => {
  const { user } = useAuthStore.getState()
  if (user && !user.mustChangePassword) {
    useAuthStore.setState({ user: { ...user, mustChangePassword: true } })
  }
})
