import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api, isNetworkError, type Exercise, type Session } from '../services/api'
import {
  Button, Card, Chip, ErrorBox, FEELING_VALUES, Feeling, Modal, PageSkeleton, Stat, Toast, fmtDuration, fmtNum, inputCls,
  parseUtc, useToast } from '../components/ui'
import ExerciseInfo from '../components/ExerciseInfo'
import ExercisePicker from '../components/ExercisePicker'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'
import { useKeyboardOpen } from '../utils/keyboard'
import { amountDefault, amountLabel, amountStep, fmtSetLine, measureOf, showsWeight } from '../utils/measure'
import { loadPending, newClientId, savePending, type PendingSet } from '../utils/pending'

const num = (s: string) => parseFloat(s.replace(',', '.'))

interface Row {
  key: string
  id?: number
  client_id: string | null
  set_number: number
  weight: number
  reps: number
  distance: number | null
  is_pr: boolean
  pending: boolean
}

export default function SessionPage() {
  const nav = useNavigate()
  const toast = useToast()
  const showToast = toast.show

  const [session, setSession] = useState<Session | null>(null)
  const [all, setAll] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [exId, setExId] = useState<number | null>(null)
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [distance, setDistance] = useState('')
  const [busy, setBusy] = useState(false)

  const [pending, setPending] = useState<PendingSet[]>([])
  const [offline, setOffline] = useState(false)
  const pendingRef = useRef<PendingSet[]>([])
  const flushRef = useRef<Promise<void> | null>(null)
  const addLock = useRef(false)
  const allRef = useRef<Exercise[]>([])
  allRef.current = all

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

  const setPendingList = useCallback((next: PendingSet[], sessionId: number) => {
    pendingRef.current = next
    setPending(next)
    savePending(sessionId, next)
  }, [])

  const flush = useCallback(
    (sessionId: number): Promise<void> => {
      if (flushRef.current) return flushRef.current
      const run = async () => {
        while (pendingRef.current.length > 0) {
          const item = pendingRef.current[0]
          try {
            const updated = await api.addSet(sessionId, {
              exercise_id: item.exercise_id,
              reps: item.reps,
              weight: item.weight,
              distance: item.distance,
              client_id: item.client_id,
            })
            setSession(updated)
            setOffline(false)
            if (updated.sets.find((x) => x.client_id === item.client_id)?.is_pr) {
              haptic.success()
              showToast('Новый рекорд')
            }
          } catch (e) {
            if (isNetworkError(e)) {
              setOffline(true)
              return
            }
            setErr(e instanceof Error ? e.message : 'Ошибка')
            haptic.error()
          }
          setPendingList(
            pendingRef.current.filter((x) => x.client_id !== item.client_id),
            sessionId,
          )
        }
      }
      const p = run().finally(() => {
        flushRef.current = null
      })
      flushRef.current = p
      return p
    },
    [setPendingList, showToast],
  )

  const sessionId = session?.id

  useEffect(() => {
    if (sessionId === undefined) return
    const list = loadPending(sessionId)
    pendingRef.current = list
    setPending(list)
    if (list.length) void flush(sessionId)
  }, [sessionId, flush])

  useEffect(() => {
    if (sessionId === undefined) return
    const kick = () => {
      if (pendingRef.current.length) void flush(sessionId)
    }
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', kick)
    const t = window.setInterval(kick, 10000)
    return () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', kick)
      window.clearInterval(t)
    }
  }, [sessionId, flush])

  const prefill = useCallback((id: number, sess: Session) => {
    exRef.current = id
    touched.current = false
    setHint(null)
    const ex = allRef.current.find((e) => e.id === id) ?? sess.plan.find((p) => p.exercise_id === id)?.exercise
    const measure = measureOf(ex)
    const lastQueued = [...pendingRef.current].reverse().find((x) => x.exercise_id === id)
    const lastSaved = [...sess.sets].reverse().find((x) => x.exercise_id === id)
    const last = lastQueued ?? lastSaved
    const plan = sess.plan.find((p) => p.exercise_id === id)
    if (last) {
      setWeight(String(last.weight))
      setReps(String(last.reps))
      setDistance(last.distance ? String(last.distance) : '')
      return
    }
    setWeight(plan?.target_weight != null ? String(plan.target_weight) : '')
    setReps(String(plan?.target_reps ?? amountDefault(measure)))
    setDistance('')
    api
      .suggestion(id, plan?.target_reps)
      .then((r) => {
        if (exRef.current !== id || !r.suggested || !r.last) return
        const prev = r.last.sets.map((x) => fmtSetLine(x, measure)).join(', ')
        setHint({ prev, reason: r.suggested.reason })
        if (!touched.current) {
          setWeight(String(r.suggested.weight))
          setReps(String(r.suggested.reps))
          const lastDistance = r.last.sets[r.last.sets.length - 1]?.distance
          if (lastDistance) setDistance(String(lastDistance))
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

  if (loading) return <PageSkeleton variant="session" />
  if (err && !session) return <div className="p-4"><ErrorBox message={err} /></div>

  if (result) {
    const prs = result.sets.filter((s) => s.is_pr).length
    return (
      <div className="mx-auto max-w-xl px-4 pt-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-fg">
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

  const savedClientIds = new Set(session.sets.map((s) => s.client_id).filter(Boolean))
  const queued = pending.filter((p) => !savedClientIds.has(p.client_id))

  const rowsFor = (id: number): Row[] => {
    const saved: Row[] = session.sets
      .filter((s) => s.exercise_id === id)
      .map((s) => ({
        key: `s${s.id}`,
        id: s.id,
        client_id: s.client_id,
        set_number: s.set_number,
        weight: s.weight,
        reps: s.reps,
        distance: s.distance,
        is_pr: s.is_pr,
        pending: false,
      }))
    const waiting: Row[] = queued
      .filter((p) => p.exercise_id === id)
      .map((p, i) => ({
        key: `p${p.client_id}`,
        client_id: p.client_id,
        set_number: saved.length + i + 1,
        weight: p.weight,
        reps: p.reps,
        distance: p.distance,
        is_pr: false,
        pending: true,
      }))
    return [...saved, ...waiting]
  }

  const doneFor = (id: number) => rowsFor(id).length
  const chips = session.plan.map((p) => ({ id: p.exercise_id, name: p.exercise.name, target: p.target_sets }))
  const extra = [...session.sets.map((s) => s.exercise_id), ...queued.map((p) => p.exercise_id)]
    .filter((id, i, a) => a.indexOf(id) === i && !chips.some((c) => c.id === id))
    .map((id) => ({ id, name: byId.get(id)?.name ?? 'Упражнение', target: 0 }))
  const allChips = [...chips, ...extra]
  if (exId !== null && !allChips.some((c) => c.id === exId)) {
    allChips.push({ id: exId, name: byId.get(exId)?.name ?? 'Упражнение', target: 0 })
  }

  const cur = exId !== null ? byId.get(exId) : undefined
  const measure = measureOf(cur)
  const weightOn = showsWeight(cur)

  const totalSets = session.total_sets + queued.length
  const totalVolume =
    session.total_volume +
    queued.reduce((sum, p) => sum + (measureOf(byId.get(p.exercise_id)) === 'reps' ? p.weight * p.reps : 0), 0)

  const setWeightU = (v: string) => {
    touched.current = true
    setWeight(v)
  }
  const setRepsU = (v: string) => {
    touched.current = true
    setReps(v)
  }
  const setDistanceU = (v: string) => {
    touched.current = true
    setDistance(v)
  }

  const step = (setter: (v: string) => void, cur: string, d: number, min = 0) => {
    haptic.tap()
    const v = Math.max(min, Math.round(((num(cur) || 0) + d) * 100) / 100)
    setter(String(v))
  }

  const addSet = () => {
    const w = weightOn && weight.trim() !== '' ? num(weight) : 0
    const r = parseInt(reps)
    if (exId === null) return setErr('Выберите упражнение')
    if (!(r >= 1) || !(w >= 0)) {
      return setErr(measure === 'reps' ? 'Введите повторы (≥1) и вес (≥0)' : 'Введите время (≥1)')
    }
    const dist = measure === 'minutes' && distance.trim() !== '' ? num(distance) : null
    if (dist !== null && !(dist >= 0)) return setErr('Некорректная дистанция')
    if (addLock.current) return
    addLock.current = true
    window.setTimeout(() => {
      addLock.current = false
    }, 500)
    setErr(null)
    const item: PendingSet = { client_id: newClientId(), exercise_id: exId, reps: r, weight: w, distance: dist }
    setPendingList([...pendingRef.current, item], session.id)
    setHint(null)
    haptic.tap()
    void flush(session.id)
  }

  const removeSet = async (row: Row) => {
    if (row.pending) {
      setPendingList(pendingRef.current.filter((x) => x.client_id !== row.client_id), session.id)
      return
    }
    try {
      setSession(await api.deleteSet(session.id, row.id as number))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const finish = async () => {
    setBusy(true)
    setErr(null)
    try {
      await flush(session.id)
      if (pendingRef.current.length > 0) {
        setErr(`Нет связи: подходов не отправлено: ${pendingRef.current.length}. Дождитесь интернета и повторите.`)
        setBusy(false)
        return
      }
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
      setPendingList([], session.id)
      cacheDrop('dashboard', 'plan', 'diary')
      nav('/')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const grouped = allChips
    .map((c) => ({ ...c, rows: rowsFor(c.id) }))
    .filter((g) => g.rows.length > 0)

  const todayLine = fmtSetLine({ weight: weightOn ? num(weight) || 0 : 0, reps: parseInt(reps) || 0, distance: null }, measure)

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

      {err && !finishOpen && <div className="mb-3"><ErrorBox message={err} /></div>}

      {queued.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-2xl bg-card2 px-3 py-2 text-xs text-hint">
          <Icon name="clock" size={14} className="mt-px shrink-0" />
          <span>
            {offline
              ? `Нет связи. Подходов на телефоне: ${queued.length}. Они отправятся сами, как только появится интернет.`
              : `Отправляю подходы: ${queued.length}`}
          </span>
        </p>
      )}

      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setPicking(true)}
          aria-label="Другое упражнение"
          className={
            allChips.length
              ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg'
              : 'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-fg'
          }
        >
          <Icon name="plus" size={18} />
          {!allChips.length && 'Выбрать упражнение'}
        </button>
        <div className="-mr-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 pr-4">
          {allChips.map((c) => {
            const done = doneFor(c.id)
            return (
              <Chip key={c.id} active={exId === c.id} onClick={() => select(c.id)}>
                {c.name}
                <span className="ml-1 opacity-70">{c.target ? `${done}/${c.target}` : done > 0 ? done : ''}</span>
              </Chip>
            )
          })}
        </div>
      </div>

      {exId !== null && (
        <Card className="mb-4 space-y-3.5">
          <div className="flex items-center justify-center gap-3">
            <div className="text-center font-semibold">{cur?.name}</div>
            <button className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand" onClick={() => setInfoFor(cur?.name ?? '')}>
              <Icon name="info" size={16} /> Техника
            </button>
          </div>
          {hint && (
            <div className="rounded-2xl bg-card2 px-3 py-2.5 text-center text-sm">
              <div className="text-hint">Прошлый раз: {hint.prev}</div>
              <div className="font-medium">Сегодня: {todayLine}, {hint.reason}</div>
            </div>
          )}
          {weightOn && (
            <Stepper label={`Вес, кг`} value={weight} onChange={setWeightU} mode="decimal"
              onMinus={() => step(setWeightU, weight, -2.5)} onPlus={() => step(setWeightU, weight, 2.5)} />
          )}
          <Stepper label={amountLabel(measure)} value={reps} onChange={setRepsU} mode="numeric"
            onMinus={() => step(setRepsU, reps, -amountStep(measure), 1)} onPlus={() => step(setRepsU, reps, amountStep(measure), 1)} />
          {measure === 'minutes' && (
            <Stepper label="Дистанция, км (необязательно)" value={distance} onChange={setDistanceU} mode="decimal"
              onMinus={() => step(setDistanceU, distance, -0.5)} onPlus={() => step(setDistanceU, distance, 0.5)} />
          )}
          <Button full onClick={addSet}>
            {`Записать подход ${doneFor(exId) + 1}`}
          </Button>
        </Card>
      )}

      {grouped.map((g) => {
        const m = measureOf(byId.get(g.id))
        return (
          <section key={g.id} className="mb-3">
            <h3 className="mb-1 px-1 text-sm font-semibold text-hint">{g.name}</h3>
            <Card className="divide-y divide-line !p-0">
              {g.rows.map((s) => (
                <div key={s.key} className="flex items-center justify-between px-4 py-2">
                  <span>
                    <span className="mr-2 text-hint">#{s.set_number}</span>
                    {m === 'reps' ? (
                      <>
                        <b>{fmtNum(s.weight)}</b> кг × <b>{s.reps}</b>
                      </>
                    ) : (
                      <b>{fmtSetLine(s, m)}</b>
                    )}
                    {s.is_pr && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-fg">рекорд</span>}
                    {s.pending && offline && <Icon name="clock" size={14} className="ml-2 inline text-hint" />}
                  </span>
                  <button className="px-1 text-hint" onClick={() => removeSet(s)} aria-label="Удалить подход"><Icon name="x" size={18} /></button>
                </div>
              ))}
            </Card>
          </section>
        )
      })}

      <div
        className={clsx(
          'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5 transition-transform duration-150',
          keyboard && 'pointer-events-none translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="whitespace-nowrap text-xs text-hint">
            {totalSets} подх.<br />{fmtNum(totalVolume)} кг
          </div>
          <Button full onClick={() => (totalSets === 0 ? discard() : setFinishOpen(true))}>
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
            allRef.current = allRef.current.some((e) => e.id === ex.id) ? allRef.current : [...allRef.current, ex]
            select(ex.id)
          }}
        />
      )}

      {infoFor && <ExerciseInfo name={infoFor} onClose={() => setInfoFor(null)} />}

      {finishOpen && (
        <Modal onClose={() => setFinishOpen(false)}>
          <h2 className="mb-1 text-xl font-bold">Как прошла тренировка?</h2>
          <div className="my-4 flex justify-between">
            {FEELING_VALUES.map((f) => (
              <button
                key={f}
                onClick={() => { setFeeling(f); haptic.select() }}
                aria-label={`Оценка ${f} из 5`}
                className={clsx('rounded-2xl p-3', feeling === f ? 'bg-accent/30 ring-2 ring-accent' : 'bg-card')}
              >
                <Feeling n={f} size={32} />
              </button>
            ))}
          </div>
          <input className={clsx(inputCls, 'mb-4')} placeholder="Заметка (необязательно)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          {err && <div className="mb-3"><ErrorBox message={err} /></div>}
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
      <div className="mb-1 text-center text-sm text-hint">{props.label}</div>
      <div className="flex items-center gap-3">
        <button onClick={props.onMinus} className="h-12 w-14 rounded-2xl bg-card2 text-3xl font-light active:opacity-60" aria-label="Меньше">
          <span className="mx-auto block h-[2px] w-4 rounded-full bg-current" />
        </button>
        <input
          className="min-w-0 flex-1 rounded-2xl border border-line bg-card2 py-2.5 text-center text-3xl font-bold tabular-nums outline-none focus:border-accent"
          inputMode={props.mode}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="0"
        />
        <button onClick={props.onPlus} className="h-12 w-14 rounded-2xl bg-card2 text-3xl font-light active:opacity-60" aria-label="Больше">
          +
        </button>
      </div>
    </div>
  )
}
