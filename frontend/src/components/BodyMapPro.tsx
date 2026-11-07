import { useId, useMemo } from 'react'
import clsx from 'clsx'
import { BASE, HEAD, NECK } from './bodyShapes'
import { A_BACK, A_FRONT, DETAIL_BACK, DETAIL_FRONT, anatomicalName, anchorOf, type AMuscle } from './bodyAnatomy'

export interface ProCell {
  /** -1: нет цели, 0: пусто, 0..1: заполнение или относительная нагрузка */
  value: number
  /** мышца вне программы, засчитана как дополнительная */
  extra?: boolean
}

export type ProMode = 'fill' | 'heat'
export type MapView = 'both' | 'front' | 'back'

const MIRROR = 'translate(100 0) scale(-1 1)'
const PLAIN = 'translate(100 0)'
const OUTLINE = 'rgb(var(--line-rgb))'
const BASE_FILL = 'rgb(var(--card2-rgb))'
const SEAM = 'rgb(var(--bg-rgb) / 0.75)'

function colorFor(v: number, mode: ProMode, dim: boolean): string {
  const k = dim ? 0.4 : 1
  if (v < 0) return `rgb(var(--hint-rgb) / ${0.12 * k})`
  if (mode === 'heat') {
    if (v <= 0) return `rgb(var(--hint-rgb) / ${0.16 * k})`
    return `rgb(var(--accent-rgb) / ${(0.22 + 0.78 * Math.pow(v, 1.1)) * k})`
  }
  if (v === 0) return `rgb(var(--hint-rgb) / ${0.24 * k})`
  const a = v >= 1 ? 1 : 0.3 + 0.5 * v
  return `rgb(var(--accent-rgb) / ${a * k})`
}

function tagFor(list: AMuscle[], detail: boolean, selected: string | null) {
  if (!selected) return null
  const mu = list.find((x) => (detail ? x.id : x.parent) === selected)
  if (!mu) return null
  const a = anchorOf(mu.d)
  if (!a) return null
  const text = anatomicalName(selected)
  return { x: 100 + (mu.mirror ? Math.max(a[0], 9) : a[0]), y: a[1], text }
}

