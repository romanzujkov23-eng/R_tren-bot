import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../services/api'
import { Button, Card, fmtNum, useLoad } from './ui'
import Icon from './Icon'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'

const KIND_LABEL: Record<string, string> = {
  top: 'Верхний подход', backoff: 'Со сниженным весом', work: 'Рабочий', speed: 'Быстрый', attempt: 'Попытка', deload: 'Лёгкий',
}

/**
 * Дополнительный день жима лёжа: необязательная тренировка, которую можно добавить к любой программе.
 * variant "plan": карточка дня в плане, "home": компактная карточка под следующей тренировкой.
 */
export default function BenchDayCard({ variant }: { variant: 'plan' | 'home' }) {
  const nav = useNavigate()
  const q = useLoad(() => api.bench(), [], 'bench')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const s = q.data
  if (!s) return null

  if (!s.active || !s.program || !s.progress) {
    if (variant === 'home') return null
    return (
      <Link to="/plan/bench" className="block">
        <Card className="flex items-center gap-3.5 border-dashed">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-brand">
            <Icon name="plus" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold leading-snug">Добавить день жима лёжа</span>
            <span className="block text-sm text-hint">Необязательный дополнительный день. Подходит к любой программе, веса считаются по вашим результатам.</span>
          </span>
          <Icon name="right" size={18} className="shrink-0 text-hint" />
        </Card>
      </Link>
    )
  }

  const plan = s.next
  if (!plan) {
    return (
      <Link to="/plan/bench" className="block">
        <Card className="flex items-center gap-3.5">
          <Icon name="dumbbell" size={24} className="shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Цикл жима завершён</span>
            <span className="block text-sm text-hint">Расчётный максимум {fmtNum(s.program.e1rm)} кг. Откройте, чтобы начать новый цикл.</span>
          </span>
          <Icon name="right" size={18} className="shrink-0 text-hint" />
        </Card>
      </Link>
    )
  }

  const resume = !!s.resume_session_id
  const rest = s.chest_hours != null && s.chest_hours < 40 && ['heavy', 'volume', 'test'].includes(plan.kind)
  const restText = rest ? `Нагрузка на грудь была ${s.chest_hours! < 1 ? 'меньше часа' : `${Math.round(s.chest_hours!)} ч`} назад. Для тяжёлого жима лучше подождать около 48 часов.` : null

  const start = async () => {
    haptic.tap()
    setBusy(true)
    setErr(null)
    try {
      await api.benchStart()
      cacheDrop('dashboard', 'bench', 'plan')
      nav('/session')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  const meta = `Неделя ${s.progress.week} из ${s.program.weeks} · расчётный максимум ${fmtNum(s.program.e1rm)} кг`

  if (variant === 'home') {
    return (
      <Card className="space-y-2.5">
        <div className="flex items-center gap-3.5">
          <Icon name="dumbbell" size={24} className="shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wider text-hint">Дополнительный день</span>
            <span className="block font-semibold leading-snug">Жим лёжа: {plan.title.toLowerCase()}</span>
            <span className="block text-sm text-hint">{meta}</span>
          </span>
          <Button size="sm" disabled={busy} onClick={start}>
            {resume ? 'Продолжить' : 'Начать'}
          </Button>
        </div>
        {restText && <p className="rounded-xl bg-card2 px-3 py-2 text-xs text-hint">{restText}</p>}
        {err && <p className="text-xs text-danger">{err}</p>}
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-semibold">Жим лёжа: {plan.title.toLowerCase()}</div>
          <div className="text-xs text-hint">{meta}</div>
        </div>
        <span className="shrink-0 rounded-full border border-accent/50 px-2.5 py-1 text-xs font-bold text-brand">Доп. день</span>
      </div>

      {open && (
        <div className="mt-3 space-y-2.5 rounded-2xl bg-card2 px-3 py-2.5">
          {plan.warmup.length > 0 && (
            <p className="text-sm text-hint">Разминка (не записывайте): {plan.warmup.map((w) => `${fmtNum(w.weight)}×${w.reps}`).join(' → ')}</p>
          )}
          <ul className="divide-y divide-line">
            {plan.sets.map((x, i) => (
              <li key={i} className="flex items-center justify-between py-1.5 text-sm first:pt-0 last:pb-0">
                <span>{KIND_LABEL[x.kind] ?? x.label}</span>
                <span className="tabular-nums font-semibold">
                  {fmtNum(x.weight)} × {x.reps}
                  {x.rir !== null && <span className="ml-1.5 text-xs font-normal text-hint">запас {x.rir}</span>}
                </span>
              </li>
            ))}
          </ul>
          {plan.accessories.length > 0 && <p className="text-xs text-hint">Подсобные: {plan.accessories.map((a) => `${a.name} ${a.sets}×${a.reps}`).join(', ')}</p>}
        </div>
      )}

      {restText && <p className="mt-3 rounded-xl bg-card2 px-3 py-2 text-xs text-hint">{restText}</p>}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}

      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" disabled={busy} onClick={start}>
          <Icon name="play" size={16} fill="currentColor" /> {resume ? 'Продолжить' : 'Начать'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Состав'}
        </Button>
        <Link to="/plan/bench">
          <Button variant="ghost" size="sm" className={clsx('!px-3')} aria-label="Настроить день жима">
            <Icon name="edit" size={18} />
          </Button>
        </Link>
      </div>
    </Card>
  )
}
