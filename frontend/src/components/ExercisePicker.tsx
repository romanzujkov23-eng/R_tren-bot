import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { api, type Exercise, type Measure, type MuscleGroup } from '../services/api'
import { Button, Chip, ErrorBox, MUSCLE_GROUPS, MUSCLE_LABELS, Modal, inputCls, useLoad } from './ui'
import Icon from './Icon'
import MuscleSelect, { groupForMuscles } from './MuscleSelect'
import { findInfo, useCatalog } from '../stores/catalogStore'
import { cacheDrop } from '../utils/cache'
import { haptic } from '../utils/telegram'

const norm = (s: string) => s.toLowerCase().split(/\s+/).join(' ').trim()

interface Muscles {
  primary: string[]
  secondary: string[]
}

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

interface Token {
  temp: Exercise
  creation: Promise<Exercise>
  real?: Exercise
  picked: boolean
  cancelled: boolean
}

export default function ExercisePicker({
  onPick, onUnpick, onClose, multi = false, instant = false, exclude = [], title = 'Добавить упражнение',
}: {
  onPick: (ex: Exercise, creation?: Promise<Exercise>) => void | Promise<void>
  onUnpick?: (ex: Exercise) => void | Promise<void>
  onClose: () => void
  multi?: boolean
  instant?: boolean
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
  const [viaCatalog, setViaCatalog] = useState<Set<string>>(new Set())
  const tokens = useRef(new Map<string, Token>())
  const cleanup = useRef(new Map<string, Promise<unknown>>())
  const seq = useRef(0)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPrimary, setNewPrimary] = useState<string[]>([])
  const [newSecondary, setNewSecondary] = useState<string[]>([])
  const [newMeasure, setNewMeasure] = useState<Measure>('reps')

  const mine = useMemo(() => mineQ.data ?? [], [mineQ.data])
  const mineByName = useMemo(() => new Map(mine.map((e) => [norm(e.name), e])), [mine])
  const needle = norm(q)
  const matches = (name: string, g: MuscleGroup, extra = '') =>
    (group === 'all' || g === group) && (!needle || norm(name).includes(needle) || norm(extra).includes(needle))

  const myList = mine.filter((e) => !viaCatalog.has(norm(e.name)) && matches(e.name, e.muscle_group))
  const catList = catalog.filter((c) => (!mineByName.has(norm(c.name)) || viaCatalog.has(norm(c.name))) && matches(c.name, c.group, `${c.muscles} ${(c.aliases ?? []).join(' ')}`))

  const flag = (setter: typeof setAdded, key: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const fail = (key: string) => (e: unknown) => {
    flag(setAdded, key, false)
    flag(setViaCatalog, key, false)
    tokens.current.delete(key)
    setErr(e instanceof Error ? e.message : 'Не удалось добавить упражнение')
    haptic.error()
  }

  const createRemote = (name: string, g: MuscleGroup, m?: Measure, muscles?: Muscles) => {
    const prior = cleanup.current.get(norm(name)) ?? Promise.resolve()
    return prior
      .then(() => api.createExercise({ name, muscle_group: g, measure: m, ...muscles }))
      .then((ex) => {
        cacheDrop('exercises')
        mineQ.setData((prev) => (prev && prev.some((p) => p.id === ex.id) ? prev : [...(prev ?? []), ex]))
        return ex
      })
  }

  const select = (name: string, g: MuscleGroup, existing?: Exercise, m?: Measure, muscles?: Muscles) => {
    const key = norm(name)
    setErr(null)
    flag(setAdded, key, true)
    haptic.success()
    if (existing) {
      Promise.resolve(onPick(existing)).catch(fail(key))
      return
    }
    const temp: Exercise = { id: -(++seq.current), name, muscle_group: g, measure: m ?? 'reps', ...muscles }
    const creation = createRemote(name, g, m, muscles)
    const token: Token = { temp, creation, picked: instant, cancelled: false }
    tokens.current.set(key, token)
    flag(setViaCatalog, key, true)
    creation.then((ex) => void (token.real = ex)).catch(() => undefined)
    if (instant) {
      creation.catch(fail(key))
      Promise.resolve(onPick(temp, creation)).catch(fail(key))
    } else {
      creation
        .then((ex) => {
          if (token.cancelled) return undefined
          token.picked = true
          return onPick(ex)
        })
        .catch(fail(key))
    }
  }

  const unselect = (name: string, existing?: Exercise) => {
    const key = norm(name)
    haptic.select()
    flag(setAdded, key, false)
    const token = tokens.current.get(key)
    if (!token) {
      if (existing) void onUnpick?.(existing)
      return
    }
    tokens.current.delete(key)
    flag(setViaCatalog, key, false)
    token.cancelled = true
    if (token.picked) void onUnpick?.(token.real ?? token.temp)
    const done = token.creation
      .then(async (ex) => {
        await api.deleteExercise(ex.id)
        cacheDrop('exercises')
        mineQ.setData((prev) => (prev ? prev.filter((p) => p.id !== ex.id) : prev))
      })
      .catch(() => undefined)
    cleanup.current.set(key, done)
    void done.then(() => {
      if (cleanup.current.get(key) === done) cleanup.current.delete(key)
    })
  }

  const tap = (name: string, g: MuscleGroup, existing?: Exercise, m?: Measure, muscles?: Muscles) => {
    if (!multi) return void choose(name, g, existing, m, muscles)
    const selected = added.has(norm(name)) || (!!existing && exclude.includes(existing.id))
    if (selected && onUnpick) unselect(name, existing)
    else select(name, g, existing, m, muscles)
  }

  const choose = async (name: string, g: MuscleGroup, existing?: Exercise, m?: Measure, muscles?: Muscles) => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      let ex = existing
      if (!ex) {
        ex = await api.createExercise({ name, muscle_group: g, measure: m, ...muscles })
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
    if (newPrimary.length === 0) return setErr('Выберите хотя бы одну основную мышцу')
    const muscles = { primary: newPrimary, secondary: newSecondary }
    const g = groupForMuscles(newPrimary)
    if (multi) {
      select(name, g, mineByName.get(norm(name)), newMeasure, muscles)
      setCreating(false)
      setNewName('')
      setNewPrimary([])
      setNewSecondary([])
      return
    }
    await choose(name, g, mineByName.get(norm(name)), newMeasure, muscles)
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-xl font-bold">{title}</h2>
      {multi && onUnpick && <p className="mb-3 text-sm text-hint">Нажмите ещё раз, чтобы убрать.</p>}
      {!(multi && onUnpick) && <div className="mb-2" />}
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
          <Chip key={g} active={group === g} onClick={() => setGroup(g)}>
            {g === 'all' ? 'Все' : MUSCLE_LABELS[g]}
          </Chip>
        ))}
      </div>

      {creating ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-accent/50 bg-card p-3.5">
          <div className="font-semibold">Новое упражнение</div>
          <input className={inputCls} placeholder="Название" value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} />
          <div>
            <div className="mb-1.5 text-sm text-hint">Группа мышц</div>
            <MuscleSelect
              primary={newPrimary}
              secondary={newSecondary}
              onChange={(p, sec) => {
                setNewPrimary(p)
                setNewSecondary(sec)
              }}
            />
          </div>
          <div>
            <div className="mb-1.5 text-sm text-hint">Как считаем</div>
            <div className="flex flex-wrap gap-1.5">
              {([['reps', 'Повторы'], ['seconds', 'Секунды'], ['minutes', 'Минуты']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setNewMeasure(value)}
                  className={clsx('rounded-full px-3 py-1 text-sm', newMeasure === value ? 'bg-accent font-semibold text-accent-fg' : 'bg-card2')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button full disabled={(busy && !multi) || !newName.trim()} onClick={createOwn}>
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
            setCreating(true)
          }}
        >
          <Icon name="plus" size={18} /> Создать своё упражнение
        </Button>
      )}

      {mineQ.loading && !mineQ.data && <p className="py-4 text-center text-sm text-hint">Загрузка…</p>}

      {myList.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold text-hint">Мои упражнения</h3>
          <div className="space-y-1.5">
            {myList.map((e) => (
              <Row
                key={e.id}
                busy={busy && !multi}
                name={e.name}
                sub={findInfo(catalog, e.name)?.muscles ?? (e.primary?.length ? e.primary.join(', ') : MUSCLE_LABELS[e.muscle_group])}
                done={exclude.includes(e.id) || added.has(norm(e.name))}
                onClick={() => tap(e.name, e.muscle_group, e)}
              />
            ))}
          </div>
        </section>
      )}

      {catList.length > 0 && (
        <section className="mb-2">
          <h3 className="mb-1.5 text-sm font-semibold text-hint">Каталог</h3>
          <div className="space-y-1.5">
            {catList.map((c) => (
              <Row key={c.name} busy={busy && !multi} name={c.name} sub={`${MUSCLE_LABELS[c.group]} · ${c.muscles}`} done={added.has(norm(c.name))} onClick={() => tap(c.name, c.group)} />
            ))}
          </div>
        </section>
      )}

      {!mineQ.loading && myList.length === 0 && catList.length === 0 && (
        <p className="py-4 text-center text-sm text-hint">Ничего не найдено.</p>
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
