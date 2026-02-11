import type { FavoriteMovie } from '../types'

const FAVORITES_KEY = 'themeflick:favorites:v1'

export function readFavorites(): FavoriteMovie[] {
  const raw = window.localStorage.getItem(FAVORITES_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as FavoriteMovie[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFavorites(favorites: FavoriteMovie[]): void {
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
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

  favorites.unshift(movie)
  saveFavorites(favorites)
  return true
}
