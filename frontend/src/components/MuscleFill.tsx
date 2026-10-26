import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { api, type MuscleFillItem, type MuscleMap } from '../services/api'
import { haptic } from '../utils/telegram'
import BodyMap from './BodyMap'
import { Card, ErrorBox, Spinner, fmtNum, useLoad } from './ui'

type Scope = 'week' | 'cycle'

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100
  const b = n % 10
  if (a >= 11 && a <= 14) return many
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many
}

function Ring({ percent }: { percent: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" stroke="rgb(var(--card2-rgb))" />
        <circle
          cx="38" cy="38" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke="rgb(var(--accent-rgb))"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(percent, 100) / 100)}
          style={{ transition: 'stroke-dashoffset 0.7s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-lg font-bold">{percent}%</div>
    </div>
  )
}

function headline(data: MuscleMap): { title: string; text: string } {
  if (data.scope === 'week' && data.start && data.end) {
    const left = (data.days_left ?? 0) + 1
    return {
      title: `Неделя ${day(data.start)} - ${day(data.end)}`,
      text:
        left === 1
          ? 'Последний день недели, завтра карта начнётся заново.'
          : `Карта начнётся заново через ${left} ${plural(left, 'день', 'дня', 'дней')}.`,
    }
  }
  const cycle = data.cycle
  const name = data.program_name ? `«${data.program_name}»` : 'программы'
  if (!cycle || !data.start) {
    return { title: `Круг ${name}`, text: 'Круг ещё не начат: первая тренировка начнёт заполнять карту.' }
  }
  if (cycle.completed) {
    return { title: `Круг ${name} пройден`, text: 'Следующая тренировка начнёт новый круг с чистой карты.' }
  }
  return {
    title: `Круг ${name}`,
    text: `Тренировка ${cycle.done} из ${cycle.total}. Карта обнулится, когда круг будет пройден.`,
  }
}

