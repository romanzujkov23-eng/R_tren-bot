import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { api, type MuscleLoad, type MuscleMap, type MuscleRegion } from '../services/api'
import { haptic } from '../utils/telegram'
import { periodOf } from '../utils/periods'
import BodyMapPro, { type ProCell, type ProMode } from './BodyMapPro'
import { ALIASES, MUSCLES } from './BodyMap'
import { Ring, headline } from './MuscleFill'
import { anatomicalName } from './bodyAnatomy'
import Icon from './Icon'
import { Card, ErrorBox, Spinner, fmtNum, useLoad } from './ui'

/* ───────── модель ───────── */

interface Row {
  name: string
  sets: number
  assist: number
  load: number
  target: number | null
  progress: number | null
  last_days: number | null
  extra: boolean
  hints: string[]
}

const GROUPS: { key: string; label: string; muscles: string[] }[] = [
  { key: 'chest', label: 'Грудь', muscles: ['Грудные'] },
  { key: 'back', label: 'Спина', muscles: ['Широчайшие', 'Ромбовидные', 'Трапеции', 'Разгибатели спины'] },
  { key: 'shoulders', label: 'Плечи', muscles: ['Передние дельты', 'Средние дельты', 'Задние дельты'] },
  { key: 'arms', label: 'Руки', muscles: ['Бицепс', 'Трицепс', 'Плечевая мышца', 'Предплечья'] },
  { key: 'core', label: 'Кор', muscles: ['Пресс', 'Косые мышцы живота'] },
  { key: 'legs', label: 'Ноги', muscles: ['Квадрицепс', 'Бицепс бедра', 'Ягодичные', 'Приводящие', 'Икры'] },
]
const groupOf = (name: string) => GROUPS.find((g) => g.muscles.includes(name))?.label ?? ''

const BALANCES = [
  {
    title: 'Жим и тяга', leftName: 'Жим', rightName: 'Тяга',
    a: ['Грудные', 'Передние дельты', 'Средние дельты', 'Трицепс'],
    b: ['Широчайшие', 'Ромбовидные', 'Задние дельты', 'Бицепс', 'Плечевая мышца', 'Трапеции'],
    tipA: 'Жимов заметно больше тяг. Добавьте тяги и гребли, чтобы уберечь плечи.',
    tipB: 'Тяг заметно больше жимов. Добавьте жимовые движения на грудь и плечи.',
  },
  {
    title: 'Верх и низ', leftName: 'Верх', rightName: 'Низ',
    a: ['Грудные', 'Трапеции', 'Широчайшие', 'Ромбовидные', 'Передние дельты', 'Средние дельты', 'Задние дельты', 'Бицепс', 'Трицепс', 'Плечевая мышца', 'Предплечья'],
    b: ['Квадрицепс', 'Бицепс бедра', 'Ягодичные', 'Приводящие', 'Икры'],
    tipA: 'Верх тела получает намного больше нагрузки. Не забывайте про ноги.',
    tipB: 'Ноги получают намного больше нагрузки. Добавьте упражнения на верх тела.',
  },
  {
    title: 'Передняя и задняя цепь', leftName: 'Перед', rightName: 'Зад',
    a: ['Грудные', 'Передние дельты', 'Бицепс', 'Пресс', 'Косые мышцы живота', 'Квадрицепс'],
    b: ['Трапеции', 'Ромбовидные', 'Широчайшие', 'Задние дельты', 'Трицепс', 'Разгибатели спины', 'Ягодичные', 'Бицепс бедра'],
    tipA: 'Передняя сторона тела перегружена относительно задней. Добавьте тяги, ягодичные и бицепс бедра.',
    tipB: 'Задняя цепь работает заметно больше передней. Добавьте грудные, пресс и квадрицепс.',
  },
]

