import { create } from 'zustand'
import { api, setToken, setUnauthorizedHandler, type User } from '../services/api'
import { getInitData } from '../utils/telegram'
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

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  error: null,

  login: async () => {
    const initData = getInitData()
    try {
      let res
      if (initData) {
        res = await api.loginTelegram(initData)
      } else if (import.meta.env.DEV) {
        res = await api.loginDev()
      } else {
        set({ status: 'no-telegram' })
        return false
      }
      setToken(res.token)
      setCacheUser(res.user.id)
      set({ user: res.user, status: 'ready', error: null })
      if (res.user.app_mode === 'simple') {
        prefetch(`diary:${monthStr(new Date())}`, () => api.diary(monthStr(new Date())))
      } else if (res.user.app_mode === 'full') {
        prefetch('dashboard', api.dashboard)
        prefetch('plan', api.plan)
        prefetch('exercises', api.exercises)
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz && tz !== res.user.timezone) {
        api.updateMe({ timezone: tz }).then((u) => set({ user: u })).catch(() => undefined)
      }
      return true
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Ошибка входа' })
      return false
    }
  },

  setUser: (user) => set({ user }),
}))

setUnauthorizedHandler(() => useAuth.getState().login())
