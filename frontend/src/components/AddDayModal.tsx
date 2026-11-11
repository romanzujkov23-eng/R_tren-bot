import { useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api, type PlanDay } from '../services/api'
import { Button, Card, ErrorBox, Modal, fmtNum, inputCls, useLoad } from './ui'
import Icon from './Icon'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'

const shortName = (n: string) => n.split(' (')[0]

/** Выбор дополнительного дня для круга программы: день жима, кардио или своя тренировка. */
export default function AddDayModal({ own, onClose, onAdded }: { own: PlanDay[]; onClose: () => void; onAdded: () => void }) {
  const info = useLoad(() => api.extras(), [], 'extras')
  const bench = useLoad(() => api.bench(), [], 'bench')
  const [cardio, setCardio] = useState<string | null>(null)
  const [minutes, setMinutes] = useState('20')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const add = async (body: Parameters<typeof api.addExtra>[0]) => {
    haptic.tap()
    setBusy(true)
    setErr(null)
    try {
      await api.addExtra(body)
      haptic.success()
      cacheDrop('plan', 'dashboard', 'bench', 'overview', 'extras')
      onAdded()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  const b = bench.data
  const mins = parseInt(minutes)

  return (
    <Modal onClose={onClose}>
      <div className="space-y-5 pb-2">
        <div>
          <div className="text-lg font-bold">Добавить день в программу</div>
          <p className="mt-0.5 text-sm text-hint">День встанет в круг после ваших тренировок и будет подсказываться как следующий.</p>
        </div>
        {err && <ErrorBox message={err} />}

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-hint">Жим лёжа</div>
          {b?.active && b.in_program ? (
            <Card className="text-sm text-hint">День жима уже добавлен в программу.</Card>
          ) : b?.active ? (
            <button disabled={busy} onClick={() => add({ kind: 'bench' })} className="w-full text-left">
              <Card className="flex items-center gap-3">
                <Icon name="dumbbell" size={24} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Добавить день жима</span>
                  <span className="block text-sm text-hint">
                    Ваш цикл идёт: расчётный максимум {fmtNum(b.program?.e1rm ?? 0)} кг. Веса считаются по результатам.
                  </span>
                </span>
                <Icon name="plus" size={20} className="shrink-0 text-brand" />
              </Card>
            </button>
          ) : (
            <Link to="/plan/bench" onClick={onClose} className="block">
              <Card className="flex items-center gap-3">
                <Icon name="dumbbell" size={24} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Настроить программу жима</span>
                  <span className="block text-sm text-hint">Введёте результаты, и день жима сам встанет в круг программы.</span>
                </span>
                <Icon name="right" size={18} className="shrink-0 text-hint" />
              </Card>
            </Link>
          )}
        </section>

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-hint">Кардио</div>
          <div className="flex flex-wrap gap-1.5">
            {(info.data?.cardio ?? []).map((n) => (
              <button
                key={n}
                onClick={() => setCardio(cardio === n ? null : n)}
                aria-pressed={cardio === n}
                className={clsx('rounded-full px-3 py-1.5 text-sm font-medium', cardio === n ? 'bg-accent text-accent-fg' : 'bg-card2 text-hint')}
              >
                {shortName(n)}
              </button>
            ))}
          </div>
          {cardio && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input className={clsx(inputCls, 'pr-14')} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-hint">мин</span>
              </div>
              <Button disabled={busy || !(mins >= 1 && mins <= 240)} onClick={() => add({ kind: 'cardio', exercise: cardio, minutes: mins })}>
                Добавить
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-hint">Своя тренировка</div>
          {own.length === 0 ? (
            <p className="text-sm text-hint">Своих тренировок пока нет. Создайте тренировку в плане, и её можно будет добавить сюда.</p>
          ) : (
            own.map((d) => (
              <button key={d.workout_id} disabled={busy} onClick={() => add({ kind: 'workout', workout_id: d.workout_id })} className="w-full text-left">
                <Card className="flex items-center justify-between gap-3 !py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="block text-xs text-hint">{d.exercises.length} упр.</span>
                  </span>
                  <Icon name="plus" size={18} className="shrink-0 text-brand" />
                </Card>
              </button>
            ))
          )}
        </section>
      </div>
    </Modal>
  )
}
