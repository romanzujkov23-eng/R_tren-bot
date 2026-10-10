import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../services/api'
import { useAuth } from '../stores/authStore'
import { Button, Card, ErrorBox, Field, PageTitle, Segmented, Toggle, inputCls } from '../components/ui'
import Icon from '../components/Icon'
import { confirmAction, haptic } from '../utils/telegram'
import { ACCENTS, getAccent, getThemePref, setAccent, setThemePref, type Accent, type ThemePref } from '../utils/theme'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function SettingsPage() {
  const user = useAuth((s) => s.user)!
  const setUser = useAuth((s) => s.setUser)
  const nav = useNavigate()
  const simple = user.app_mode === 'simple'
  const [theme, setTheme] = useState<ThemePref>(getThemePref())
  const [accent, setAccentState] = useState<Accent>(getAccent())
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)


  const [remOn, setRemOn] = useState(user.reminder_enabled)
  const [remTime, setRemTime] = useState(user.reminder_time)
  const [remDays, setRemDays] = useState<number[]>(user.reminder_days.length ? user.reminder_days : [0, 2, 4])
  const [remBusy, setRemBusy] = useState(false)

  const flash = (m: string) => {
    setOk(m)
    haptic.success()
    window.setTimeout(() => setOk(null), 1800)
  }

  const save = async (patch: Parameters<typeof api.updateMe>[0], message = 'Сохранено') => {
    setErr(null)
    try {
      setUser(await api.updateMe(patch))
      flash(message)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const switchMode = async (mode: 'simple' | 'full') => {
    if (user.app_mode === mode) return
    setErr(null)
    try {
      setUser(await api.updateMe({ app_mode: mode }))
      nav('/', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const saveReminders = async () => {
    setErr(null)
    if (remOn && remDays.length === 0) return setErr('Выберите хотя бы один день недели')
    setRemBusy(true)
    try {
      setUser(await api.setReminders({ enabled: remOn, time: remTime || '18:00', days: remDays }))
      flash(remOn ? 'Напоминания включены' : 'Напоминания выключены')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setRemBusy(false)
    }
  }

  const wipe = async () => {
    if (!(await confirmAction('Удалить аккаунт и все данные? Это необратимо.'))) return
    try {
      await api.deleteMe()
      window.location.reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const toggleDay = (d: number) => setRemDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))

  return (
    <div className="space-y-4">
      <PageTitle>{simple ? 'Настройки' : 'Профиль'}</PageTitle>

      <Card className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-fg">
          {user.first_name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="text-lg font-semibold">{user.first_name}</div>
          {user.username && <div className="text-sm text-hint">@{user.username}</div>}
        </div>
      </Card>

      {err && <ErrorBox message={err} />}
      {ok && <p className="text-center text-sm font-semibold text-brand">{ok}</p>}

      <Card className="space-y-2">
        <Field label="Режим приложения" group>
          <Segmented
            value={user.app_mode as 'simple' | 'full'}
            options={[
              { value: 'simple', label: 'Дневник' },
              { value: 'full', label: 'Полный' },
            ]}
            onChange={switchMode}
          />
        </Field>
        <p className="text-xs text-hint">
          Календарь общий: отметки и тренировки видны в обоих режимах, их можно открыть, изменить и удалить где угодно.
        </p>
      </Card>

      <Card className="space-y-2">
        <Field label="Цель: тренировочных дней в неделю" group>
          <div className="grid grid-cols-7 gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                onClick={() => save({ weekly_goal: n })}
                className={clsx('rounded-xl py-3 font-semibold', user.weekly_goal === n ? 'bg-accent text-accent-fg' : 'bg-card2')}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
        <p className="text-xs text-hint">От цели зависит серия: сколько недель подряд вы её выполняли.</p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Напоминания в Telegram</div>
            <div className="text-xs text-hint">Бот напишет в выбранное время</div>
          </div>
          <Toggle on={remOn} label="Напоминания" onChange={setRemOn} />
        </div>

        {remOn && (
          <>
            <Field label="Время">
              <input type="time" className={inputCls} value={remTime} onChange={(e) => setRemTime(e.target.value)} />
            </Field>
            <Field label="Дни недели" group>
              <div className="grid grid-cols-7 gap-1">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(i)}
                    className={clsx('rounded-xl py-2.5 text-sm font-semibold', remDays.includes(i) ? 'bg-accent text-accent-fg' : 'bg-card2')}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <p className="text-xs text-hint">
              Время по вашему часовому поясу ({user.timezone}). Если в этот день вы уже занимались, напоминание не придёт. Если бот не может
              написать вам, откройте чат с ним, нажмите Start и повторите.
            </p>
          </>
        )}
        {(remOn || user.reminder_enabled) && (
          <Button full disabled={remBusy} onClick={saveReminders}>
            {remBusy ? 'Сохраняю' : 'Сохранить напоминания'}
          </Button>
        )}
      </Card>

      <Card className="space-y-4">
        <Field label="Оформление" group>
          <Segmented
            value={theme}
            options={[
              { value: 'auto', label: 'Авто' },
              { value: 'dark', label: 'Тёмная' },
              { value: 'light', label: 'Светлая' },
            ]}
            onChange={(v) => {
              setTheme(v)
              setThemePref(v)
            }}
          />
        </Field>

        <Field label="Цвет темы" group>
          <div className="grid grid-cols-4 gap-2">
            {ACCENTS.map((a) => {
              const on = accent === a.key
              return (
                <button
                  key={a.key}
                  onClick={() => {
                    haptic.select()
                    setAccentState(a.key)
                    setAccent(a.key)
                  }}
                  aria-label={a.label}
                  aria-pressed={on}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 text-[11px] font-medium transition active:scale-95',
                    on ? 'border-accent bg-accent/15' : 'border-line bg-card2',
                  )}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full text-black/70" style={{ background: a.color }}>
                    {on && <Icon name="check" size={18} strokeWidth={2.8} />}
                  </span>
                  {a.label}
                </button>
              )
            })}
          </div>
        </Field>
      </Card>

      <Button variant="danger" full onClick={wipe}>
        Удалить аккаунт и данные
      </Button>
      <p className="pb-2 pt-1 text-center text-xs text-hint">TrenBot by Rom4ik</p>
    </div>
  )
}
