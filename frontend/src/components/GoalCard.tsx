import clsx from 'clsx'
import type { Goal, GoalKind } from '../services/api'
import { Card, ProgressBar, fmtNum } from './ui'
import Icon from './Icon'
import { MONTHS_GEN } from '../utils/dates'

export const KIND_INFO: Record<GoalKind, { emoji: string; name: string; hint: string }> = {
  body_weight: { emoji: '⚖️', name: 'Вес тела', hint: 'Похудеть или набрать до нужного веса' },
  lift: { emoji: '🏋️', name: 'Результат в упражнении', hint: 'Например, жим лёжа 100 кг или 20 подтягиваний' },
  monthly: { emoji: '📅', name: 'Тренировок в месяц', hint: 'Сколько дней в месяце вы хотите заниматься' },
}

function fmtShort(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
}

function daysLeft(iso: string) {
  const end = new Date(`${iso}T23:59:59`).getTime()
  return Math.ceil((end - Date.now()) / 86_400_000)
}


function detail(g: Goal): string {
  if (g.kind === 'monthly') return `${g.current} из ${g.target} дней в этом месяце`
  if (g.kind === 'body_weight') {
    const left = Math.abs(g.target - g.current)
    return g.achieved ? `Сейчас ${fmtNum(g.current)} кг` : `Сейчас ${fmtNum(g.current)} кг · осталось ${fmtNum(Math.round(left * 10) / 10)} кг`
  }
  const left = Math.max(0, g.target - g.current)
  return g.achieved
    ? `Лучший результат: ${fmtNum(g.current)} ${g.unit}`
    : `${fmtNum(g.current)} из ${fmtNum(g.target)} ${g.unit} · осталось ${fmtNum(Math.round(left * 10) / 10)} ${g.unit}`
}

export function GoalCard({ g, onDelete, onWeight, compact }: { g: Goal; onDelete?: () => void; onWeight?: () => void; compact?: boolean }) {
  const left = g.deadline && !g.achieved ? daysLeft(g.deadline) : null
  return (
    <Card className={clsx(g.achieved && 'border-ok/40', compact && '!p-3.5')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">{KIND_INFO[g.kind].emoji}</span>
            <div className="truncate font-semibold">{g.title}</div>
          </div>
        </div>
        {g.achieved ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2.5 py-1 text-xs font-bold text-ok">
            <Icon name="check" size={14} strokeWidth={3} /> {g.kind === 'monthly' ? 'Выполнена' : 'Достигнута'}
          </span>
        ) : (
          <span className="shrink-0 text-lg font-bold">{Math.round(g.progress * 100)}%</span>
        )}
      </div>
      <ProgressBar value={g.progress} done={g.achieved} className="mt-3" />
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-hint">
        <span>{detail(g)}</span>
        {left !== null && (
          <span className={clsx('shrink-0 font-medium', left < 0 ? 'text-danger' : left <= 7 && 'text-fg')}>
            {left < 0 ? 'срок прошёл' : left === 0 ? 'до конца сегодня' : `ещё ${left} дн.`}
          </span>
        )}
        {g.achieved && g.achieved_at && g.kind !== 'monthly' && <span className="shrink-0">{fmtShort(g.achieved_at)}</span>}
      </div>
      {!compact && (onDelete || (onWeight && g.kind === 'body_weight')) && (
        <div className="mt-3 flex items-center gap-4 text-xs text-hint">
          {onWeight && g.kind === 'body_weight' && (
            <button className="flex items-center gap-1.5 font-medium text-brand" onClick={onWeight}>
              <Icon name="plus" size={14} /> Записать вес
            </button>
          )}
          {onDelete && (
            <button className="flex items-center gap-1.5" onClick={onDelete}>
              <Icon name="trash" size={14} /> Удалить
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

