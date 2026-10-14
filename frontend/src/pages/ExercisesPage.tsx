import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CatalogItem, type Measure, type MuscleGroup } from '../services/api'
import {
  Button, Card, ErrorBox, Field, MUSCLE_GROUPS, MUSCLE_LABELS, PageTitle, PageSkeleton, ShowMore, Toast, inputCls, useLoad, useToast,
} from '../components/ui'
import ExerciseInfo from '../components/ExerciseInfo'
import Icon from '../components/Icon'
import { findInfo, useCatalog } from '../stores/catalogStore'
import { confirmAction, haptic } from '../utils/telegram'
import { measureOf } from '../utils/measure'

export default function ExercisesPage() {
  const list = useLoad(() => api.exercises(), [], 'exercises')
  const { items: catalog, load } = useCatalog()
  useEffect(() => void load(), [load])
  const [name, setName] = useState('')
  const [group, setGroup] = useState<MuscleGroup>('chest')
  const [measure, setMeasure] = useState<Measure>('reps')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ name: string; item?: CatalogItem } | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [allCatalog, setAllCatalog] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const toast = useToast()

  const create = async (n: string, g: MuscleGroup, m?: Measure) => {
    setBusy(true)
    try {
      await api.createExercise({ name: n.trim(), muscle_group: g, measure: m })
      haptic.success()
      await list.reload()
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      return false
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: number, n: string) => {
    if (!(await confirmAction(`Удалить упражнение «${n}»?`))) return
    try {
      await api.deleteExercise(id)
      await list.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  if (list.loading && !list.data) return <PageSkeleton />
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={list.reload} />

  const mine = new Set((list.data ?? []).map((e) => e.name.toLowerCase()))
  const grouped = MUSCLE_GROUPS.map((g) => ({ g, items: (list.data ?? []).filter((e) => e.muscle_group === g) })).filter(
    (x) => x.items.length > 0,
  )
  const notMine = catalog.filter((c) => !mine.has(c.name.toLowerCase()))

  return (
    <div className="space-y-4">
      <Toast message={toast.msg} />
      <Link to="/plan" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> План
      </Link>
      <PageTitle>Упражнения</PageTitle>
      {err && <ErrorBox message={err} />}

      <Button variant="ghost" full onClick={() => setShowCatalog((v) => !v)}>
        {showCatalog ? 'Скрыть каталог' : `Добавить из каталога (${notMine.length})`}
      </Button>

      {showCatalog && (
        <div>
          {notMine.length === 0 && <p className="text-sm text-hint">Все упражнения из каталога уже у вас.</p>}
          {notMine.length > 0 && (
            <Card className="divide-y divide-line !p-0">
              {(allCatalog ? notMine : notMine.slice(0, 6)).map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setInfo({ name: c.name, item: c })}>
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="truncate text-xs text-hint">{c.muscles}</div>
                  </button>
                  <Button
                    size="sm"
                    className="!px-3.5"
                    disabled={busy}
                    aria-label={`Добавить ${c.name}`}
                    onClick={async () => {
                      if (await create(c.name, c.group)) toast.show('Добавлено')
                    }}
                  >
                    +
                  </Button>
                </div>
              ))}
              <ShowMore total={notMine.length} limit={6} open={allCatalog} onToggle={() => setAllCatalog((v) => !v)} />
            </Card>
          )}
        </div>
      )}

      {grouped.map(({ g, items }) => (
        <section key={g}>
          <button
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-card px-4 py-3 text-left"
            aria-expanded={!!openGroups[g]}
            onClick={() => setOpenGroups((o) => ({ ...o, [g]: !o[g] }))}
          >
            <span className="font-semibold">
              {MUSCLE_LABELS[g]} <span className="ml-1 text-sm font-normal text-hint">{items.length}</span>
            </span>
            <Icon name={openGroups[g] ? 'up' : 'down'} size={18} className="text-hint" />
          </button>
          {openGroups[g] && (
            <Card className="mt-2 divide-y divide-line !p-0">
              {items.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-4 py-2.5">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setInfo({ name: e.name })}>
                    <div className="text-sm font-medium">{e.name}</div>
                    <div className="truncate text-xs text-hint">
                      {findInfo(catalog, e.name)?.muscles ?? MUSCLE_LABELS[e.muscle_group]}
                      {measureOf(e) === 'reps' ? '' : measureOf(e) === 'seconds' ? ' · на время, сек' : ' · на время, мин'}
                    </div>
                  </button>
                  <button className="px-2 text-hint" onClick={() => remove(e.id, e.name)} aria-label="Удалить">
                    <Icon name="x" size={18} />
                  </button>
                </div>
              ))}
            </Card>
          )}
        </section>
      ))}

      <Card className="space-y-3">
        <Field label="Своё упражнение">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Жим гантелей" maxLength={100} />
        </Field>
        <select aria-label="Группа мышц" className={inputCls} value={group} onChange={(e) => setGroup(e.target.value as MuscleGroup)}>
          {MUSCLE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {MUSCLE_LABELS[g]}
            </option>
          ))}
        </select>
        <select aria-label="Как считаем" className={inputCls} value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
          <option value="reps">Считаем повторы</option>
          <option value="seconds">Считаем секунды (планка и подобное)</option>
          <option value="minutes">Считаем минуты (кардио)</option>
        </select>
        <Button
          full
          disabled={busy || !name.trim()}
          onClick={async () => {
            if (name.trim() && (await create(name, group, measure))) {
              setName('')
              setMeasure('reps')
            }
          }}
        >
          Добавить своё
        </Button>
      </Card>

      {info && <ExerciseInfo name={info.name} item={info.item} onClose={() => setInfo(null)} />}
    </div>
  )
}
