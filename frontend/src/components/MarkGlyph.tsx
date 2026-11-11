import clsx from 'clsx'
import Icon from './Icon'
import type { Glyph } from '../utils/diaryTypes'

export default function MarkGlyph({ g, size = 20, className }: { g: Glyph; size?: number; className?: string }) {
  if (g.icon) return <Icon name={g.icon} size={size} className={clsx('shrink-0', className)} />
  return (
    <span className="leading-none" style={{ fontSize: size }}>
      {g.emoji}
    </span>
  )
}
