import type { FavoriteMovie } from '../types'

export type Account = { authenticated: boolean; displayName: string | null; email: string | null }
export type SyncState = 'checking' | 'local' | 'syncing' | 'synced' | 'error'
export type FavoriteState = {
  favorites: FavoriteMovie[]
  storageScope: string
  generation: string
  revision: number
}
export type FavoriteMutation = {
  operationId: string
  generation: string
  action: 'put' | 'remove'
  favorite?: FavoriteMovie
  movieId?: number
}

const MUTATION_HEADERS = { 'content-type': 'application/json', 'x-themeflick-request': '1' }

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Account request failed (${response.status})`)
  return (await response.json()) as T
}

export async function getAccount(): Promise<Account> {
  return parseJson<Account>(await fetch('/api/account', { credentials: 'same-origin' }))
}

export async function getCloudFavorites(): Promise<FavoriteState> {
  return parseJson<FavoriteState>(await fetch('/api/favorites', { credentials: 'same-origin' }))
}

export async function sendFavoriteMutation(mutation: FavoriteMutation): Promise<FavoriteState> {
  return parseJson<FavoriteState>(await fetch('/api/favorites/mutation', {
    method: 'POST', credentials: 'same-origin', headers: MUTATION_HEADERS, body: JSON.stringify(mutation),
  }))
}

export async function importCloudFavorites(generation: string, favorites: FavoriteMovie[]): Promise<FavoriteState> {
  return parseJson<FavoriteState>(await fetch('/api/favorites/import', {
    method: 'POST', credentials: 'same-origin', headers: MUTATION_HEADERS,
    body: JSON.stringify({ operationId: crypto.randomUUID(), generation, favorites }),
  }))
}

export async function deleteCloudData(generation: string): Promise<void> {
  const response = await fetch('/api/account/data', {
    method: 'DELETE', credentials: 'same-origin', headers: MUTATION_HEADERS, body: JSON.stringify({ generation }),
  })
  if (!response.ok) throw new Error(`Account deletion failed (${response.status})`)
}

export async function downloadCloudData(): Promise<void> {
  const response = await fetch('/api/account/export', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Account export failed (${response.status})`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `themeflick-export-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function signInPath(returnTo = '/'): string { return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeRelativeReturnTo(returnTo))}` }
export function signOutPath(returnTo = '/'): string { return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeRelativeReturnTo(returnTo))}` }

function safeRelativeReturnTo(returnTo: string): string {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return '/'
  try {
    const url = new URL(returnTo, 'https://themeflick.local')
    if (url.origin !== 'https://themeflick.local' || ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(url.pathname)) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return '/' }
}
