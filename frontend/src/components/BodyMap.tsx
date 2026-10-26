import { useId } from 'react'
import clsx from 'clsx'
import { BACK, BASE, DETAILS_BACK, DETAILS_FRONT, FRONT, HEAD, NECK, type Part } from './bodyShapes'

export const MUSCLES = [
  'Трапеции', 'Передние дельты', 'Средние дельты', 'Задние дельты', 'Грудные', 'Широчайшие', 'Ромбовидные',
  'Бицепс', 'Трицепс', 'Плечевая мышца', 'Предплечья', 'Пресс', 'Косые мышцы живота', 'Разгибатели спины',
  'Сгибатели бедра', 'Ягодичные', 'Квадрицепс', 'Бицепс бедра', 'Приводящие', 'Икры',
] as const

export const ALIASES: Record<string, string[]> = {
  Спина: ['Широчайшие', 'Ромбовидные', 'Трапеции', 'Разгибатели спины'],
  Ноги: ['Квадрицепс', 'Бицепс бедра', 'Ягодичные', 'Икры'],
  Плечи: ['Передние дельты', 'Средние дельты', 'Задние дельты'],
  Руки: ['Бицепс', 'Трицепс', 'Предплечья'],
}

const KNOWN = new Set<string>(MUSCLES)

const expandMuscle = (name: string): string[] => ALIASES[name] ?? (KNOWN.has(name) ? [name] : [])

export function muscleValues(items: { name: string; weight: number }[]): Record<string, number> {
  const raw: Record<string, number> = {}
  for (const it of items) {
    const targets = expandMuscle(it.name)
    for (const t of targets) raw[t] = (raw[t] ?? 0) + it.weight / targets.length
  }
  const max = Math.max(0, ...Object.values(raw))
  if (max === 0) return {}
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / max]))
}

export type BodyMapMode = 'heat' | 'gaps' | 'fill'

const MIRROR = 'translate(100 0) scale(-1 1)'
const PLAIN = 'translate(100 0)'
const OUTLINE = 'rgb(var(--line-rgb))'
const BASE_FILL = 'rgb(var(--card2-rgb))'
const SEAM = 'rgb(var(--card-rgb))'

function fillFor(v: number, mode: BodyMapMode, dim: boolean): string {
  if (mode === 'fill') {
    if (v < 0) return `rgb(var(--hint-rgb) / ${dim ? 0.05 : 0.12})`
    if (v === 0) return `rgb(var(--hint-rgb) / ${dim ? 0.1 : 0.24})`
    const a = v >= 1 ? 1 : 0.3 + 0.5 * v
    return `rgb(var(--accent-rgb) / ${dim ? a * 0.45 : a})`
  }
  if (mode === 'gaps') {
    return v > 0
      ? `rgb(var(--accent-rgb) / ${dim ? 0.25 : 0.45})`
      : `rgb(var(--danger-rgb) / ${dim ? 0.4 : 0.7})`
  }
  if (v <= 0) return `rgb(var(--hint-rgb) / ${dim ? 0.1 : 0.2})`
  const a = 0.22 + 0.78 * Math.pow(v, 1.2)
  return `rgb(var(--accent-rgb) / ${dim ? a * 0.45 : a})`
}

function Figure({
  parts, details, label, values, mode, selectedSet, onSelect, height,
}: {
  parts: Part[]
  details: string[]
  label: string
  values: Record<string, number>
  mode: BodyMapMode
  selectedSet: Set<string> | null
  onSelect?: (name: string) => void
  height: number
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const glowId = `bmglow${uid}`
  const dimOthers = selectedSet !== null

  const hot = parts.filter((p) => (mode === 'heat' && (values[p.muscle] ?? 0) >= 0.5) || (mode === 'fill' && (values[p.muscle] ?? -1) >= 1))

  const both = (key: string, d: string, props: Record<string, unknown>, mirror?: boolean) =>
    mirror ? (
      <g key={key}>
        <path d={d} transform={PLAIN} {...props} />
        <path d={d} transform={MIRROR} {...props} />
      </g>
    ) : (
      <path key={key} d={d} transform={PLAIN} {...props} />
    )

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <svg viewBox="0 0 200 458" style={{ height }} className="w-auto max-w-full" role="img" aria-label={label}>
        <defs>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>

        <g fill="none" stroke={OUTLINE} strokeWidth="3" strokeLinejoin="round">
          <path d={HEAD} transform={PLAIN} />
          <path d={NECK} transform={PLAIN} />
          {BASE.map((d, i) => both(`o${i}`, d, {}, true))}
        </g>
        <g fill={BASE_FILL}>
          <path d={HEAD} transform={PLAIN} />
          <path d={NECK} transform={PLAIN} />
          {BASE.map((d, i) => both(`f${i}`, d, {}, true))}
        </g>

        {hot.length > 0 && (
          <g filter={`url(#${glowId})`} opacity={dimOthers ? 0.25 : 0.55} style={{ pointerEvents: 'none' }}>
            {hot.map((p, i) => both(`g${i}`, p.d, { fill: 'rgb(var(--accent-rgb))' }, p.mirror))}
          </g>
        )}

        {parts.map((p, i) => {
          const v = values[p.muscle] ?? (mode === 'fill' ? -1 : 0)
          const selected = selectedSet?.has(p.muscle) ?? false
          const dim = dimOthers && !selected
          const pulse = ((mode === 'gaps' && v <= 0) || (mode === 'fill' && v === 0)) && !dim
          return both(
            `m${i}`,
            p.d,
            {
              className: clsx('bm-muscle', pulse && 'bm-pulse'),
              onClick: onSelect ? () => onSelect(p.muscle) : undefined,
              role: onSelect ? 'button' : undefined,
              'aria-label': onSelect ? p.muscle : undefined,
              style: {
                fill: fillFor(v, mode, dim),
                stroke: selected ? 'rgb(var(--fg-rgb))' : SEAM,
                strokeWidth: selected ? 1.6 : 1,
                strokeLinejoin: 'round',
                cursor: onSelect ? 'pointer' : undefined,
                animationDelay: `${i * 22}ms`,
              },
            },
            p.mirror,
          )
        })}

        <g fill="none" stroke={OUTLINE} strokeWidth="0.9" strokeLinecap="round" style={{ pointerEvents: 'none' }}>
          {details.map((d, i) => both(`d${i}`, d, {}, true))}
        </g>

        {selectedSet &&
          parts
            .filter((p) => selectedSet.has(p.muscle))
            .map((p, i) =>
              both(
                `s${i}`,
                p.d,
                { fill: 'none', stroke: 'rgb(var(--fg-rgb))', strokeWidth: 1.6, strokeLinejoin: 'round', style: { pointerEvents: 'none' } },
                p.mirror,
              ),
            )}
      </svg>
      <span className="mt-1 text-[11px] text-hint">{label}</span>
    </div>
  )
}

export default function BodyMap({
  values, selected, onSelect, height = 250, mode = 'heat', className,
}: {
  values: Record<string, number>
  selected?: string | null
  onSelect?: (name: string) => void
  height?: number
  mode?: BodyMapMode
  className?: string
}) {
  const selectedSet = selected ? new Set(expandMuscle(selected)) : null
  return (
    <div className={clsx('flex items-start justify-center gap-2', className)}>
      <Figure parts={FRONT} details={DETAILS_FRONT} label="Спереди" values={values} mode={mode} selectedSet={selectedSet} onSelect={onSelect} height={height} />
      <Figure parts={BACK} details={DETAILS_BACK} label="Сзади" values={values} mode={mode} selectedSet={selectedSet} onSelect={onSelect} height={height} />
    </div>
  )
}
