import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { api, type DiaryEntry, type DiaryKind, type DiaryMonth, type DiaryWorkout, type MarkInput } from '../services/api'
import { Button, Card, ErrorBox, FEELINGS, Modal, Segmented, Spinner, Stat, Toast, Toggle, fmtNum, inputCls, useLoad, useToast } from '../components/ui'
import Icon from '../components/Icon'
import { GoalCard } from '../components/GoalCard'
import { useAuth } from '../stores/authStore'
import { Link } from 'react-router-dom'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'
import { MONTHS, MONTHS_GEN, WEEKDAYS_FULL, dateStr, monthStr } from '../utils/dates'
import {
  EMOJI_GROUPS, KINDS, PALETTE, fillBackground, firstGrapheme, kindInfo, markEmoji, markLook, textOn, type MarkLook,
} from '../utils/diaryTypes'

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MAX_MARKS = 2
const WORKOUT_EMOJI = markEmoji('strength', null)


type Mark = Omit<MarkInput, 'slot' | 'note'>

const getLastMark = (): Mark => {
  try {
    const v = JSON.parse(localStorage.getItem('tb:lastMark') ?? 'null') as Mark | null
    if (v && v.kind === 'custom' && (v.emoji || v.color)) return v
    if (v && KINDS.some((k) => k.key === v.kind)) return v
  } catch {

  }
  return { kind: 'strength', subtype: null }
}
const saveLastMark = (m: Mark) => {
  try {
    localStorage.setItem('tb:lastMark', JSON.stringify(m))
  } catch {

  }
}

const bySlot = (a: DiaryEntry, b: DiaryEntry) => a.day.localeCompare(b.day) || a.slot - b.slot


function dayFace(marks: DiaryEntry[], hasWorkout: boolean) {
  const looks = marks.map(markLook)
  const fills = looks.map((l) => l.color).filter((c): c is string => !!c)
  const emojis = looks.map((l) => l.emoji).filter(Boolean)

  if (hasWorkout && marks.length < MAX_MARKS && !marks.some((m) => m.kind === 'strength')) emojis.unshift(WORKOUT_EMOJI)
  return { fills, emojis: emojis.slice(0, MAX_MARKS), marked: marks.length > 0 || hasWorkout }
}


function DayTile({
  num, fills, emojis, marked, today, future, size = 'grid', onClick,
}: {
  num: number | string
  fills: string[]
  emojis: string[]
  marked: boolean
  today?: boolean
  future?: boolean
  size?: 'grid' | 'preview'
  onClick?: () => void
}) {
  const bg = fillBackground(fills)
  const ink = fills.length ? textOn(fills[0]) : undefined
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      disabled={onClick ? future : undefined}
      onClick={onClick}
      style={bg ? { background: bg } : undefined}
      className={clsx(
        'relative flex items-center justify-center overflow-hidden rounded-2xl text-sm transition',
        size === 'grid' ? 'aspect-square active:scale-95' : 'h-16 w-16',
        bg ? 'border border-black/10' : marked ? 'border border-accent/50 bg-accent/15' : 'bg-card2/70',
        today && 'ring-2 ring-accent',
        future && 'opacity-30',
      )}
    >
      {marked && emojis.length > 0 ? (
        <>
          <span className="absolute left-1.5 top-1 text-[10px] font-medium leading-none" style={{ color: ink ?? 'var(--hint)' }}>
            {num}
          </span>
          <span className={clsx('flex items-center justify-center pt-1.5 leading-none', emojis.length > 1 ? 'gap-0.5 text-[15px]' : 'text-xl')}>
            {emojis.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </span>
        </>
      ) : (
        <span className={clsx(bg && 'text-sm font-bold')} style={ink ? { color: ink } : undefined}>
          {num}
        </span>
      )}
    </Tag>
  )
}


function LookBadge({ look, size = 40 }: { look: MarkLook; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-card2 text-2xl"
      style={{ width: size, height: size, ...(look.color ? { background: look.color } : {}) }}
    >
      {look.emoji}
    </span>
  )
}


