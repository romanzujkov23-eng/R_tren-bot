import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CatalogItem, type Exercise, type Measure, type MuscleGroup } from '../services/api'
import {
  Button, Card, ErrorBox, Field, MUSCLE_GROUPS, MUSCLE_LABELS, PageTitle, PageSkeleton, Toast, inputCls, useLoad, useToast,
} from '../components/ui'
import ExerciseInfo from '../components/ExerciseInfo'
import Icon from '../components/Icon'
import MuscleSelect, { groupForMuscles } from '../components/MuscleSelect'
import { useCatalog } from '../stores/catalogStore'
import { confirmAction, haptic } from '../utils/telegram'
import { measureOf } from '../utils/measure'

const norm = (s: string) => s.toLowerCase().split(/\s+/).join(' ').trim()

interface Row {
  key: string
  name: string
  group: MuscleGroup
  muscles: string
  catalog?: CatalogItem
  mine?: Exercise
  search: string
}

export default function ExercisesPage() {
  const list = useLoad(() => api.exercises(), [], 'exercises')
  const { items: catalog, load } = useCatalog()
  useEffect(() => void load(), [load])
  const [name, setName] = useState('')
  const [primary, setPrimary] = useState<string[]>([])
  const [secondary, setSecondary] = useState<string[]>([])
  const [measure, setMeasure] = useState<Measure>('reps')
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ name: string; item?: CatalogItem; own?: Exercise } | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const toast = useToast()

  const create = async (n: string, g: MuscleGroup, m?: Measure, muscles?: { primary: string[]; secondary: string[] }) => {
    setBusy(true)
    try {
      await api.createExercise({ name: n.trim(), muscle_group: g, measure: m, ...muscles })
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

  const rows = useMemo<Row[]>(() => {
    const mine = new Map((list.data ?? []).map((e) => [norm(e.name), e]))
    const fromCatalog: Row[] = catalog.map((c) => ({
      key: `c:${norm(c.name)}`,
      name: c.name,
      group: c.group,
      muscles: c.muscles,
      catalog: c,
      mine: mine.get(norm(c.name)),
      search: norm(`${c.name} ${c.muscles} ${c.equipment} ${(c.aliases ?? []).join(' ')}`),
    }))
    const known = new Set(catalog.map((c) => norm(c.name)))
    const own: Row[] = (list.data ?? [])
      .filter((e) => !known.has(norm(e.name)))
      .map((e) => {
        const muscles = e.primary && e.primary.length > 0 ? e.primary.join(', ') : MUSCLE_LABELS[e.muscle_group]
        return { key: `m:${e.id}`, name: e.name, group: e.muscle_group, muscles, mine: e, search: norm(`${e.name} ${muscles}`) }
      })
    return [...fromCatalog, ...own]
  }, [catalog, list.data])

  if (list.loading && !list.data) return <PageSkeleton />
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={list.reload} />

  const needle = norm(q)
  const visible = needle ? rows.filter((r) => r.search.includes(needle)) : rows
  const grouped = MUSCLE_GROUPS.map((g) => ({ g, items: visible.filter((r) => r.group === g) })).filter((x) => x.items.length > 0)

  return (
    <div className="space-y-4">
      <Toast message={toast.msg} />
      <Link to="/plan" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> План
      </Link>
      <PageTitle>Упражнения</PageTitle>
      {err && <ErrorBox message={err} />}

      <input
        className={inputCls}
        placeholder="Поиск по названию или мышце"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        enterKeyHint="search"
      />

      {grouped.length === 0 && <p className="text-sm text-hint">Ничего не найдено.</p>}

      {grouped.map(({ g, items }) => {
        const open = needle ? true : !!openGroups[g]
        return (
          <section key={g}>
            <button
              className="flex w-full items-center justify-between rounded-2xl border border-line bg-card px-4 py-3 text-left"
              aria-expanded={open}
              onClick={() => setOpenGroups((o) => ({ ...o, [g]: !o[g] }))}
            >
              <span className="font-semibold">
                {MUSCLE_LABELS[g]} <span className="ml-1 text-sm font-normal text-hint">{items.length}</span>
              </span>
              <Icon name={open ? 'up' : 'down'} size={18} className="text-hint" />
            </button>
            {open && (
              <Card className="mt-2 divide-y divide-line !p-0">
                {items.map((r) => (
                  <div key={r.key} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setInfo({ name: r.name, item: r.catalog, own: r.mine })}>
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {r.mine && <Icon name="check" size={14} className="shrink-0 text-ok" />}
                        <span className="min-w-0">{r.name}</span>
                      </div>
                      <div className="truncate text-xs text-hint">
                        {r.muscles}
                        {!r.mine || measureOf(r.mine) === 'reps' ? '' : measureOf(r.mine) === 'seconds' ? ' · на время, сек' : ' · на время, мин'}
                      </div>
                    </button>
                    {r.mine ? (
                      <button className="px-2 text-hint" onClick={() => remove(r.mine!.id, r.name)} aria-label={`Убрать ${r.name}`}>
                        <Icon name="x" size={18} />
                      </button>
                    ) : (
                      <Button
                        size="sm"
                        className="!px-3.5"
                        disabled={busy}
                        aria-label={`Добавить ${r.name}`}
                        onClick={async () => {
                          if (await create(r.name, r.group)) toast.show('Добавлено')
                        }}
                      >
                        +
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </section>
        )
      })}

      <Card className="space-y-3">
        <Field label="Своё упражнение">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Жим гантелей" maxLength={100} />
        </Field>
        <div>
          <div className="mb-1.5 text-sm text-hint">Группа мышц</div>
          <MuscleSelect
            primary={primary}
            secondary={secondary}
            onChange={(p, s) => {
              setPrimary(p)
              setSecondary(s)
            }}
          />
        </div>
        <select aria-label="Как считаем" className={inputCls} value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
          <option value="reps">Считаем повторы</option>
          <option value="seconds">Считаем секунды (планка и подобное)</option>
          <option value="minutes">Считаем минуты (кардио)</option>
        </select>
        <Button
          full
          disabled={busy || !name.trim() || primary.length === 0}
          onClick={async () => {
            if (name.trim() && primary.length > 0 && (await create(name, groupForMuscles(primary), measure, { primary, secondary }))) {
              setName('')
              setPrimary([])
              setSecondary([])
              setMeasure('reps')
            }
          }}
        >
          Добавить своё
        </Button>
        {primary.length === 0 && <p className="text-xs text-hint">Выберите хотя бы одну основную мышцу.</p>}
      </Card>

      {info && <ExerciseInfo name={info.name} item={info.item} own={info.own} onClose={() => setInfo(null)} />}
    </div>
  )
}
