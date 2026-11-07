import { useEffect } from 'react'
import { Modal, MUSCLE_LABELS } from './ui'
import { findInfo, useCatalog } from '../stores/catalogStore'
import type { CatalogItem, Exercise } from '../services/api'
import BodyMap, { muscleValues } from './BodyMap'
import TechniqueAnimation from './TechniqueAnimation'

const fromOwn = (ex: Exercise): CatalogItem => ({
  name: ex.name,
  group: ex.muscle_group,
  equipment: 'Своё упражнение',
  muscles: (ex.primary ?? []).join(', '),
  primary: ex.primary ?? [],
  secondary: ex.secondary ?? [],
  how: [],
  tips: [],
})

export default function ExerciseInfo({
  name, item, own, onClose,
}: { name?: string; item?: CatalogItem; own?: Exercise; onClose: () => void }) {
  const { items, load } = useCatalog()
  useEffect(() => void load(), [load])
  const found = item ?? (name ? findInfo(items, name) : undefined)
  const info = found ?? (own && own.primary && own.primary.length > 0 ? fromOwn(own) : undefined)

  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl font-bold">{info?.name ?? name}</h2>
      {info ? (
        <div className="mt-2 space-y-4">
          <p className="text-sm text-hint">
            {MUSCLE_LABELS[info.group]} · {info.equipment}
          </p>

          {info.images && info.images.length > 0 ? (
            <TechniqueAnimation images={info.images} name={info.name} />
          ) : (
            <div className="rounded-2xl border border-line bg-card py-3">
              <BodyMap
                height={190}
                values={muscleValues([
                  ...info.primary.map((name) => ({ name, weight: 1 })),
                  ...info.secondary.map((name) => ({ name, weight: 0.35 })),
                ])}
              />
            </div>
          )}

          <div className="space-y-2 rounded-2xl border border-line bg-card p-3 text-sm">
            <div>
              <div className="text-xs text-hint">Основные мышцы</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {info.primary.map((m) => (
                  <span key={m} className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg">
                    {m}
                  </span>
                ))}
              </div>
            </div>
            {info.secondary.length > 0 && (
              <div>
                <div className="text-xs text-hint">Вспомогательные</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {info.secondary.map((m) => (
                    <span key={m} className="rounded-full bg-card2 px-2.5 py-1 text-xs">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {info.how.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Как выполнять</h3>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {info.how.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            </div>
          )}
          {info.tips.length > 0 && (
            <div className="rounded-2xl bg-card2 p-3">
              <h3 className="mb-1 text-sm font-semibold">Обратите внимание</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {info.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-hint">Описания нет: упражнение ваше.</p>
      )}
    </Modal>
  )
}
