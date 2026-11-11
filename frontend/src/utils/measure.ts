import type { Exercise, Measure } from '../services/api'

const NO_WEIGHT_GROUPS = ['core', 'cardio']

export function measureOf(ex?: { name: string; measure?: Measure } | null): Measure {
  if (!ex) return 'reps'
  if (ex.measure) return ex.measure
  const n = ex.name.toLowerCase().trim()
  if (n.endsWith('(секунды)')) return 'seconds'
  if (n.endsWith('(минуты)')) return 'minutes'
  return 'reps'
}

export function showsWeight(ex?: Pick<Exercise, 'name' | 'measure' | 'muscle_group'> | null): boolean {
  const m = measureOf(ex)
  if (m === 'reps') return true
  if (m === 'minutes') return false
  return !NO_WEIGHT_GROUPS.includes(ex?.muscle_group ?? 'other')
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }))

export const amountLabel = (m: Measure) => (m === 'seconds' ? 'Время, сек' : m === 'minutes' ? 'Время, мин' : 'Повторы')
export const amountShort = (m: Measure) => (m === 'seconds' ? 'Секунды' : m === 'minutes' ? 'Минуты' : 'Повторы')
export const amountStep = (m: Measure) => (m === 'reps' ? 1 : 5)
export const amountDefault = (m: Measure) => (m === 'seconds' ? 30 : m === 'minutes' ? 20 : 10)

export function fmtAmount(m: Measure, value: number): string {
  if (m === 'seconds') return `${value} сек`
  if (m === 'minutes') return `${value} мин`
  return `${value}`
}

export function fmtSetLine(s: { weight: number; reps: number; distance?: number | null }, m: Measure): string {
  if (m === 'reps') return `${num(s.weight)}×${s.reps}`
  const parts: string[] = []
  if (s.weight > 0) parts.push(`${num(s.weight)} кг`)
  parts.push(fmtAmount(m, s.reps))
  if (s.distance) parts.push(`${num(s.distance)} км`)
  return parts.join(' · ')
}

export function fmtTarget(sets: number, reps: number, m: Measure): string {
  if (m === 'reps') return `${sets}×${reps}`
  if (sets === 1) return fmtAmount(m, reps)
  return `${sets}×${fmtAmount(m, reps)}`
}
