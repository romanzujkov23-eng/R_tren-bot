import { useState } from 'react'
import clsx from 'clsx'
import type { MuscleGroup } from '../services/api'
import { MUSCLE_LABELS, Segmented } from './ui'

const AREAS: { group: MuscleGroup; muscles: string[] }[] = [
  { group: 'chest', muscles: ['Грудные'] },
  { group: 'back', muscles: ['Широчайшие', 'Ромбовидные', 'Трапеции', 'Разгибатели спины'] },
  { group: 'shoulders', muscles: ['Передние дельты', 'Средние дельты', 'Задние дельты'] },
  { group: 'arms', muscles: ['Бицепс', 'Трицепс', 'Плечевая мышца', 'Предплечья'] },
  { group: 'core', muscles: ['Пресс', 'Косые мышцы живота', 'Сгибатели бедра'] },
  { group: 'legs', muscles: ['Квадрицепс', 'Бицепс бедра', 'Ягодичные', 'Приводящие', 'Икры'] },
]

export const groupOfMuscle = (muscle: string): MuscleGroup | undefined =>
  AREAS.find((a) => a.muscles.includes(muscle))?.group

export const groupForMuscles = (primary: string[], fallback: MuscleGroup = 'other'): MuscleGroup =>
  (primary[0] && groupOfMuscle(primary[0])) || fallback

export default function MuscleSelect({
  primary, secondary, onChange,
}: {
  primary: string[]
  secondary: string[]
  onChange: (primary: string[], secondary: string[]) => void
}) {
  const [target, setTarget] = useState<'primary' | 'secondary'>('primary')

  const toggle = (m: string) => {
    if (target === 'primary') {
      onChange(
        primary.includes(m) ? primary.filter((x) => x !== m) : [...primary, m],
        secondary.filter((x) => x !== m),
      )
      return
    }
    onChange(
      primary.filter((x) => x !== m),
      secondary.includes(m) ? secondary.filter((x) => x !== m) : [...secondary, m],
    )
  }

  return (
    <div className="space-y-3">
      <Segmented
        value={target}
        options={[
          { value: 'primary', label: `Основные${primary.length ? ` · ${primary.length}` : ''}` },
          { value: 'secondary', label: `Вспомогательные${secondary.length ? ` · ${secondary.length}` : ''}` },
        ]}
        onChange={setTarget}
      />
      {AREAS.map((a) => (
        <div key={a.group}>
          <div className="mb-1.5 text-xs text-hint">{MUSCLE_LABELS[a.group]}</div>
          <div className="flex flex-wrap gap-1.5">
            {a.muscles.map((m) => {
              const isPrimary = primary.includes(m)
              const isSecondary = secondary.includes(m)
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={isPrimary || isSecondary}
                  onClick={() => toggle(m)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-sm transition',
                    isPrimary && 'bg-accent font-semibold text-accent-fg',
                    isSecondary && 'bg-card2 font-medium ring-2 ring-accent',
                    !isPrimary && !isSecondary && 'bg-card2',
                  )}
                >
                  {m}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
