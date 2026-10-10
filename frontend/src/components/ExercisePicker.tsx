import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { api, type Exercise, type MuscleGroup } from '../services/api'
import { Button, ErrorBox, MUSCLE_GROUPS, MUSCLE_LABELS, Modal, inputCls, useLoad } from './ui'
import Icon from './Icon'
import { findInfo, useCatalog } from '../stores/catalogStore'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'

const norm = (s: string) => s.toLowerCase().split(/\s+/).join(' ').trim()

function Row({ name, sub, done, busy, onClick }: { name: string; sub: string; done: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left transition active:scale-[0.99] disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        <span className="block truncate text-xs text-hint">{sub}</span>
      </span>
      <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', done ? 'bg-accent text-accent-fg' : 'bg-card2 text-fg')}>
        <Icon name={done ? 'check' : 'plus'} size={16} strokeWidth={2.4} />
      </span>
    </button>
  )
}








export default function ExercisePicker({
  onPick, onClose, multi = false, exclude = [], title = 'Добавить упражнение',
}: {
  onPick: (ex: Exercise) => void | Promise<void>
  onClose: () => void
  multi?: boolean
  exclude?: number[]
  title?: string
}) {
  const mineQ = useLoad(() => api.exercises(), [], 'exercises')
  const { items: catalog, load } = useCatalog()
  useEffect(() => void load(), [load])

  const [q, setQ] = useState('')
  const [group, setGroup] = useState<MuscleGroup | 'all'>('all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState<MuscleGroup>('other')

  const mine = useMemo(() => mineQ.data ?? [], [mineQ.data])
  const mineByName = useMemo(() => new Map(mine.map((e) => [norm(e.name), e])), [mine])
  const needle = norm(q)
  const matches = (name: string, g: MuscleGroup, extra = '') =>
    (group === 'all' || g === group) && (!needle || norm(name).includes(needle) || norm(extra).includes(needle))

  const myList = mine.filter((e) => matches(e.name, e.muscle_group))
  const catList = catalog.filter((c) => !mineByName.has(norm(c.name)) && matches(c.name, c.group, c.muscles))

  const choose = async (name: string, g: MuscleGroup, existing?: Exercise) => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      let ex = existing
      if (!ex) {
        ex = await api.createExercise({ name, muscle_group: g })
        cacheDrop('exercises')
        mineQ.setData((prev) => (prev && prev.some((p) => p.id === ex!.id) ? prev : [...(prev ?? []), ex!]))
      }
      await onPick(ex)
      haptic.success()
      setAdded((a) => new Set(a).add(norm(name)))
      if (!multi) onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось добавить упражнение')
      haptic.error()
    } finally {
      setBusy(false)
    }
  }

  const createOwn = async () => {
    const name = newName.trim()
    if (!name) return setErr('Введите название упражнения')
    await choose(name, newGroup, mineByName.get(norm(name)))
    if (multi) {
      setCreating(false)
      setNewName('')
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-3 text-xl font-bold">{title}</h2>
      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}

      <input
        className={clsx(inputCls, 'mb-2')}
        placeholder="Поиск: например, жим или гиря"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        enterKeyHint="search"
      />
      <div className="-mx-5 mb-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {(['all', ...MUSCLE_GROUPS] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={clsx(
              'shrink-0 rounded-full border px-3 py-1 text-sm font-medium',
              group === g ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-card',
            )}
          >
            {g === 'all' ? 'Все' : MUSCLE_LABELS[g]}
          </button>
        ))}
      </div>

      {                                   }
      {creating ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-accent/50 bg-card p-3.5">
          <div className="font-semibold">Новое упражнение</div>
          <input className={inputCls} placeholder="Название" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} />
          <div>
            <div className="mb-1.5 text-sm text-hint">Группа мышц</div>
            <div className="flex flex-wrap gap-1.5">
              {MUSCLE_GROUPS.map((g) => (
                <button
                  key={g}
                  onClick={() => setNewGroup(g)}
                  className={clsx('rounded-full px-3 py-1 text-sm', newGroup === g ? 'bg-accent font-semibold text-accent-fg' : 'bg-card2')}
                >
                  {MUSCLE_LABELS[g]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button full disabled={busy || !newName.trim()} onClick={createOwn}>
              Создать и добавить
            </Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          full
          className="mb-4 flex items-center justify-center gap-2"
          onClick={() => {
            setNewName(q.trim())
            if (group !== 'all') setNewGroup(group)
            setCreating(true)
          }}
        >
          <Icon name="plus" size={18} /> Создать своё упражнение
        </Button>
      )}

      {mineQ.loading && !mineQ.data && <p className="py-4 text-center text-sm text-hint">Загрузка…</p>}

      {myList.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-hint">Мои упражнения</h3>
          <div className="space-y-1.5">
            {myList.map((e) => (
              <Row
                key={e.id}
                busy={busy}
                name={e.name}
                sub={findInfo(catalog, e.name)?.muscles ?? MUSCLE_LABELS[e.muscle_group]}
                done={exclude.includes(e.id) || added.has(norm(e.name))}
                onClick={() => choose(e.name, e.muscle_group, e)}
              />
            ))}
          </div>
        </section>
      )}

      {catList.length > 0 && (
        <section className="mb-2">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-hint">Каталог</h3>
          <div className="space-y-1.5">
            {catList.map((c) => (
              <Row key={c.name} busy={busy} name={c.name} sub={`${MUSCLE_LABELS[c.group]} · ${c.muscles}`} done={added.has(norm(c.name))} onClick={() => choose(c.name, c.group)} />
            ))}
          </div>
        </section>
      )}

      {!mineQ.loading && myList.length === 0 && catList.length === 0 && (
        <p className="py-4 text-center text-sm text-hint">Ничего не найдено. Создайте своё упражнение кнопкой выше.</p>
      )}

      {multi && (
        <div className="sticky bottom-0 -mx-5 mt-3 border-t border-line bg-bg px-5 pb-1 pt-3">
          <Button full onClick={onClose}>
            Готово{added.size > 0 ? ` (добавлено: ${added.size})` : ''}
          </Button>
        </div>
      )}
    </Modal>
  )
}
