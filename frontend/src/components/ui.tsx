import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { MuscleGroup } from '../services/api'
import { cacheGet, cacheSet, takeInflight } from '../utils/cache'



export const parseUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z')

export const fmtDate = (s: string) =>
  parseUtc(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

export function fmtDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export const fmtNum = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Грудь',
  back: 'Спина',
  legs: 'Ноги',
  shoulders: 'Плечи',
  arms: 'Руки',
  core: 'Пресс',
  cardio: 'Кардио',
  other: 'Другое',
}
export const MUSCLE_GROUPS = Object.keys(MUSCLE_LABELS) as MuscleGroup[]
export const FEELINGS = ['😫', '😕', '😐', '🙂', '🔥']






export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], key?: string) {
  const [data, setData] = useState<T | null>(() => (key ? cacheGet<T>(key) : null))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !(key && cacheGet<T>(key)))
  const alive = useRef(true)
  const dataRef = useRef<T | null>(data)
  dataRef.current = data
  const fnRef = useRef(fn)
  fnRef.current = fn
  const keyRef = useRef(key)
  keyRef.current = key

  const reload = useCallback(async () => {
    const cached = keyRef.current ? cacheGet<T>(keyRef.current) : null

    if (cached) setData((prev) => prev ?? cached)
    setLoading(!cached && !dataRef.current)
    try {
      const pre = keyRef.current ? takeInflight(keyRef.current) : null
      let r: T
      if (pre) {
        try {
          r = (await pre) as T
        } catch {
          r = await fnRef.current()
        }
      } else {
        r = await fnRef.current()
      }
      if (keyRef.current) cacheSet(keyRef.current, r)
      if (alive.current) {
        setData(r)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      if (alive.current) setLoading(false)
    }

  }, deps)

  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])

  return { data, error, loading, reload, setData }
}


export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx('flex justify-center py-12', className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-card2 border-t-accent" />
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-center text-sm text-danger">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-semibold underline">
          Повторить
        </button>
      )}
    </div>
  )
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={clsx('rounded-3xl border border-line bg-card p-4', onClick && 'cursor-pointer transition active:scale-[0.99]', className)}
    >
      {children}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; full?: boolean }
export function Button({ variant = 'primary', full, className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'rounded-2xl px-4 py-3.5 text-base font-semibold transition active:scale-[0.98] disabled:opacity-45',
        variant === 'primary' && 'bg-accent text-accent-fg shadow-[var(--glow)]',
        variant === 'ghost' && 'border border-line bg-card2 text-fg',
        variant === 'danger' && 'bg-danger/12 text-danger',
        full && 'w-full',
        className,
      )}
    />
  )
}

export function PageTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h1 className="text-[28px] font-bold leading-tight">{children}</h1>
      {right}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-lg font-semibold">{children}</h2>
      {right}
    </div>
  )
}

export function Field({ label, children, group }: { label: string; children: ReactNode; group?: boolean }) {

  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block">
      <span className="mb-1.5 block text-sm text-hint">{label}</span>
      {children}
    </Tag>
  )
}

export const inputCls =
  'w-full rounded-2xl border border-line bg-card2 px-4 py-3 text-fg outline-none placeholder:text-hint focus:border-accent'

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3 text-center">
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="mt-0.5 text-xs text-hint">{label}</div>
      {sub && <div className="text-[10px] text-hint">{sub}</div>}
    </div>
  )
}


export function Segmented<T extends string | number>({
  value, options, onChange, className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      className={clsx('grid gap-1 rounded-2xl bg-card2 p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-xl py-2 text-sm font-semibold transition',
            value === o.value ? 'bg-accent text-accent-fg' : 'text-hint',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={clsx('relative h-8 w-14 shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-card2')}
    >
      <span
        className={clsx(
          'absolute top-1 h-6 w-6 rounded-full shadow transition-all',
          on ? 'left-7 bg-accent-fg' : 'left-1 bg-hint',
        )}
      />
    </button>
  )
}


export function ProgressBar({ value, done, className }: { value: number; done?: boolean; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      className={clsx('h-2.5 overflow-hidden rounded-full bg-card2', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', done ? 'bg-ok' : 'bg-accent')}
        style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
      />
    </div>
  )
}


export function Ring({ value, max, size = 76, children }: { value: number; max: number; size?: number; children?: ReactNode }) {
  const r = (size - 10) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, max ? value / max : 0))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card2)" strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset .5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-lg font-bold">{children}</div>
    </div>
  )
}


