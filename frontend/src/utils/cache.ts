const mem = new Map<string, unknown>()
let uid: number | null = null

export const setCacheUser = (id: number | null) => {
  uid = id
}

const k = (key: string) => (uid ? `tb:${uid}:${key}` : null)

export function cacheGet<T>(key: string): T | null {
  const full = k(key)
  if (!full) return null
  if (mem.has(full)) return mem.get(full) as T
  try {
    const raw = localStorage.getItem(full)
    if (raw) {
      const v = JSON.parse(raw) as T
      mem.set(full, v)
      return v
    }
  } catch {
  }
  return null
}

export function cacheSet(key: string, value: unknown) {
  const full = k(key)
  if (!full) return
  mem.set(full, value)
  try {
    localStorage.setItem(full, JSON.stringify(value))
  } catch {
  }
}

const inflight = new Map<string, Promise<unknown>>()

export function prefetch(key: string, fn: () => Promise<unknown>) {
  const p = fn().then((v) => {
    cacheSet(key, v)
    return v
  })
  p.catch(() => undefined)
  inflight.set(key, p)
  p.finally(() => inflight.delete(key)).catch(() => undefined)
}

export function takeInflight(key: string): Promise<unknown> | null {
  const p = inflight.get(key) ?? null
  if (p) inflight.delete(key)
  return p
}

export function cacheDrop(...prefixes: string[]) {
  if (!uid) return
  const base = `tb:${uid}:`
  const match = (k: string) => prefixes.some((p) => k.startsWith(base + p))
  for (const k of [...mem.keys()]) if (match(k)) mem.delete(k)
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && match(k)) localStorage.removeItem(k)
    }
  } catch {
  }
}