export default function CalendarPage() {
  const now = useMemo(() => new Date(), [])
  const todayS = dateStr(now)
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const month = monthStr(new Date(cursor.y, cursor.m, 1))
  const isCurrent = month === monthStr(now)
  const q = useLoad(() => api.diary(month), [month], `diary:${month}`)
  const toast = useToast()
  const [sheet, setSheet] = useState<{ day: string; edit?: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const lastMark = useRef<Mark>(getLastMark())

  const simple = useAuth((u) => u.user?.app_mode === 'simple')
  const goalsQ = useLoad(() => (simple ? api.goals() : Promise.resolve([])), [simple], simple ? 'goals' : 'goals-none')

  const data = q.data
  const marksBy = useMemo(() => {
    const m = new Map<string, DiaryEntry[]>()
    for (const e of [...(data?.entries ?? [])].sort(bySlot)) m.set(e.day, [...(m.get(e.day) ?? []), e])
    return m
  }, [data])
  const workoutsBy = useMemo(() => {
    const m = new Map<string, DiaryWorkout[]>()
    for (const w of data?.workouts ?? []) m.set(w.day, [...(m.get(w.day) ?? []), w])
    return m
  }, [data])


  const counts = useMemo(() => {
    const kinds = new Map<string, number>()
    const custom = new Map<string, { look: MarkLook; n: number }>()
    const trainingDays = new Set<string>()
    for (const e of data?.entries ?? []) {
      if (e.kind === 'custom') {
        const look = markLook(e)
        const key = `${look.emoji}|${look.color}|${look.label}`
        custom.set(key, { look, n: (custom.get(key)?.n ?? 0) + 1 })
      } else {
        kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
        trainingDays.add(e.day)
      }
    }
    for (const w of data?.workouts ?? []) {
      if (!trainingDays.has(w.day)) {
        kinds.set('strength', (kinds.get('strength') ?? 0) + 1)
        trainingDays.add(w.day)
      }
    }
    return { kinds, custom: [...custom.values()] }
  }, [data])

  if (q.loading && !data) return <Spinner />
  if (q.error && !data) return <ErrorBox message={q.error} onRetry={q.reload} />
  if (!data) return null


  const patch = (fn: (d: DiaryMonth) => DiaryMonth) =>
    q.setData((prev) => {
      if (!prev) return prev
      const next = fn(prev)

      const days = new Set([...next.entries.filter((e) => e.counts).map((e) => e.day), ...next.workouts.map((w) => w.day)])
      return { ...next, marked_days: days.size }
    })

  const mark = async (day: string, slot: number, m: Mark, note: string | null) => {
    setErr(null)
    lastMark.current = m
    saveLastMark(m)
    haptic.success()
    const optimistic: DiaryEntry = {
      id: -1, day, slot, kind: m.kind, subtype: m.subtype ?? null, emoji: m.emoji ?? null, color: m.color ?? null,
      label: m.label ?? null, counts: m.kind === 'custom' ? !!m.counts : true, note,
    }
    patch((d) => ({ ...d, entries: [...d.entries.filter((e) => !(e.day === day && e.slot === slot)), optimistic].sort(bySlot) }))
    try {
      await api.markDay(day, { ...m, slot, note })
      cacheDrop('goals')
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить')
      haptic.error()
      await q.reload()
    }
  }

  const unmark = async (day: string, slot: number) => {
    setErr(null)
    haptic.tap()
    patch((d) => ({ ...d, entries: d.entries.filter((e) => !(e.day === day && e.slot === slot)) }))
    try {
      await api.unmarkDay(day, slot)
      cacheDrop('goals')
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось убрать отметку')
      await q.reload()
    }
  }

  const deleteWorkout = async (id: number) => {
    setErr(null)
    patch((d) => ({ ...d, workouts: d.workouts.filter((w) => w.id !== id) }))
    try {
      await api.discardSession(id)
      cacheDrop('dashboard', 'plan', 'overview', 'history', 'progress', 'goals')
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось удалить тренировку')
      await q.reload()
    }
  }


  const first = new Date(cursor.y, cursor.m, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const dayStr = (d: number) => dateStr(new Date(cursor.y, cursor.m, d))

  const move = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1)
    if (d > new Date(now.getFullYear(), now.getMonth(), 1)) return
    haptic.select()
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  const todayMarks = marksBy.get(todayS) ?? []
  const todayWorkouts = isCurrent ? workoutsBy.get(todayS) : undefined
  const sheetDay = sheet?.day
  const lastLook = markLook({ kind: lastMark.current.kind, subtype: lastMark.current.subtype ?? null, emoji: lastMark.current.emoji ?? null, color: lastMark.current.color ?? null, label: lastMark.current.label ?? null })

  return (
    <div className="space-y-4">
      <Toast message={toast.msg} />

      <div className="flex items-center justify-between">
        <button onClick={() => move(-1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-card2" aria-label="Предыдущий месяц">
          <Icon name="left" size={20} />
        </button>
        <h1 className="text-xl font-bold">
          {MONTHS[cursor.m]} {cursor.y}
        </h1>
        <button
          onClick={() => move(1)}
          disabled={isCurrent}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card2 disabled:opacity-30"
          aria-label="Следующий месяц"
        >
          <Icon name="right" size={20} />
        </button>
      </div>

      {err && <ErrorBox message={err} />}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="дней в месяце" value={data.marked_days} />
        <Stat label="серия, нед." value={data.streak.current} />
        <Stat label="эта неделя" value={`${Math.min(data.streak.this_week, data.streak.weekly_goal)}/${data.streak.weekly_goal}`} />
      </div>

      {(counts.kinds.size > 0 || counts.custom.length > 0) && (
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          {KINDS.filter((k) => counts.kinds.has(k.key)).map((k) => (
            <span key={k.key} className="rounded-full border border-line bg-card px-3 py-1">
              {k.emoji} {k.label}: <b>{counts.kinds.get(k.key)}</b>
            </span>
          ))}
          {counts.kinds.has('home') && (
            <span className="rounded-full border border-line bg-card px-3 py-1">
              🏠 Дома: <b>{counts.kinds.get('home')}</b>
            </span>
          )}
          {counts.custom.map(({ look, n }) => (
            <span key={`${look.emoji}|${look.color}|${look.label}`} className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1">
              {look.color && <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: look.color }} />}
              {look.emoji} {look.label}: <b>{n}</b>
            </span>
          ))}
        </div>
      )}

      {simple && (
        <Link to="/goals" className="block">
          {(goalsQ.data ?? []).filter((g) => !g.achieved).length > 0 ? (
            <div className="space-y-2">
              {(goalsQ.data ?? [])
                .filter((g) => !g.achieved)
                .slice(0, 2)
                .map((g) => (
                  <GoalCard key={g.id} g={g} compact />
                ))}
            </div>
          ) : (
            <Card className="flex items-center gap-3 !py-3">
              <span className="text-2xl">🎯</span>
              <span className="text-sm text-hint">
                {goalsQ.data && goalsQ.data.length > 0 ? 'Все цели достигнуты. Поставьте новую!' : 'Поставьте цель: например, 12 тренировок в месяц или вес.'}
              </span>
            </Card>
          )}
        </Link>
      )}

      {isCurrent &&
        (todayMarks.length > 0 || todayWorkouts?.length ? (
          <Card onClick={() => setSheet({ day: todayS })} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-hint">Сегодня</div>
              <div className="truncate font-semibold">
                {todayMarks.length > 0
                  ? todayMarks.map((m) => {
                      const l = markLook(m)
                      return `${l.emoji} ${l.label}`.trim()
                    }).join(' · ')
                  : todayWorkouts?.[0].name}
              </div>
            </div>
            <Icon name="right" size={20} className="shrink-0 text-hint" />
          </Card>
        ) : (
          <div className="space-y-1.5">
            <Button
              full
              className="!py-4 text-lg"
              onClick={async () => {
                await mark(todayS, 0, lastMark.current, null)
                toast.show('Записано')
              }}
            >
              Отметить сегодня
            </Button>
            <div className="flex items-center justify-between px-1 text-xs text-hint">
              <span>
                {lastLook.emoji} {lastLook.label}
              </span>
              <button className="text-brand" onClick={() => setSheet({ day: todayS, edit: true })}>
                выбрать другую отметку
              </button>
            </div>
          </div>
        ))}

      <Card className="!p-3">
        <div className="mb-2 grid grid-cols-7 text-center text-xs text-hint">
          {WEEK.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />
            const ds = dayStr(d)
            const face = dayFace(marksBy.get(ds) ?? [], workoutsBy.has(ds))
            return (
              <DayTile
                key={ds}
                num={d}
                {...face}
                today={ds === todayS}
                future={ds > todayS}
                onClick={() => {
                  haptic.select()
                  setSheet({ day: ds })
                }}
              />
            )
          })}
        </div>
      </Card>

      <p className="text-center text-xs text-hint">
        Нажмите на день: можно поставить до двух отметок: тип тренировки, свой смайлик или закрасить день цветом.
      </p>

      {sheet && sheetDay && (
        <DaySheet
          key={sheetDay}
          day={sheetDay}
          startEdit={sheet.edit}
          marks={marksBy.get(sheetDay) ?? []}
          workouts={workoutsBy.get(sheetDay) ?? []}
          defaultMark={lastMark.current}
          onClose={() => setSheet(null)}
          onSave={async (slot, m, note) => {
            setSheet(null)
            await mark(sheetDay, slot, m, note)
          }}
          onRemoveMark={(slot) => unmark(sheetDay, slot)}
          onDeleteWorkout={deleteWorkout}
        />
      )}
    </div>
  )
}