export function Delta({ value, prev, invert }: { value: number; prev: number; invert?: boolean }) {
  if (!prev && !value) return <span className="text-xs text-hint">-</span>
  if (!prev) return <span className="text-xs text-hint">новое</span>
  const pct = Math.round(((value - prev) / prev) * 100)
  if (pct === 0) return <span className="text-xs text-hint">без изменений</span>
  const good = invert ? pct < 0 : pct > 0
  return (
    <span className={clsx('text-xs font-semibold', good ? 'text-ok' : 'text-danger')}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

let scrollLocks = 0






export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const dismiss = useCallback(() => {
    const el = sheetRef.current
    if (closing.current) return
    closing.current = true
    if (!el) return closeRef.current()
    el.style.transition = 'transform .2s ease-in'
    el.style.transform = `translateY(${el.offsetHeight + 40}px)`
    window.setTimeout(() => closeRef.current(), 190)
  }, [])

  useEffect(() => {
    const tg = window.Telegram?.WebApp
    try {
      tg?.disableVerticalSwipes?.()
    } catch {

    }
    if (scrollLocks++ === 0) document.body.style.overflow = 'hidden'
    return () => {

      if (--scrollLocks === 0) {
        document.body.style.overflow = ''
        try {
          tg?.enableVerticalSwipes?.()
        } catch {

        }
      }
    }
  }, [])


  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const st = { y0: 0, dy: 0, t0: 0, can: false, dragging: false }
    const setY = (y: number, animate: boolean) => {
      el.style.transition = animate ? 'transform .2s ease-out' : 'none'
      el.style.transform = y > 0 ? `translateY(${y}px)` : ''
    }
    const onStart = (e: TouchEvent) => {
      if (closing.current) return
      const onHandle = !!(e.target as HTMLElement).closest('[data-sheet-handle]')
      const atTop = (bodyRef.current?.scrollTop ?? 0) <= 0
      st.can = onHandle || atTop
      st.y0 = e.touches[0].clientY
      st.dy = 0
      st.t0 = Date.now()
      st.dragging = false
    }
    const onMove = (e: TouchEvent) => {
      if (!st.can || closing.current) return
      const dy = e.touches[0].clientY - st.y0
      if (!st.dragging) {
        if (dy < -4) {
          st.can = false
          return
        }
        if (dy <= 4) return
        st.dragging = true
      }
      if (e.cancelable) e.preventDefault()
      st.dy = dy
      setY(dy, false)
    }
    const onEnd = () => {
      if (!st.dragging) return
      st.dragging = false
      const speed = st.dy / Math.max(1, Date.now() - st.t0)
      if (st.dy > 110 || (st.dy > 40 && speed > 0.55)) dismiss()
      else setY(0, true)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)


    const handle = el.querySelector<HTMLElement>('[data-sheet-handle]')
    const onDown = (e: MouseEvent) => {
      if (closing.current) return
      st.y0 = e.clientY
      st.t0 = Date.now()
      st.dy = 0
      st.dragging = true
      const move = (ev: MouseEvent) => {
        st.dy = Math.max(0, ev.clientY - st.y0)
        setY(st.dy, false)
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        onEnd()
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
    handle?.addEventListener('mousedown', onDown)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      handle?.removeEventListener('mousedown', onDown)
    }
  }, [dismiss])

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade items-end bg-black/60" onClick={dismiss}>
      <div
        ref={sheetRef}
        className="mx-auto flex max-h-[92dvh] w-full max-w-xl animate-sheet flex-col overflow-hidden rounded-t-[28px] border-t border-line bg-bg"
        onClick={(e) => e.stopPropagation()}
      >
        {                                                                                                                                                            }
        <div data-sheet-handle className="shrink-0 cursor-grab touch-none px-5 pb-3 pt-3.5 active:cursor-grabbing" aria-hidden="true">
          <div className="mx-auto h-1.5 w-11 rounded-full bg-hint/50" />
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4">
      <div className="animate-fade rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-lg">{message}</div>
    </div>
  )
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number>()
  const show = useCallback((m: string) => {
    setMsg(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 2200)
  }, [])
  return { msg, show }
}
