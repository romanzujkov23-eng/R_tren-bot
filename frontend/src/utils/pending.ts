export interface PendingSet {
  client_id: string
  exercise_id: number
  reps: number
  weight: number
  distance: number | null
}

const key = (sessionId: number) => `tb:pending:${sessionId}`

export function loadPending(sessionId: number): PendingSet[] {
  try {
    const raw = localStorage.getItem(key(sessionId))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function savePending(sessionId: number, list: PendingSet[]) {
  try {
    if (list.length) localStorage.setItem(key(sessionId), JSON.stringify(list))
    else localStorage.removeItem(key(sessionId))
  } catch {
    return
  }
}

export function newClientId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
