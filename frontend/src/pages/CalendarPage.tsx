import { memo, useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { api, type DiaryEntry, type DiaryKind, type DiaryMonth, type DiaryWorkout, type MarkInput, type WorkoutLookInput } from '../services/api'
import { Button, Card, ErrorBox, Feeling, Modal, Segmented, PageSkeleton, Toast, Toggle, fmtNum, inputCls, useLoad, useToast } from '../components/ui'
import Icon from '../components/Icon'
import MarkGlyph from '../components/MarkGlyph'
import { GoalRow } from '../components/GoalCard'
import { useAuth } from '../stores/authStore'
import { Link } from 'react-router-dom'
import { cacheDrop } from '../utils/cache'
import { fmtSetLine, measureOf } from '../utils/measure'
import { confirmAction, haptic } from '../utils/telegram'
import { MONTHS, MONTHS_GEN, WEEKDAYS_FULL, dateStr, monthStr } from '../utils/dates'
import {
  EMOJI_GROUPS, KINDS, PALETTE, fillBackground, firstGrapheme, glyphKey, kindInfo, markGlyph, markLook, textOn, type Glyph, type MarkLook,
} from '../utils/diaryTypes'

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MAX_TRAININGS = 2
const MAX_SLOTS = 3

type Mark = Omit<MarkInput, 'slot' | 'note'>
type MarkMode = 'training' | 'color'

const getLastMark = (): Mark => {
  try {
    const v = JSON.parse(localStorage.getItem('tb:lastMark') ?? 'null') as Mark | null
    if (v && v.kind === 'custom' && (v.emoji || v.color)) return v
    if (v && KINDS.some((k) => k.key === v.kind)) return v
  } catch {}
  return { kind: 'strength', subtype: null }
}
const saveLastMark = (m: Mark) => {
  try {
    localStorage.setItem('tb:lastMark', JSON.stringify(m))
  } catch {}
}

const bySlot = (a: DiaryEntry, b: DiaryEntry) => a.day.localeCompare(b.day) || a.slot - b.slot

const isColorOnly = (e: Pick<DiaryEntry, 'kind' | 'color' | 'emoji'>) => e.kind === 'custom' && !!e.color && !e.emoji

const workoutGlyph = (w: DiaryWorkout): Glyph =>
  w.emoji ? { icon: null, emoji: w.emoji } : markGlyph(w.kind ?? 'strength', w.subtype)

function dayFace(marks: DiaryEntry[], workouts: DiaryWorkout[]) {
  const looks = marks.map(markLook)
  const fills = looks.map((l) => l.color).filter((c): c is string => !!c)
  const glyphs = [...workouts.map(workoutGlyph), ...looks.map((l) => l.glyph).filter((g) => glyphKey(g))]
  return { fills, glyphs, marked: marks.length > 0 || workouts.length > 0 }
}

const EMPTY_FACE = dayFace([], [])

function DayTile({
  num, fills, glyphs, marked, today, selected, future, size = 'grid', onClick,
}: {
  num: number | string
  fills: string[]
  glyphs: Glyph[]
  marked: boolean
  today?: boolean
  selected?: boolean
  future?: boolean
  size?: 'grid' | 'preview'
  onClick?: () => void
}) {
  const bg = fillBackground(fills)
  const ink = fills.length ? textOn(fills[0]) : undefined
  const shown = glyphs.slice(0, 2)
  const extra = glyphs.length - shown.length
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
        selected ? 'ring-2 ring-fg ring-offset-1 ring-offset-bg' : today && 'ring-2 ring-accent',
        future && 'opacity-30',
      )}
    >
      {marked && shown.length > 0 ? (
        <>
          <span className="absolute left-1.5 top-1 text-[10px] font-medium leading-none" style={{ color: ink ?? 'var(--hint)' }}>
            {num}
          </span>
          <span
            className={clsx('flex items-center justify-center pt-1.5 leading-none', shown.length > 1 ? 'gap-1' : '', !ink && 'text-brand')}
            style={ink ? { color: ink } : undefined}
          >
            {shown.map((g, i) => (
              <MarkGlyph key={i} g={g} size={shown.length > 1 ? 17 : 24} />
            ))}
          </span>
          {extra > 0 && (
            <span className="absolute bottom-1 right-1.5 text-[9px] font-bold leading-none" style={{ color: ink ?? 'var(--hint)' }}>
              +{extra}
            </span>
          )}
        </>
      ) : (
        <span className={clsx(bg && 'text-sm font-bold')} style={ink ? { color: ink } : undefined}>
          {num}
        </span>
      )}
    </Tag>
  )
}

