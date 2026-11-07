import type { DiaryEntry, DiaryKind } from '../services/api'

export interface SubType {
  key: string
  icon: string
  label: string
}
export interface KindInfo {
  key: DiaryKind
  icon: string
  label: string
  question: string
  subs: SubType[]
}

export const KINDS: KindInfo[] = [
  {
    key: 'strength',
    icon: 'dumbbell',
    label: 'Силовая',
    question: 'Какой формат?',
    subs: [
      { key: 'full', icon: 'person', label: 'Фулбади (всё тело)' },
      { key: 'upper', icon: 'shirt', label: 'Верх тела' },
      { key: 'lower', icon: 'legs', label: 'Низ тела' },
      { key: 'split', icon: 'grid', label: 'Сплит (группа мышц)' },
      { key: 'circuit', icon: 'repeat', label: 'Круговая' },
      { key: 'calisthenics', icon: 'bar', label: 'Воркаут' },
      { key: 'core', icon: 'target', label: 'Пресс и кор' },
    ],
  },
  {
    key: 'cardio',
    icon: 'pulse',
    label: 'Кардио',
    question: 'Какое кардио?',
    subs: [
      { key: 'run', icon: 'run', label: 'Бег' },
      { key: 'walk', icon: 'walk', label: 'Ходьба' },
      { key: 'bike', icon: 'bike', label: 'Велосипед' },
      { key: 'swim', icon: 'swim', label: 'Плавание' },
      { key: 'row', icon: 'row', label: 'Гребля' },
      { key: 'hiit', icon: 'bolt', label: 'Интервальная (HIIT)' },
    ],
  },
  {
    key: 'stretch',
    icon: 'lotus',
    label: 'Растяжка и йога',
    question: 'Что именно?',
    subs: [
      { key: 'yoga', icon: 'lotus', label: 'Йога' },
      { key: 'stretching', icon: 'stretch', label: 'Растяжка' },
      { key: 'pilates', icon: 'ring', label: 'Пилатес' },
      { key: 'mobility', icon: 'joint', label: 'Мобильность' },
    ],
  },
  {
    key: 'sport',
    icon: 'ball',
    label: 'Спорт',
    question: 'Какой спорт?',
    subs: [
      { key: 'football', icon: 'football', label: 'Футбол' },
      { key: 'basketball', icon: 'basketball', label: 'Баскетбол' },
      { key: 'volleyball', icon: 'volleyball', label: 'Волейбол' },
      { key: 'tennis', icon: 'tennis', label: 'Теннис' },
      { key: 'martial', icon: 'glove', label: 'Единоборства' },
      { key: 'hockey', icon: 'hockey', label: 'Хоккей' },
      { key: 'winter', icon: 'snow', label: 'Лыжи и коньки' },
      { key: 'other_sport', icon: 'medal', label: 'Другой спорт' },
    ],
  },
  {
    key: 'other',
    icon: 'checkcircle',
    label: 'Другое',
    question: 'Что именно?',
    subs: [
      { key: 'dance', icon: 'music', label: 'Танцы' },
      { key: 'hike', icon: 'mountain', label: 'Поход' },
      { key: 'general', icon: 'checkcircle', label: 'Просто тренировка' },
    ],
  },
]

const LEGACY: KindInfo = { key: 'home', icon: 'home', label: 'Дома', question: '', subs: [] }

export const kindInfo = (k: string): KindInfo => KINDS.find((x) => x.key === k) ?? LEGACY

export interface Glyph {
  icon: string | null
  emoji: string
}

export function markGlyph(kind: string, subtype: string | null | undefined): Glyph {
  const info = kindInfo(kind)
  return { icon: info.subs.find((s) => s.key === subtype)?.icon ?? info.icon, emoji: '' }
}

export const glyphKey = (g: Glyph) => g.icon ?? g.emoji

export function markLabel(kind: string, subtype: string | null | undefined): string {
  const info = kindInfo(kind)
  const sub = info.subs.find((s) => s.key === subtype)
  return sub ? `${info.label} · ${sub.label}` : info.label
}

export interface MarkLook {
  glyph: Glyph
  color: string | null
  label: string
  custom: boolean
}

export function markLook(e: Pick<DiaryEntry, 'kind' | 'subtype' | 'emoji' | 'color' | 'label'>): MarkLook {
  if (e.kind === 'custom') {
    return {
      glyph: { icon: null, emoji: e.emoji ?? '' },
      color: e.color,
      label: e.label || (e.color && !e.emoji ? 'Закрашенный день' : 'Своя отметка'),
      custom: true,
    }
  }
  return { glyph: markGlyph(e.kind, e.subtype), color: null, label: markLabel(e.kind, e.subtype), custom: false }
}

export const PALETTE: { color: string; name: string }[] = [
  { color: '#ff6b6b', name: 'Красный' },
  { color: '#ff9f45', name: 'Оранжевый' },
  { color: '#ffd84a', name: 'Жёлтый' },
  { color: '#4ade80', name: 'Зелёный' },
  { color: '#2dd4bf', name: 'Бирюзовый' },
  { color: '#5ea8ff', name: 'Синий' },
  { color: '#b794ff', name: 'Фиолетовый' },
  { color: '#ff6fb5', name: 'Розовый' },
  { color: '#a8a29e', name: 'Серый' },
  { color: '#c08457', name: 'Коричневый' },
]

export const EMOJI_GROUPS: { title: string; items: string[] }[] = [
  { title: 'Тренировки', items: ['💪', '🏋️', '🏃', '🚴', '🏊', '🧘', '🤸', '⚽', '🏀', '🎾', '🥊', '🧗', '⛷️', '🏓', '🥾', '💃'] },
  { title: 'Состояние', items: ['🔥', '⚡', '😎', '😤', '🥳', '😴', '🤒', '🤕', '🥵', '😌'] },
  { title: 'Жизнь', items: ['⭐', '❤️', '🏖️', '✈️', '🎉', '🎂', '🍕', '🥗', '💊', '💧', '📌', '✅', '❌', '🏆'] },
]

export function firstGrapheme(input: string): string {
  const text = input.trim()
  if (!text) return ''
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter
    if (Seg) {
      for (const part of new Seg(undefined, { granularity: 'grapheme' }).segment(text)) return part.segment
    }
  } catch {}
  return Array.from(text).slice(0, 2).join('')
}

export function textOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#ffffff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#12151b' : '#ffffff'
}

export function fillBackground(colors: string[]): string | undefined {
  if (colors.length === 0) return undefined
  if (colors.length === 1) return colors[0]
  return `linear-gradient(135deg, ${colors[0]} 0%, ${colors[0]} 50%, ${colors[1]} 50%, ${colors[1]} 100%)`
}
