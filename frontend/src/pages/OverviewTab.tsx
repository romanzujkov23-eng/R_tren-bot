import { useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Overview, type SessionBrief } from '../services/api'
import { fmtSetLine, measureOf } from '../utils/measure'
import { PERIODS, periodOf } from '../utils/periods'
import { Button, Card, Delta, ErrorBox, Feeling, Segmented, PageSkeleton, ShowMore, Spinner, fmtDate, fmtNum, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import MuscleSection from '../components/MuscleSection'

const AXIS = { fontSize: 11, fill: 'var(--hint)' }
const TOOLTIP = { background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)', fontSize: 12 }
const GRID = <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />

type Section = 'muscles' | 'trend' | 'exercises' | 'history'
type Metric = 'volume' | 'workouts' | 'sets'

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ч ${Math.round(m % 60)} мин` : `${Math.round(m)} мин`)
const fmtTonnage = (kg: number) => (kg >= 10000 ? { value: (kg / 1000).toFixed(1).replace('.', ','), unit: 'т' } : { value: fmtNum(kg), unit: 'кг' })

function Kpi({ label, value, unit, delta }: { label: string; value: ReactNode; unit?: string; delta: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3">
      <div className="truncate text-xs text-hint">{label}</div>
      <div className="mt-1 text-xl font-bold leading-tight">
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-hint">{unit}</span>}
      </div>
      <div className="mt-0.5">{delta}</div>
    </div>
  )
}

function Kpis({ kpi, weeks }: { kpi: Overview['kpi']; weeks: number }) {
  const [more, setMore] = useState(false)
  const tonnage = fmtTonnage(kpi.volume.value)
  return (
    <section>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Тренировки" value={kpi.workouts.value} delta={<Delta {...kpi.workouts} />} />
        <Kpi label="Тоннаж" value={tonnage.value} unit={tonnage.unit} delta={<Delta {...kpi.volume} />} />
        <Kpi label="Подходы" value={kpi.sets.value} delta={<Delta {...kpi.sets} />} />
        {more && (
          <>
            <Kpi label="Время" value={fmtMinutes(kpi.minutes.value)} delta={<Delta {...kpi.minutes} />} />
            <Kpi label="Средняя" value={Math.round(kpi.avg_minutes.value)} unit="мин" delta={<Delta {...kpi.avg_minutes} />} />
            <Kpi label="Частота" value={kpi.per_week.value} unit="/нед" delta={<Delta {...kpi.per_week} />} />
          </>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-hint">
        <span>Изменение к {periodOf(weeks).prev}</span>
        <button className="font-medium text-brand" onClick={() => setMore((v) => !v)}>
          {more ? 'Меньше' : 'Ещё показатели'}
        </button>
      </div>
    </section>
  )
}

function TrendChart({ data }: { data: Overview }) {
  const [metric, setMetric] = useState<Metric>('volume')
  const n = data.weekly.length
  return (
    <Card>
      <p className="mb-2 text-sm font-semibold">{data.bucket === 'day' ? 'Нагрузка по дням' : 'Нагрузка по неделям'}</p>
      <Segmented
        className="mb-3"
        value={metric}
        options={[
          { value: 'volume', label: 'Тоннаж' },
          { value: 'workouts', label: 'Тренировки' },
          { value: 'sets', label: 'Подходы' },
        ]}
        onChange={setMetric}
      />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.weekly}>
            {GRID}
            <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} interval={n > 14 ? 2 : n > 7 ? 1 : 0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={42} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'var(--card2)' }} labelFormatter={(l) => (data.bucket === 'week' ? `Неделя с ${l}` : l)} />
            <Bar isAnimationActive={false} dataKey={metric} fill="var(--accent)" radius={[6, 6, 0, 0]} name={metric === 'volume' ? 'Тоннаж, кг' : metric === 'sets' ? 'Подходов' : 'Тренировок'} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

const unitOf = (measure: string | undefined) => (measure === 'seconds' ? 'сек' : measure === 'minutes' ? 'мин' : 'кг')

function bestSet(e: Overview['exercises'][number]) {
  if (e.measure && e.measure !== 'reps') return fmtSetLine({ weight: e.best_weight, reps: e.best_reps }, e.measure)
  return e.best_weight > 0 ? `${fmtNum(e.best_weight)}×${e.best_reps}` : `${e.best_reps} повт.`
}

const LIST_LIMIT = 5

function ExercisesTable({ exercises }: { exercises: Overview['exercises'] }) {
  const [open, setOpen] = useState<number | null>(null)
  const [all, setAll] = useState(false)
  if (exercises.length === 0) return <Card className="text-center text-sm text-hint">За период нет упражнений.</Card>
  return (
    <>
      <Card className="!p-0">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-4 py-2 text-xs text-hint">
          <span>Упражнение</span>
          <span className="text-right">Лучший подход</span>
          <span className="w-14 text-right">1ПМ</span>
        </div>
        {(all ? exercises : exercises.slice(0, LIST_LIMIT)).map((e) => (
          <div key={e.exercise_id} className="border-b border-line last:border-0">
            <button
              className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-3 px-4 py-3 text-left"
              onClick={() => setOpen(open === e.exercise_id ? null : e.exercise_id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{e.name}</span>
                <span className="block text-xs text-hint">
                  {e.sessions} трен.
                  {e.delta_1rm !== null && e.delta_1rm !== 0 && (
                    <span className={e.delta_1rm > 0 ? 'text-ok' : 'text-danger'}>
                      {' · '}
                      {e.delta_1rm > 0 ? '+' : ''}
                      {fmtNum(e.delta_1rm)} {unitOf(e.measure)}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-right text-sm">{bestSet(e)}</span>
              <span className="w-14 text-right text-sm font-semibold">{e.best_1rm > 0 ? fmtNum(e.best_1rm) : '-'}</span>
            </button>
            {open === e.exercise_id && <ExerciseProgress id={e.exercise_id} />}
          </div>
        ))}
        <ShowMore total={exercises.length} limit={LIST_LIMIT} open={all} onToggle={() => setAll((v) => !v)} />
      </Card>
      <p className="mt-2 text-xs text-hint">1ПМ - расчётный максимум. Нажмите на строку для графика.</p>
    </>
  )
}

export default function OverviewTab() {
  const [weeks, setWeeks] = useState(1)
  const [section, setSection] = useState<Section>('muscles')
  const q = useLoad(() => api.overview(weeks), [weeks], `overview:${weeks}`)

  const data = q.data
  const empty = !!data && data.kpi.workouts.value === 0 && data.kpi.workouts.prev === 0

  return (
    <div className="space-y-3">
      <Segmented value={weeks} options={PERIODS.map(({ value, label }) => ({ value, label }))} onChange={setWeeks} />

      {q.loading && !data && <PageSkeleton variant="stats" />}
      {q.error && !data && <ErrorBox message={q.error} onRetry={q.reload} />}

      {data && (
        <>
          <Kpis kpi={data.kpi} weeks={weeks} />

          <Segmented
            value={section}
            options={[
              { value: 'muscles', label: 'Мышцы' },
              { value: 'trend', label: 'Динамика' },
              { value: 'exercises', label: 'Упражнения' },
              { value: 'history', label: 'История' },
            ]}
            onChange={setSection}
          />

          {section === 'history' ? (
            <History />
          ) : empty ? (
            <Card className="text-center text-sm text-hint">За выбранный период тренировок нет.</Card>
          ) : section === 'muscles' ? (
            <MuscleSection muscles={data.muscles} weeks={weeks} />
          ) : section === 'trend' ? (
            <TrendChart data={data} />
          ) : (
            <ExercisesTable exercises={data.exercises} />
          )}
        </>
      )}
    </div>
  )
}

function ExerciseProgress({ id }: { id: number }) {
  const q = useLoad(() => api.progress(id), [id], `progress:${id}`)
  if (q.loading && !q.data) return <Spinner className="!py-4" />
  const pts = q.data?.points ?? []
  const timed = q.data?.exercise.measure === 'seconds' || q.data?.exercise.measure === 'minutes'
  if (pts.length < 2) return <p className="px-4 pb-3 text-xs text-hint">Для графика нужно две тренировки.</p>
  return (
    <div className="h-44 px-2 pb-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts}>
          {GRID}
          <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={38} domain={['auto', 'auto']} />
          <Tooltip contentStyle={TOOLTIP} />
          {timed ? (
            <Line isAnimationActive={false} type="monotone" dataKey="max_reps" name={q.data?.exercise.measure === 'seconds' ? 'Секунды' : 'Минуты'} stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} />
          ) : (
            <>
              <Line isAnimationActive={false} type="monotone" dataKey="est_1rm" name="1ПМ" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="max_weight" name="Макс. вес" stroke="var(--chart2)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function History() {
  const q = useLoad(() => api.history(20), [], 'history')
  const [open, setOpen] = useState<number | null>(null)
  const [all, setAll] = useState(false)
  if (q.loading && !q.data) return <Spinner />
  const rows = q.data ?? []
  if (rows.length === 0) return <Card className="text-center text-sm text-hint">Завершённых тренировок пока нет.</Card>
  return (
    <div className="space-y-2">
      {(all ? rows : rows.slice(0, LIST_LIMIT)).map((h) => (
        <HistoryRow key={h.id} h={h} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />
      ))}
      {rows.length > LIST_LIMIT && (
        <Button variant="ghost" full size="sm" onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Показать все (${rows.length})`}
          <Icon name={all ? 'up' : 'down'} size={16} />
        </Button>
      )}
    </div>
  )
}

