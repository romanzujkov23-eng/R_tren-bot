import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type BodyEntry, type BodyValues } from '../services/api'
import { Button, Card, ErrorBox, SectionTitle, Segmented, Spinner, Toast, fmtDate, inputCls, parseUtc, useLoad, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { confirmAction, haptic } from '../utils/telegram'
import { dateStr } from '../utils/dates'
import { cacheDrop } from '../utils/cache'

type Metric = 'weight' | 'waist' | 'chest' | 'hips' | 'arm' | 'thigh'
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'weight', label: 'Вес', unit: 'кг' },
  { key: 'waist', label: 'Талия', unit: 'см' },
  { key: 'chest', label: 'Грудь', unit: 'см' },
  { key: 'hips', label: 'Бёдра', unit: 'см' },
  { key: 'arm', label: 'Рука', unit: 'см' },
  { key: 'thigh', label: 'Нога', unit: 'см' },
]
const RANGES = [
  { value: 30, label: '1 мес' },
  { value: 90, label: '3 мес' },
  { value: 180, label: '6 мес' },
  { value: 0, label: 'Всё' },
]
const AXIS = { fontSize: 11, fill: 'var(--hint)' }
const num = (s: string) => parseFloat(s.replace(',', '.'))
const r1 = (n: number) => Math.round(n * 10) / 10

