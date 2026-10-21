import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type QuickWorkout } from '../services/api'
import { Button, Card, ErrorBox, PageTitle, SectionTitle, PageSkeleton, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'
import { fmtTarget } from '../utils/measure'

export default function CatalogWorkoutsPage() {
  const nav = useNavigate()
  const q = useLoad(() => api.quickWorkouts(), [], 'quick-workouts')
  const [open, setOpen] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (q.loading && !q.data) return <PageSkeleton />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />
  if (!q.data) return null

  const start = async (id: string) => {
    haptic.tap()
    setStarting(id)
    setErr(null)
    try {
      await api.startSession({ catalog_id: id })
      cacheDrop('dashboard')
      nav('/session')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setStarting(null)
    }
  }

  const renderItem = (w: QuickWorkout) => (
    <Card key={w.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold">{w.name}</div>
          <div className="text-xs text-hint">{w.exercises.length} упр.</div>
        </div>
        <Button size="sm" className="shrink-0" disabled={starting !== null} onClick={() => start(w.id)}>
          <Icon name="play" size={16} fill="currentColor" /> Начать
        </Button>
      </div>
      {w.description && <p className="mt-2 text-sm text-hint">{w.description}</p>}
      <button className="mt-2 text-sm font-medium text-brand" onClick={() => setOpen(open === w.id ? null : w.id)}>
        {open === w.id ? 'Скрыть состав' : 'Состав'}
      </button>
      {open === w.id && (
        <ul className="mt-2 divide-y divide-line rounded-2xl bg-card2 px-3 py-1">
          {w.exercises.map((e, idx) => (
            <li key={`${e.name}-${idx}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate">{e.name}</span>
              <span className="shrink-0 text-hint">{fmtTarget(e.sets, e.reps, e.measure)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )

  return (
    <div className="space-y-5">
      <Link to="/plan" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> План
      </Link>
      <PageTitle>Тренировка из каталога</PageTitle>
      <p className="-mt-2 text-sm text-hint">Разовая тренировка, программа не изменится.</p>
      {err && <ErrorBox message={err} />}
      {q.data.groups.map((g) => {
        const items = q.data!.items.filter((w) => w.group === g)
        if (items.length === 0) return null
        return (
          <section key={g} className="space-y-3">
            <SectionTitle>{g}</SectionTitle>
            {items.map(renderItem)}
          </section>
        )
      })}
    </div>
  )
}
