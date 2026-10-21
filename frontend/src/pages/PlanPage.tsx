import { Fragment, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api, type Exercise, type PlanDay, type WorkoutInput } from '../services/api'
import { Button, Card, ErrorBox, PageTitle, SectionTitle, PageSkeleton, fmtDate, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import ExerciseInfo from '../components/ExerciseInfo'
import ExercisePicker from '../components/ExercisePicker'
import { cacheDrop } from '../utils/cache'
import { fmtTarget, measureOf } from '../utils/measure'
import { confirmAction, haptic } from '../utils/telegram'

function lastDoneLabel(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн. назад`
  return fmtDate(iso)
}

export default function PlanPage() {
  const nav = useNavigate()
  const q = useLoad(() => api.plan(), [], 'plan')
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const [open, setOpen] = useState<number | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [pickFor, setPickFor] = useState<number | null>(null)

  if (q.loading && !q.data) return <PageSkeleton />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />
  if (!q.data) return null
  const { program, own } = q.data

  const start = async (body: { workout_id?: number }) => {
    haptic.tap()
    setStarting(true)
    setErr(null)
    try {
      await api.startSession(body)
      cacheDrop('dashboard')
      nav('/session')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setStarting(false)
    }
  }

  const remove = async (id: number, name: string) => {
    if (!(await confirmAction(`Удалить тренировку «${name}»? История сохранится.`))) return
    try {
      await api.deleteWorkout(id)
      cacheDrop('dashboard', 'myPrograms')
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const mutateItems = (workoutId: number, change: (items: WorkoutInput['items']) => WorkoutInput['items']) => {
    const run = queue.current.then(async () => {
      const w = await api.workout(workoutId)
      await api.updateWorkout(workoutId, {
        name: w.name,
        description: w.description,
        items: change(
          w.items.map((i) => ({
            exercise_id: i.exercise_id,
            target_sets: i.target_sets,
            target_reps: i.target_reps,
            target_weight: i.target_weight,
          })),
        ),
      })
      cacheDrop('plan', 'dashboard', 'myPrograms')
    })
    queue.current = run.catch(() => undefined)
    return run.then(() => q.reload())
  }

  const addExercise = (workoutId: number, ex: Exercise) =>
    mutateItems(workoutId, (items) => [...items, { exercise_id: ex.id, target_sets: 3, target_reps: 10, target_weight: null }])

  const removeExercise = (workoutId: number, ex: Exercise) =>
    mutateItems(workoutId, (items) => {
      const at = items.map((i) => i.exercise_id).lastIndexOf(ex.id)
      return at < 0 ? items : items.filter((_, k) => k !== at)
    })

  const renderDay = ({ d, next, own: isOwn }: { d: PlanDay; next?: boolean; own?: boolean }) => (
    <Card className={clsx(next && 'border-accent/50')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-semibold">{d.name}</div>
          <div className="text-xs text-hint">
            {d.exercises.length} упр. · {d.last_done ? `выполнялась: ${lastDoneLabel(d.last_done)}` : 'ещё не выполнялась'}
          </div>
        </div>
        {next && <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-fg">Следующая</span>}
      </div>

      {open === d.workout_id && (
        <div className="mt-3 rounded-2xl bg-card2 px-3 py-2.5">
          {d.exercises.length === 0 ? (
            <p className="text-sm text-hint">В этой тренировке пока нет упражнений.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.exercises.map((e, idx) => (
                <li key={`${e.exercise_id}-${idx}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setInfo(e.name)}>
                    <div className="text-sm font-medium">{e.name}</div>
                    <div className="truncate text-xs text-hint">{e.muscles}</div>
                  </button>
                  <span className="shrink-0 text-sm text-hint">
                    {fmtTarget(e.sets, e.reps, measureOf(e))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 border-t border-line pt-2 text-xs text-hint">Нажмите на упражнение: техника и мышцы.</p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size={next ? 'md' : 'sm'}
          className="flex-1"
          disabled={starting}
          onClick={() => start({ workout_id: d.workout_id })}
        >
          <Icon name="play" size={16} fill="currentColor" /> Начать
        </Button>
        <Button variant="ghost" size={next ? 'md' : 'sm'} onClick={() => setOpen(open === d.workout_id ? null : d.workout_id)}>
          {open === d.workout_id ? 'Скрыть' : 'Состав'}
        </Button>
      </div>
      {open === d.workout_id && (
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => setPickFor(d.workout_id)}>
            <Icon name="plus" size={16} /> Упражнение
          </Button>
          <Link to={`/plan/workout/${d.workout_id}`}>
            <Button variant="ghost" size="sm" className="!px-3" aria-label="Изменить">
              <Icon name="edit" size={18} />
            </Button>
          </Link>
          {isOwn && (
            <Button variant="danger" size="sm" className="!px-3" onClick={() => remove(d.workout_id, d.name)} aria-label="Удалить">
              <Icon name="trash" size={18} />
            </Button>
          )}
        </div>
      )}
    </Card>
  )

  return (
    <div className="space-y-5">
      <PageTitle>План</PageTitle>
      {err && <ErrorBox message={err} />}

      {program ? (
        <section className="space-y-3">
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-hint">Моя программа</div>
                <div className="text-xl font-bold">{program.name}</div>
              </div>
              <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-xs text-hint">{program.level}</span>
            </div>
            <p className="mt-1 text-sm text-hint">{program.description}</p>
            {program.custom && program.cycle && program.cycle.length > 0 && (
              <p className="mt-1 text-sm">{program.cycle.map((c) => c.name).join(' → ')}</p>
            )}
            <div className="mt-2 flex items-center gap-4 text-sm font-medium text-brand">
              <Link to="/plan/programs">Сменить программу</Link>
              {program.custom && <Link to={`/plan/programs/edit/${program.id.slice(1)}`}>Изменить</Link>}
            </div>
          </Card>
          {program.days.map((d) => (
            <Fragment key={d.workout_id}>{renderDay({ d, next: d.workout_id === program.next_workout_id })}</Fragment>
          ))}
        </section>
      ) : (
        <Card className="space-y-3">
          <div className="text-lg font-semibold">Программа не выбрана</div>
          <p className="text-sm text-hint">
            Выберите программу в каталоге: приложение подскажет следующую тренировку.
          </p>
          <Link to="/plan/programs" className="block">
            <Button full>Каталог программ</Button>
          </Link>
          <Link to="/plan/programs/new" className="block">
            <Button full variant="ghost">
              Собрать из своих тренировок
            </Button>
          </Link>
        </Card>
      )}

      <section className="space-y-3">
        <SectionTitle
          right={
            <Link to="/plan/workout/new">
              <Button size="sm">
                <Icon name="plus" size={16} /> Создать
              </Button>
            </Link>
          }
        >
          Свои тренировки
        </SectionTitle>
        {own.length === 0 && <p className="text-sm text-hint">Пока нет своих тренировок.</p>}
        {own.map((d) => (
          <Fragment key={d.workout_id}>{renderDay({ d, own: true })}</Fragment>
        ))}
      </section>

      <section className="grid grid-cols-3 gap-2">
        {[
          { to: '/plan/catalog', icon: 'dumbbell', label: 'Из каталога' },
          { to: '/plan/exercises', icon: 'book', label: 'Справочник' },
        ].map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-card px-1 py-3 text-xs font-medium"
          >
            <Icon name={t.icon} size={22} className="text-brand" />
            {t.label}
          </Link>
        ))}
        <button
          disabled={starting}
          onClick={() => start({})}
          className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-card px-1 py-3 text-xs font-medium disabled:opacity-45"
        >
          <Icon name="play" size={22} className="text-brand" />
          Свободная
        </button>
      </section>

      {info && <ExerciseInfo name={info} onClose={() => setInfo(null)} />}
      {pickFor !== null && (
        <ExercisePicker
          multi
          title="Добавить в тренировку"
          onClose={() => setPickFor(null)}
          onPick={(ex) => addExercise(pickFor, ex)}
          onUnpick={(ex) => removeExercise(pickFor, ex)}
        />
      )}
    </div>
  )
}