const lastText = (d: number) => (d === 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} дн. назад`)

function statusOf(r: Row, goal: boolean): { label: string; cls: string } {
  if (goal && r.progress !== null) {
    if (r.progress >= 1) return { label: 'закрыта', cls: 'bg-accent text-accent-fg' }
    if (r.load > 0) return { label: 'в работе', cls: 'bg-accent/25 text-fg' }
    return { label: 'не тронута', cls: 'bg-hint/15 text-hint' }
  }
  if (r.load <= 0) return { label: 'не тронута', cls: 'bg-hint/15 text-hint' }
  return { label: 'в работе', cls: 'bg-accent/25 text-fg' }
}

/* ───────── части мышц ───────── */

type ViewMode = ProMode | 'detail'
const fmt1 = (n: number) => fmtNum(Math.round(n * 10) / 10)

function detailCells(rows: Row[], regions: MuscleRegion[]) {
  const split = new Set(regions.map((r) => r.parent))
  const top = Math.max(0.0001, ...regions.map((r) => r.load), ...rows.filter((r) => !split.has(r.name)).map((r) => r.load))
  const regionCells: Record<string, ProCell> = {}
  for (const r of regions) regionCells[r.name] = { value: r.load / top }
  const cells: Record<string, ProCell> = {}
  for (const r of rows) cells[r.name] = { value: r.load / top, extra: r.extra }
  return { cells, regionCells }
}

function RegionInfo({ region, all }: { region: MuscleRegion; all: MuscleRegion[] }) {
  const others = all.filter((r) => r.parent === region.parent && r.name !== region.name)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <b>{region.parent}</b>
          <span className="ml-1.5 text-sm">{anatomicalName(region.name)}</span>
        </span>
        <span className="shrink-0 text-xs text-hint">{Math.round(region.share * 100)}% нагрузки на мышцу</span>
      </div>
      <div className="text-hint">
        {region.load > 0 ? `${fmt1(region.load)} подходов приходится на эту часть.` : 'Эта часть пока не получала нагрузки.'}
        {others.length > 0 && ` Остальное: ${others.map((o) => `${o.part} ${Math.round(o.share * 100)}%`).join(', ')}.`}
      </div>
    </div>
  )
}

function Detail({ r, goal }: { r: Row; goal: boolean }) {
  const st = statusOf(r, goal)
  const hasGoal = goal && r.progress !== null && r.target !== null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <b>{r.name}</b>
          <span className="ml-1.5 text-xs text-hint">{groupOf(r.name)}</span>
        </span>
        <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold', st.cls)}>{st.label}</span>
      </div>
      {hasGoal && (
        <div className="h-2 overflow-hidden rounded-full bg-bg">
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round((r.progress ?? 0) * 100)}%` }} />
        </div>
      )}
      <div className="text-hint">
        {hasGoal ? `${fmtNum(r.load)} из ${fmtNum(r.target!)} подходов` : `${fmtNum(r.load)} подходов`}
        {` · ${r.sets} основных, ${r.assist} вспомогательных`}
        {r.last_days !== null && ` · последний раз ${lastText(r.last_days)}`}
      </div>
      {r.extra && <div className="text-hint">Мышцы нет в программе: нагрузка добавлена к плану как дополнительная.</div>}
      {hasGoal && r.progress! < 1 && r.hints.length > 0 && <div>Закроют: {r.hints.join(', ')}</div>}
    </div>
  )
}

/* ───────── мелкие элементы ───────── */

function Pills<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={clsx('rounded-full px-3.5 py-1.5 text-xs font-semibold transition', value === o.value ? 'bg-accent text-accent-fg' : 'bg-card2 text-hint')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="!p-0">
      <button className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-1.5 text-xs text-hint">
          {hint}
          <Icon name={open ? 'up' : 'down'} size={16} />
        </span>
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </Card>
  )
}

