import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api, type BenchDayPlan, type BenchHint, type BenchParams, type BenchPreview, type BenchState, type BenchWeek } from '../services/api'
import { Button, Card, ErrorBox, Field, PageSkeleton, PageTitle, ProgressBar, SectionTitle, Segmented, fmtNum, inputCls, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'

const num = (s: string) => parseFloat(s.replace(',', '.'))
const KIND_LABEL: Record<string, string> = {
  top: 'Верхний подход', backoff: 'Со сниженным весом', work: 'Рабочий', speed: 'Быстрый', attempt: 'Попытка', deload: 'Лёгкий',
}

/* ───────── недели ───────── */

function Weeks({ weeks, openWeek }: { weeks: BenchWeek[]; openWeek?: number }) {
  const [open, setOpen] = useState<number | null>(openWeek ?? null)
  return (
    <div className="space-y-2">
      {weeks.map((w) => (
        <Card key={w.week} className="!p-0">
          <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === w.week ? null : w.week)}>
            <span>
              <span className="text-sm font-semibold">Неделя {w.week}</span>
              <span className="ml-2 text-xs text-hint">{w.phase}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-hint">
              {w.days.filter((d) => d.state === 'done').length}/{w.days.length}
              <Icon name={open === w.week ? 'up' : 'down'} size={16} />
            </span>
          </button>
          {open === w.week && (
            <div className="space-y-1.5 border-t border-line px-4 py-3">
              <p className="pb-1 text-xs text-hint">{w.focus}</p>
              {w.days.map((d) => (
                <div
                  key={d.day}
                  className={clsx('flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm', d.state === 'next' ? 'bg-accent/20' : 'bg-card2', d.state === 'done' && 'opacity-60')}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{d.state === 'done' ? '✓ ' : ''}{d.title}</span>
                    <span className="block text-xs text-hint">{d.summary}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

/* ───────── мастер настройки ───────── */

function NumField({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <Field label={label}>
      <div className="relative">
        <input className={clsx(inputCls, 'pr-12')} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-hint">{unit}</span>
      </div>
    </Field>
  )
}

function Wizard({ hint, onCreated }: { hint: BenchHint | null | undefined; onCreated: (s: BenchState) => void }) {
  const [bestW, setBestW] = useState(hint ? String(hint.best_weight) : '')
  const [bestR, setBestR] = useState(hint ? String(hint.best_reps) : '1')
  const [workW, setWorkW] = useState(hint?.work_weight ? String(hint.work_weight) : '')
  const [workR, setWorkR] = useState(hint?.work_reps ? String(hint.work_reps) : '8')
  const [days, setDays] = useState(1)
  const [preview, setPreview] = useState<BenchPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const params: BenchParams | null = (() => {
    const p = {
      best_weight: num(bestW), best_reps: parseInt(bestR), work_weight: num(workW), work_reps: parseInt(workR), days_per_week: days,
    }
    return p.best_weight >= 20 && p.best_weight <= 500 && p.work_weight >= 20 && p.work_weight <= 500 && p.best_reps >= 1 && p.best_reps <= 12 && p.work_reps >= 1 && p.work_reps <= 15
      ? p
      : null
  })()
  const key = params ? JSON.stringify(params) : ''

  useEffect(() => {
    if (!params) {
      setPreview(null)
      return
    }
    let alive = true
    const t = window.setTimeout(() => {
      api.benchPreview(params).then((r) => alive && setPreview(r)).catch(() => alive && setPreview(null))
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const create = async () => {
    if (!params) return
    haptic.tap()
    setBusy(true)
    setErr(null)
    try {
      const s = await api.benchCreate(params)
      haptic.success()
      onCreated(s)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-sm">
        <p>
          День жима лёжа, который встаёт в круг вашей программы, какая бы она ни была: из PPL на 3 дня получится круг на 4 дня. Вы вводите свои результаты, а приложение считает
          веса, подходы и повторы и пересчитывает их после каждой тренировки, исходя из того, как вам дались подходы.
        </p>
        <p className="text-hint">
          Цикл на 9 недель: три недели накопления, тяжёлые подходы, пик, разгрузка и тест нового максимума. В дне: жим, вариация с узким хватом и подсобные на трицепс, верх груди, спину и плечи. Обычные дни вашей программы остаются как есть. Если программа не выбрана, день запускается отдельно.
        </p>
      </Card>

      {hint && (
        <Card className="space-y-1 text-sm">
          <div className="font-semibold">Что мы знаем по вашим тренировкам</div>
          <p className="text-hint">
            Лучший жим: {fmtNum(hint.best_weight)} кг × {hint.best_reps}
            {hint.recent_e1rm ? `. Расчётный максимум за последние недели: около ${fmtNum(hint.recent_e1rm)} кг` : ''}
            {hint.weekly_sets ? `. Подходов жима в неделю: около ${fmtNum(hint.weekly_sets)}` : ''}.
          </p>
          <p className="text-xs text-hint">Поля ниже уже заполнены из истории. Поправьте, если нужно.</p>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Лучший жим, вес" value={bestW} onChange={setBestW} unit="кг" />
          <NumField label="Повторов с ним" value={bestR} onChange={setBestR} unit="раз" />
          <NumField label="Рабочий вес" value={workW} onChange={setWorkW} unit="кг" />
          <NumField label="Повторов с ним" value={workR} onChange={setWorkR} unit="раз" />
        </div>
        <p className="text-xs text-hint">Лучший жим: самый тяжёлый подход, который вы делали. Рабочий вес: с каким обычно жмёте основные подходы.</p>
        <Field label="Сколько дней жима в неделю" group>
          <Segmented
            value={days}
            options={[{ value: 1, label: '1 (доп. день)' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]}
            onChange={setDays}
          />
          <p className="mt-1.5 text-xs text-hint">
            {days === 1
              ? 'Один дополнительный тяжёлый день в неделю. Ваша программа остаётся как есть. Ставьте этот день на день отдыха или через день после тренировки, где много жимов.'
              : 'Приложение распределит тяжёлые, объёмные и лёгкие дни по неделе. Подходит, если жим для вас главный и ваша программа не занимает все дни.'}
          </p>
        </Field>
      </Card>

      {preview && (
        <section className="space-y-2">
          <Card className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-hint">Расчётный стартовый максимум</span>
              <span className="text-2xl font-bold">{fmtNum(preview.e1rm)} <span className="text-sm font-medium text-hint">кг</span></span>
            </div>
            {preview.notes.map((n) => (
              <p key={n} className="text-xs text-hint">{n}</p>
            ))}
          </Card>
          <SectionTitle>Как пройдёт цикл</SectionTitle>
          <Weeks weeks={preview.weeks} />
          <p className="px-1 text-xs text-hint">Это первоначальный расчёт. Веса пересчитаются после ваших тренировок.</p>
        </section>
      )}

      {err && <ErrorBox message={err} />}
      <Button full disabled={!params || busy} onClick={create}>
        {busy ? 'Создаю' : 'Начать программу'}
      </Button>
    </div>
  )
}

/* ───────── тренировка дня ───────── */

function DayCard({ plan, resume, onStart, busy, sinceBench }: { plan: BenchDayPlan; resume: boolean; onStart: () => void; busy: boolean; sinceBench?: number | null }) {
  const [tips, setTips] = useState(false)
  const rest = plan.rest_seconds
  return (
    <Card className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-hint">
          Неделя {plan.week} · тренировка {plan.day} · {plan.phase}
        </div>
        <div className="mt-1 text-xl font-bold leading-tight">{plan.title}</div>
        <p className="mt-1 text-sm text-hint">{plan.focus}</p>
      </div>

      {plan.warmup.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-semibold">Разминка (не записывайте)</div>
          <p className="text-sm text-hint">{plan.warmup.map((w) => `${fmtNum(w.weight)}×${w.reps}`).join(' → ')}</p>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-sm font-semibold">{plan.main}</div>
        <div className="space-y-1.5">
          {plan.sets.map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-card2 px-3 py-2 text-sm">
              <span>{KIND_LABEL[s.kind] ?? s.label}</span>
              <span className="tabular-nums font-semibold">
                {fmtNum(s.weight)} × {s.reps}
                {s.rir !== null && <span className="ml-1.5 text-xs font-normal text-hint">запас {s.rir}</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-hint">
          Отдых между подходами: {Math.floor(rest / 60)} мин{rest % 60 ? ` ${rest % 60} с` : ''}.
          {plan.main_note ? ` ${plan.main_note}` : ''}
        </p>
      </div>

      {plan.secondary && (
        <div>
          <div className="mb-1.5 text-sm font-semibold">{plan.secondary.name}</div>
          <div className="space-y-1.5">
            {plan.secondary.sets.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-card2 px-3 py-2 text-sm">
                <span>{KIND_LABEL[s.kind] ?? s.label}</span>
                <span className="tabular-nums font-semibold">
                  {fmtNum(s.weight)} × {s.reps}
                  {s.rir !== null && <span className="ml-1.5 text-xs font-normal text-hint">запас {s.rir}</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-hint">{plan.secondary.note}</p>
        </div>
      )}

      {plan.accessories.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm font-semibold">Подсобные упражнения</div>
          <div className="space-y-1.5">
            {plan.accessories.map((a) => (
              <div key={a.name} className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="shrink-0 text-xs text-hint">{a.sets}×{a.reps}, {a.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <button className="flex w-full items-center justify-between text-sm font-semibold" onClick={() => setTips((v) => !v)}>
          Советы к тренировке
          <Icon name={tips ? 'up' : 'down'} size={16} className="text-hint" />
        </button>
        {tips && (
          <ul className="mt-2 space-y-1.5 text-sm text-hint">
            {plan.tips.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
        )}
      </div>

      {!resume && sinceBench != null && sinceBench < 40 && ['heavy', 'volume', 'test'].includes(plan.kind) && (
        <p className="rounded-xl bg-card2 px-3 py-2.5 text-sm">
          Нагрузка на грудь была {sinceBench < 1 ? 'меньше часа' : `${Math.round(sinceBench)} ч`} назад. Для этой тренировки лучше отдохнуть около 48 часов. Можно начать и сейчас, но
          вес может пойти тяжелее.
        </p>
      )}

      <Button full disabled={busy} onClick={onStart}>
        <Icon name="dumbbell" size={18} /> {resume ? 'Продолжить тренировку' : 'Начать тренировку'}
      </Button>
    </Card>
  )
}

/* ───────── страница ───────── */

export default function BenchPage() {
  const nav = useNavigate()
  const q = useLoad(() => api.bench(), [], 'bench')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (q.loading && !q.data) return <PageSkeleton />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />
  const s = q.data
  if (!s) return null

  const refreshAll = () => cacheDrop('bench', 'dashboard', 'plan')
  const start = async () => {
    haptic.tap()
    setBusy(true)
    setErr(null)
    try {
      await api.benchStart()
      refreshAll()
      nav('/session')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }
  const finish = async (ask: boolean) => {
    if (ask && !(await confirmAction('Убрать день жима из плана? История тренировок сохранится.'))) return
    setBusy(true)
    try {
      await api.benchFinish()
      refreshAll()
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <>
      <Link to="/plan" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> План
      </Link>
      <PageTitle>День жима лёжа</PageTitle>
    </>
  )

  if (!s.active || !s.program || !s.progress) {
    return (
      <div className="space-y-4">
        {header}
        <Wizard
          hint={s.hint}
          onCreated={(st) => {
            refreshAll()
            q.reload()
            void st
          }}
        />
      </div>
    )
  }

  const { program: p, progress: pr } = s
  const gain = p.e1rm - p.baseline_e1rm
  const openWeek = pr.complete ? undefined : pr.week

  return (
    <div className="space-y-4">
      {header}
      {err && <ErrorBox message={err} />}

      <Card className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-hint">Расчётный максимум</div>
            <div className="text-3xl font-bold leading-tight">
              {fmtNum(p.e1rm)} <span className="text-base font-medium text-hint">кг</span>
            </div>
          </div>
          <div className={clsx('text-sm font-semibold', gain > 0 ? 'text-ok' : gain < 0 ? 'text-danger' : 'text-hint')}>
            {gain > 0 ? '+' : ''}{fmtNum(Math.round(gain * 10) / 10)} кг к старту
          </div>
        </div>
        <ProgressBar value={pr.done / pr.total} done={pr.complete} />
        <div className="flex justify-between text-xs text-hint">
          <span>{pr.complete ? 'Цикл завершён' : `Неделя ${pr.week} из ${p.weeks} · ${pr.phase}`}</span>
          <span>{pr.done} из {pr.total} тренировок</span>
        </div>
        {p.notes.map((n) => (
          <p key={n} className="text-xs text-hint">{n}</p>
        ))}
        {s.in_program && <p className="text-xs text-hint">Этот день стоит в круге вашей программы и подсказывается как следующий в свою очередь.</p>}
      </Card>

      {s.next ? (
        <DayCard plan={s.next} resume={!!s.resume_session_id} onStart={start} busy={busy} sinceBench={s.chest_hours} />
      ) : (
        <Card className="space-y-3">
          <div className="text-lg font-bold">Цикл завершён</div>
          <p className="text-sm text-hint">
            Новый расчётный максимум {fmtNum(p.e1rm)} кг: {gain >= 0 ? '+' : ''}{fmtNum(Math.round(gain * 10) / 10)} кг к старту. Отдохните пару дней и начните новый цикл с обновлёнными
            результатами.
          </p>
          <Button full disabled={busy} onClick={() => finish(false)}>
            Начать новый цикл
          </Button>
        </Card>
      )}

      {s.last && (
        <Card className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-hint">Прошлая тренировка</div>
          <div className="font-semibold">{s.last.title}</div>
          <div className="text-sm text-hint">{s.last.summary}</div>
          <p className="rounded-xl bg-card2 px-3 py-2 text-sm">{s.last.tip}</p>
        </Card>
      )}

      {s.weeks && (
        <section>
          <SectionTitle>Расписание цикла</SectionTitle>
          <Weeks weeks={s.weeks} openWeek={openWeek} />
        </section>
      )}

      <Card className="space-y-2 text-sm">
        <div className="font-semibold">Параметры программы</div>
        <p className="text-hint">
          Лучший жим {fmtNum(p.best_weight)} × {p.best_reps}, рабочий вес {fmtNum(p.work_weight)} × {p.work_reps}, {p.days_per_week === 1 ? 'один дополнительный день в неделю' : `${p.days_per_week} дня в неделю`}.
        </p>
        <Button variant="ghost" full disabled={busy} onClick={() => finish(true)}>
          Убрать день жима
        </Button>
      </Card>
    </div>
  )
}

