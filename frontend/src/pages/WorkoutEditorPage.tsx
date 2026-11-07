import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Exercise } from '../services/api'
import { Button, Card, ErrorBox, Field, MUSCLE_LABELS, PageTitle, PageSkeleton, inputCls, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import ExercisePicker from '../components/ExercisePicker'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'
import { amountShort, measureOf, showsWeight } from '../utils/measure'

interface Row {
  uid: number
  exercise_id: number
  target_sets: string
  target_reps: string
  target_weight: string
}

export default function WorkoutEditorPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const editing = id !== undefined
  const exercises = useLoad(() => api.exercises(), [], 'exercises')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(!editing)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [undo, setUndo] = useState<{ row: Row; index: number; name: string } | null>(null)
  const uid = useRef(0)
  const rowsRef = useRef<Row[]>([])
  const pending = useRef(new Set<Promise<unknown>>())
  const resolved = useRef(new Map<number, number>())
  const undoTimer = useRef<number | undefined>(undefined)
  rowsRef.current = rows

  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  useEffect(() => {
    if (!editing) return
    api
      .workout(Number(id))
      .then((w) => {
        setName(w.name)
        setDescription(w.description ?? '')
        setRows(
          w.items.map((i) => ({
            uid: ++uid.current,
            exercise_id: i.exercise_id,
            target_sets: String(i.target_sets),
            target_reps: String(i.target_reps),
            target_weight: i.target_weight != null ? String(i.target_weight) : '',
          })),
        )
        setLoaded(true)
      })
      .catch((e) => setErr(e.message))
  }, [editing, id])

  if (!loaded && !err) return <PageSkeleton />
  if (exercises.loading && !exercises.data) return <PageSkeleton />
  const all: Exercise[] = exercises.data ?? []
  const byId = new Map(all.map((e) => [e.id, e]))

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d
      if (j < 0 || j >= r.length) return r
      const c = [...r]
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })

  const removeRow = (i: number) => {
    const row = rows[i]
    if (!row) return
    setRows((r) => r.filter((_, k) => k !== i))
    window.clearTimeout(undoTimer.current)
    setUndo({ row, index: i, name: byId.get(row.exercise_id)?.name ?? 'Упражнение' })
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000)
    haptic.select()
  }

  const restore = () => {
    if (!undo) return
    const { row, index } = undo
    setRows((r) => [...r.slice(0, Math.min(index, r.length)), row, ...r.slice(Math.min(index, r.length))])
    setUndo(null)
    window.clearTimeout(undoTimer.current)
    haptic.select()
  }

  const pickExercise = (ex: Exercise, creation?: Promise<Exercise>) => {
    exercises.setData((prev) => (prev && prev.some((p) => p.id === ex.id) ? prev : [...(prev ?? []), ex]))
    setRows((r) => [...r, { uid: ++uid.current, exercise_id: ex.id, target_sets: '3', target_reps: '10', target_weight: '' }])
    if (!creation) return
    const task = creation
      .then((real) => {
        resolved.current.set(ex.id, real.id)
        exercises.setData((prev) => (prev ? prev.map((p) => (p.id === ex.id ? real : p)).filter((p, k, a) => a.findIndex((x) => x.id === p.id) === k) : prev))
        setRows((r) => r.map((x) => (x.exercise_id === ex.id ? { ...x, exercise_id: real.id } : x)))
      })
      .catch(() => {
        setRows((r) => r.filter((x) => x.exercise_id !== ex.id))
        setErr(`Не удалось добавить «${ex.name}»`)
      })
      .finally(() => pending.current.delete(task))
    pending.current.add(task)
  }

  const unpickExercise = (ex: Exercise) => {
    setRows((r) => {
      const at = r.map((x) => x.exercise_id).lastIndexOf(ex.id)
      return at < 0 ? r : r.filter((_, k) => k !== at)
    })
  }

  const save = async () => {
    if (!name.trim()) return setErr('Введите название')
    setSaving(true)
    setErr(null)
    await Promise.allSettled([...pending.current])
    const current = rowsRef.current.map((r) => ({ ...r, exercise_id: resolved.current.get(r.exercise_id) ?? r.exercise_id }))
    if (current.some((r) => r.exercise_id < 0)) {
      setErr('Упражнение ещё сохраняется, попробуйте через секунду')
      setSaving(false)
      return
    }
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      items: current.map((r) => ({
        exercise_id: r.exercise_id,
        target_sets: Math.min(20, Math.max(1, parseInt(r.target_sets) || 3)),
        target_reps: Math.min(200, Math.max(1, parseInt(r.target_reps) || 10)),
        target_weight: !showsWeight(byId.get(r.exercise_id)) || r.target_weight.trim() === '' ? null : Math.max(0, parseFloat(r.target_weight.replace(',', '.')) || 0),
      })),
    }
    try {
      if (editing) await api.updateWorkout(Number(id), body)
      else await api.createWorkout(body)
      haptic.success()
      cacheDrop('plan', 'dashboard', 'myPrograms')
      nav('/plan')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle right={<Link to="/plan" className="text-sm text-brand">Отмена</Link>}>
        {editing ? 'Шаблон' : 'Новый шаблон'}
      </PageTitle>
      {err && <ErrorBox message={err} />}

      <Field label="Название">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Грудь + трицепс" maxLength={100} />
      </Field>
      <Field label="Описание (необязательно)">
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </Field>

      <h2 className="pt-2 font-semibold">Упражнения</h2>
      {rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-hint">
          Пока пусто. Нажмите «Добавить упражнение».
        </p>
      )}
      {rows.map((r, i) => (
        <Card key={r.uid} className="animate-fade space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card2 text-xs font-bold">{i + 1}</span>
              <div className="min-w-0 font-medium">
                <span className="block truncate">{byId.get(r.exercise_id)?.name ?? 'Упражнение'}</span>
                <span className="block text-xs font-normal text-hint">{MUSCLE_LABELS[byId.get(r.exercise_id)?.muscle_group ?? 'other']}</span>
              </div>
            </div>
            <div className="flex shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="p-2 disabled:opacity-25" aria-label="Выше"><Icon name="up" size={19} /></button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="p-2 disabled:opacity-25" aria-label="Ниже"><Icon name="down" size={19} /></button>
              <button onClick={() => removeRow(i)} className="p-2 text-hint" aria-label="Убрать"><Icon name="x" size={19} /></button>
            </div>
          </div>
          <div className={showsWeight(byId.get(r.exercise_id)) ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
            <Field label="Подходы">
              <input className={inputCls} inputMode="numeric" value={r.target_sets} onChange={(e) => patch(i, { target_sets: e.target.value })} />
            </Field>
            <Field label={amountShort(measureOf(byId.get(r.exercise_id)))}>
              <input className={inputCls} inputMode="numeric" value={r.target_reps} onChange={(e) => patch(i, { target_reps: e.target.value })} />
            </Field>
            {showsWeight(byId.get(r.exercise_id)) && (
              <Field label="Вес">
                <input className={inputCls} inputMode="decimal" value={r.target_weight} onChange={(e) => patch(i, { target_weight: e.target.value })} placeholder="-" />
              </Field>
            )}
          </div>
        </Card>
      ))}

      <Button variant="ghost" full className="flex items-center justify-center gap-2" onClick={() => setPicking(true)}>
        <Icon name="plus" size={18} /> Добавить упражнение
      </Button>

      {undo && (
        <div className="fixed inset-x-4 bottom-24 z-40 flex animate-fade items-center justify-between gap-3 rounded-2xl bg-fg px-4 py-3 text-bg shadow-lg">
          <span className="min-w-0 truncate text-sm">Убрано: {undo.name}</span>
          <button onClick={restore} className="flex shrink-0 items-center gap-1.5 text-sm font-bold">
            <Icon name="undo" size={16} /> Вернуть
          </button>
        </div>
      )}

      <Button full disabled={saving} onClick={save}>
        {saving ? 'Сохраняю' : 'Сохранить'}
      </Button>

      {picking && (
        <ExercisePicker
          multi
          instant
          exclude={rows.map((r) => r.exercise_id)}
          onClose={() => setPicking(false)}
          onPick={pickExercise}
          onUnpick={unpickExercise}
        />
      )}
    </div>
  )
}
