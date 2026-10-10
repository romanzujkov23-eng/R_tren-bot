import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import Icon from './Icon'
import { haptic } from '../utils/telegram'
import { useKeyboardOpen } from '../utils/keyboard'
import { useAuth } from '../stores/authStore'

const FULL_TABS = [
  { to: '/', label: 'Главная', icon: 'home', end: true },
  { to: '/plan', label: 'План', icon: 'plan', end: false },
  { to: '/calendar', label: 'Календарь', icon: 'calendar', end: false },
  { to: '/stats', label: 'Прогресс', icon: 'chart', end: false },
  { to: '/settings', label: 'Профиль', icon: 'user', end: false },
]
const SIMPLE_TABS = [
  { to: '/', label: 'Календарь', icon: 'calendar', end: true },
  { to: '/goals', label: 'Цели', icon: 'target', end: false },
  { to: '/settings', label: 'Настройки', icon: 'user', end: false },
]

export default function Layout() {
  const simple = useAuth((s) => s.user?.app_mode === 'simple')
  const tabs = simple ? SIMPLE_TABS : FULL_TABS

  const keyboard = useKeyboardOpen()
  return (
    <div className="mx-auto min-h-screen max-w-xl">
      <main className="px-4 pb-32 pt-5">
        <Outlet />
      </main>
      {                                                                                                                                                             }
      <nav
        aria-hidden={keyboard}
        className={clsx(
          'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_28px_-14px_rgba(0,0,0,0.45)] transition-transform duration-150',
          keyboard && 'pointer-events-none translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-xl px-2 pt-1.5">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              onClick={() => haptic.select()}
              className={({ isActive }) =>
                clsx('flex flex-1 flex-col items-center gap-0.5 pb-2 text-[11px]', isActive ? 'font-bold text-fg' : 'font-medium text-hint')
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={clsx(
                      'flex h-8 w-14 items-center justify-center rounded-full transition',
                      isActive && 'bg-accent text-accent-fg',
                    )}
                  >
                    <Icon name={t.icon} size={22} />
                  </span>
                  <span>{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
