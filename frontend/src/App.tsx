import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Icon from './components/Icon'
import { Button, Spinner } from './components/ui'
import { useAuth } from './stores/authStore'
import HomePage from './pages/HomePage'
import PlanPage from './pages/PlanPage'
import SessionPage from './pages/SessionPage'
import CalendarPage from './pages/CalendarPage'
import ModeChooser from './pages/ModeChooser'


const StatsPage = lazy(() => import('./pages/StatsPage'))
const ProgramsPage = lazy(() => import('./pages/ProgramsPage'))
const ProgramDetailPage = lazy(() => import('./pages/ProgramDetailPage'))
const ExercisesPage = lazy(() => import('./pages/ExercisesPage'))
const WorkoutEditorPage = lazy(() => import('./pages/WorkoutEditorPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage'))


function prefetchScreens() {
  const run = () => {
    void import('./pages/SettingsPage')
    void import('./pages/GoalsPage')
    void import('./pages/ProgramsPage')
    void import('./pages/ProgramDetailPage')
    void import('./pages/WorkoutEditorPage')
    void import('./pages/ExercisesPage')
    void import('./pages/StatsPage')
  }
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 })
  else window.setTimeout(run, 2500)
}

function Message({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-card2 text-brand">
        <Icon name={icon} size={30} />
      </div>
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      <p className="mt-2 text-hint">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export default function App() {
  const { status, error, login, user } = useAuth()

  useEffect(() => {
    void login()
  }, [login])

  const ready = status === 'ready' && !!user && user.app_mode !== 'ask'
  useEffect(() => {
    if (ready) prefetchScreens()
  }, [ready])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <Spinner />
        <p className="text-sm text-hint">Загрузка. Первый запуск может занять до минуты.</p>
      </div>
    )
  }
  if (status === 'no-telegram') {
    return (
      <Message
        icon="dumbbell"
        title="Откройте через Telegram"
        text="Приложение работает внутри Telegram. Найдите бота, нажмите /start и откройте приложение кнопкой."
      />
    )
  }
  if (status === 'error') {
    return (
      <Message
        icon="info"
        title="Не удалось войти"
        text={error ?? 'Неизвестная ошибка'}
        action={<Button onClick={() => void login()}>Повторить</Button>}
      />
    )
  }


  if (user?.app_mode === 'ask') return <ModeChooser />


  if (user?.app_mode === 'simple') {
    return (
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/programs" element={<ProgramsPage />} />
        <Route path="/plan/programs/:id" element={<ProgramDetailPage />} />
        <Route path="/plan/exercises" element={<ExercisesPage />} />
        <Route path="/plan/workout/new" element={<WorkoutEditorPage />} />
        <Route path="/plan/workout/:id" element={<WorkoutEditorPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/session" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
