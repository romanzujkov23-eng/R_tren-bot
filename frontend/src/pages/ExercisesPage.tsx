import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CatalogItem, type MuscleGroup } from '../services/api'
import {
  Button, Card, ErrorBox, Field, MUSCLE_GROUPS, MUSCLE_LABELS, PageTitle, Spinner, Toast, inputCls, useLoad, useToast,
} from '../components/ui'
import ExerciseInfo from '../components/ExerciseInfo'
import Icon from '../components/Icon'
import { findInfo, useCatalog } from '../stores/catalogStore'
import { confirmAction, haptic } from '../utils/telegram'


export default function ExercisesPage() {
  const list = useLoad(() => api.exercises(), [], 'exercises')
  const { items: catalog, load } = useCatalog()
  useEffect(() => void load(), [load])
  const [name, setName] = useState('')
  const [group, setGroup] = useState<MuscleGroup>('chest')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ name: string; item?: CatalogItem } | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const toast = useToast()

  const create = async (n: string, g: MuscleGroup) => {
    setBusy(true)
    try {
      await api.createExercise({ name: n.trim(), muscle_group: g })
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

  if (list.loading && !list.data) return <Spinner />
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
        <div className="space-y-1">
          {notMine.length === 0 && <p className="text-sm text-hint">Все упражнения из каталога уже у вас.</p>}
          {notMine.map((c) => (
            <Card key={c.name} className="flex items-center justify-between gap-2 !py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setInfo({ name: c.name, item: c })}>
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-xs text-hint">{c.muscles}</div>
              </button>
              <Button
                className="!px-3 !py-1.5 !text-sm"
                disabled={busy}
                onClick={async () => {
                  if (await create(c.name, c.group)) toast.show('Добавлено')
                }}
              >
                +
              </Button>
            </Card>
          ))}
        </div>
      )}

      {grouped.map(({ g, items }) => (
        <section key={g}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-hint">{MUSCLE_LABELS[g]}</h3>
          <div className="space-y-1">
            {items.map((e) => (
              <Card key={e.id} className="flex items-center justify-between !py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setInfo({ name: e.name })}>
                  <div className="font-medium">{e.name}</div>
                  <div className="truncate text-xs text-hint">{findInfo(catalog, e.name)?.muscles ?? MUSCLE_LABELS[e.muscle_group]}</div>
                </button>
                <button className="px-2 text-hint" onClick={() => remove(e.id, e.name)} aria-label="Удалить">
                  <Icon name="x" size={18} />
                </button>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Card className="space-y-3">
        <Field label="Своё упражнение">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Жим гантелей" maxLength={100} />
        </Field>
        <select className={inputCls} value={group} onChange={(e) => setGroup(e.target.value as MuscleGroup)}>
          {MUSCLE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {MUSCLE_LABELS[g]}
            </option>
          ))}
        </select>
        <Button
          full
          disabled={busy || !name.trim()}
          onClick={async () => {
            if (name.trim() && (await create(name, group))) setName('')
          }}
        >
          Добавить своё
        </Button>
      </Card>

      {info && <ExerciseInfo name={info.name} item={info.item} onClose={() => setInfo(null)} />}
    </div>
  )
}
