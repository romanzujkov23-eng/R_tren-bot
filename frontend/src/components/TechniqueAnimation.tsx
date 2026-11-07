import { useEffect, useState } from 'react'
import clsx from 'clsx'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function TechniqueAnimation({
  images, name, size = 'full', onClick,
}: {
  images: string[]
  name: string
  size?: 'full' | 'thumb'
  onClick?: () => void
}) {
  const [frame, setFrame] = useState(0)
  const [paused, setPaused] = useState(prefersReducedMotion)
  const [failed, setFailed] = useState(false)
  const thumb = size === 'thumb'

  useEffect(() => {
    if (paused || images.length < 2) return
    const t = window.setInterval(() => setFrame((f) => (f + 1) % images.length), thumb ? 800 : 950)
    return () => window.clearInterval(t)
  }, [paused, images.length, thumb])

  if (failed || images.length === 0) return null

  return (
    <button
      onClick={onClick ?? (() => setPaused((p) => !p))}
      className={clsx(
        'relative block overflow-hidden border border-line bg-white',
        thumb ? 'h-16 w-16 shrink-0 rounded-2xl' : 'aspect-[3/2] w-full rounded-2xl',
      )}
      aria-label={onClick ? `${name}: открыть технику` : paused ? 'Запустить анимацию' : 'Остановить анимацию'}
    >
      {images.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={i === 0 ? `${name}: начало движения` : `${name}: конец движения`}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-contain transition-opacity duration-500"
          style={{ opacity: frame === i ? 1 : 0 }}
        />
      ))}
      {!thumb && images.length > 1 && (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
          {frame === 0 ? 'Старт' : 'Финиш'}
          {paused ? ' · пауза' : ''}
        </span>
      )}
    </button>
  )
}
