import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, type AuthUser } from '@/api/auth'
import { setAuthToken, setUnauthorizedHandler, setMustChangePasswordHandler, ApiError } from '@/api/client'
import { useCaseStore } from '@/store/useCaseStore'
import { saveAccount, updateAccountToken, removeAccount, type SavedAccount } from '@/utils/savedAccounts'

interface AuthState {
  token: string | null
  user: AuthUser | null
  status: 'idle' | 'loading' | 'authed' | 'guest'
  error: string | null
  sessionRevokedMessage: string | null

  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  /** 多账号选择器：用本地存的长效 token 免密进入；失效时抛错并清理该账号 */
  loginWithSavedAccount: (account: SavedAccount) => Promise<void>
  logout: () => void
  bootstrap: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<void>
  /** v2.0: 切换公司，重签 token + 重新加载 me。
   *  opts.reload 默认 true（整页刷新）；超管"数据查询"按公司查数据时传 false，避免跳出当前面板 */
  switchCompany: (companyId: string, opts?: { reload?: boolean }) => Promise<void>
  clearSessionRevoked: () => void
  /** 自助更新个人设置（通知邮箱 + 邮件通知开关），成功后同步本地 user */
  updateProfile: (payload: { notificationEmail?: string; emailNotifyEnabled?: boolean }) => Promise<void>
  /** 关闭"邮件通知功能"首登弹窗（标记已看过） */
  dismissEmailNotice: () => Promise<void>
}

const SESSION_REVOKED_MESSAGE =
  '您的账号已在其他设备登录，本设备已自动退出。如果不是您本人操作，请立即修改密码。'

export const useAuthStore = create<AuthState>()(persist((set, get) => ({
  token: null,
  user: null,
  status: 'idle',
  error: null,
  sessionRevokedMessage: null,

  async login(username, password, rememberMe = false) {
    set({ status: 'loading', error: null, sessionRevokedMessage: null })
    try {
      const { token, user } = await authApi.login(username, password, rememberMe)
      setAuthToken(token)
      set({ token, user, status: 'authed' })
      if (rememberMe) {
        saveAccount({ username: user.username, displayName: user.displayName, token })
      } else {
        // 没勾记住我：本次登录已 bump token_version，旧存的 token 必然失效 → 顺手清理
        removeAccount(user.username)
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '登录失败')
      set({ status: 'guest', error: msg })
      throw e
    }
  },

  async loginWithSavedAccount(account) {
    // 注意：这里不设 status='loading' —— AuthGate 在 loading 时会卸载 LoginPage，
    // 导致失败后组件带旧状态重挂载、错误提示丢失。选择器按钮自带"进入中…"反馈。
    set({ error: null, sessionRevokedMessage: null })
    try {
      setAuthToken(account.token)
      const { user } = await authApi.me()
      set({ token: account.token, user, status: 'authed' })
    } catch (e) {
      // token 失效（他处重新登录 / 改密码 / 账号被删）→ 清掉该账号，回密码登录
      removeAccount(account.username)
      setAuthToken(null)
      set({ token: null, user: null, status: 'guest' })
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
    // 若该账号在"记住我"列表里，同步新 token（旧 token 因 token_version+1 已失效）
    updateAccountToken(newUser.username, newToken)
  },

  async switchCompany(companyId, opts) {
    const reload = opts?.reload !== false   // 默认 true
    const { token: newToken } = await authApi.switchCompany(companyId)
    setAuthToken(newToken)
    set({ token: newToken })
    // 同步"记住我"列表里的 token（切公司不 bump token_version，但新 token 带着新的公司上下文）
    const currentUsername = get().user?.username
    if (currentUsername) updateAccountToken(currentUsername, newToken)
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

  async updateProfile(payload) {
    const res = await authApi.updateProfile(payload)
    const { user } = get()
    if (user) set({ user: { ...user, notificationEmail: res.notificationEmail, emailNotifyEnabled: res.emailNotifyEnabled } })
  },

  async dismissEmailNotice() {
    await authApi.dismissEmailNotice()
    const { user } = get()
    if (user) set({ user: { ...user, emailFeatureNoticeSeen: true } })
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
