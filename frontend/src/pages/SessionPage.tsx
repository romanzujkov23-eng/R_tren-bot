import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api, type Exercise, type Session } from '../services/api'
import {
  Button, Card, ErrorBox, FEELINGS, Modal, Spinner, Stat, Toast, fmtDuration, fmtNum, inputCls,
  parseUtc, useToast } from '../components/ui'
import ExerciseInfo from '../components/ExerciseInfo'
import ExercisePicker from '../components/ExercisePicker'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'
import { useKeyboardOpen } from '../utils/keyboard'

const num = (s: string) => parseFloat(s.replace(',', '.'))

export default function SessionPage() {
  const nav = useNavigate()
  const toast = useToast()

  const [session, setSession] = useState<Session | null>(null)
  const [all, setAll] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [exId, setExId] = useState<number | null>(null)
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [busy, setBusy] = useState(false)

  const [hint, setHint] = useState<{ prev: string; reason: string } | null>(null)
  const [infoFor, setInfoFor] = useState<string | null>(null)
  const exRef = useRef<number | null>(null)
  const touched = useRef(false)

  const [now, setNow] = useState(Date.now())
  const [picking, setPicking] = useState(false)
  const keyboard = useKeyboardOpen()

  const [finishOpen, setFinishOpen] = useState(false)
  const [feeling, setFeeling] = useState<number | undefined>()
  const [note, setNote] = useState('')
  const [result, setResult] = useState<Session | null>(null)

  useEffect(() => {
    Promise.all([api.activeSession(), api.exercises()])
      .then(([s, ex]) => {
        setSession(s)
        setAll(ex)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [])

  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all])


  const prefill = useCallback((id: number, sess: Session) => {
    exRef.current = id
    touched.current = false
    setHint(null)
    const last = [...sess.sets].reverse().find((x) => x.exercise_id === id)
    const plan = sess.plan.find((p) => p.exercise_id === id)
    if (last) {
      setWeight(String(last.weight))
      setReps(String(last.reps))
      return
    }
    setWeight(plan?.target_weight != null ? String(plan.target_weight) : '')
    setReps(String(plan?.target_reps ?? 10))
    api
      .suggestion(id, plan?.target_reps)
      .then((r) => {
        if (exRef.current !== id || !r.suggested || !r.last) return
        const prev = r.last.sets.map((x) => `${fmtNum(x.weight)}×${x.reps}`).join(', ')
        setHint({ prev, reason: r.suggested.reason })
        if (!touched.current) {
          setWeight(String(r.suggested.weight))
          setReps(String(r.suggested.reps))
        }
      })
      .catch(() => undefined)
  }, [])

  const select = (id: number) => {
    setExId(id)
    if (session) prefill(id, session)
    haptic.select()
  }


  useEffect(() => {
    if (session && exId === null) {
      const first = session.plan[0]?.exercise_id ?? session.sets[session.sets.length - 1]?.exercise_id
      if (first) {
        setExId(first)
        prefill(first, session)
      }
    }
  }, [session, exId, prefill])

  if (loading) return <Spinner className="mt-20" />
  if (err && !session) return <div className="p-4"><ErrorBox message={err} /></div>

  if (result) {
    const prs = result.sets.filter((s) => s.is_pr).length
    return (
      <div className="mx-auto max-w-xl px-4 pt-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-fg shadow-[var(--glow)]">
          <Icon name="check" size={40} strokeWidth={2.6} />
        </div>
        <h1 className="mt-4 text-2xl font-bold">Тренировка завершена</h1>
        <p className="text-hint">{result.name}</p>
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Stat label="время" value={`${Math.max(1, Math.round(result.duration_seconds / 60))} мин`} />
          <Stat label="подходов" value={result.total_sets} />
          <Stat label={`тоннаж, кг`} value={fmtNum(result.total_volume)} />
        </div>
        {prs > 0 && <p className="mt-4 font-semibold text-brand">Новых рекордов: {prs}</p>}
        <Button full className="mt-8" onClick={() => nav('/')}>На главную</Button>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-xl px-6 pt-24 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-card2 text-brand"><Icon name="dumbbell" size={30} /></div>
        <p className="mt-3 text-hint">Активной тренировки нет.</p>
        <Button className="mt-6" onClick={() => nav('/')}>На главную</Button>
      </div>
    )
  }

  const elapsed = (now - parseUtc(session.started_at).getTime()) / 1000

  const doneFor = (id: number) => session.sets.filter((s) => s.exercise_id === id).length
  const chips = session.plan.map((p) => ({ id: p.exercise_id, name: p.exercise.name, target: p.target_sets }))
  const extra = session.sets
    .map((s) => s.exercise_id)
    .filter((id, i, a) => a.indexOf(id) === i && !chips.some((c) => c.id === id))
    .map((id) => ({ id, name: byId.get(id)?.name ?? 'Упражнение', target: 0 }))
  const allChips = [...chips, ...extra]
  if (exId !== null && !allChips.some((c) => c.id === exId)) {
    allChips.push({ id: exId, name: byId.get(exId)?.name ?? 'Упражнение', target: 0 })
  }

  const setWeightU = (v: string) => {
    touched.current = true
    setWeight(v)
  }
  const setRepsU = (v: string) => {
    touched.current = true
    setReps(v)
  }

  const step = (setter: (v: string) => void, cur: string, d: number, min = 0) => {
    haptic.tap()
    const v = Math.max(min, Math.round(((num(cur) || 0) + d) * 100) / 100)
    setter(String(v))
  }

  const addSet = async () => {
    const w = weight.trim() === '' ? 0 : num(weight)
    const r = parseInt(reps)
    if (exId === null) return setErr('Выберите упражнение')
    if (!(r >= 1) || !(w >= 0)) return setErr('Введите повторы (≥1) и вес (≥0)')
    setBusy(true)
    setErr(null)
    try {
      const updated = await api.addSet(session.id, { exercise_id: exId, reps: r, weight: w })
      setSession(updated)
      setHint(null)
      const added = updated.sets[updated.sets.length - 1]
      if (added?.is_pr) {
        haptic.success()
        toast.show('Новый рекорд')
      } else {
        haptic.tap()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      haptic.error()
    } finally {
      setBusy(false)
    }
  }

  const removeSet = async (id: number) => {
    try {
      setSession(await api.deleteSet(session.id, id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const finish = async () => {
    setBusy(true)
    try {
      const res = await api.finishSession(session.id, { feeling, note: note.trim() || undefined })
      haptic.success()
      cacheDrop('dashboard', 'plan', 'diary', 'overview', 'history', 'progress', 'goals')
      setFinishOpen(false)
      setResult(res)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  const discard = async () => {
    if (!(await confirmAction('Удалить эту тренировку без сохранения?'))) return
    try {
      await api.discardSession(session.id)
      cacheDrop('dashboard', 'plan', 'diary')
      nav('/')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const grouped = allChips
    .map((c) => ({ ...c, sets: session.sets.filter((s) => s.exercise_id === c.id) }))
    .filter((g) => g.sets.length > 0)

  return (
    <div className="mx-auto max-w-xl px-4 pb-32 pt-4">
      <Toast message={toast.msg} />

      <div className="mb-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-1 text-sm text-brand"><Icon name="left" size={16} /> Назад</Link>
        <div className="text-center">
          <div className="font-bold">{session.name}</div>
          <div className="text-sm tabular-nums text-hint">{fmtDuration(elapsed)}</div>
        </div>
        <button className="text-sm text-hint" onClick={discard}>Отменить</button>
      </div>

      {err && <div className="mb-3"><ErrorBox message={err} /></div>}

      {                                     }
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {allChips.map((c) => {
          const done = doneFor(c.id)
          return (
            <button
              key={c.id}
              onClick={() => select(c.id)}
              className={clsx(
                'shrink-0 rounded-full px-4 py-2 text-sm font-medium',
                exId === c.id ? 'bg-accent text-accent-fg' : 'bg-card',
              )}
            >
              {c.name}
              <span className="ml-1 opacity-70">{c.target ? `${done}/${c.target}` : done > 0 ? done : ''}</span>
            </button>
          )
        })}
      </div>
      <Button variant="ghost" full className="mb-4 flex items-center justify-center gap-2 !py-3" onClick={() => setPicking(true)}>
        <Icon name="plus" size={18} /> {allChips.length ? 'Другое упражнение' : 'Выбрать упражнение'}
      </Button>

      {                             }
      {exId !== null && (
        <Card className="mb-5 space-y-4">
          <div className="flex items-center justify-center gap-2">
            <div className="text-center font-semibold">{byId.get(exId)?.name}</div>
            <button className="flex items-center gap-1 text-sm text-brand" onClick={() => setInfoFor(byId.get(exId)?.name ?? '')}>
              <Icon name="info" size={16} /> Техника
            </button>
          </div>
          {hint && (
            <div className="rounded-2xl bg-card2 p-3 text-center text-sm">
              <div className="text-hint">Прошлый раз: {hint.prev}</div>
              <div className="font-medium">Сегодня: {weight || 0}×{reps}, {hint.reason}</div>
            </div>
          )}
          <Stepper label={`Вес, кг`} value={weight} onChange={setWeightU} mode="decimal"
            onMinus={() => step(setWeightU, weight, -2.5)} onPlus={() => step(setWeightU, weight, 2.5)} />
          <Stepper label="Повторы" value={reps} onChange={setRepsU} mode="numeric"
            onMinus={() => step(setRepsU, reps, -1, 1)} onPlus={() => step(setRepsU, reps, 1, 1)} />
          <Button full disabled={busy} onClick={addSet}>
            {busy ? 'Сохраняю…' : `Записать подход ${doneFor(exId) + 1}`}
          </Button>
        </Card>
      )}

      {                               }
      {grouped.map((g) => (
        <section key={g.id} className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-hint">{g.name}</h3>
          <div className="space-y-1">
            {g.sets.map((s) => (
              <Card key={s.id} className="flex items-center justify-between !py-2">
                <span>
                  <span className="mr-2 text-hint">#{s.set_number}</span>
                  <b>{fmtNum(s.weight)}</b> кг × <b>{s.reps}</b>
                  {s.is_pr && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-accent-fg">рекорд</span>}
                </span>
                <button className="px-2 text-hint" onClick={() => removeSet(s.id)} aria-label="Удалить подход"><Icon name="x" size={18} /></button>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <div
        className={clsx(
          'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 transition-transform duration-150',
          keyboard && 'pointer-events-none translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="whitespace-nowrap text-xs text-hint">
            {session.total_sets} подх.<br />{fmtNum(session.total_volume)} кг
          </div>
          <Button full onClick={() => (session.total_sets === 0 ? discard() : setFinishOpen(true))}>
            Завершить тренировку
          </Button>
        </div>
      </div>

      {picking && (
        <ExercisePicker
          title="Выбрать упражнение"
          onClose={() => setPicking(false)}
          onPick={(ex) => {
            setAll((list) => (list.some((e) => e.id === ex.id) ? list : [...list, ex]))
            select(ex.id)
          }}
        />
      )}

      {infoFor && <ExerciseInfo name={infoFor} onClose={() => setInfoFor(null)} />}

      {finishOpen && (
        <Modal onClose={() => setFinishOpen(false)}>
          <h2 className="mb-1 text-xl font-bold">Как прошла тренировка?</h2>
          <div className="my-4 flex justify-between">
            {FEELINGS.map((f, i) => (
              <button
                key={f}
                onClick={() => { setFeeling(i + 1); haptic.select() }}
                className={clsx('rounded-2xl p-3 text-3xl', feeling === i + 1 ? 'bg-accent/30 ring-2 ring-accent' : 'bg-card')}
              >
                {f}
              </button>
            ))}
          </div>
          <input className={clsx(inputCls, 'mb-4')} placeholder="Заметка (необязательно)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <Button full disabled={busy} onClick={finish}>{busy ? 'Сохраняю…' : 'Сохранить'}</Button>
        </Modal>
      )}
    </div>
  )
}

function Stepper(props: {
  label: string
  value: string
  onChange: (v: string) => void
  onMinus: () => void
  onPlus: () => void
  mode: 'decimal' | 'numeric'
}) {
  return (
    <div>
      <div className="mb-1.5 text-center text-xs uppercase tracking-wide text-hint">{props.label}</div>
      <div className="flex items-center gap-3">
        <button onClick={props.onMinus} className="h-14 w-16 rounded-2xl bg-card2 text-3xl font-light active:opacity-60" aria-label="Меньше">
          <span className="mx-auto block h-[2px] w-4 rounded-full bg-current" />
        </button>
        <input
          className="min-w-0 flex-1 rounded-2xl border border-line bg-card2 py-3 text-center text-3xl font-bold tabular-nums outline-none focus:border-accent"
          inputMode={props.mode}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="0"
        />
        <button onClick={props.onPlus} className="h-14 w-16 rounded-2xl bg-card2 text-3xl font-light active:opacity-60" aria-label="Больше">
          +
        </button>
      </div>
    </div>
  )
}
