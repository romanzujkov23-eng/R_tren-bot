import { useState } from 'react'
import clsx from 'clsx'
import { api, type Exercise, type Goal, type GoalKind } from '../services/api'
import { Button, Card, ErrorBox, Field, Modal, SectionTitle, Segmented, Spinner, Toast, fmtNum, inputCls, useLoad, useToast } from '../components/ui'
import { GoalCard, KIND_INFO } from '../components/GoalCard'
import { useAuth } from '../stores/authStore'
import { dateStr } from '../utils/dates'
import ExercisePicker from '../components/ExercisePicker'
import Icon from '../components/Icon'
import { cacheDrop } from '../utils/cache'
import { confirmAction, haptic } from '../utils/telegram'

const num = (s: string) => parseFloat(s.replace(',', '.'))


export default function GoalsTab() {
  const q = useLoad(() => api.goals(), [], 'goals')
  const simple = useAuth((u) => u.user?.app_mode === 'simple')
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [weighing, setWeighing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (q.loading && !q.data) return <Spinner />
  if (q.error && !q.data) return <ErrorBox message={q.error} onRetry={q.reload} />
  const goals = q.data ?? []
  const active = goals.filter((g) => !g.achieved)
  const done = goals.filter((g) => g.achieved)

  const remove = async (g: Goal) => {
    if (!(await confirmAction(`Удалить цель «${g.title}»?`))) return
    try {
      await api.deleteGoal(g.id)
      cacheDrop('goals')
      await q.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className="space-y-4">
      <Toast message={toast.msg} />
      {err && <ErrorBox message={err} />}

      <Button full className="flex items-center justify-center gap-2" onClick={() => setCreating(true)}>
        <Icon name="plus" size={18} /> Новая цель
      </Button>

      {goals.length === 0 && (
        <Card className="space-y-2 text-center">
          <div className="text-3xl">🎯</div>
          <div className="font-semibold">Поставьте первую цель</div>
          <p className="text-sm text-hint">
            Вес тела, жим на 100 кг, 12 тренировок в месяц: приложение само будет считать, сколько осталось.
          </p>
        </Card>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>В работе</SectionTitle>
          {active.map((g) => (
            <GoalCard key={g.id} g={g} onDelete={() => remove(g)} onWeight={() => setWeighing(true)} />
          ))}
        </section>
      )}
      {done.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Достигнуто</SectionTitle>
          {done.map((g) => (
            <GoalCard key={g.id} g={g} onDelete={() => remove(g)} onWeight={() => setWeighing(true)} />
          ))}
        </section>
      )}

      {weighing && (
        <WeightSheet
          onClose={() => setWeighing(false)}
          onSaved={async () => {
            cacheDrop('goals', 'body')
            setWeighing(false)
            haptic.success()
            toast.show('Вес записан')
            await q.reload()
          }}
        />
      )}

      {creating && (
        <GoalSheet
          simple={simple}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            cacheDrop('goals')
            setCreating(false)
            haptic.success()
            await q.reload()
          }}
        />
      )}
    </div>
  )
}


function WeightSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [w, setW] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    const v = num(w)
    if (!(v >= 20 && v <= 400)) return setErr('Введите вес в килограммах')
    setBusy(true)
    try {
      await api.addBody({ weight: v, day: dateStr(new Date()) })
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-3 text-xl font-bold">Записать вес</h2>
      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}
      <Field label="Вес сегодня, кг">
        <input className={inputCls} inputMode="decimal" autoFocus value={w} onChange={(e) => setW(e.target.value)} placeholder="Например, 82,5" />
      </Field>
      <Button full className="mt-4" disabled={busy} onClick={save}>
        {busy ? 'Сохраняю…' : 'Сохранить'}
      </Button>
    </Modal>
  )
}