function Figure({
  list, detailLines, title, cells, regionCells, mode, selected, onSelect, ox, uid,
}: {
  list: AMuscle[]
  detailLines: string[]
  title: string
  cells: Record<string, ProCell>
  regionCells?: Record<string, ProCell>
  mode: ProMode
  selected: string | null
  onSelect?: (name: string) => void
  ox: number
  uid: string
}) {
  const detail = !!regionCells
  const dimOthers = selected !== null
  const tag = useMemo(() => tagFor(list, detail, selected), [list, detail, selected])
  const sides = (mu: AMuscle) => (mu.mirror ? [PLAIN, MIRROR] : [PLAIN])
  const fiberId = (a: number) => `${uid}f${String(a).replace('-', 'm')}`

  return (
    <g transform={`translate(${ox} 20)`}>
      <text x={100} y={-6} textAnchor="middle" fontSize="8.5" letterSpacing="2.2" fill="rgb(var(--hint-rgb))" fontWeight="600">
        {title}
      </text>

      {/* силуэт */}
      <g fill="none" stroke={OUTLINE} strokeWidth="3" strokeLinejoin="round">
        <path d={HEAD} transform={PLAIN} />
        <path d={NECK} transform={PLAIN} />
        {BASE.map((d, i) => (
          <g key={i}>
            <path d={d} transform={PLAIN} />
            <path d={d} transform={MIRROR} />
          </g>
        ))}
      </g>
      <g fill={BASE_FILL}>
        <path d={HEAD} transform={PLAIN} />
        <path d={NECK} transform={PLAIN} />
        {BASE.map((d, i) => (
          <g key={i}>
            <path d={d} transform={PLAIN} />
            <path d={d} transform={MIRROR} />
          </g>
        ))}
      </g>

      {/* мышцы */}
      {list.map((mu, i) => {
        if (mu.id === null) {
          return (
            <g key={i} style={{ pointerEvents: 'none' }}>
              {sides(mu).map((T) => (
                <g key={T} transform={T}>
                  <path d={mu.d} fill={BASE_FILL} />
                  <path d={mu.d} fill="rgb(var(--hint-rgb) / 0.3)" />
                  <path d={mu.d} fill={`url(#${fiberId(mu.fiber ?? 0)})`} opacity="0.5" />
                  <path d={mu.d} fill={`url(#${uid}shade)`} stroke={SEAM} strokeWidth="0.7" strokeLinejoin="round" />
                </g>
              ))}
            </g>
          )
        }
        const key = detail ? mu.id : mu.parent!
        const parentCell = cells[mu.parent!]
        const cell = detail ? regionCells![mu.id] ?? parentCell : parentCell
        const isSel = selected === key
        const dim = dimOthers && !isSel
        const fill = isSel && detail ? 'rgb(var(--accent-rgb))' : colorFor(cell?.value ?? -1, detail ? 'heat' : mode, dim)
        const extra = !detail && !!parentCell?.extra
        return (
          <g
            key={i}
            onClick={onSelect ? () => onSelect(key) : undefined}
            role={onSelect ? 'button' : undefined}
            aria-label={onSelect ? key : undefined}
            style={{ cursor: onSelect ? 'pointer' : undefined }}
          >
            {sides(mu).map((T) => (
              <g key={T} transform={T}>
                <path d={mu.d} fill={BASE_FILL} />
                <path d={mu.d} fill={fill} />
                <path d={mu.d} fill={`url(#${fiberId(mu.fiber ?? 0)})`} opacity={dim ? 0.25 : 0.55} />
                <path
                  d={mu.d}
                  fill={`url(#${uid}shade)`}
                  stroke={isSel ? 'rgb(var(--fg-rgb))' : extra ? 'rgb(var(--accent-rgb))' : SEAM}
                  strokeWidth={isSel ? 1.7 : extra ? 1.1 : 0.7}
                  strokeDasharray={extra && !isSel ? '2.4 1.8' : undefined}
                  strokeLinejoin="round"
                />
              </g>
            ))}
          </g>
        )
      })}

      {/* рельеф: сухожильные перемычки, белая линия, коленная чашечка */}
      <g fill="none" stroke="rgb(var(--bg-rgb) / 0.7)" strokeWidth="0.8" strokeLinecap="round" style={{ pointerEvents: 'none' }}>
        {detailLines.map((d, i) => (
          <g key={i}>
            <path d={d} transform={PLAIN} />
            <path d={d} transform={MIRROR} />
          </g>
        ))}
      </g>

      {tag && (
        <g transform={`translate(${tag.x} ${tag.y})`} style={{ pointerEvents: 'none' }}>
          <rect x={-(tag.text.length * 2.5 + 7)} y={-7} width={tag.text.length * 5 + 14} height={14} rx={7} fill="rgb(var(--fg-rgb))" />
          <text y={3} textAnchor="middle" fontSize="8" fontWeight="700" fill="rgb(var(--bg-rgb))">
            {tag.text}
          </text>
        </g>
      )}
    </g>
  )
}

export default function BodyMapPro({
  cells, regionCells, selected = null, onSelect, mode = 'fill', view = 'both', height = 400, className,
}: {
  cells: Record<string, ProCell>
  /** если передано, мышцы раскрашиваются и выбираются по частям (головки, пучки, отделы) */
  regionCells?: Record<string, ProCell>
  selected?: string | null
  onSelect?: (name: string) => void
  mode?: ProMode
  view?: MapView
  height?: number
  className?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const angles = useMemo(() => [...new Set([...A_FRONT, ...A_BACK].map((x) => x.fiber ?? 0))], [])
  const shared = { cells, regionCells, mode, selected, onSelect, uid }
  return (
    <div className={clsx('flex justify-center', className)}>
      <svg
        viewBox={view === 'both' ? '0 0 430 486' : '0 0 200 486'}
        style={{ height, touchAction: 'manipulation' }}
        className="w-auto max-w-full"
        role="img"
        aria-label="Мышечная карта"
      >
        <defs>
          {/* объём: свет сверху слева, тень снизу справа */}
          <linearGradient id={`${uid}shade`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.34" />
          </linearGradient>
          {/* направление мышечных волокон */}
          {angles.map((a) => (
            <pattern key={a} id={`${uid}f${String(a).replace('-', 'm')}`} width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform={`rotate(${a})`}>
              <rect width="0.55" height="2.6" fill="#000" fillOpacity="0.42" />
            </pattern>
          ))}
        </defs>
        {view !== 'back' && <Figure {...shared} list={A_FRONT} detailLines={DETAIL_FRONT} title="СПЕРЕДИ" ox={0} />}
        {view !== 'front' && <Figure {...shared} list={A_BACK} detailLines={DETAIL_BACK} title="СЗАДИ" ox={view === 'both' ? 230 : 0} />}
      </svg>
    </div>
  )
}
