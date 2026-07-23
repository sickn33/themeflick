import type { FavoriteMovie } from '../types'

const DEVICE_FAVORITES_KEY = 'themeflick:favorites:v1'
const MAX_FAVORITES = 100
export const FAVORITES_CHANGED_EVENT = 'themeflick:favorites-changed'
let activeFavoritesKey = DEVICE_FAVORITES_KEY

export type FavoriteChange = { action: 'put' | 'remove'; favorite?: FavoriteMovie; movieId?: number; source: 'user' | 'cloud' }

function accountFavoritesKey(storageScope: string): string { return `themeflick:favorites:account:v2:${storageScope}` }
function isFavoriteMovie(value: unknown): value is FavoriteMovie {
  if (!value || typeof value !== 'object') return false
  const movie = value as Record<string, unknown>
  return typeof movie.id === 'number' && Number.isInteger(movie.id) && movie.id > 0 && typeof movie.title === 'string' && movie.title.length > 0 && movie.title.length <= 160 && (typeof movie.poster_path === 'string' || movie.poster_path === null) && (typeof movie.release_date === 'string' || movie.release_date === null) && typeof movie.vote_average === 'number' && Number.isFinite(movie.vote_average)
}
function readFavoritesAt(key: string): FavoriteMovie[] {
  try { const raw = window.localStorage.getItem(key); if (!raw) return []; const parsed = JSON.parse(raw) as unknown; return Array.isArray(parsed) ? parsed.filter(isFavoriteMovie).slice(0, MAX_FAVORITES) : [] } catch { return [] }
}
function writeFavoritesAt(key: string, favorites: FavoriteMovie[]): void { window.localStorage.setItem(key, JSON.stringify(favorites.filter(isFavoriteMovie).slice(0, MAX_FAVORITES))) }
function announce(change?: FavoriteChange): void { window.dispatchEvent?.(new CustomEvent<FavoriteChange | undefined>(FAVORITES_CHANGED_EVENT, { detail: change })) }

export function readFavorites(): FavoriteMovie[] { return readFavoritesAt(activeFavoritesKey) }
export function readDeviceFavorites(): FavoriteMovie[] { return readFavoritesAt(DEVICE_FAVORITES_KEY) }
export function activateAccountFavorites(storageScope: string, favorites: FavoriteMovie[]): void {
  activeFavoritesKey = accountFavoritesKey(storageScope)
  try { writeFavoritesAt(activeFavoritesKey, favorites) } catch { /* cloud remains authoritative */ }
  announce({ action: 'put', source: 'cloud' })
}
export function activateDeviceFavorites(): void { activeFavoritesKey = DEVICE_FAVORITES_KEY; announce() }
export function clearDeviceFavorites(): void { try { window.localStorage.removeItem(DEVICE_FAVORITES_KEY) } catch { /* imported cloud copy remains */ } }
export function replaceFavoritesFromCloud(favorites: FavoriteMovie[]): void {
  try { writeFavoritesAt(activeFavoritesKey, favorites); announce({ action: 'put', source: 'cloud' }) } catch { /* optional local cache */ }
}
export function saveFavorites(favorites: FavoriteMovie[], change?: FavoriteChange): void {
  try { writeFavoritesAt(activeFavoritesKey, favorites); announce(change) } catch { /* optional local state */ }
}
export function subscribeToFavorites(listener: (change?: FavoriteChange) => void): () => void {
  const custom = (event: Event) => listener((event as CustomEvent<FavoriteChange | undefined>).detail)
  const storage = (event: StorageEvent) => { if (event.key === null || event.key === activeFavoritesKey) listener() }
  window.addEventListener(FAVORITES_CHANGED_EVENT, custom); window.addEventListener('storage', storage)
  return () => { window.removeEventListener(FAVORITES_CHANGED_EVENT, custom); window.removeEventListener('storage', storage) }
}
export function isFavorite(movieId: number): boolean { return readFavorites().some((movie) => movie.id === movieId) }
export function toggleFavorite(movie: FavoriteMovie): boolean {
  const favorites = readFavorites(); const index = favorites.findIndex((item) => item.id === movie.id)
  if (index >= 0) { favorites.splice(index, 1); saveFavorites(favorites, { action: 'remove', movieId: movie.id, source: 'user' }); return false }
  saveFavorites([movie, ...favorites], { action: 'put', favorite: movie, source: 'user' }); return true
}
