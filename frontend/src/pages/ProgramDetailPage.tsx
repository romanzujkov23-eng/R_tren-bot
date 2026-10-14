import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../stores/authStore'
import { Button, Card, ErrorBox, PageTitle, PageSkeleton, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import ExerciseInfo from '../components/ExerciseInfo'
import { cacheDrop } from '../utils/cache'
import { fmtTarget, measureOf } from '../utils/measure'
import { confirmAction, haptic } from '../utils/telegram'

export default function ProgramDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const user = useAuth((s) => s.user)!
  const setUser = useAuth((s) => s.setUser)
  const q = useLoad(() => api.programs(), [], 'programs')
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (q.loading && !q.data) return <PageSkeleton />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />
  const prog = (q.data ?? []).find((p) => p.id === id)
  if (!prog) return <ErrorBox message="Программа не найдена" />

  const isActive = user.active_program === prog.id
  const choose = async () => {
    if (user.active_program && !isActive) {
      const ok = await confirmAction('Заменить текущую программу? История тренировок сохранится.')
      if (!ok) return
    }
    setBusy(true)
    setErr(null)
    try {
      await api.activateProgram(prog.id)
      haptic.success()
      setUser({ ...user, active_program: prog.id })
      cacheDrop('plan', 'dashboard')
      nav('/plan', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Link to="/plan/programs" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> Все программы
      </Link>
      <div>
        <PageTitle>{prog.name}</PageTitle>
        <div className="text-sm text-hint">
          <span className="font-medium text-brand">{prog.goal}</span> · {prog.level} · {prog.per_week} раза в неделю · {prog.equipment}
        </div>
      </div>
      <p className="text-sm text-hint">{prog.description}</p>
      {err && <ErrorBox message={err} />}

      {prog.days.map((d) => (
        <Card key={d.name}>
          <div className="mb-2 text-base font-semibold">{d.name}</div>
          <ul className="divide-y divide-line">
            {d.items.map((i) => (
              <li key={i.name} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <button className="min-w-0 flex-1 text-left" onClick={() => setInfo(i.name)}>
                  <div className="text-sm font-medium">{i.name}</div>
                  <div className="truncate text-xs text-hint">{i.muscles}</div>
                </button>
                <span className="shrink-0 text-sm text-hint">
                  {fmtTarget(i.sets, i.reps, measureOf(i))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <p className="text-center text-xs text-hint">Нажмите на упражнение: техника и мышцы.</p>

      <div className="fixed inset-x-0 bottom-[calc(4.1rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-card px-4 py-3">
        <div className="mx-auto max-w-xl">
          {isActive ? (
            <Button full disabled>
              Это ваша программа
            </Button>
          ) : (
            <Button full disabled={busy} onClick={choose}>
              {busy ? 'Выбираю…' : 'Выбрать эту программу'}
            </Button>
          )}
        </div>
      </div>

      {info && <ExerciseInfo name={info} onClose={() => setInfo(null)} />}
    </div>
  )
}
