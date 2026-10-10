import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../services/api'
import { useAuth } from '../stores/authStore'
import { Card, ErrorBox, PageTitle, Spinner, useLoad } from '../components/ui'
import Icon from '../components/Icon'

function Chips({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={clsx(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium',
            value === o ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-card text-fg',
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}


export default function ProgramsPage() {
  const active = useAuth((s) => s.user?.active_program)
  const q = useLoad(() => api.programs(), [], 'programs')
  const [goal, setGoal] = useState('Все')
  const [place, setPlace] = useState('Все')

  const all = q.data ?? []
  const goals = useMemo(() => ['Все', ...Array.from(new Set(all.map((p) => p.goal)))], [all])
  const places = useMemo(() => ['Все', ...Array.from(new Set(all.map((p) => p.equipment)))], [all])
  const list = all.filter((p) => (goal === 'Все' || p.goal === goal) && (place === 'Все' || p.equipment === place))

  if (q.loading && !q.data) return <Spinner />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />

  return (
    <div className="space-y-4">
      <Link to="/plan" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> План
      </Link>
      <PageTitle>Программы</PageTitle>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-hint">Цель</div>
        <Chips value={goal} options={goals} onChange={setGoal} />
        <div className="pt-1 text-xs uppercase tracking-wide text-hint">Где заниматься</div>
        <Chips value={place} options={places} onChange={setPlace} />
      </div>

      {list.length === 0 && <p className="py-6 text-center text-sm text-hint">По этим фильтрам программ нет.</p>}
      {list.map((p) => (
        <Link key={p.id} to={`/plan/programs/${p.id}`} className="block">
          <Card className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-lg font-semibold leading-snug">{p.name}</div>
              {active === p.id && (
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
                  <Icon name="check" size={14} /> Ваша
                </span>
              )}
            </div>
            <p className="text-sm text-hint">{p.description}</p>
            <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
              <span className="rounded-full bg-accent/15 px-2.5 py-1 font-medium text-brand">{p.goal}</span>
              <span className="rounded-full bg-card2 px-2.5 py-1">{p.level}</span>
              <span className="rounded-full bg-card2 px-2.5 py-1">{p.per_week} раза в неделю</span>
              <span className="rounded-full bg-card2 px-2.5 py-1">{p.equipment}</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}
