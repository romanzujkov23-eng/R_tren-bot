import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CustomProgram } from '../services/api'
import { useAuth } from '../stores/authStore'
import { Button, Card, Chip, ErrorBox, PageTitle, PageSkeleton, SectionTitle, useLoad } from '../components/ui'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'

function Chips({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {options.map((o) => (
        <Chip key={o} active={value === o} onClick={() => onChange(o)}>
          {o}
        </Chip>
      ))}
    </div>
  )
}

function MyProgramCard({ p, active, busy, onPick }: { p: CustomProgram; active: boolean; busy: boolean; onPick: () => void }) {
  return (
    <Card className="space-y-2">
      <Link to={`/plan/programs/edit/${p.id}`} className="block space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-semibold leading-snug">{p.name}</div>
          {active && (
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
              <Icon name="check" size={14} /> Ваша
            </span>
          )}
        </div>
        <div className="truncate text-sm text-hint">{p.days.map((d) => d.name).join(' → ')}</div>
        <div className="text-xs text-hint">Своя программа · тренировок: {p.days.length}</div>
      </Link>
      <div className="flex gap-2 pt-1">
        {!active && (
          <Button size="sm" className="flex-1" disabled={busy} onClick={onPick}>
            Выбрать
          </Button>
        )}
        <Link to={`/plan/programs/edit/${p.id}`} className={active ? 'block w-full' : 'block'}>
          <Button size="sm" variant="ghost" full={active}>
            Изменить
          </Button>
        </Link>
      </div>
    </Card>
  )
}

export default function ProgramsPage() {
  const active = useAuth((s) => s.user?.active_program)
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const q = useLoad(() => api.programs(), [], 'programs')
  const mine = useLoad(() => api.myPrograms(), [], 'myPrograms')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pick = async (p: CustomProgram) => {
    if (!user) return
    if (user.active_program && !(await confirmAction('Заменить текущую программу? История тренировок сохранится.'))) return
    setBusy(true)
    setErr(null)
    try {
      await api.activateMyProgram(p.id)
      haptic.success()
      setUser({ ...user, active_program: p.key })
      cacheDrop('plan', 'dashboard', 'myPrograms')
      mine.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }
  const [goal, setGoal] = useState('Все')
  const [place, setPlace] = useState('Все')

  const all = useMemo(() => q.data ?? [], [q.data])
  const goals = useMemo(() => ['Все', ...Array.from(new Set(all.map((p) => p.goal)))], [all])
  const places = useMemo(() => ['Все', ...Array.from(new Set(all.map((p) => p.equipment)))], [all])
  const list = all.filter((p) => (goal === 'Все' || p.goal === goal) && (place === 'Все' || p.equipment === place))

  if (q.loading && !q.data) return <PageSkeleton />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />

  return (
    <div className="space-y-4">
      <Link to="/plan" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> План
      </Link>
      <PageTitle>Программы</PageTitle>
      {err && <ErrorBox message={err} />}

      <section className="space-y-2">
        <SectionTitle
          right={
            (mine.data ?? []).length > 0 ? (
              <Link to="/plan/programs/new">
                <Button size="sm">
                  <Icon name="plus" size={16} /> Создать
                </Button>
              </Link>
            ) : undefined
          }
        >
          Мои программы
        </SectionTitle>
        {(mine.data ?? []).length === 0 ? (
          <Card className="space-y-3">
            <p className="text-sm text-hint">Соберите программу из своих тренировок: порядок любой, повторы можно.</p>
            <Link to="/plan/programs/new" className="block">
              <Button full>
                <Icon name="plus" size={18} /> Создать свою программу
              </Button>
            </Link>
          </Card>
        ) : (
          (mine.data ?? []).map((p) => <MyProgramCard key={p.id} p={p} active={active === p.key} busy={busy} onPick={() => pick(p)} />)
        )}
      </section>

      <SectionTitle>Готовые программы</SectionTitle>
      <div className="space-y-2">
        <div className="text-sm text-hint">Цель</div>
        <Chips value={goal} options={goals} onChange={setGoal} />
        <div className="pt-1 text-sm text-hint">Где заниматься</div>
        <Chips value={place} options={places} onChange={setPlace} />
      </div>

      {list.length === 0 && <p className="py-6 text-center text-sm text-hint">По этим фильтрам программ нет.</p>}
      {list.map((p) => (
        <Link key={p.id} to={`/plan/programs/${p.id}`} className="block">
          <Card className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-base font-semibold leading-snug">{p.name}</div>
              {active === p.id && (
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand">
                  <Icon name="check" size={14} /> Ваша
                </span>
              )}
            </div>
            <p className="text-sm text-hint">{p.description}</p>
            <div className="text-xs text-hint">
              <span className="font-medium text-brand">{p.goal}</span> · {p.level} · {p.per_week} раза в неделю · {p.equipment}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}
