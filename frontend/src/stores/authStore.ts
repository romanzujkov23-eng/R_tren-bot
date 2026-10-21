import { create } from 'zustand'
import { api, getStoredToken, isNetworkError, setToken, setUnauthorizedHandler, type User } from '../services/api'
import { onAppResume, waitForInitData } from '../utils/telegram'
import { prefetch, setCacheUser } from '../utils/cache'
import { monthStr } from '../utils/dates'

type Status = 'loading' | 'ready' | 'no-telegram' | 'error'

interface AuthState {
  user: User | null
  status: Status
  error: string | null
  login: () => Promise<boolean>
  setUser: (u: User) => void
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!isNetworkError(e) || i === attempts - 1) break
      await wait(700)
    }
  }
  throw last
}

let inflight: Promise<boolean> | null = null

export const useAuth = create<AuthState>((set, get) => {
  const run = async (): Promise<boolean> => {
    const hadUser = !!get().user
    try {
      const initData = await waitForInitData(hadUser ? 300 : 800)
      let res: { token: string; user: User } | null = null
      if (initData) {
        res = await withRetry(() => api.loginTelegram(initData))
      } else if (import.meta.env.DEV) {
        res = await api.loginDev()
      } else {
        const stored = getStoredToken()
        if (stored) {
          setToken(stored)
          try {
            res = await withRetry(() => api.restoreSession())
          } catch (e) {
            if (isNetworkError(e)) throw e
            setToken(null)
          }
        }
        if (!res) {
          if (!hadUser) set({ status: 'no-telegram' })
          return false
        }
      }
      setToken(res.token)
      setCacheUser(res.user.id)
      set({ user: res.user, status: 'ready', error: null })
      if (!hadUser) {
        if (res.user.app_mode === 'simple') {
          prefetch(`diary:${monthStr(new Date())}`, () => api.diary(monthStr(new Date())))
        } else if (res.user.app_mode === 'full') {
          prefetch('dashboard', api.dashboard)
          prefetch('plan', api.plan)
          prefetch('exercises', api.exercises)
        }
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz && tz !== res.user.timezone) {
        api.updateMe({ timezone: tz }).then((u) => set({ user: u })).catch(() => undefined)
      }
      return true
    } catch (e) {
      if (!hadUser) set({ status: 'error', error: e instanceof Error ? e.message : 'Ошибка входа' })
      return false
    }
  }

  return {
    user: null,
    status: 'loading',
    error: null,

    login: () => {
      if (!inflight) inflight = run().finally(() => (inflight = null))
      return inflight
    },

    setUser: (user) => set({ user }),
  }
})

setUnauthorizedHandler(() => useAuth.getState().login())

onAppResume(() => {
  const { status, login } = useAuth.getState()
  if (status === 'error' || status === 'no-telegram') {
    useAuth.setState({ status: 'loading' })
    void login()
  }
})