function Legend({ mode }: { mode: ViewMode }) {
  return mode === 'fill' ? (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-hint">
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-hint/30" />пусто</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent/50" />в процессе</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent" />закрыта</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-dashed border-accent" />доп.</span>
    </div>
  ) : (
    <div className="flex items-center gap-2 px-2 text-[11px] text-hint">
      <span>меньше</span>
      <span className="h-1.5 flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, rgb(var(--accent-rgb) / 0.2), rgb(var(--accent-rgb)))' }} />
      <span>больше</span>
    </div>
  )
}

/* ───────── карта ───────── */

function MapCard({
  head, mode, setMode, modes, cells, regionCells, regions, selected, onSelect, info, children,
}: {
  head?: ReactNode
  mode: ViewMode
  setMode: (m: ViewMode) => void
  modes: { value: ViewMode; label: string }[]
  cells: Record<string, ProCell>
  regionCells: Record<string, ProCell>
  regions: MuscleRegion[]
  selected: string | null
  onSelect: (name: string) => void
  info: ReactNode
  children?: ReactNode
}) {
  const [side, setSide] = useState<'front' | 'back'>('front')
  const detail = mode === 'detail'
  const selRegion = regions.find((r) => r.name === selected)
  const siblings = selRegion ? regions.filter((r) => r.parent === selRegion.parent) : []

  return (
    <Card className="space-y-3 !px-3">
      {head}
      <Pills value={mode} options={modes} onChange={setMode} />

      <div className="rounded-2xl" style={{ background: 'radial-gradient(60% 45% at 50% 42%, rgb(var(--accent-rgb) / 0.10), transparent 75%)' }}>
        <BodyMapPro
          cells={cells}
          regionCells={detail ? regionCells : undefined}
          mode={mode === 'fill' ? 'fill' : 'heat'}
          view={detail ? side : 'both'}
          selected={selected}
          onSelect={onSelect}
          height={detail ? 560 : 380}
        />
      </div>

      {detail && (
        <Pills
          value={side}
          options={[{ value: 'front', label: 'Спереди' }, { value: 'back', label: 'Сзади' }]}
          onChange={(v) => setSide(v)}
        />
      )}
      <Legend mode={mode} />

      <div className="mx-1 min-h-[4.25rem] rounded-2xl bg-card2 px-3.5 py-3 text-sm">{info}</div>

      {detail && siblings.length > 1 && (
        <div className="mx-1 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-hint">{selRegion!.parent}:</span>
          {siblings.map((r) => (
            <button
              key={r.name}
              onClick={() => onSelect(r.name)}
              className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', selected === r.name ? 'bg-accent text-accent-fg' : 'bg-card2 text-hint')}
            >
              {r.part}
            </button>
          ))}
        </div>
      )}
      {children}
    </Card>
  )
}

/* ───────── аналитика ───────── */