function HistoryRow({ h, open, onToggle }: { h: SessionBrief; open: boolean; onToggle: () => void }) {
  const detail = useLoad(() => (open ? api.session(h.id) : Promise.resolve(null)), [open, h.id], open ? `session:${h.id}` : undefined)
  const grouped = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of detail.data?.sets ?? []) m.set(s.exercise.name, [...(m.get(s.exercise.name) ?? []), fmtSetLine(s, measureOf(s.exercise))])
    return [...m.entries()]
  }, [detail.data])
  return (
    <Card className="!p-3.5">
      <button className="flex w-full items-center gap-3 text-left" onClick={onToggle}>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{h.name}</span>
          <span className="block text-xs text-hint">
            {h.finished_at && fmtDate(h.finished_at)} · {h.total_sets} подх. · {fmtNum(h.total_volume)} кг · {Math.round(h.duration_seconds / 60)} мин
          </span>
        </span>
        {h.feeling && <Feeling n={h.feeling} size={22} />}
        <Icon name={open ? 'up' : 'down'} size={18} className="text-hint" />
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {detail.loading && !detail.data && <p className="text-sm text-hint">Загрузка</p>}
          {grouped.map(([name, sets]) => (
            <div key={name} className="text-sm">
              <div className="font-medium">{name}</div>
              <div className="text-hint">{sets.join(' · ')}</div>
            </div>
          ))}
          {detail.data?.note && <p className="rounded-xl bg-card2 p-2.5 text-sm">{detail.data.note}</p>}
        </div>
      )}
    </Card>
  )
}