function Detail({ m }: { m: MuscleFillItem }) {
  const goal = m.progress !== null
  const left = Math.max(0, m.target - m.load)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <b>{m.name}</b>
        {goal ? (
          m.progress! >= 1 ? (
            <span className="text-xs font-semibold text-ok">заполнено</span>
          ) : (
            <span className="text-xs text-hint">осталось {fmtNum(left)} подх.</span>
          )
        ) : (
          <span className="text-xs text-hint">вне цели</span>
        )}
      </div>
      {goal && (
        <div className="h-2 overflow-hidden rounded-full bg-bg">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round((m.progress ?? 0) * 100)}%` }} />
        </div>
      )}
      <div className="text-hint">
        {goal ? `${fmtNum(m.load)} из ${fmtNum(m.target)} подходов` : `${fmtNum(m.load)} подходов, цели для этой мышцы нет`}
        {m.last_days !== null && ` · последний раз ${m.last_days === 0 ? 'сегодня' : m.last_days === 1 ? 'вчера' : `${m.last_days} дн. назад`}`}
      </div>
      {(!goal || m.progress! < 1) && m.hints.length > 0 && <div>Закроют: {m.hints.join(', ')}</div>}
    </div>
  )
}

export default function MuscleFill({ scope }: { scope: Scope }) {
  const q = useLoad(() => api.muscleMap(scope), [scope], `overview:map:${scope}`)
  const [selected, setSelected] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const data = q.data

  const values = useMemo(
    () => Object.fromEntries((data?.muscles ?? []).map((m) => [m.name, m.progress ?? -1])),
    [data],
  )
  const open = useMemo(
    () =>
      (data?.muscles ?? [])
        .filter((m) => m.progress !== null && m.progress < 1)
        .sort((a, b) => b.target - b.load - (a.target - a.load)),
    [data],
  )

  if (q.loading && !data) return <Spinner />
  if (q.error && !data) return <ErrorBox message={q.error} onRetry={q.reload} />
  if (!data) return null

  if (scope === 'cycle' && data.scope !== 'cycle') {
    return (
      <Card className="text-center text-sm text-hint">
        Круг считается по активной программе. Выберите программу в разделе «План», и карта будет заполняться по её кругу.
      </Card>
    )
  }

  const head = headline(data)
  const picked = data.muscles.find((m) => m.name === selected)
  const complete = data.total > 0 && data.filled === data.total
  const pick = (name: string) => {
    haptic.select()
    setSelected((cur) => (cur === name ? null : name))
  }

  let info
  if (picked) {
    info = <Detail m={picked} />
  } else if (complete) {
    info = (
      <p className="bm-pop font-semibold">
        Карта заполнена: все {data.total} мышц закрыты. {data.scope === 'week' ? 'Отличная неделя.' : 'Круг выполнен.'}
      </p>
    )
  } else if (data.next_workout && data.next_workout.muscles.length > 0) {
    info = (
      <p>
        Следующая тренировка «{data.next_workout.name}» продвинет: <b>{data.next_workout.muscles.join(', ')}</b>.
      </p>
    )
  } else {
    info = <p className="text-hint">Нажмите на мышцу, чтобы увидеть, сколько осталось и какие упражнения её закроют.</p>
  }

  return (
    <Card className="space-y-3 !px-3">
      <div className="flex items-center gap-3 px-1">
        <Ring percent={data.percent} />
        <div className="min-w-0">
          <div className="font-semibold leading-tight">{head.title}</div>
          <div className="mt-0.5 text-xs text-hint">{head.text}</div>
          <div className="mt-1 text-sm">
            <b>{data.filled}</b>
            <span className="text-hint"> из {data.total} мышц заполнено</span>
            {data.prev_percent !== null && data.scope === 'week' && (
              <span className="text-hint"> · прошлая неделя {data.prev_percent}%</span>
            )}
          </div>
        </div>
      </div>

      <div
        className={clsx('rounded-2xl', complete && 'bm-pop')}
        style={{ background: 'radial-gradient(60% 45% at 50% 40%, rgb(var(--accent-rgb) / 0.10), transparent 75%)' }}
      >
        <BodyMap values={values} mode="fill" selected={selected} onSelect={pick} height={340} />
      </div>

      <div className="flex items-center justify-center gap-4 text-[11px] text-hint">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-hint/30" />пусто</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent/50" />в процессе</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent" />заполнено</span>
      </div>

      <div className="mx-1 min-h-[4.25rem] rounded-2xl bg-card2 px-3.5 py-3 text-sm">{info}</div>

      {data.source === 'default' && (
        <p className="mx-1 text-xs text-hint">
          Цель по умолчанию: около 8 подходов на крупную мышцу и 4 на малую. Запустите программу, и цели подстроятся под неё.
        </p>
      )}

      {open.length > 0 && (
        <div className="mx-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-hint">Осталось:</span>
          {open.map((m) => (
            <button
              key={m.name}
              onClick={() => pick(m.name)}
              className={clsx(
                'rounded-full px-2.5 py-1 text-xs font-medium',
                selected === m.name ? 'bg-accent text-accent-fg' : 'bg-card2 text-hint',
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      <div className="mx-1">
        <button className="w-full py-1 text-center text-sm font-medium text-brand" onClick={() => setListOpen((v) => !v)}>
          {listOpen ? 'Скрыть список' : 'Все мышцы'}
        </button>
        {listOpen && (
          <div className="mt-2 space-y-3">
            {data.muscles.map((m) => (
              <button key={m.name} className="block w-full text-left" onClick={() => pick(m.name)}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className={selected === m.name ? 'font-semibold' : ''}>{m.name}</span>
                  <span className="text-hint">
                    {m.progress === null ? `${fmtNum(m.load)} подх.` : `${fmtNum(m.load)} / ${fmtNum(m.target)}`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-card2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((m.progress ?? 0) * 100)}%` }} />
                </div>
              </button>
            ))}
            <p className="text-xs text-hint">Вспомогательные мышцы считаются наполовину. Кардио не учитывается.</p>
          </div>
        )}
      </div>
    </Card>
  )
}