const GridCell = memo(function GridCell({
  day, num, face, today, selected, future, onSelect,
}: {
  day: string
  num: number
  face: ReturnType<typeof dayFace>
  today: boolean
  selected: boolean
  future: boolean
  onSelect: (day: string) => void
}) {
  return (
    <DayTile
      num={num}
      {...face}
      today={today}
      selected={selected}
      future={future}
      onClick={() => onSelect(day)}
    />
  )
})

function LookBadge({ look, size = 40 }: { look: MarkLook; size?: number }) {
  return (
    <span
      className={clsx('flex shrink-0 items-center justify-center rounded-xl bg-card2', !look.custom && 'text-brand')}
      style={{ width: size, height: size, ...(look.color ? { background: look.color } : {}) }}
    >
      <MarkGlyph g={look.glyph} size={24} />
    </span>
  )
}

export default function CalendarPage() {
  const now = useMemo(() => new Date(), [])
  const todayS = dateStr(now)
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selected, setSelected] = useState(todayS)
  const month = monthStr(new Date(cursor.y, cursor.m, 1))
  const isCurrent = month === monthStr(now)
  const q = useLoad(() => api.diary(month), [month], `diary:${month}`)
  const toast = useToast()
  const [editor, setEditor] = useState<
    { type: 'mark'; day: string; slot: number; mode: MarkMode } | { type: 'look'; id: number } | null
  >(null)
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

  const faces = useMemo(() => {
    const m = new Map<string, ReturnType<typeof dayFace>>()
    const days = new Set([...marksBy.keys(), ...workoutsBy.keys()])
    for (const d of days) m.set(d, dayFace(marksBy.get(d) ?? [], workoutsBy.get(d) ?? []))
    return m
  }, [marksBy, workoutsBy])

  const selectDay = useCallback((ds: string) => {
    haptic.select()
    setSelected(ds)
  }, [])

  const counts = useMemo(() => {
    const kinds = new Map<string, number>()
    const custom = new Map<string, { look: MarkLook; n: number }>()
    const addCustom = (look: MarkLook) => {
      const key = `${glyphKey(look.glyph)}|${look.color}|${look.label}`
      custom.set(key, { look, n: (custom.get(key)?.n ?? 0) + 1 })
    }
    for (const e of data?.entries ?? []) {
      if (e.kind === 'custom') addCustom(markLook(e))
      else kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
    }
    for (const w of data?.workouts ?? []) {
      if (w.emoji) addCustom({ glyph: { icon: null, emoji: w.emoji }, color: null, label: 'Тренировка', custom: true })
      else {
        const k = w.kind ?? 'strength'
        kinds.set(k, (kinds.get(k) ?? 0) + 1)
      }
    }
    return { kinds, custom: [...custom.values()] }
  }, [data])

  if (q.loading && !data) return <PageSkeleton variant="calendar" />
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

  const setWorkoutLook = async (id: number, look: WorkoutLookInput) => {
    setErr(null)
    haptic.success()
    patch((d) => ({
      ...d,
      workouts: d.workouts.map((w) =>
        w.id === id ? { ...w, kind: look.kind ?? null, subtype: look.subtype ?? null, emoji: look.emoji ?? null } : w,
      ),
    }))
    try {
      await api.setWorkoutLook(id, look)
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить значок')
      haptic.error()
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
    setSelected(monthStr(d) === monthStr(now) ? todayS : dateStr(d))
  }

  const selMarks = marksBy.get(selected) ?? []
  const selWorkouts = workoutsBy.get(selected) ?? []
  const lastLook = markLook({ kind: lastMark.current.kind, subtype: lastMark.current.subtype ?? null, emoji: lastMark.current.emoji ?? null, color: lastMark.current.color ?? null, label: lastMark.current.label ?? null })

  const chipCls = 'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-card2 px-2.5 py-1 text-xs'
  const hasCounts = counts.kinds.size > 0 || counts.custom.length > 0

  const editingMark = editor?.type === 'mark' ? editor : null
  const editingLook = editor?.type === 'look' ? (data.workouts.find((w) => w.id === editor.id) ?? null) : null

  return (
    <div className="space-y-3">
      <Toast message={toast.msg} />

      <div className="flex items-center justify-between">
        <button onClick={() => move(-1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-card2" aria-label="Предыдущий месяц">
          <Icon name="left" size={20} />
        </button>
        <h1 className="text-xl font-bold">
          {MONTHS[cursor.m]} {cursor.y}
        </h1>
        <button
          onClick={() => move(1)}
          disabled={isCurrent}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card2 disabled:opacity-30"
          aria-label="Следующий месяц"
        >
          <Icon name="right" size={20} />
        </button>
      </div>

      {err && <ErrorBox message={err} />}

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
            return (
              <GridCell
                key={ds}
                day={ds}
                num={d}
                face={faces.get(ds) ?? EMPTY_FACE}
                today={ds === todayS}
                selected={ds === selected}
                future={ds > todayS}
                onSelect={selectDay}
              />
            )
          })}
        </div>
      </Card>

      <DayPanel
        key={selected}
        day={selected}
        isToday={selected === todayS}
        marks={selMarks}
        workouts={selWorkouts}
        lastLook={lastLook}
        onQuick={async () => {
          await mark(selected, 0, lastMark.current, null)
          toast.show('Записано')
        }}
        onAdd={(mode, slot) => setEditor({ type: 'mark', day: selected, slot, mode })}
        onEdit={(m) => setEditor({ type: 'mark', day: selected, slot: m.slot, mode: isColorOnly(m) ? 'color' : 'training' })}
        onRemoveMark={(slot) => unmark(selected, slot)}
        onDeleteWorkout={deleteWorkout}
        onEditLook={(w) => setEditor({ type: 'look', id: w.id })}
      />

      <Card className="!p-0">
        <div className="grid grid-cols-3 divide-x divide-line py-3 text-center">
          <div>
            <div className="text-xl font-bold leading-tight">{data.marked_days}</div>
            <div className="text-xs text-hint">дней в месяце</div>
          </div>
          <div>
            <div className="text-xl font-bold leading-tight">{data.streak.current}</div>
            <div className="text-xs text-hint">серия, нед.</div>
          </div>
          <div>
            <div className="text-xl font-bold leading-tight">{`${Math.min(data.streak.this_week, data.streak.weekly_goal)}/${data.streak.weekly_goal}`}</div>
            <div className="text-xs text-hint">эта неделя</div>
          </div>
        </div>
        {hasCounts && (
          <div className="flex gap-1.5 overflow-x-auto border-t border-line px-3 py-2.5">
            {KINDS.filter((k) => counts.kinds.has(k.key)).map((k) => (
              <span key={k.key} className={chipCls}>
                <MarkGlyph g={{ icon: k.icon, emoji: '' }} size={14} className="text-brand" /> {k.label} <b>{counts.kinds.get(k.key)}</b>
              </span>
            ))}
            {counts.kinds.has('home') && (
              <span className={chipCls}>
                <Icon name="home" size={14} className="text-brand" /> Дома <b>{counts.kinds.get('home')}</b>
              </span>
            )}
            {counts.custom.map(({ look, n }) => (
              <span key={`${glyphKey(look.glyph)}|${look.color}|${look.label}`} className={chipCls}>
                {look.color && <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: look.color }} />}
                <MarkGlyph g={look.glyph} size={14} /> {look.label} <b>{n}</b>
              </span>
            ))}
          </div>
        )}
      </Card>

      {simple && (
        <Link to="/goals" className="block">
          {(goalsQ.data ?? []).filter((g) => !g.achieved).length > 0 ? (
            <Card className="divide-y divide-line !p-0">
              {(goalsQ.data ?? [])
                .filter((g) => !g.achieved)
                .slice(0, 2)
                .map((g) => (
                  <GoalRow key={g.id} g={g} />
                ))}
            </Card>
          ) : (
            <Card className="flex items-center gap-3 !py-3">
              <Icon name="target" size={26} className="shrink-0 text-brand" />
              <span className="text-sm text-hint">
                {goalsQ.data && goalsQ.data.length > 0 ? 'Все цели достигнуты. Поставьте новую!' : 'Поставьте цель.'}
              </span>
            </Card>
          )}
        </Link>
      )}

      {editingMark && (
        <Modal onClose={() => setEditor(null)}>
          <DayHeading day={editingMark.day} />
          <MarkEditor
            key={`${editingMark.slot}:${editingMark.mode}`}
            day={editingMark.day}
            mode={editingMark.mode}
            slot={editingMark.slot}
            entry={marksBy.get(editingMark.day)?.find((m) => m.slot === editingMark.slot)}
            others={(marksBy.get(editingMark.day) ?? []).filter((m) => m.slot !== editingMark.slot)}
            workouts={workoutsBy.get(editingMark.day) ?? []}
            defaultMark={lastMark.current}
            onCancel={() => setEditor(null)}
            onSave={async (m, note) => {
              const { day, slot } = editingMark
              setEditor(null)
              await mark(day, slot, m, note)
            }}
          />
        </Modal>
      )}

      {editingLook && (
        <Modal onClose={() => setEditor(null)}>
          <DayHeading day={editingLook.day} />
          <WorkoutLookEditor
            w={editingLook}
            onCancel={() => setEditor(null)}
            onSave={async (look) => {
              setEditor(null)
              await setWorkoutLook(editingLook.id, look)
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function DayHeading({ day }: { day: string }) {
  const date = new Date(`${day}T12:00:00`)
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold">
        {date.getDate()} {MONTHS_GEN[date.getMonth()]}
      </h2>
      <p className="text-sm text-hint">{WEEKDAYS_FULL[date.getDay()]}</p>
    </div>
  )
}

function WorkoutRecord({
  w, onDelete, onEditLook,
}: {
  w: DiaryWorkout
  onDelete: (id: number) => Promise<void>
  onEditLook: (w: DiaryWorkout) => void
}) {
  const [open, setOpen] = useState(false)
  const detail = useLoad(() => (open ? api.session(w.id) : Promise.resolve(null)), [open, w.id], open ? `session:${w.id}` : undefined)

  const byExercise = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of detail.data?.sets ?? []) {
      m.set(s.exercise.name, [...(m.get(s.exercise.name) ?? []), fmtSetLine(s, measureOf(s.exercise))])
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
          <MarkGlyph g={workoutGlyph(w)} size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{w.name}</span>
          <span className="block text-xs text-hint">
            {w.sets} подх. · {fmtNum(w.volume)} кг{w.minutes ? ` · ${w.minutes} мин` : ''}
          </span>
        </span>
        {w.feeling && <Feeling n={w.feeling} size={22} />}
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
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button variant="ghost" className="flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm" onClick={() => onEditLook(w)}>
          <Icon name="edit" size={16} /> Значок
        </Button>
        <Button variant="danger" className="flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm" onClick={remove}>
          <Icon name="trash" size={16} /> Удалить
        </Button>
      </div>
    </Card>
  )
}

function DayPanel(props: {
  day: string
  isToday: boolean
  marks: DiaryEntry[]
  workouts: DiaryWorkout[]
  lastLook: MarkLook
  onQuick: () => void
  onAdd: (mode: MarkMode, slot: number) => void
  onEdit: (m: DiaryEntry) => void
  onRemoveMark: (slot: number) => Promise<void>
  onDeleteWorkout: (id: number) => Promise<void>
  onEditLook: (w: DiaryWorkout) => void
}) {
  const { day, marks, workouts } = props
  const date = new Date(`${day}T12:00:00`)
  const empty = marks.length === 0 && workouts.length === 0
  const freeSlot = Array.from({ length: MAX_SLOTS }, (_, i) => i).find((s) => !marks.some((m) => m.slot === s))
  const trainings = marks.filter((m) => !isColorOnly(m)).length
  const canAddTraining = freeSlot !== undefined && trainings < MAX_TRAININGS
  const canAddColor = freeSlot !== undefined && !marks.some((m) => !!m.color)

  return (
    <Card className="!p-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">
          {props.isToday ? 'Сегодня, ' : ''}
          {date.getDate()} {MONTHS_GEN[date.getMonth()]}
        </h2>
        <span className="text-xs text-hint">{WEEKDAYS_FULL[date.getDay()]}</span>
      </div>

      <div className="space-y-3">
        {empty && (
          <div className="space-y-1.5">
            <Button full onClick={props.onQuick}>
              {props.isToday ? 'Отметить сегодня' : 'Отметить день'}
            </Button>
            <div className="flex items-center justify-between px-1 text-xs text-hint">
              <span className="inline-flex items-center gap-1.5">
                <MarkGlyph g={props.lastLook.glyph} size={16} className={props.lastLook.custom ? '' : 'text-brand'} />
                {props.lastLook.label}
              </span>
              <button className="font-medium text-brand" onClick={() => props.onAdd('training', freeSlot ?? 0)}>
                выбрать другую отметку
              </button>
            </div>
          </div>
        )}

        {marks.map((m) => {
          const look = markLook(m)
          return (
            <div key={m.slot} className="rounded-2xl bg-card2/60 p-3">
              <div className="flex items-center gap-3">
                <LookBadge look={look} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{look.label}</div>
                  <div className="text-xs text-hint">
                    {isColorOnly(m)
                      ? `Цвет дня${m.counts ? ' · считается тренировкой' : ''}`
                      : look.custom
                        ? `Своя отметка${m.counts ? ' · считается тренировкой' : ''}`
                        : 'Отметка в дневнике'}
                  </div>
                </div>
              </div>
              {m.note && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-card p-2.5 text-sm">{m.note}</p>}
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" className="flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm" onClick={() => props.onEdit(m)}>
                  <Icon name="edit" size={16} /> Изменить
                </Button>
                <Button
                  variant="danger"
                  className="flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm"
                  onClick={() => props.onRemoveMark(m.slot)}
                >
                  <Icon name="trash" size={16} /> Убрать
                </Button>
              </div>
            </div>
          )
        })}

        {workouts.map((w) => (
          <WorkoutRecord key={w.id} w={w} onDelete={props.onDeleteWorkout} onEditLook={props.onEditLook} />
        ))}

        {freeSlot !== undefined && (
          <div className="flex gap-2">
            {canAddTraining && !empty && (
              <Button variant="ghost" full className="flex items-center justify-center gap-2" onClick={() => props.onAdd('training', freeSlot)}>
                <Icon name="plus" size={18} /> Тренировка
              </Button>
            )}
            {canAddColor && (
              <Button variant="ghost" full className="flex items-center justify-center gap-2" onClick={() => props.onAdd('color', freeSlot)}>
                <Icon name="plus" size={18} /> Цвет дня
              </Button>
            )}
          </div>
        )}
        {!empty && !canAddTraining && !canAddColor && (
          <p className="text-center text-xs text-hint">В день можно две отметки тренировки и цвет.</p>
        )}
      </div>
    </Card>
  )
}

type Tab = 'type' | 'emoji' | 'color'

function KindPicker(props: { kind: DiaryKind; subtype: string | null; onChange: (kind: DiaryKind, subtype: string | null) => void }) {
  const { kind, subtype } = props
  const info = kindInfo(kind)
  return (
    <>
      <div className="mb-1.5 text-sm text-hint">Вид тренировки</div>
      <div className="mb-4 grid grid-cols-5 gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => {
              haptic.select()
              if (k.key !== kind) props.onChange(k.key, null)
            }}
            className={clsx('rounded-2xl px-1 py-2.5 text-[11px] font-medium leading-tight', kind === k.key ? 'bg-accent text-accent-fg' : 'bg-card2')}
          >
            <div className="mb-1 flex justify-center">
              <MarkGlyph g={{ icon: k.icon, emoji: '' }} size={26} className={kind === k.key ? '' : 'text-brand'} />
            </div>
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
              props.onChange(kind, subtype === s.key ? null : s.key)
            }}
            className={clsx(
              'flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm',
              subtype === s.key ? 'bg-accent text-accent-fg' : 'bg-card2',
            )}
          >
            <MarkGlyph g={{ icon: s.icon, emoji: '' }} size={22} className={subtype === s.key ? '' : 'text-brand'} />
            <span className="leading-tight">{s.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function EmojiPicker({ emoji, onChange }: { emoji: string; onChange: (e: string) => void }) {
  return (
    <>
      <div className="mb-1.5 text-sm text-hint">Выберите ниже или вставьте свой</div>
      <div className="mb-3 flex items-center gap-2">
        <input
          className={clsx(inputCls, 'w-24 text-center text-2xl')}
          value={emoji}
          placeholder="🙂"
          onChange={(e) => onChange(firstGrapheme(e.target.value))}
          aria-label="Свой смайлик"
        />
        {emoji && (
          <button className="text-sm text-hint underline" onClick={() => onChange('')}>
            очистить
          </button>
        )}
      </div>
      <div className="mb-4 space-y-3">
        {EMOJI_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 text-xs text-hint">{g.title}</div>
            <div className="grid grid-cols-8 gap-1">
              {g.items.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    haptic.select()
                    onChange(e)
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
  )
}

function WorkoutLookEditor(props: { w: DiaryWorkout; onCancel: () => void; onSave: (look: WorkoutLookInput) => void }) {
  const { w } = props
  const [tab, setTab] = useState<'type' | 'emoji'>(w.emoji ? 'emoji' : 'type')
  const [kind, setKind] = useState<DiaryKind>(w.kind ?? 'strength')
  const [subtype, setSubtype] = useState<string | null>(w.subtype)
  const [emoji, setEmoji] = useState(w.emoji ?? '')

  const save = () => props.onSave(tab === 'emoji' ? { emoji } : { kind, subtype })

  return (
    <>
      <p className="mb-3 truncate text-sm text-hint">Значок тренировки «{w.name}»</p>
      <Segmented
        className="mb-4"
        value={tab}
        options={[
          { value: 'type', label: 'Вид' },
          { value: 'emoji', label: 'Смайлик' },
        ]}
        onChange={(t) => {
          haptic.select()
          setTab(t)
        }}
      />
      {tab === 'type' ? (
        <KindPicker
          kind={kind}
          subtype={subtype}
          onChange={(k, s) => {
            setKind(k)
            setSubtype(s)
          }}
        />
      ) : (
        <EmojiPicker emoji={emoji} onChange={setEmoji} />
      )}
      <Button full disabled={tab === 'emoji' && !emoji} onClick={save}>
        Сохранить
      </Button>
      <Button variant="ghost" full className="mt-2" onClick={props.onCancel}>
        Отмена
      </Button>
    </>
  )
}

function MarkEditor(props: {
  day: string
  mode: MarkMode
  slot: number
  entry?: DiaryEntry
  others: DiaryEntry[]
  workouts: DiaryWorkout[]
  defaultMark: Mark
  onCancel: () => void
  onSave: (m: Mark, note: string | null) => void
}) {
  const { entry, mode } = props

  const base: Mark = entry
    ? { kind: entry.kind === 'home' ? 'other' : entry.kind, subtype: entry.kind === 'home' ? null : entry.subtype, emoji: entry.emoji, color: entry.color, label: entry.label, counts: entry.counts }
    : props.defaultMark
  const start: Mark = !entry && mode === 'color' ? { kind: 'custom', color: null } : base
  const startTab: Tab = mode === 'color' ? 'color' : start.kind === 'custom' && start.emoji ? 'emoji' : 'type'

  const [tab, setTab] = useState<Tab>(startTab)
  const [kind, setKind] = useState<DiaryKind>(start.kind === 'custom' ? 'strength' : start.kind)
  const [subtype, setSubtype] = useState<string | null>(start.kind === 'custom' ? null : (start.subtype ?? null))
  const [emoji, setEmoji] = useState(start.kind === 'custom' ? (start.emoji ?? '') : '')
  const [color, setColor] = useState<string | null>(start.kind === 'custom' ? (start.color?.toLowerCase() ?? null) : null)
  const [label, setLabel] = useState(start.kind === 'custom' ? (start.label ?? '') : '')
  const [counts, setCounts] = useState(entry?.kind === 'custom' ? entry.counts : false)
  const [note, setNote] = useState(entry?.note ?? '')
  const keepColor = tab === 'emoji' && entry?.kind === 'custom' && entry.emoji ? entry.color : null

  const canSave = tab === 'type' || (tab === 'emoji' && !!emoji) || (tab === 'color' && !!color)

  const save = () => {
    const n = note.trim() || null
    if (tab === 'type') return props.onSave({ kind, subtype }, n)
    if (tab === 'emoji') return props.onSave({ kind: 'custom', emoji, color: keepColor, label: label.trim() || null, counts }, n)
    props.onSave({ kind: 'custom', color, label: label.trim() || null, counts }, n)
  }

  const candidate: DiaryEntry = {
    id: -1, day: props.day, slot: props.slot, note: null, counts: true,
    kind: tab === 'type' ? kind : 'custom',
    subtype: tab === 'type' ? subtype : null,
    emoji: tab === 'emoji' ? emoji : null,
    color: tab === 'color' ? color : keepColor,
    label: null,
  }
  const face = dayFace([...props.others, candidate].sort((a, b) => a.slot - b.slot), props.workouts)
  const dayNum = new Date(`${props.day}T12:00:00`).getDate()
  const hasOthers = props.others.length > 0 || props.workouts.length > 0

  return (
    <>
      {mode === 'training' && (
        <Segmented
          className="mb-4"
          value={tab}
          options={[
            { value: 'type', label: 'Тренировка' },
            { value: 'emoji', label: 'Смайлик' },
          ]}
          onChange={(t) => {
            haptic.select()
            setTab(t)
          }}
        />
      )}

      {tab === 'type' && (
        <KindPicker
          kind={kind}
          subtype={subtype}
          onChange={(k, s) => {
            setKind(k)
            setSubtype(s)
          }}
        />
      )}

      {tab !== 'type' && (
        <div className="mb-4 flex items-center gap-4">
          <DayTile size="preview" num={dayNum} fills={face.fills} glyphs={face.glyphs} marked={face.fills.length > 0 || face.glyphs.length > 0} />
          <p className="text-xs text-hint">
            Так день будет выглядеть в календаре{hasOthers ? ' вместе с остальными отметками' : ''}.
          </p>
        </div>
      )}

      {tab === 'emoji' && <EmojiPicker emoji={emoji} onChange={setEmoji} />}

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
            {color && !PALETTE.some((p) => p.color === color) && (
              <button
                aria-label="Выбранный цвет"
                aria-pressed
                className="flex aspect-square items-center justify-center rounded-full border border-black/10 ring-2 ring-fg ring-offset-2 ring-offset-bg"
                style={{ background: color }}
              >
                <Icon name="check" size={18} strokeWidth={3} style={{ color: textOn(color) }} />
              </button>
            )}
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
      <Button variant="ghost" full className="mt-2" onClick={props.onCancel}>
        Отмена
      </Button>
    </>
  )
}
