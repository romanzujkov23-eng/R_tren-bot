import { useMemo, useState, type ReactNode } from 'react'
import type { MuscleLoad } from '../services/api'
import { periodOf } from '../utils/periods'
import BodyMap, { ALIASES, MUSCLES, muscleValues, type BodyMapMode } from './BodyMap'
import { Card, Segmented } from './ui'

const lastText = (days: number) => (days === 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} дн. назад`)

function MuscleDetail({ m }: { m: MuscleLoad }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <b>{m.name}</b>
        <span className="text-xs text-hint">{Math.round(m.share * 100)}% всей нагрузки</span>
      </div>
      <div className="mt-1 text-hint">
        {m.sets} основных и {m.assist} вспомогательных подходов · последний раз {lastText(m.last_days)}
      </div>
    </div>
  )
}

export default function MuscleSection({ muscles, weeks }: { muscles: MuscleLoad[]; weeks: number }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<BodyMapMode>('heat')
  const [listOpen, setListOpen] = useState(false)

  const values = useMemo(() => muscleValues(muscles.map((m) => ({ name: m.name, weight: m.load }))), [muscles])
  const missed = useMemo(() => MUSCLES.filter((m) => !(values[m] > 0)), [values])
  const periodText = periodOf(weeks).text
  const picked = muscles.find((m) => m.name === selected)
  const group = selected && !picked ? muscles.find((m) => ALIASES[m.name]?.includes(selected)) : undefined
  const topLoad = muscles[0]?.load || 1
  const pick = (name: string) => setSelected((cur) => (cur === name ? null : name))

  let info: ReactNode
  if (!selected) {
    info = (
      <div className="flex items-center gap-3">
        <div className="text-3xl font-bold leading-none">
          {MUSCLES.length - missed.length}
          <span className="text-base font-medium text-hint">/{MUSCLES.length}</span>
        </div>
        <p className="text-sm text-hint">
          {muscles.length ? `мышечных групп в работе ${periodText}. Нажмите на мышцу для подробностей.` : `Нагрузки ${periodText} нет.`}
        </p>
      </div>
    )
  } else if (picked) {
    info = <MuscleDetail m={picked} />
  } else if (group) {
    info = (
      <p>
        <b>{selected}</b>{' '}
        <span className="text-hint">входит в общую группу «{group.name}» ({group.sets} подх.). Точнее считаются упражнения из каталога.</span>
      </p>
    )
  } else {
    info = (
      <p>
        <b>{selected}</b> <span className="text-danger">нагрузки {periodText} нет</span>
      </p>
    )
  }

  return (
    <Card className="space-y-3 !px-3">
      <Segmented
        value={mode}
        options={[
          { value: 'heat', label: 'Нагрузка' },
          { value: 'gaps', label: 'Пропуски' },
        ]}
        onChange={setMode}
      />

      <div className="rounded-2xl" style={{ background: 'radial-gradient(60% 45% at 50% 40%, rgb(var(--accent-rgb) / 0.10), transparent 75%)' }}>
        <BodyMap values={values} mode={mode} selected={selected} onSelect={pick} height={340} />
      </div>

      {mode === 'heat' ? (
        <div className="flex items-center gap-2 px-2 text-[11px] text-hint">
          <span>меньше</span>
          <span className="h-1.5 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.22), rgb(var(--accent-rgb)))' }} />
          <span>больше</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-4 text-[11px] text-hint">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent/50" />нагружено</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-danger/70" />пропущено</span>
        </div>
      )}

      <div className="mx-1 min-h-[4.25rem] rounded-2xl bg-card2 px-3.5 py-3 text-sm">{info}</div>

      {muscles.length > 0 && missed.length > 0 && (
        <div className="mx-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-hint">Забыли:</span>
          {missed.map((m) => (
            <button
              key={m}
              onClick={() => pick(m)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${selected === m ? 'bg-danger text-bg' : 'bg-danger/15 text-danger'}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {muscles.length > 0 && (
        <div className="mx-1">
          <button className="w-full py-1 text-center text-sm font-medium text-brand" onClick={() => setListOpen((v) => !v)}>
            {listOpen ? 'Скрыть список' : `Все мышцы (${muscles.length})`}
          </button>
          {listOpen && (
            <div className="mt-2 space-y-3">
              {muscles.map((m) => (
                <button key={m.name} className="block w-full text-left" onClick={() => pick(m.name)}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className={selected === m.name ? 'font-semibold' : ''}>{m.name}</span>
                    <span className="text-hint">
                      {m.sets} подх.{m.assist > 0 && ` + ${m.assist} доп.`} · {Math.round(m.share * 100)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-card2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (m.load / topLoad) * 100)}%` }} />
                  </div>
                </button>
              ))}
              <p className="text-xs text-hint">
                Вспомогательные мышцы считаются наполовину. Кардио не учитывается.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
