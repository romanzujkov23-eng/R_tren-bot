import { useSyncExternalStore } from 'react'

export type MapVersion = 'classic' | 'pro'

const KEY = 'tb:mapver'
const listeners = new Set<() => void>()

export function getMapVersion(): MapVersion {
  try {
    return localStorage.getItem(KEY) === 'pro' ? 'pro' : 'classic'
  } catch {
    return 'classic'
  }
}

export function setMapVersion(v: MapVersion) {
  try {
    localStorage.setItem(KEY, v)
  } catch {}
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export function useMapVersion(): MapVersion {
  return useSyncExternalStore(subscribe, getMapVersion, () => 'classic' as MapVersion)
}
