import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../stores/authStore'
import { Button, Card, ErrorBox, Field, PageSkeleton, PageTitle, SectionTitle, inputCls, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'

const MAX_DAYS = 21

export default function CustomProgramPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const pid = Number(id)
  const nav = useNavigate()
  const user = useAuth((s) => s.user)!
  const setUser = useAuth((s) => s.setUser)
  const plan = useLoad(() => api.plan(), [], 'plan')
  const mine = useLoad(() => api.myPrograms(), [], 'myPrograms')
  const [name, setName] = useState('')
  const [ids, setIds] = useState<number[]>([])
  const [ready, setReady] = useState(!editing)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const current = editing ? (mine.data ?? []).find((p) => p.id === pid) : undefined

  useEffect(() => {
    if (!editing || ready || !current) return
    setName(current.name)
    setIds(current.workout_ids)
    setReady(true)
  }, [editing, ready, current])

  const pool = useMemo(() => {
    const p = plan.data
    if (!p) return []
    const rows = [...p.own, ...(p.program?.custom ? p.program.days : [])]
    return rows.filter((d, i) => rows.findIndex((x) => x.workout_id === d.workout_id) === i)
  }, [plan.data])

  const byId = useMemo(() => new Map(pool.map((d) => [d.workout_id, d])), [pool])
  const chosen = ids.flatMap((wid, pos) => {
    const d = byId.get(wid)
    return d ? [{ d, pos }] : []
  })
  const counts = new Map<number, number>()
  chosen.forEach(({ d }) => counts.set(d.workout_id, (counts.get(d.workout_id) ?? 0) + 1))

  if ((plan.loading && !plan.data) || (mine.loading && !mine.data) || (editing && !ready && !mine.error)) return <PageSkeleton />
  if (plan.error && !plan.data) return <ErrorBox message={plan.error} onRetry={plan.reload} />
  if (editing && !current) return <ErrorBox message="Программа не найдена" />

  const move = (i: number, to: number) => {
    if (to < 0 || to >= ids.length) return
    const next = [...ids]
    ;[next[i], next[to]] = [next[to], next[i]]
    setIds(next)
    haptic.select()
  }
  const add = (wid: number, at: number = ids.length) => {
    if (ids.length >= MAX_DAYS) return
    setIds([...ids.slice(0, at), wid, ...ids.slice(at)])
    haptic.select()
  }
  const removeAt = (i: number) => {
    setIds(ids.filter((_, k) => k !== i))
    haptic.select()
  }

  const canSave = name.trim().length > 0 && chosen.length > 0 && !busy

  const save = async (activate: boolean) => {
    const alreadyActive = editing && user.active_program === `c${pid}`
    if (activate && user.active_program && !alreadyActive) {
      const ok = await confirmAction(
        'Заменить текущую программу? История тренировок сохранится.',
      )
      if (!ok) return
    }
    setBusy(true)
    setErr(null)
    try {
      const body = { name: name.trim(), workout_ids: chosen.map(({ d }) => d.workout_id) }
      const saved = editing ? await api.updateMyProgram(pid, body) : await api.createMyProgram(body)
      if (activate) {
        await api.activateMyProgram(saved.id)
        setUser({ ...user, active_program: saved.key })
      }
      haptic.success()
      cacheDrop('plan', 'dashboard', 'myPrograms')
      nav(activate || alreadyActive ? '/plan' : '/plan/programs', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!(await confirmAction('Удалить программу? Сами тренировки останутся в «Своих тренировках».'))) return
    setBusy(true)
    try {
      await api.deleteMyProgram(pid)
      if (user.active_program === `c${pid}`) setUser({ ...user, active_program: null })
      cacheDrop('plan', 'dashboard', 'myPrograms')
      nav('/plan/programs', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  const isActive = editing && user.active_program === `c${pid}`

  return (
    <div className="space-y-4">
      <Link to="/plan/programs" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> Программы
      </Link>
      <PageTitle>{editing ? 'Изменить программу' : 'Своя программа'}</PageTitle>
      {err && <ErrorBox message={err} />}

      <Card>
        <Field label="Название">
          <input className={inputCls} maxLength={60} placeholder="Например, Моя трёхдневка" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Card>

      <section>
        <SectionTitle right={<span className="text-sm text-hint">{chosen.length}</span>}>Круг тренировок</SectionTitle>
        {chosen.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-hint">
            Добавьте тренировки ниже. Одну можно ставить несколько раз: А, Б, А, В.
          </p>
        ) : (
          <>
            <Card className="divide-y divide-line !p-0">
              {chosen.map(({ d }, i) => (
                <div key={`${i}-${d.workout_id}`} className="flex items-center gap-2 px-3 py-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-hint">{d.exercises.length} упр.</div>
                  </div>
                  <button className="p-2 text-hint disabled:opacity-25" disabled={ids.length >= MAX_DAYS} onClick={() => add(d.workout_id, i + 1)} aria-label="Повторить следом">
                    <Icon name="copy" size={19} />
                  </button>
                  <button className="p-2 text-hint disabled:opacity-25" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Выше">
                    <Icon name="up" size={19} />
                  </button>
                  <button className="p-2 text-hint disabled:opacity-25" disabled={i === chosen.length - 1} onClick={() => move(i, i + 1)} aria-label="Ниже">
                    <Icon name="down" size={19} />
                  </button>
                  <button className="p-2 text-hint" onClick={() => removeAt(i)} aria-label="Убрать">
                    <Icon name="x" size={19} />
                  </button>
                </div>
              ))}
            </Card>
            <p className="mt-2 px-1 text-xs text-hint">{chosen.map(({ d }) => d.name).join(' → ')}</p>
          </>
        )}
      </section>

      <section>
        <SectionTitle>Ваши тренировки</SectionTitle>
        {pool.length === 0 ? (
          <Card className="space-y-3">
            <p className="text-sm text-hint">Своих тренировок пока нет.</p>
            <Link to="/plan/workout/new" className="block">
              <Button full>
                <Icon name="plus" size={18} /> Создать тренировку
              </Button>
            </Link>
          </Card>
        ) : (
          <Card className="divide-y divide-line !p-0">
            {pool.map((d) => (
              <div key={d.workout_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-hint">
                    {d.exercises.length} упр.
                    {counts.get(d.workout_id) ? ` · в круге: ${counts.get(d.workout_id)}` : ''}
                  </div>
                </div>
                <Button size="sm" className="!px-3.5" disabled={ids.length >= MAX_DAYS} aria-label={`Добавить ${d.name}`} onClick={() => add(d.workout_id)}>
                  <Icon name="plus" size={16} />
                </Button>
              </div>
            ))}
          </Card>
        )}
        {pool.length > 0 && (
          <Link to="/plan/workout/new" className="mt-2 inline-block text-sm font-medium text-brand">
            Создать новую тренировку
          </Link>
        )}
      </section>

      <div className="space-y-2 pb-2">
        {editing ? (
          <>
            <Button full disabled={!canSave} onClick={() => save(isActive)}>
              Сохранить
            </Button>
            {!isActive && (
              <Button full variant="ghost" disabled={!canSave} onClick={() => save(true)}>
                Сохранить и сделать активной
              </Button>
            )}
            <Button full variant="danger" size="sm" disabled={busy} onClick={remove}>
              Удалить программу
            </Button>
          </>
        ) : (
          <>
            <Button full disabled={!canSave} onClick={() => save(true)}>
              Создать и выбрать
            </Button>
            <Button full variant="ghost" disabled={!canSave} onClick={() => save(false)}>
              Только создать
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
