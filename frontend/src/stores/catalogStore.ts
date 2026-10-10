import { create } from 'zustand'
import { api, type CatalogItem } from '../services/api'
import { cacheGet, cacheSet } from '../utils/cache'

interface CatalogState {
  items: CatalogItem[]
  loaded: boolean
  load: () => Promise<void>
}

const norm = (s: string) => s.toLowerCase().split(/\s+/).join(' ')

export const useCatalog = create<CatalogState>((set, get) => ({
  items: cacheGet<CatalogItem[]>('catalog') ?? [],
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const cached = cacheGet<CatalogItem[]>('catalog')
    if (cached && get().items.length === 0) set({ items: cached })
    try {
      const items = await api.catalog()
      cacheSet('catalog', items)
      set({ items, loaded: true })
    } catch {
    }
  },
}))

export const findInfo = (items: CatalogItem[], name: string) => items.find((c) => norm(c.name) === norm(name))
