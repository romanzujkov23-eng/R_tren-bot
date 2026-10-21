import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../stores/authStore'
import { Button, Card, ErrorBox, Feeling, Ring, SectionTitle, PageSkeleton, fmtDate, fmtNum, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import { GoalRow } from '../components/GoalCard'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'

const weeksWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? 'неделя' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'недели' : 'недель'

export default function HomePage() {
  const user = useAuth((s) => s.user)!
  const nav = useNavigate()
  const dash = useLoad(() => api.dashboard(), [], 'dashboard')
  const goalsQ = useLoad(() => api.goals(), [], 'goals')
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const start = async (workoutId?: number) => {
    haptic.tap()
    setStarting(true)
    setErr(null)
    try {
      await api.startSession(workoutId ? { workout_id: workoutId } : {})
      cacheDrop('dashboard')
      nav('/session')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setStarting(false)
    }
  }

  if (dash.loading && !dash.data) return <PageSkeleton variant="home" />
  if (dash.error && !dash.data) return <ErrorBox message={dash.error} onRetry={dash.reload} />
  if (!dash.data) return null
  const { summary, recent, active, streak, next_workout: next } = dash.data
  const isNew = summary.total_workouts === 0 && !next && !active
  const raw = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  const today = raw.charAt(0).toUpperCase() + raw.slice(1)

  const openGoals = (goalsQ.data ?? []).filter((g) => !g.achieved)

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-hint">{today}</div>
        <h1 className="text-[26px] font-bold leading-tight">Привет, {user.first_name}</h1>
      </div>
      {err && <ErrorBox message={err} />}

      {active ? (
        <Card className="border-accent/40 bg-gradient-to-br from-accent/15 to-card">
          <div className="text-sm text-hint">Тренировка идёт</div>
          <div className="text-xl font-bold">{active.name}</div>
          <div className="mb-4 text-sm text-hint">Подходов записано: {active.total_sets}</div>
          <Link to="/session">
            <Button full>Продолжить</Button>
          </Link>
        </Card>
      ) : next ? (
        <Card className="border-accent/40 bg-gradient-to-br from-accent/15 to-card">
          <div className="text-sm text-hint">Следующая тренировка</div>
          <div className="text-2xl font-bold">{next.name}</div>
          <div className="mb-4 text-sm text-hint">
            {next.program_name} · {next.exercises} упр.
          </div>
          <Button full disabled={starting} onClick={() => start(next.id)}>
            <Icon name="play" size={18} fill="currentColor" /> Начать тренировку
          </Button>
          <div className="mt-3 grid grid-cols-3 divide-x divide-line text-center text-sm font-medium text-brand">
            <Link to="/plan" className="py-1">
              Весь план
            </Link>
            <Link to="/plan/catalog" className="py-1">
              Из каталога
            </Link>
            <button className="py-1" disabled={starting} onClick={() => start()}>
              Без плана
            </button>
          </div>
        </Card>
      ) : (
        <Card className="space-y-3">
          <div>
            <div className="text-lg font-semibold">Выберите программу</div>
            <p className="mt-1 text-sm text-hint">
              Готовые программы с техникой упражнений.
            </p>
          </div>
          <Link to="/plan/programs" className="block">
            <Button full>Смотреть программы</Button>
          </Link>
          <div className="grid grid-cols-2 divide-x divide-line text-center text-sm font-medium text-brand">
            <Link to="/plan/catalog" className="py-1">
              Из каталога
            </Link>
            <button className="py-1" disabled={starting} onClick={() => start()}>
              Без программы
            </button>
          </div>
        </Card>
      )}

      {isNew && (
        <Card>
          <div className="mb-3 font-semibold">С чего начать</div>
          <ol className="space-y-3 text-sm">
            {['Выберите программу и изучите состав', 'Нажмите «Начать тренировку»', 'Записывайте подходы, вес подставится сам', 'Завершите: следующая тренировка появится здесь'].map(
              (t, i) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card2 text-xs font-bold">
                    {i + 1}
                  </span>
                  {t}
                </li>
              ),
            )}
          </ol>
        </Card>
      )}

      <Card className="flex items-center gap-4 !py-3.5">
        <Ring value={streak.this_week} max={streak.weekly_goal} size={60}>
          <span className="text-base">{Math.min(streak.this_week, streak.weekly_goal)}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Эта неделя</div>
          <div className="text-sm text-hint">
            {streak.this_week} из {streak.weekly_goal} тренировочных дней
          </div>
          {streak.current > 0 && (
            <div className="mt-0.5 flex items-center gap-1 text-sm text-brand">
              <Icon name="flame" size={15} /> Серия {streak.current} {weeksWord(streak.current)}
            </div>
          )}
        </div>
      </Card>

      {goalsQ.data && (
        <section>
          <SectionTitle
            right={
              <Link to="/stats?tab=goals" className="text-sm font-medium text-brand">
                {goalsQ.data.length ? 'Все цели' : 'Поставить'}
              </Link>
            }
          >
            Цели
          </SectionTitle>
          {openGoals.length === 0 ? (
            <Link to="/stats?tab=goals" className="block">
              <Card className="flex items-center gap-3 !py-3.5">
                <Icon name="target" size={26} className="shrink-0 text-brand" />
                <span className="text-sm text-hint">
                  {goalsQ.data.length ? 'Все цели достигнуты. Поставьте новую!' : 'Поставьте цель и следите за прогрессом.'}
                </span>
              </Card>
            </Link>
          ) : (
            <Card className="divide-y divide-line !p-0">
              {openGoals.slice(0, 3).map((g) => (
                <GoalRow key={g.id} g={g} />
              ))}
            </Card>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <SectionTitle
            right={
              <Link to="/calendar" className="text-sm font-medium text-brand">
                Календарь
              </Link>
            }
          >
            Последние тренировки
          </SectionTitle>
          <Card className="divide-y divide-line !p-0">
            {recent.slice(0, 3).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-hint">
                    {s.finished_at && fmtDate(s.finished_at)} · {s.total_sets} подх. · {fmtNum(s.total_volume)} кг ·{' '}
                    {Math.round(s.duration_seconds / 60)} мин
                  </div>
                </div>
                {s.feeling && <Feeling n={s.feeling} size={22} className="ml-2 shrink-0" />}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  )
}