function WorkoutRecord({ w, onDelete }: { w: DiaryWorkout; onDelete: (id: number) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const detail = useLoad(() => (open ? api.session(w.id) : Promise.resolve(null)), [open, w.id], open ? `session:${w.id}` : undefined)

  const byExercise = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of detail.data?.sets ?? []) {
      m.set(s.exercise.name, [...(m.get(s.exercise.name) ?? []), `${fmtNum(s.weight)}×${s.reps}`])
    }
    return [...m.entries()]
  }, [detail.data])

  const remove = async () => {
    if (!(await confirmAction(`Удалить тренировку «${w.name}» вместе с подходами? Это нельзя отменить.`))) return
    await onDelete(w.id)
  }

  return (
    <Card className="!p-3.5">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((v) => !v)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-brand">
          <Icon name="dumbbell" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{w.name}</span>
          <span className="block text-xs text-hint">
            {w.sets} подх. · {fmtNum(w.volume)} кг{w.minutes ? ` · ${w.minutes} мин` : ''}
          </span>
        </span>
        {w.feeling && <span className="text-xl">{FEELINGS[w.feeling - 1]}</span>}
        <Icon name={open ? 'up' : 'down'} size={18} className="text-hint" />
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {detail.loading && !detail.data && <p className="text-sm text-hint">Загрузка</p>}
          {byExercise.map(([name, sets]) => (
            <div key={name} className="text-sm">
              <div className="font-medium">{name}</div>
              <div className="text-hint">{sets.join(' · ')}</div>
            </div>
          ))}
          {w.note && <p className="whitespace-pre-wrap rounded-xl bg-card2 p-2.5 text-sm">{w.note}</p>}
          <Button variant="danger" full className="!py-2.5 text-sm" onClick={remove}>
            Удалить тренировку
          </Button>
        </div>
      )}
    </Card>
  )
}