export default function BodyTab() {
  const q = useLoad(() => api.body(), [], 'body')
  const toast = useToast()
  const [metric, setMetric] = useState<Metric>('weight')
  const [range, setRange] = useState(90)
  const [form, setForm] = useState<Record<string, string>>({})
  const [day, setDay] = useState(dateStr(new Date()))
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const entries = useMemo(() => q.data ?? [], [q.data])
  const meta = METRICS.find((m) => m.key === metric)!


  const series = useMemo(
    () =>
      [...entries]
        .filter((e) => e[metric] != null)
        .reverse()
        .map((e) => ({ t: parseUtc(e.measured_at).getTime(), date: fmtDate(e.measured_at), value: e[metric] as number })),
    [entries, metric],
  )
  const view = useMemo(() => {
    if (!range) return series
    const from = Date.now() - range * 86_400_000
    return series.filter((p) => p.t >= from)
  }, [series, range])


  const chart = useMemo(
    () =>
      view.map((p, i) => {
        const w = view.slice(Math.max(0, i - 4), i + 1)
        return { ...p, avg: r1(w.reduce((a, b) => a + b.value, 0) / w.length) }
      }),
    [view],
  )

  if (q.loading && !q.data) return <Spinner />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const lastWeight = entries.find((e) => e.weight != null)?.weight

  const save = async () => {
    const values: BodyValues = { day }
    let any = false
    for (const k of ['weight', 'waist', 'chest', 'hips', 'arm', 'thigh'] as const) {
      const raw = form[k]?.trim()
      if (raw) {
        const v = num(raw)
        if (!(v > 0)) return setErr('Введите положительные числа')
        values[k] = v
        any = true
      }
    }
    if (!any) return setErr('Введите хотя бы одно значение')
    setBusy(true)
    setErr(null)
    try {
      await api.addBody(values)
      haptic.success()
      cacheDrop('goals')
      toast.show('Замер записан')
      setForm({})
      setMore(false)
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (e: BodyEntry) => {
    if (!(await confirmAction('Удалить этот замер?'))) return
    try {
      await api.deleteBody(e.id)
      cacheDrop('goals')
      await q.reload()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Ошибка')
    }
  }


  const current = series.length ? series[series.length - 1].value : null
  const first = view.length ? view[0].value : null
  const change = current !== null && first !== null && view.length > 1 ? r1(current - first) : null
  const values = view.map((p) => p.value)
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null

  const fmt = (n: number) => `${n % 1 ? n.toFixed(1) : n}`
  const describe = (e: BodyEntry) =>
    METRICS.filter((m) => e[m.key] != null)
      .map((m) => (m.key === 'weight' ? `${fmt(e.weight as number)} кг` : `${m.label} ${fmt(e[m.key] as number)}`))
      .join(' · ')


  const withDelta = entries.map((e, i) => {
    if (e.weight == null) return { e, delta: null as number | null }
    const prev = entries.slice(i + 1).find((x) => x.weight != null)
    return { e, delta: prev ? r1(e.weight - (prev.weight as number)) : null }
  })

  return (
    <div className="space-y-4">
      <Toast message={toast.msg} />
      {err && <ErrorBox message={err} />}

      {                                     }
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              metric === m.key ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-card'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Card className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-hint">{meta.label} сейчас</div>
            <div className="text-4xl font-bold leading-none">
              {current !== null ? fmt(current) : '-'}
              <span className="ml-1.5 text-base font-medium text-hint">{meta.unit}</span>
            </div>
          </div>
          {change !== null && (
            <div className="text-right">
              <div className="text-xs text-hint">за период</div>
              <div className={`text-lg font-semibold ${change === 0 ? 'text-hint' : 'text-fg'}`}>
                {change > 0 ? '+' : ''}
                {fmt(change)} {meta.unit}
              </div>
            </div>
          )}
        </div>

        <Segmented value={range} options={RANGES} onChange={setRange} />

        {chart.length > 1 ? (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={(v) => String(Math.round(v))} />
                  <Tooltip contentStyle={{ background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--fg)', fontSize: 12 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="value" name="Замер" stroke="var(--hint)" strokeWidth={1.5} dot={{ r: 2.5, fill: 'var(--hint)' }} />
                  {chart.length >= 5 && (
                    <Line isAnimationActive={false} type="monotone" dataKey="avg" name="Тренд" stroke="var(--accent)" strokeWidth={3} dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-card2 py-2">
                <div className="text-hint">минимум</div>
                <div className="text-sm font-semibold">{min !== null ? fmt(min) : '-'}</div>
              </div>
              <div className="rounded-xl bg-card2 py-2">
                <div className="text-hint">максимум</div>
                <div className="text-sm font-semibold">{max !== null ? fmt(max) : '-'}</div>
              </div>
              <div className="rounded-xl bg-card2 py-2">
                <div className="text-hint">замеров</div>
                <div className="text-sm font-semibold">{view.length}</div>
              </div>
            </div>
          </>
        ) : (
          <p className="py-4 text-center text-sm text-hint">
            {series.length < 2 ? 'Для графика нужно минимум два замера.' : 'В выбранном периоде меньше двух замеров.'}
          </p>
        )}
      </Card>

      {                           }
      <section>
        <SectionTitle>Новый замер</SectionTitle>
        <Card className="space-y-3">
          {                                                                                                                                                                                }
          <div className="grid grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-hint">Вес, кг</span>
              <input
                className="h-[58px] w-full min-w-0 rounded-2xl border border-line bg-card2 px-4 text-2xl font-bold outline-none focus:border-accent"
                inputMode="decimal"
                placeholder={lastWeight != null ? String(lastWeight) : '0'}
                value={form.weight ?? ''}
                onChange={(e) => set('weight', e.target.value)}
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs text-hint">Дата</span>
              <input
                type="date"
                className={`${inputCls} h-[58px] min-w-0 max-w-full`}
                value={day}
                max={dateStr(new Date())}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          </div>
          {more && (
            <div className="grid grid-cols-2 gap-2">
              {METRICS.filter((m) => m.key !== 'weight').map((m) => (
                <label key={m.key} className="block">
                  <span className="mb-1 block text-xs text-hint">{m.label}, см</span>
                  <input className={inputCls} inputMode="decimal" value={form[m.key] ?? ''} onChange={(e) => set(m.key, e.target.value)} />
                </label>
              ))}
            </div>
          )}
          <button className="w-full text-center text-sm text-brand" onClick={() => setMore((v) => !v)}>
            {more ? 'Скрыть объёмы' : 'Добавить объёмы: талия, грудь, бёдра, рука, нога'}
          </button>
          <Button full disabled={busy} onClick={save}>
            {busy ? 'Сохраняю' : 'Записать'}
          </Button>
        </Card>
      </section>

      <section>
        <SectionTitle>История замеров</SectionTitle>
        {entries.length === 0 ? (
          <p className="text-sm text-hint">Замеров пока нет. Взвешивайтесь раз в неделю, в одно и то же время: так график будет честным.</p>
        ) : (
          <div className="space-y-2">
            {withDelta.map(({ e, delta }) => (
              <Card key={e.id} className="flex items-center justify-between gap-2 !py-3">
                <div className="min-w-0">
                  <div className="text-xs text-hint">{fmtDate(e.measured_at)}</div>
                  <div className="text-sm">{describe(e)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {delta !== null && delta !== 0 && (
                    <span className={`text-xs font-semibold ${delta < 0 ? 'text-ok' : 'text-hint'}`}>
                      {delta > 0 ? '+' : ''}
                      {fmt(delta)}
                    </span>
                  )}
                  <button className="p-1 text-hint" onClick={() => remove(e)} aria-label="Удалить">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
