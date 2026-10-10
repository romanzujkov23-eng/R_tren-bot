import { useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type SessionBrief } from '../services/api'
import { Card, Delta, ErrorBox, FEELINGS, Segmented, SectionTitle, Spinner, fmtDate, fmtNum, useLoad } from '../components/ui'
import Icon from '../components/Icon'

const AXIS = { fontSize: 11, fill: 'var(--hint)' }
const TOOLTIP = { background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)', fontSize: 12 }
const GRID = <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ч ${Math.round(m % 60)} мин` : `${Math.round(m)} мин`)

function Kpi({ label, value, unit, delta }: { label: string; value: ReactNode; unit?: string; delta: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-hint">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-hint">{unit}</span>}
      </div>
      <div className="mt-0.5">{delta}</div>
    </div>
  )
}


export default function OverviewTab() {
  const [weeks, setWeeks] = useState(12)
  const [metric, setMetric] = useState<'volume' | 'workouts' | 'sets'>('volume')
  const q = useLoad(() => api.overview(weeks), [weeks], `overview:${weeks}`)
  const [openEx, setOpenEx] = useState<number | null>(null)

  const data = q.data
  const empty = !!data && data.kpi.workouts.value === 0 && data.kpi.workouts.prev === 0

  return (
    <div className="space-y-5">
      <Segmented
        value={weeks}
        options={[
          { value: 4, label: '4 нед' },
          { value: 8, label: '8 нед' },
          { value: 12, label: '12 нед' },
          { value: 26, label: '6 мес' },
        ]}
        onChange={setWeeks}
      />

      {q.loading && !data && <Spinner />}
      {q.error && !data && <ErrorBox message={q.error} onRetry={q.reload} />}

      {data && (
        <>
          <section>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Тренировки" value={data.kpi.workouts.value} delta={<Delta {...data.kpi.workouts} />} />
              <Kpi label="Тоннаж" value={fmtNum(data.kpi.volume.value)} unit="кг" delta={<Delta {...data.kpi.volume} />} />
              <Kpi label="Подходы" value={data.kpi.sets.value} delta={<Delta {...data.kpi.sets} />} />
              <Kpi label="Время в зале" value={fmtMinutes(data.kpi.minutes.value)} delta={<Delta {...data.kpi.minutes} />} />
              <Kpi label="Средняя длительность" value={Math.round(data.kpi.avg_minutes.value)} unit="мин" delta={<Delta {...data.kpi.avg_minutes} />} />
              <Kpi label="Частота" value={data.kpi.per_week.value} unit="в неделю" delta={<Delta {...data.kpi.per_week} />} />
            </div>
            <p className="mt-2 text-xs text-hint">Изменение показано относительно предыдущих {weeks} нед.</p>
          </section>

          {empty ? (
            <Card className="text-center text-sm text-hint">За выбранный период тренировок нет.</Card>
          ) : (
            <>
              <section>
                <SectionTitle>Нагрузка по неделям</SectionTitle>
                <Card>
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
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.weekly}>
                        {GRID}
                        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} interval={weeks > 12 ? 3 : 0} />
                        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={42} allowDecimals={false} />
                        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'var(--card2)' }} />
                        <Bar isAnimationActive={false} dataKey={metric} fill="var(--accent)" radius={[6, 6, 0, 0]} name={metric === 'volume' ? 'Тоннаж, кг' : metric === 'sets' ? 'Подходов' : 'Тренировок'} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </section>

              {data.muscles.length > 0 && (
                <section>
                  <SectionTitle>Нагрузка по мышцам</SectionTitle>
                  <Card className="space-y-3">
                    {data.muscles.map((m) => (
                      <div key={m.name}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span>{m.name}</span>
                          <span className="text-hint">
                            {m.sets} подх. · {Math.round(m.share * 100)}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-card2">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (m.share / data.muscles[0].share) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-hint">Каждый подход засчитывается основным мышцам упражнения. Кардио не учитывается.</p>
                  </Card>
                </section>
              )}

              {data.exercises.length > 0 && (
                <section>
                  <SectionTitle>Упражнения</SectionTitle>
                  <Card className="!p-0">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wide text-hint">
                      <span>Упражнение</span>
                      <span className="text-right">Лучший подход</span>
                      <span className="w-14 text-right">1ПМ</span>
                    </div>
                    {data.exercises.map((e) => (
                      <div key={e.exercise_id} className="border-b border-line last:border-0">
                        <button
                          className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-3 px-4 py-3 text-left"
                          onClick={() => setOpenEx(openEx === e.exercise_id ? null : e.exercise_id)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{e.name}</span>
                            <span className="block text-xs text-hint">
                              {e.sessions} трен.
                              {e.delta_1rm !== null && e.delta_1rm !== 0 && (
                                <span className={e.delta_1rm > 0 ? 'text-ok' : 'text-danger'}>
                                  {' · '}
                                  {e.delta_1rm > 0 ? '+' : ''}
                                  {fmtNum(e.delta_1rm)} кг
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="text-right text-sm">{e.best_weight > 0 ? `${fmtNum(e.best_weight)}×${e.best_reps}` : `${e.best_reps} повт.`}</span>
                          <span className="w-14 text-right text-sm font-semibold">{e.best_1rm > 0 ? fmtNum(e.best_1rm) : '-'}</span>
                        </button>
                        {openEx === e.exercise_id && <ExerciseProgress id={e.exercise_id} />}
                      </div>
                    ))}
                  </Card>
                  <p className="mt-2 text-xs text-hint">1ПМ - расчётный максимум на одно повторение (формула Эпли). Нажмите на строку, чтобы увидеть динамику.</p>
                </section>
              )}
            </>
          )}

          <History />
        </>
      )}
    </div>
  )
}

function ExerciseProgress({ id }: { id: number }) {
  const q = useLoad(() => api.progress(id), [id], `progress:${id}`)
  if (q.loading && !q.data) return <Spinner className="!py-4" />
  const pts = q.data?.points ?? []
  if (pts.length < 2) return <p className="px-4 pb-3 text-xs text-hint">Для графика нужно минимум две тренировки с этим упражнением.</p>
  return (
    <div className="h-44 px-2 pb-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts}>
          {GRID}
          <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={38} domain={['auto', 'auto']} />
          <Tooltip contentStyle={TOOLTIP} />
          <Line isAnimationActive={false} type="monotone" dataKey="est_1rm" name="1ПМ" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="max_weight" name="Макс. вес" stroke="var(--chart2)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function History() {
  const q = useLoad(() => api.history(20), [], 'history')
  const [open, setOpen] = useState<number | null>(null)
  if (q.loading && !q.data) return null
  const rows = q.data ?? []
  if (rows.length === 0) return null
  return (
    <section>
      <SectionTitle>История</SectionTitle>
      <div className="space-y-2">
        {rows.map((h) => (
          <HistoryRow key={h.id} h={h} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />
        ))}
      </div>
    </section>
  )
}

function HistoryRow({ h, open, onToggle }: { h: SessionBrief; open: boolean; onToggle: () => void }) {
  const detail = useLoad(() => (open ? api.session(h.id) : Promise.resolve(null)), [open, h.id], open ? `session:${h.id}` : undefined)
  const grouped = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of detail.data?.sets ?? []) m.set(s.exercise.name, [...(m.get(s.exercise.name) ?? []), `${fmtNum(s.weight)}×${s.reps}`])
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
        {h.feeling && <span className="text-xl">{FEELINGS[h.feeling - 1]}</span>}
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