function GoalSheet({ simple, onClose, onCreated }: { simple: boolean; onClose: () => void; onCreated: () => void | Promise<void> }) {
  const body = useLoad(() => api.body(), [], 'body')
  const [kind, setKind] = useState<GoalKind | null>(null)
  const [target, setTarget] = useState('')
  const [exercise, setExercise] = useState<Exercise | null>(null)
  const [metric, setMetric] = useState<'weight' | 'reps'>('weight')
  const [deadline, setDeadline] = useState('')
  const [picking, setPicking] = useState(false)
  const [startWeight, setStartWeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const lastWeight = (body.data ?? []).find((e) => e.weight != null)?.weight ?? null

  const save = async () => {
    if (!kind) return
    const t = num(target)
    if (!(t > 0)) return setErr('Введите число больше нуля')
    if (kind === 'lift' && !exercise) return setErr('Выберите упражнение')
    setBusy(true)
    setErr(null)
    try {
      if (kind === 'body_weight' && lastWeight === null) {
        const sw = num(startWeight)
        if (!(sw >= 20 && sw <= 400)) throw new Error('Введите текущий вес в килограммах')
        await api.addBody({ weight: sw, day: dateStr(new Date()) })
        cacheDrop('body')
      }
      await api.createGoal({
        kind,
        target: t,
        ...(kind === 'lift' && exercise ? { exercise_id: exercise.id, metric } : {}),
        deadline: kind !== 'monthly' && deadline ? deadline : null,
      })
      await onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-3 text-xl font-bold">Новая цель</h2>
      {err && (
        <div className="mb-3">
          <ErrorBox message={err} />
        </div>
      )}

      {kind === null ? (
        <div className="space-y-2">
          {(Object.keys(KIND_INFO) as GoalKind[]).filter((k) => !(simple && k === 'lift')).map((k) => (
            <button
              key={k}
              onClick={() => {
                haptic.select()
                setKind(k)
                setTarget(k === 'monthly' ? '12' : '')
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-3.5 text-left transition active:scale-[0.99]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card2 text-2xl">{KIND_INFO[k].emoji}</span>
              <span className="min-w-0">
                <span className="block font-semibold">{KIND_INFO[k].name}</span>
                <span className="block text-xs text-hint">{KIND_INFO[k].hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button className="flex items-center gap-1 text-sm text-brand" onClick={() => setKind(null)}>
            <Icon name="left" size={16} /> {KIND_INFO[kind].name}
          </button>

          {kind === 'body_weight' && (
            <>
              {lastWeight === null ? (
                <Field label="Ваш вес сейчас, кг">
                  <input className={inputCls} inputMode="decimal" value={startWeight} onChange={(e) => setStartWeight(e.target.value)} placeholder="Например, 85" />
                </Field>
              ) : (
                <p className="text-sm text-hint">Сейчас у вас {fmtNum(lastWeight)} кг. Цель может быть и ниже, и выше.</p>
              )}
              <Field label="Целевой вес, кг">
                <input className={inputCls} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Например, 75" />
              </Field>
            </>
          )}

          {kind === 'lift' && (
            <>
              <Field label="Упражнение" group>
                <button className={clsx(inputCls, 'flex items-center justify-between text-left')} onClick={() => setPicking(true)}>
                  <span className={exercise ? '' : 'text-hint'}>{exercise?.name ?? 'Выбрать упражнение'}</span>
                  <Icon name="right" size={18} className="text-hint" />
                </button>
              </Field>
              <Field label="Что считаем" group>
                <Segmented
                  value={metric}
                  options={[
                    { value: 'weight', label: 'Вес, кг' },
                    { value: 'reps', label: 'Повторы' },
                  ]}
                  onChange={setMetric}
                />
              </Field>
              <Field label={metric === 'weight' ? 'Цель, кг' : 'Цель, повторов'}>
                <input
                  className={inputCls}
                  inputMode={metric === 'weight' ? 'decimal' : 'numeric'}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={metric === 'weight' ? 'Например, 100' : 'Например, 20'}
                />
              </Field>
              <p className="text-xs text-hint">Считается лучший подход из завершённых тренировок.</p>
            </>
          )}

          {kind === 'monthly' && (
            <>
              <Field label="Дней с тренировкой в месяце" group>
                <div className="grid grid-cols-5 gap-1.5">
                  {[4, 8, 12, 16, 20].map((n) => (
                    <button
                      key={n}
                      onClick={() => setTarget(String(n))}
                      className={clsx('rounded-xl py-2.5 font-semibold', target === String(n) ? 'bg-accent text-accent-fg' : 'bg-card2')}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Или своё число (1-31)">
                <input className={inputCls} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <p className="text-xs text-hint">Цель повторяется каждый месяц. Считаются завершённые тренировки и отметки, которые «считаются тренировкой».</p>
            </>
          )}

          {kind !== 'monthly' && (
            <Field label="Срок (по желанию)">
              <input type="date" className={inputCls} value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          )}

          <Button full disabled={busy || body.loading && !body.data} onClick={save}>
            {busy ? 'Сохраняю…' : 'Поставить цель'}
          </Button>
        </div>
      )}

      {picking && <ExercisePicker title="Упражнение для цели" onClose={() => setPicking(false)} onPick={(ex) => setExercise(ex)} />}
    </Modal>
  )
}
