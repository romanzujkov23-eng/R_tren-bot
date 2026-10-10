export type ThemePref = 'auto' | 'dark' | 'light'

export type Accent = 'lime' | 'pink' | 'purple' | 'blue' | 'teal' | 'orange' | 'yellow'

export const ACCENTS: { key: Accent; label: string; color: string }[] = [
  { key: 'lime', label: 'Лайм', color: '#c8f43a' },
  { key: 'pink', label: 'Розовый', color: '#ff6fb5' },
  { key: 'purple', label: 'Фиолетовый', color: '#b794ff' },
  { key: 'blue', label: 'Синий', color: '#5ea8ff' },
  { key: 'teal', label: 'Бирюзовый', color: '#2dd4bf' },
  { key: 'orange', label: 'Оранжевый', color: '#ff9f45' },
  { key: 'yellow', label: 'Жёлтый', color: '#ffd84a' },
]

const KEY = 'tb:theme'
const ACCENT_KEY = 'tb:accent'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'dark' || v === 'light' || v === 'auto') return v
  } catch {
  }
  return 'auto'
}

export function getAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY)
    if (ACCENTS.some((a) => a.key === v)) return v as Accent
  } catch {
  }
  return 'lime'
}

function resolve(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'auto') return pref
  const tg = window.Telegram?.WebApp?.colorScheme
  if (tg === 'light' || tg === 'dark') return tg
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function cssVarToHex(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const parts = raw.split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return '#0d0f13'
  return '#' + parts.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')
}

export function applyTheme(pref: ThemePref = getThemePref(), accent: Accent = getAccent()) {
  const root = document.documentElement
  root.dataset.theme = resolve(pref)
  root.dataset.accent = accent
  const bg = cssVarToHex('--bg-rgb')
  const nav = cssVarToHex('--card-rgb')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  const tg = window.Telegram?.WebApp
  try {
    tg?.setHeaderColor?.(bg)
    tg?.setBackgroundColor?.(bg)
    tg?.setBottomBarColor?.(nav)
  } catch {
  }
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
  }
  applyTheme(pref, getAccent())
}

export function setAccent(accent: Accent) {
  try {
    localStorage.setItem(ACCENT_KEY, accent)
  } catch {
  }
  applyTheme(getThemePref(), accent)
}
