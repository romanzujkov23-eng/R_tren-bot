import { Fragment, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api, type Exercise, type PlanDay } from '../services/api'
import { Button, Card, ErrorBox, PageTitle, SectionTitle, Spinner, fmtDate, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import ExerciseInfo from '../components/ExerciseInfo'
import ExercisePicker from '../components/ExercisePicker'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'

function lastDoneLabel(iso: string | null): string {
  if (!iso) return 'ещё не выполнялась'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн. назад`
  return fmtDate(iso)
}

export default function PlanPage() {
  const nav = useNavigate()
  const q = useLoad(() => api.plan(), [], 'plan')
  const [open, setOpen] = useState<number | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [pickFor, setPickFor] = useState<number | null>(null)

  if (q.loading && !q.data) return <Spinner />
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
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }


  const addExercise = async (workoutId: number, ex: Exercise) => {
    const w = await api.workout(workoutId)
    await api.updateWorkout(workoutId, {
      name: w.name,
      description: w.description,
      items: [
        ...w.items.map((i) => ({
          exercise_id: i.exercise_id,
          target_sets: i.target_sets,
          target_reps: i.target_reps,
          target_weight: i.target_weight,
        })),
        { exercise_id: ex.id, target_sets: 3, target_reps: 10, target_weight: null },
      ],
    })
    cacheDrop('plan', 'dashboard')
    await q.reload()
  }


  const renderDay = ({ d, next, own: isOwn }: { d: PlanDay; next?: boolean; own?: boolean }) => (
    <Card className={clsx(next && 'border-accent/50')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-lg font-semibold">{d.name}</div>
          <div className="text-xs text-hint">
            {d.exercises.length} упр. · выполнялась: {lastDoneLabel(d.last_done)}
          </div>
        </div>
        {next && <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-fg">Следующая</span>}
      </div>

      {open === d.workout_id && (
        <div className="mt-3 rounded-2xl bg-card2 p-3">
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
                    {e.sets}×{e.reps}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-hint">Нажмите на упражнение, чтобы открыть технику и мышцы.</p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button className="flex flex-1 items-center justify-center gap-2 !py-3" disabled={starting} onClick={() => start({ workout_id: d.workout_id })}>
          <Icon name="play" size={16} fill="currentColor" /> Начать
        </Button>
        <Button variant="ghost" className="!px-4 !py-3" onClick={() => setOpen(open === d.workout_id ? null : d.workout_id)}>
          {open === d.workout_id ? 'Скрыть' : 'Состав'}
        </Button>
      </div>
      {open === d.workout_id && (
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" className="flex flex-1 items-center justify-center gap-2 !py-3" onClick={() => setPickFor(d.workout_id)}>
            <Icon name="plus" size={18} /> Упражнение
          </Button>
          <Link to={`/plan/workout/${d.workout_id}`}>
            <Button variant="ghost" className="!px-3.5 !py-3" aria-label="Изменить">
              <Icon name="edit" size={18} />
            </Button>
          </Link>
          {isOwn && (
            <Button variant="danger" className="!px-3.5 !py-3" onClick={() => remove(d.workout_id, d.name)} aria-label="Удалить">
              <Icon name="trash" size={18} />
            </Button>
          )}
        </div>
      )}
    </Card>
  )

  return (
    <div className="space-y-6">
      <PageTitle>План</PageTitle>
      {err && <ErrorBox message={err} />}

      {program ? (
        <section className="space-y-3">
          <Card className="bg-gradient-to-br from-accent/12 to-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-hint">Моя программа</div>
                <div className="text-xl font-bold">{program.name}</div>
              </div>
              <span className="shrink-0 rounded-full bg-card2 px-2.5 py-1 text-xs text-hint">{program.level}</span>
            </div>
            <p className="mt-1 text-sm text-hint">{program.description}</p>
            <Link to="/plan/programs" className="mt-3 inline-block text-sm font-medium text-brand">
              Сменить программу
            </Link>
          </Card>
          {program.days.map((d) => (
            <Fragment key={d.workout_id}>{renderDay({ d, next: d.workout_id === program.next_workout_id })}</Fragment>
          ))}
        </section>
      ) : (
        <Card className="space-y-3">
          <div className="text-lg font-semibold">Программа не выбрана</div>
          <p className="text-sm text-hint">
            Откройте каталог, изучите состав и технику упражнений, затем выберите подходящую. Приложение само будет показывать, какая тренировка следующая.
          </p>
          <Link to="/plan/programs" className="block">
            <Button full>Каталог программ</Button>
          </Link>
        </Card>
      )}

      <section className="space-y-3">
        <SectionTitle>Свои тренировки</SectionTitle>
        {own.length === 0 && <p className="text-sm text-hint">Здесь будут тренировки, которые вы создадите сами.</p>}
        {own.map((d) => (
          <Fragment key={d.workout_id}>{renderDay({ d, own: true })}</Fragment>
        ))}
        <Link to="/plan/workout/new" className="block">
          <Button variant="ghost" full className="flex items-center justify-center gap-2">
            <Icon name="plus" size={18} /> Создать тренировку
          </Button>
        </Link>
      </section>

      {                                                                                                                                                                                      }
      <section className="flex flex-col gap-3 !mt-3">
        <Button variant="ghost" full disabled={starting} onClick={() => start({})}>
          Свободная тренировка
        </Button>
        <Link to="/plan/exercises" className="block">
          <Button variant="ghost" full className="flex items-center justify-center gap-2">
            <Icon name="book" size={18} /> Справочник упражнений
          </Button>
        </Link>
      </section>

      {info && <ExerciseInfo name={info} onClose={() => setInfo(null)} />}
      {pickFor !== null && (
        <ExercisePicker
          multi
          title="Добавить в тренировку"
          onClose={() => setPickFor(null)}
          onPick={(ex) => addExercise(pickFor, ex)}
        />
      )}
    </div>
  )
}
