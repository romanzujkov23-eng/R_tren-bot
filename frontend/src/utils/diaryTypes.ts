import type { DiaryEntry, DiaryKind } from '../services/api'

export interface SubType {
  key: string
  emoji: string
  label: string
}
export interface KindInfo {
  key: DiaryKind
  emoji: string
  label: string
  question: string
  subs: SubType[]
}

export const KINDS: KindInfo[] = [
  {
    key: 'strength',
    emoji: '💪',
    label: 'Силовая',
    question: 'Какой формат?',
    subs: [
      { key: 'full', emoji: '🏋️', label: 'Фулбади (всё тело)' },
      { key: 'upper', emoji: '💪', label: 'Верх тела' },
      { key: 'lower', emoji: '🦵', label: 'Низ тела' },
      { key: 'split', emoji: '🧩', label: 'Сплит (группа мышц)' },
      { key: 'circuit', emoji: '🔁', label: 'Круговая' },
      { key: 'calisthenics', emoji: '🤸', label: 'Воркаут' },
      { key: 'core', emoji: '🎯', label: 'Пресс и кор' },
    ],
  },
  {
    key: 'cardio',
    emoji: '🏃',
    label: 'Кардио',
    question: 'Какое кардио?',
    subs: [
      { key: 'run', emoji: '🏃', label: 'Бег' },
      { key: 'walk', emoji: '🚶', label: 'Ходьба' },
      { key: 'bike', emoji: '🚴', label: 'Велосипед' },
      { key: 'swim', emoji: '🏊', label: 'Плавание' },
      { key: 'row', emoji: '🚣', label: 'Гребля' },
      { key: 'hiit', emoji: '⚡', label: 'Интервальная (HIIT)' },
    ],
  },
  {
    key: 'stretch',
    emoji: '🧘',
    label: 'Растяжка и йога',
    question: 'Что именно?',
    subs: [
      { key: 'yoga', emoji: '🧘', label: 'Йога' },
      { key: 'stretching', emoji: '🙆', label: 'Растяжка' },
      { key: 'pilates', emoji: '🩰', label: 'Пилатес' },
      { key: 'mobility', emoji: '🔄', label: 'Мобильность' },
    ],
  },
  {
    key: 'sport',
    emoji: '⚽',
    label: 'Спорт',
    question: 'Какой спорт?',
    subs: [
      { key: 'football', emoji: '⚽', label: 'Футбол' },
      { key: 'basketball', emoji: '🏀', label: 'Баскетбол' },
      { key: 'volleyball', emoji: '🏐', label: 'Волейбол' },
      { key: 'tennis', emoji: '🎾', label: 'Теннис' },
      { key: 'martial', emoji: '🥊', label: 'Единоборства' },
      { key: 'hockey', emoji: '🏒', label: 'Хоккей' },
      { key: 'winter', emoji: '⛷️', label: 'Лыжи и коньки' },
      { key: 'other_sport', emoji: '🏅', label: 'Другой спорт' },
    ],
  },
  {
    key: 'other',
    emoji: '✅',
    label: 'Другое',
    question: 'Что именно?',
    subs: [
      { key: 'dance', emoji: '💃', label: 'Танцы' },
      { key: 'hike', emoji: '🥾', label: 'Поход' },
      { key: 'general', emoji: '✅', label: 'Просто тренировка' },
    ],
  },
]

const LEGACY: KindInfo = { key: 'home', emoji: '🏠', label: 'Дома', question: '', subs: [] }

export const kindInfo = (k: string): KindInfo => KINDS.find((x) => x.key === k) ?? LEGACY

export function markEmoji(kind: string, subtype: string | null | undefined): string {
  const info = kindInfo(kind)
  return info.subs.find((s) => s.key === subtype)?.emoji ?? info.emoji
}

export function markLabel(kind: string, subtype: string | null | undefined): string {
  const info = kindInfo(kind)
  const sub = info.subs.find((s) => s.key === subtype)
  return sub ? `${info.label} · ${sub.label}` : info.label
}


export interface MarkLook {
  emoji: string
  color: string | null
  label: string
  custom: boolean
}

export function markLook(e: Pick<DiaryEntry, 'kind' | 'subtype' | 'emoji' | 'color' | 'label'>): MarkLook {
  if (e.kind === 'custom') {
    return {
      emoji: e.emoji ?? '',
      color: e.color,
      label: e.label || (e.color && !e.emoji ? 'Закрашенный день' : 'Своя отметка'),
      custom: true,
    }
  }
  return { emoji: markEmoji(e.kind, e.subtype), color: null, label: markLabel(e.kind, e.subtype), custom: false }
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
  } catch {
  }
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
