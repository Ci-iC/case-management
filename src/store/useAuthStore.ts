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

  login: (username: string, password: string) => Promise<void>
  logout: () => void
  /** On app mount: if we have a persisted token, verify it with the server. */
  bootstrap: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(persist((set, get) => ({
  token: null,
  user: null,
  status: 'idle',
  error: null,

  async login(username, password) {
    set({ status: 'loading', error: null })
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
}), {
  name: 'case-management-auth',
  partialize: (s) => ({ token: s.token, user: s.user }),
}))

// Wire 401 → logout (runs once at module load)
setUnauthorizedHandler(() => {
  useAuthStore.getState().logout()
})
