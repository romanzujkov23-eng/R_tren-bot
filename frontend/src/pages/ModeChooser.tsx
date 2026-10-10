import { useState } from 'react'
import { api } from '../services/api'
import { useAuth } from '../stores/authStore'
import { ErrorBox } from '../components/ui'
import Icon from '../components/Icon'
import { haptic } from '../utils/telegram'
import { prefetch } from '../utils/cache'
import { monthStr } from '../utils/dates'


export default function ModeChooser() {
  const setUser = useAuth((s) => s.setUser)
  const [busy, setBusy] = useState<'simple' | 'full' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const choose = async (mode: 'simple' | 'full') => {
    haptic.tap()
    setBusy(mode)
    setErr(null)
    try {
      if (mode === 'simple') prefetch(`diary:${monthStr(new Date())}`, () => api.diary(monthStr(new Date())))
      setUser(await api.updateMe({ app_mode: mode }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
      setBusy(null)
    }
  }

  const Option = ({ mode, icon, title, text }: { mode: 'simple' | 'full'; icon: string; title: string; text: string }) => (
    <button
      disabled={busy !== null}
      onClick={() => choose(mode)}
      className="w-full rounded-3xl border border-line bg-card p-5 text-left transition active:scale-[0.98] disabled:opacity-60"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-brand">
        <Icon name={icon} size={26} />
      </div>
      <div className="mt-3 text-lg font-semibold">{title}</div>
      <div className="mt-1 text-sm text-hint">{text}</div>
      {busy === mode && <div className="mt-2 text-sm text-brand">Открываю</div>}
    </button>
  )

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-8">
      <h1 className="text-center text-[28px] font-bold">Как вы будете заниматься?</h1>
      <p className="mt-2 text-center text-sm text-hint">
        Календарь общий для обоих режимов: записи не пропадают при переключении. Режим можно сменить в настройках.
      </p>
      {err && (
        <div className="mt-4">
          <ErrorBox message={err} />
        </div>
      )}

      <div className="mt-6 space-y-3">
        <Option mode="simple" icon="calendar" title="Дневник" text="Календарь с отметками: был на тренировке, выбрали вид и готово. Без подходов и весов." />
        <Option
          mode="full"
          icon="dumbbell"
          title="Полный режим"
          text="Программы, запись подходов и весов, подсказки по нагрузке, статистика и замеры тела. Календарь тоже здесь."
        />
      </div>
    </div>
  )
}
