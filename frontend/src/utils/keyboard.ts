import { useEffect, useState } from 'react'

const TEXT_TYPES = new Set(['text', 'search', 'number', 'tel', 'email', 'url', 'password', ''])

function opensKeyboard(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return TEXT_TYPES.has((el as HTMLInputElement).type)
  return (el as HTMLElement).isContentEditable === true
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let focused = false
    let shrunk = false
    let timer: number | undefined
    const vv = window.visualViewport
    let base = vv?.height ?? window.innerHeight

    const apply = () => setOpen(focused || shrunk)

    const onFocusIn = (e: FocusEvent) => {
      window.clearTimeout(timer)
      if (opensKeyboard(e.target as Element)) {
        focused = true
        apply()
      }
    }
    const onFocusOut = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        focused = opensKeyboard(document.activeElement)
        apply()
      }, 120)
    }
    const onResize = () => {
      if (!vv) return
      if (!focused && vv.height > base) base = vv.height
      shrunk = base - vv.height > 140
      if (!shrunk && !focused) base = vv.height
      apply()
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    vv?.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      vv?.removeEventListener('resize', onResize)
    }
  }, [])

  return open
}
