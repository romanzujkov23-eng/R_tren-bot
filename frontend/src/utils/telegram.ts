interface TgWebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  ready: () => void
  expand: () => void
  setHeaderColor?: (c: string) => void
  setBackgroundColor?: (c: string) => void
  setBottomBarColor?: (c: string) => void
  disableVerticalSwipes?: () => void
  enableVerticalSwipes?: () => void
  HapticFeedback?: {
    impactOccurred: (s: 'light' | 'medium' | 'heavy') => void
    notificationOccurred: (t: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }
  showConfirm?: (msg: string, cb: (ok: boolean) => void) => void
  onEvent?: (e: string, cb: () => void) => void
  offEvent?: (e: string, cb: () => void) => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
  }
}

const tg = (): TgWebApp | undefined => window.Telegram?.WebApp

export const getInitData = (): string => tg()?.initData ?? ''
export async function waitForInitData(timeoutMs = 800): Promise<string> {
  let v = getInitData()
  if (v || !tg()) return v
  const end = Date.now() + timeoutMs
  while (!v && Date.now() < end) {
    await new Promise((r) => window.setTimeout(r, 100))
    v = getInitData()
  }
  return v
}

export const isInTelegram = (): boolean => !!getInitData()

export function initTelegram() {
  const w = tg()
  if (!w) return
  w.ready()
  w.expand()
}

export const haptic = {
  tap: () => tg()?.HapticFeedback?.impactOccurred('light'),
  success: () => tg()?.HapticFeedback?.notificationOccurred('success'),
  error: () => tg()?.HapticFeedback?.notificationOccurred('error'),
  select: () => tg()?.HapticFeedback?.selectionChanged(),
}

export function confirmAction(message: string): Promise<boolean> {
  const w = tg()
  if (w?.showConfirm && isInTelegram()) {
    return new Promise((resolve) => w.showConfirm!(message, resolve))
  }
  return Promise.resolve(window.confirm(message))
}

export function onAppResume(cb: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') cb()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', cb)
  const w = tg()
  w?.onEvent?.('activated', cb)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', cb)
    w?.offEvent?.('activated', cb)
  }
}