function DaySheet(props: {
  day: string
  startEdit?: boolean
  marks: DiaryEntry[]
  workouts: DiaryWorkout[]
  defaultMark: Mark
  onClose: () => void
  onSave: (slot: number, m: Mark, note: string | null) => void
  onRemoveMark: (slot: number) => Promise<void>
  onDeleteWorkout: (id: number) => Promise<void>
}) {
  const { day, marks, workouts } = props
  const hasRecords = marks.length > 0 || workouts.length > 0
  const freeSlot = [0, 1].find((s) => !marks.some((m) => m.slot === s))

  const [edit, setEdit] = useState<{ slot: number } | null>(props.startEdit ? { slot: freeSlot ?? 0 } : null)
  const [viewOnly, setViewOnly] = useState(false)
  const editing = edit !== null || (!hasRecords && !viewOnly)
  const editSlot = edit?.slot ?? freeSlot ?? 0
  const date = new Date(`${day}T12:00:00`)

  const header = (
    <div className="mb-4">
      <h2 className="text-xl font-bold">
        {date.getDate()} {MONTHS_GEN[date.getMonth()]}
      </h2>
      <p className="text-sm text-hint">{WEEKDAYS_FULL[date.getDay()]}</p>
    </div>
  )

  if (!editing) {
    return (
      <Modal onClose={props.onClose}>
        {header}
        <div className="space-y-3">
          {marks.map((m) => {
            const look = markLook(m)
            return (
              <Card key={m.slot} className="!p-3.5">
                <div className="flex items-center gap-3">
                  <LookBadge look={look} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{look.label}</div>
                    <div className="text-xs text-hint">
                      {look.custom ? `Своя отметка${m.counts ? ' · считается тренировкой' : ''}` : 'Отметка в дневнике'}
                    </div>
                  </div>
                </div>
                {m.note && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-card2 p-2.5 text-sm">{m.note}</p>}
                <div className="mt-3 flex gap-2">
                  <Button variant="ghost" className="flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm" onClick={() => setEdit({ slot: m.slot })}>
                    <Icon name="edit" size={16} /> Изменить
                  </Button>
                  <Button
                    variant="danger"
                    className="flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm"
                    onClick={async () => {
                      await props.onRemoveMark(m.slot)
                      if (marks.length === 1 && workouts.length === 0) props.onClose()
                    }}
                  >
                    <Icon name="trash" size={16} /> Убрать
                  </Button>
                </div>
              </Card>
            )
          })}

          {workouts.map((w) => (
            <WorkoutRecord
              key={w.id}
              w={w}
              onDelete={async (id) => {
                await props.onDeleteWorkout(id)
                if (marks.length === 0 && workouts.length === 1) props.onClose()
              }}
            />
          ))}

          {freeSlot !== undefined ? (
            <Button variant="ghost" full className="flex items-center justify-center gap-2" onClick={() => setEdit({ slot: freeSlot })}>
              <Icon name="plus" size={18} /> {marks.length === 0 ? 'Добавить отметку' : 'Добавить вторую отметку'}
            </Button>
          ) : (
            <p className="text-center text-xs text-hint">В один день помещается две отметки. Чтобы поставить другую, измените или уберите одну из них.</p>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={props.onClose}>
      {header}
      <MarkEditor
        key={editSlot}
        day={day}
        entry={marks.find((m) => m.slot === editSlot)}
        otherMark={marks.find((m) => m.slot !== editSlot)}
        defaultMark={props.defaultMark}
        canCancel={hasRecords}
        onCancel={() => {
          setEdit(null)
          setViewOnly(true)
        }}
        onSave={(m, note) => props.onSave(editSlot, m, note)}
      />
    </Modal>
  )
}

type Tab = 'type' | 'emoji' | 'color'


function MarkEditor(props: {
  day: string
  entry?: DiaryEntry
  otherMark?: DiaryEntry
  defaultMark: Mark
  canCancel: boolean
  onCancel: () => void
  onSave: (m: Mark, note: string | null) => void
}) {
  const { entry } = props

  const start: Mark = entry
    ? { kind: entry.kind === 'home' ? 'other' : entry.kind, subtype: entry.kind === 'home' ? null : entry.subtype, emoji: entry.emoji, color: entry.color, label: entry.label, counts: entry.counts }
    : props.defaultMark
  const startTab: Tab = start.kind === 'custom' ? (start.emoji ? 'emoji' : 'color') : 'type'

  const [tab, setTab] = useState<Tab>(startTab)
  const [kind, setKind] = useState<DiaryKind>(start.kind === 'custom' ? 'strength' : start.kind)
  const [subtype, setSubtype] = useState<string | null>(start.kind === 'custom' ? null : (start.subtype ?? null))
  const [emoji, setEmoji] = useState(start.kind === 'custom' ? (start.emoji ?? '') : '')
  const [color, setColor] = useState<string | null>(start.kind === 'custom' ? (start.color ?? null) : null)
  const [label, setLabel] = useState(start.kind === 'custom' ? (start.label ?? '') : '')
  const [counts, setCounts] = useState(entry?.kind === 'custom' ? entry.counts : false)
  const [note, setNote] = useState(entry?.note ?? '')
  const info = kindInfo(kind)

  const canSave = tab === 'type' || (tab === 'emoji' && !!emoji) || (tab === 'color' && !!color)

  const save = () => {
    const n = note.trim() || null
    if (tab === 'type') return props.onSave({ kind, subtype }, n)
    if (tab === 'emoji') return props.onSave({ kind: 'custom', emoji, label: label.trim() || null, counts }, n)
    props.onSave({ kind: 'custom', color, label: label.trim() || null, counts }, n)
  }


  const other = props.otherMark ? markLook(props.otherMark) : null
  const previewFills = [tab === 'color' ? color : null, other?.color].filter((c): c is string => !!c)
  const previewEmoji = [tab === 'emoji' ? emoji : tab === 'type' ? markEmoji(kind, subtype) : '', other?.emoji].filter((e): e is string => !!e)
  const dayNum = new Date(`${props.day}T12:00:00`).getDate()

  return (
    <>
      <Segmented
        className="mb-4"
        value={tab}
        options={[
          { value: 'type', label: 'Тренировка' },
          { value: 'emoji', label: 'Смайлик' },
          { value: 'color', label: 'Цвет' },
        ]}
        onChange={(t) => {
          haptic.select()
          setTab(t)
        }}
      />

      {tab === 'type' && (
        <>
          <div className="mb-1.5 text-sm text-hint">Вид тренировки</div>
          <div className="mb-4 grid grid-cols-5 gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.key}
                onClick={() => {
                  haptic.select()
                  if (k.key !== kind) {
                    setKind(k.key)
                    setSubtype(null)
                  }
                }}
                className={clsx('rounded-2xl px-1 py-2.5 text-[11px] font-medium leading-tight', kind === k.key ? 'bg-accent text-accent-fg' : 'bg-card2')}
              >
                <div className="text-2xl">{k.emoji}</div>
                {k.label}
              </button>
            ))}
          </div>

          <div className="mb-1.5 text-sm text-hint">{info.question} (по желанию)</div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {info.subs.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  haptic.select()
                  setSubtype(subtype === s.key ? null : s.key)
                }}
                className={clsx(
                  'flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm',
                  subtype === s.key ? 'bg-accent text-accent-fg' : 'bg-card2',
                )}
              >
                <span className="text-xl">{s.emoji}</span>
                <span className="leading-tight">{s.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab !== 'type' && (
        <div className="mb-4 flex items-center gap-4">
          <DayTile size="preview" num={dayNum} fills={previewFills} emojis={previewEmoji.slice(0, 2)} marked={previewFills.length > 0 || previewEmoji.length > 0} />
          <p className="text-xs text-hint">
            Так день будет выглядеть в календаре{other ? ' вместе со второй отметкой' : ''}.
          </p>
        </div>
      )}

      {tab === 'emoji' && (
        <>
          <div className="mb-1.5 text-sm text-hint">Любой смайлик: выберите ниже или вставьте свой с клавиатуры</div>
          <div className="mb-3 flex items-center gap-2">
            <input
              className={clsx(inputCls, 'w-24 text-center text-2xl')}
              value={emoji}
              placeholder="🙂"
              onChange={(e) => setEmoji(firstGrapheme(e.target.value))}
              aria-label="Свой смайлик"
            />
            {emoji && (
              <button className="text-sm text-hint underline" onClick={() => setEmoji('')}>
                очистить
              </button>
            )}
          </div>
          <div className="mb-4 space-y-3">
            {EMOJI_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="mb-1 text-xs uppercase tracking-wide text-hint">{g.title}</div>
                <div className="grid grid-cols-8 gap-1">
                  {g.items.map((e) => (
                    <button
                      key={e}
                      onClick={() => {
                        haptic.select()
                        setEmoji(e)
                      }}
                      className={clsx('flex aspect-square items-center justify-center rounded-xl text-2xl', emoji === e ? 'bg-accent/30 ring-2 ring-accent' : 'bg-card2')}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'color' && (
        <>
          <div className="mb-1.5 text-sm text-hint">Цвет дня</div>
          <div className="mb-4 grid grid-cols-6 gap-2">
            {PALETTE.map((p) => (
              <button
                key={p.color}
                aria-label={p.name}
                aria-pressed={color === p.color}
                onClick={() => {
                  haptic.select()
                  setColor(p.color)
                }}
                className={clsx(
                  'flex aspect-square items-center justify-center rounded-full border border-black/10 transition active:scale-95',
                  color === p.color && 'ring-2 ring-fg ring-offset-2 ring-offset-bg',
                )}
                style={{ background: p.color }}
              >
                {color === p.color && <Icon name="check" size={18} strokeWidth={3} style={{ color: textOn(p.color) }} />}
              </button>
            ))}
            {                                                          }
            <label
              className={clsx(
                'relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-full border border-line',
                color && !PALETTE.some((p) => p.color === color) && 'ring-2 ring-fg ring-offset-2 ring-offset-bg',
              )}
              style={{
                background:
                  color && !PALETTE.some((p) => p.color === color)
                    ? color
                    : 'conic-gradient(#ff6b6b, #ffd84a, #4ade80, #5ea8ff, #b794ff, #ff6fb5, #ff6b6b)',
              }}
              aria-label="Свой цвет"
            >
              <input
                type="color"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={color ?? '#ff6fb5'}
                onChange={(e) => setColor(e.target.value.toLowerCase())}
              />
            </label>
          </div>
          {color && (
            <button className="mb-4 text-sm text-hint underline" onClick={() => setColor(null)}>
              сбросить цвет
            </button>
          )}
        </>
      )}

      {tab !== 'type' && (
        <>
          <input
            className={clsx(inputCls, 'mb-3')}
            placeholder="Название отметки (по желанию), например «Отпуск»"
            value={label}
            maxLength={30}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-card2 p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Считать тренировкой</div>
              <div className="text-xs text-hint">Войдёт в серию недель и в цель на неделю</div>
            </div>
            <Toggle on={counts} onChange={setCounts} label="Считать тренировкой" />
          </div>
        </>
      )}

      <textarea
        className={clsx(inputCls, 'mb-4 min-h-[88px] resize-none')}
        placeholder="Заметка: как прошло, что делали"
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
      />

      <Button full disabled={!canSave} onClick={save}>
        {entry ? 'Сохранить' : 'Поставить отметку'}
      </Button>
      {props.canCancel && (
        <Button variant="ghost" full className="mt-2" onClick={props.onCancel}>
          Отмена
        </Button>
      )}
    </>
  )
}
