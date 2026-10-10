import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Exercise } from '../services/api'
import { Button, Card, ErrorBox, Field, MUSCLE_LABELS, PageTitle, Spinner, inputCls, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import ExercisePicker from '../components/ExercisePicker'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'

interface Row {
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

  useEffect(() => {
    if (!editing) return
    api
      .workout(Number(id))
      .then((w) => {
        setName(w.name)
        setDescription(w.description ?? '')
        setRows(
          w.items.map((i) => ({
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

  if (!loaded && !err) return <Spinner />
  if (exercises.loading && !exercises.data) return <Spinner />
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

  const save = async () => {
    if (!name.trim()) return setErr('Введите название')
    setSaving(true)
    setErr(null)
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      items: rows.map((r) => ({
        exercise_id: r.exercise_id,
        target_sets: Math.min(20, Math.max(1, parseInt(r.target_sets) || 3)),
        target_reps: Math.min(200, Math.max(1, parseInt(r.target_reps) || 10)),
        target_weight: r.target_weight.trim() === '' ? null : Math.max(0, parseFloat(r.target_weight.replace(',', '.')) || 0),
      })),
    }
    try {
      if (editing) await api.updateWorkout(Number(id), body)
      else await api.createWorkout(body)
      haptic.success()
      cacheDrop('plan', 'dashboard')
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
      {rows.map((r, i) => (
        <Card key={i} className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {byId.get(r.exercise_id)?.name ?? 'Упражнение'}
              <span className="ml-2 text-xs text-hint">{MUSCLE_LABELS[byId.get(r.exercise_id)?.muscle_group ?? 'other']}</span>
            </div>
            <div className="flex gap-1 text-lg">
              <button onClick={() => move(i, -1)} className="px-1" aria-label="Выше"><Icon name="up" size={18} /></button>
              <button onClick={() => move(i, 1)} className="px-1" aria-label="Ниже"><Icon name="down" size={18} /></button>
              <button onClick={() => setRows((x) => x.filter((_, k) => k !== i))} className="px-1 text-hint" aria-label="Убрать"><Icon name="x" size={18} /></button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Подходы">
              <input className={inputCls} inputMode="numeric" value={r.target_sets} onChange={(e) => patch(i, { target_sets: e.target.value })} />
            </Field>
            <Field label="Повторы">
              <input className={inputCls} inputMode="numeric" value={r.target_reps} onChange={(e) => patch(i, { target_reps: e.target.value })} />
            </Field>
            <Field label="Вес">
              <input className={inputCls} inputMode="decimal" value={r.target_weight} onChange={(e) => patch(i, { target_weight: e.target.value })} placeholder="-" />
            </Field>
          </div>
        </Card>
      ))}

      <Button variant="ghost" full className="flex items-center justify-center gap-2" onClick={() => setPicking(true)}>
        <Icon name="plus" size={18} /> Добавить упражнение
      </Button>
      <p className="-mt-2 text-center text-xs text-hint">Любое из каталога или своё: его можно создать прямо в окне выбора.</p>

      <Button full disabled={saving} onClick={save}>
        {saving ? 'Сохраняю' : 'Сохранить'}
      </Button>

      {picking && (
        <ExercisePicker
          multi
          onClose={() => setPicking(false)}
          onPick={(ex) => {
            exercises.setData((prev) => (prev && prev.some((p) => p.id === ex.id) ? prev : [...(prev ?? []), ex]))
            setRows((r) => [...r, { exercise_id: ex.id, target_sets: '3', target_reps: '10', target_weight: '' }])
          }}
        />
      )}
    </div>
  )
}
