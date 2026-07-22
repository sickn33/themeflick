import type { FavoriteMovie } from '../types'

const FAVORITES_KEY = 'themeflick:favorites:v1'
const MAX_FAVORITES = 100
export const FAVORITES_CHANGED_EVENT = 'themeflick:favorites-changed'

function isFavoriteMovie(value: unknown): value is FavoriteMovie {
  if (!value || typeof value !== 'object') {
    return false
  }

  const movie = value as Record<string, unknown>
  return (
    typeof movie.id === 'number' &&
    Number.isFinite(movie.id) &&
    typeof movie.title === 'string' &&
    movie.title.length > 0 &&
    movie.title.length <= 160 &&
    (typeof movie.poster_path === 'string' || movie.poster_path === null) &&
    (typeof movie.release_date === 'string' || movie.release_date === null) &&
    typeof movie.vote_average === 'number' &&
    Number.isFinite(movie.vote_average)
  )
}

export function readFavorites(): FavoriteMovie[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as FavoriteMovie[]
    return Array.isArray(parsed) ? parsed.filter(isFavoriteMovie).slice(0, MAX_FAVORITES) : []
  } catch {
    return []
  }
}

export function saveFavorites(favorites: FavoriteMovie[]): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.filter(isFavoriteMovie).slice(0, MAX_FAVORITES)))
    window.dispatchEvent?.(new Event(FAVORITES_CHANGED_EVENT))
  } catch {
    // Storage can be unavailable or full; favorites are optional local state.
  }
}

export function subscribeToFavorites(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === FAVORITES_KEY) {
      listener()
    }
  }

  window.addEventListener(FAVORITES_CHANGED_EVENT, listener)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(FAVORITES_CHANGED_EVENT, listener)
    window.removeEventListener('storage', handleStorage)
  }
}

export function isFavorite(movieId: number): boolean {
  return readFavorites().some((movie) => movie.id === movieId)
}

export function toggleFavorite(movie: FavoriteMovie): boolean {
  const favorites = readFavorites()
  const index = favorites.findIndex((item) => item.id === movie.id)

  if (index >= 0) {
    favorites.splice(index, 1)
    saveFavorites(favorites)
    return false
  }

  saveFavorites([movie, ...favorites])
  return true
}