function GroupSummary({ rows, goal }: { rows: Row[]; goal: boolean }) {
  const by = new Map(rows.map((r) => [r.name, r]))
  const total = rows.reduce((s, r) => s + r.load, 0) || 1
  return (
    <div className="grid grid-cols-3 gap-2">
      {GROUPS.map((g) => {
        const rs = g.muscles.map((m) => by.get(m)).filter((r): r is Row => !!r)
        const withTarget = rs.filter((r) => r.progress !== null)
        const load = rs.reduce((s, r) => s + r.load, 0)
        const pct =
          goal && withTarget.length
            ? Math.round((withTarget.reduce((s, r) => s + (r.progress ?? 0), 0) / withTarget.length) * 100)
            : Math.round((load / total) * 100)
        return (
          <div key={g.key} className="rounded-2xl border border-line bg-card px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-hint">{g.label}</span>
              <span className="text-base font-bold tabular-nums">{pct}<span className="text-[10px] font-medium text-hint">%</span></span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card2">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function balanceItems(rows: Row[]) {
  const by = new Map(rows.map((r) => [r.name, r.load]))
  const sum = (names: string[]) => names.reduce((s, n) => s + (by.get(n) ?? 0), 0)
  const items = BALANCES.map((b) => {
    const a = sum(b.a)
    const t = a + sum(b.b)
    return { ...b, t, pct: t > 0 ? Math.round((a / t) * 100) : 50 }
  })
  return items.some((i) => i.t > 0) ? items : null
}

function Balance({ rows }: { rows: Row[] }) {
  const items = balanceItems(rows)
  if (!items) return null
  return (
    <div className="space-y-4">
      {items.map((i) => {
        const skew = i.t >= 6 && (i.pct >= 70 || i.pct <= 30)
        return (
          <div key={i.title}>
            <div className="mb-1.5 text-xs font-medium">{i.title}</div>
            <div className="relative flex h-2.5 overflow-hidden rounded-full bg-card2">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${i.t ? i.pct : 0}%` }} />
              <div className="h-full bg-hint/40 transition-all duration-500" style={{ width: `${i.t ? 100 - i.pct : 0}%` }} />
              <i className="absolute left-1/2 top-0 h-full w-px bg-bg/70" />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-hint">
              <span>{i.leftName} {i.t ? `${i.pct}%` : '-'}</span>
              <span>{i.t ? `${100 - i.pct}%` : '-'} {i.rightName}</span>
            </div>
            {skew && <p className="mt-1 text-xs">{i.pct >= 70 ? i.tipA : i.tipB}</p>}
          </div>
        )
      })}
    </div>
  )
}

function recoveryCols(rows: Row[]) {
  const worked = rows.filter((r) => r.load > 0 && r.last_days !== null)
  return [
    { title: 'Отдыхают', hint: 'нагружены сегодня или вчера', list: worked.filter((r) => r.last_days! <= 1) },
    { title: 'Готовы', hint: '2-4 дня отдыха', list: worked.filter((r) => r.last_days! >= 2 && r.last_days! <= 4) },
    { title: 'Давно без нагрузки', hint: '5 дней и больше', list: worked.filter((r) => r.last_days! >= 5) },
  ].filter((c) => c.list.length > 0)
}

function Recovery({ rows, onPick, selected }: { rows: Row[]; onPick: (n: string) => void; selected: string | null }) {
  return (
    <div className="space-y-3">
      {recoveryCols(rows).map((c) => (
        <div key={c.title}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium">{c.title}</span>
            <span className="text-hint">{c.hint}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.list.map((r) => (
              <button
                key={r.name}
                onClick={() => onPick(r.name)}
                className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', selected === r.name ? 'bg-accent text-accent-fg' : 'bg-card2 text-hint')}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RegionBreakdown({ regions, selected, onPick }: { regions: MuscleRegion[]; selected: string | null; onPick: (n: string) => void }) {
  const parents = [...new Set(regions.map((r) => r.parent))]
  const groups = parents
    .map((p) => ({ p, list: regions.filter((r) => r.parent === p) }))
    .filter((g) => g.list.some((r) => r.load > 0))
  const shade = [1, 0.62, 0.36]
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.p}>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium">{g.p}</span>
            <span className="text-xs tabular-nums text-hint">{fmt1(g.list.reduce((s, r) => s + r.load, 0))} подх.</span>
          </div>
          <div className="flex h-2.5 gap-px overflow-hidden rounded-full bg-card2">
            {g.list.map((r, i) => (
              <button
                key={r.name}
                aria-label={r.part}
                onClick={() => onPick(r.name)}
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${r.share * 100}%`, opacity: shade[i] ?? 0.3 }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {g.list.map((r, i) => (
              <button
                key={r.name}
                onClick={() => onPick(r.name)}
                className={clsx('flex items-center gap-1.5 text-[11px]', selected === r.name ? 'font-semibold text-fg' : 'text-hint')}
              >
                <i className="h-2 w-2 rounded-full bg-accent" style={{ opacity: shade[i] ?? 0.3 }} />
                {r.part} {Math.round(r.share * 100)}%
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-hint">
        Распределение по частям мышцы оценивается по типу упражнения: наклон скамьи, хват, положение корпуса. Это расчёт, а не измерение.
      </p>
    </div>
  )
}

function Table({ rows, goal, selected, onPick, periodText }: { rows: Row[]; goal: boolean; selected: string | null; onPick: (n: string) => void; periodText?: string }) {
  const by = new Map(rows.map((r) => [r.name, r]))
  const top = Math.max(1, ...rows.map((r) => r.load))
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <div key={g.key}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-hint">{g.label}</div>
          <div className="space-y-2.5">
            {g.muscles.map((m) => {
              const r = by.get(m)
              if (!r) return null
              const st = statusOf(r, goal)
              const width = goal && r.progress !== null ? r.progress * 100 : (r.load / top) * 100
              return (
                <button key={m} className="block w-full text-left" onClick={() => onPick(m)}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className={clsx('truncate', selected === m && 'font-semibold')}>
                      {m}
                      {r.extra && <span className="ml-1.5 text-[10px] font-medium uppercase text-hint">доп.</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-hint">
                        {goal && r.target ? `${fmtNum(r.load)} / ${fmtNum(r.target)}` : `${fmtNum(r.load)} подх.`}
                      </span>
                      <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold', st.cls)}>{st.label}</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-card2">
                    <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.max(r.load > 0 ? 3 : 0, Math.min(width, 100))}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-hint">
        Основные мышцы считаются полным подходом, вспомогательные половиной. Кардио не учитывается.
        {goal ? ' Пометка «доп.» у мышц, которых нет в программе: нагрузка на них тоже засчитана.' : ''}
        {periodText ? ` Данные ${periodText}.` : ''}
      </p>
    </div>
  )
}

/** Подробные блоки свёрнуты: на экране карта и сводка, остальное по нажатию. */
function Analytics({ rows, regions, goal, selected, onPick, periodText }: { rows: Row[]; regions: MuscleRegion[]; goal: boolean; selected: string | null; onPick: (n: string) => void; periodText?: string }) {
  const hasBalance = !!balanceItems(rows)
  const rec = recoveryCols(rows)
  const hasRegions = regions.some((r) => r.load > 0)
  return (
    <>
      <GroupSummary rows={rows} goal={goal} />
      {hasBalance && <Fold title="Баланс нагрузки" hint="жим/тяга, верх/низ"><Balance rows={rows} /></Fold>}
      {rec.length > 0 && <Fold title="Восстановление" hint={`${rec.reduce((s, c) => s + c.list.length, 0)} мышц`}><Recovery rows={rows} onPick={onPick} selected={selected} /></Fold>}
      {hasRegions && <Fold title="Части мышц" hint="головки и отделы"><RegionBreakdown regions={regions} selected={selected} onPick={onPick} /></Fold>}
      <Fold title="Все мышцы" hint={String(rows.length)}><Table rows={rows} goal={goal} selected={selected} onPick={onPick} periodText={periodText} /></Fold>
    </>
  )
}

/* ───────── карта недели / круга ───────── */

export function MuscleFillPro({ scope }: { scope: 'week' | 'cycle' }) {
  const q = useLoad(() => api.muscleMap(scope), [scope], `overview:map:${scope}`)
  const [mode, setMode] = useState<ViewMode>('fill')
  const [selected, setSelected] = useState<string | null>(null)
  const data: MuscleMap | null = q.data
  const regions = useMemo(() => data?.regions ?? [], [data])

  const rows: Row[] = useMemo(
    () =>
      (data?.muscles ?? []).map((m) => ({
        name: m.name, sets: m.sets, assist: m.assist, load: m.load, target: m.progress === null ? null : m.target,
        progress: m.progress, last_days: m.last_days, extra: !!m.extra, hints: m.hints,
      })),
    [data],
  )
  const detail = useMemo(() => detailCells(rows, regions), [rows, regions])
  const cells = useMemo(() => {
    if (mode === 'detail') return detail.cells
    const top = Math.max(1, ...rows.map((r) => r.load))
    const out: Record<string, ProCell> = {}
    for (const r of rows) {
      out[r.name] = mode === 'fill' ? { value: r.progress ?? -1, extra: r.extra } : { value: r.load / top, extra: r.extra }
    }
    return out
  }, [rows, mode, detail])

  if (q.loading && !data) return <Spinner />
  if (q.error && !data) return <ErrorBox message={q.error} onRetry={q.reload} />
  if (!data) return null
  if (scope === 'cycle' && data.scope !== 'cycle') {
    return (
      <Card className="text-center text-sm text-hint">
        Круг считается по активной программе. Выберите программу в разделе «План», и карта будет заполняться по её кругу.
      </Card>
    )
  }

  const head = headline(data)
  const picked = rows.find((r) => r.name === selected)
  const pickedRegion = regions.find((r) => r.name === selected)
  const complete = data.total > 0 && data.filled === data.total
  const open = rows.filter((r) => r.progress !== null && r.progress < 1).sort((a, b) => b.target! - b.load - (a.target! - a.load))
  const pick = (name: string) => {
    haptic.select()
    setSelected((cur) => (cur === name ? null : name))
  }

  let info: ReactNode
  if (pickedRegion) info = <RegionInfo region={pickedRegion} all={regions} />
  else if (picked) info = <Detail r={picked} goal />
  else if (mode === 'detail') info = <p className="text-hint">Нажмите на часть мышцы. Спереди и сзади переключаются кнопками под картой.</p>
  else if (complete) info = <p className="font-semibold">Карта заполнена: все {data.total} мышц закрыты.</p>
  else if (data.next_workout && data.next_workout.muscles.length > 0)
    info = <p>Следующая тренировка «{data.next_workout.name}» продвинет: <b>{data.next_workout.muscles.join(', ')}</b>.</p>
  else info = <p className="text-hint">Нажмите на мышцу на карте, чтобы увидеть подробности.</p>

  return (
    <div className="space-y-3">
      <MapCard
        head={
          <div className="flex items-center gap-3 px-1">
            <Ring percent={data.percent} />
            <div className="min-w-0">
              <div className="font-semibold leading-tight">{head.title}</div>
              <div className="mt-0.5 text-xs text-hint">{head.text}</div>
              <div className="mt-1 text-sm">
                <b>{data.filled}</b>
                <span className="text-hint"> из {data.total} мышц закрыто</span>
                {data.prev_percent !== null && data.scope === 'week' && <span className="text-hint"> · прошлая неделя {data.prev_percent}%</span>}
              </div>
            </div>
          </div>
        }
        mode={mode}
        setMode={(m) => {
          setMode(m)
          setSelected(null)
        }}
        modes={[{ value: 'fill', label: 'Прогресс' }, { value: 'heat', label: 'Нагрузка' }, ...(regions.length ? [{ value: 'detail' as const, label: 'Детально' }] : [])]}
        cells={cells}
        regionCells={detail.regionCells}
        regions={regions}
        selected={selected}
        onSelect={pick}
        info={info}
      >
        {mode !== 'detail' && open.length > 0 && (
          <div className="mx-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-hint">Осталось:</span>
            {open.map((m) => (
              <button
                key={m.name}
                onClick={() => pick(m.name)}
                className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', selected === m.name ? 'bg-accent text-accent-fg' : 'bg-card2 text-hint')}
              >
                {m.name} · {fmtNum(Math.max(0, m.target! - m.load))}
              </button>
            ))}
          </div>
        )}
        {data.source === 'default' && (
          <p className="mx-1 text-xs text-hint">
            Цель по умолчанию: около 8 подходов на крупную мышцу и 4 на малую. Запустите программу, и цели подстроятся под неё.
          </p>
        )}
      </MapCard>
      <Analytics rows={rows} regions={regions} goal selected={selected} onPick={pick} />
    </div>
  )
}

/* ───────── карта за период ───────── */

function periodRows(muscles: MuscleLoad[]): Row[] {
  const acc = new Map<string, Row>(
    MUSCLES.map((m) => [m, { name: m, sets: 0, assist: 0, load: 0, target: null, progress: null, last_days: null, extra: false, hints: [] }]),
  )
  for (const it of muscles) {
    const names = ALIASES[it.name] ?? (acc.has(it.name) ? [it.name] : [])
    for (const n of names) {
      const r = acc.get(n)!
      r.sets += it.sets / names.length
      r.assist += it.assist / names.length
      r.load += it.load / names.length
      r.last_days = r.last_days === null ? it.last_days : Math.min(r.last_days, it.last_days)
    }
  }
  return [...acc.values()].map((r) => ({ ...r, sets: Math.round(r.sets), assist: Math.round(r.assist) }))
}

export function MusclePeriodPro({ muscles, regions = [], weeks }: { muscles: MuscleLoad[]; regions?: MuscleRegion[]; weeks: number }) {
  const [mode, setMode] = useState<ViewMode>('heat')
  const [selected, setSelected] = useState<string | null>(null)
  const rows = useMemo(() => periodRows(muscles), [muscles])
  const text = periodOf(weeks).text
  const detail = useMemo(() => detailCells(rows, regions), [rows, regions])
  const cells = useMemo(() => {
    if (mode === 'detail') return detail.cells
    const top = Math.max(0, ...rows.map((r) => r.load))
    const out: Record<string, ProCell> = {}
    for (const r of rows) out[r.name] = { value: mode === 'heat' ? (top ? r.load / top : 0) : r.load > 0 ? 1 : 0 }
    return out
  }, [rows, mode, detail])
  const missed = rows.filter((r) => r.load <= 0)
  const picked = rows.find((r) => r.name === selected)
  const pickedRegion = regions.find((r) => r.name === selected)
  const pick = (name: string) => {
    haptic.select()
    setSelected((cur) => (cur === name ? null : name))
  }

  let info: ReactNode
  if (pickedRegion) info = <RegionInfo region={pickedRegion} all={regions} />
  else if (picked) info = <Detail r={picked} goal={false} />
  else if (mode === 'detail') info = <p className="text-hint">Нажмите на часть мышцы. Спереди и сзади переключаются кнопками под картой.</p>
  else
    info = (
      <div className="flex items-center gap-3">
        <div className="text-3xl font-bold leading-none">
          {MUSCLES.length - missed.length}
          <span className="text-base font-medium text-hint">/{MUSCLES.length}</span>
        </div>
        <p className="text-sm text-hint">{muscles.length ? `мышц в работе ${text}. Нажмите на мышцу для подробностей.` : `Нагрузки ${text} нет.`}</p>
      </div>
    )

  return (
    <div className="space-y-3">
      <MapCard
        mode={mode}
        setMode={(m) => {
          setMode(m)
          setSelected(null)
        }}
        modes={[{ value: 'heat', label: 'Нагрузка' }, { value: 'fill', label: 'Охват' }, ...(regions.length ? [{ value: 'detail' as const, label: 'Детально' }] : [])]}
        cells={cells}
        regionCells={detail.regionCells}
        regions={regions}
        selected={selected}
        onSelect={pick}
        info={info}
      >
        {mode !== 'detail' && muscles.length > 0 && missed.length > 0 && (
          <div className="mx-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-hint">Забыли:</span>
            {missed.map((m) => (
              <button
                key={m.name}
                onClick={() => pick(m.name)}
                className={clsx('rounded-full px-2.5 py-1 text-xs font-medium', selected === m.name ? 'bg-danger text-bg' : 'bg-danger/15 text-danger')}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </MapCard>
      {muscles.length > 0 && <Analytics rows={rows} regions={regions} goal={false} selected={selected} onPick={pick} periodText={text} />}
    </div>
  )
}
