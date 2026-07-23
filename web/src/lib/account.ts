import type { FavoriteMovie } from '../types'

export type Account = {
  authenticated: boolean
  displayName: string | null
  email: string | null
}

export type SyncState = 'checking' | 'local' | 'syncing' | 'synced' | 'error'

const MUTATION_HEADERS = {
  'content-type': 'application/json',
  'x-themeflick-request': '1',
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Account request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export async function getAccount(): Promise<Account> {
  const response = await fetch('/api/account', { credentials: 'same-origin' })
  return parseJson<Account>(response)
}

export async function getCloudFavorites(): Promise<FavoriteMovie[]> {
  const response = await fetch('/api/favorites', { credentials: 'same-origin' })
  const payload = await parseJson<{ favorites: FavoriteMovie[] }>(response)
  return payload.favorites
}

async function sendFavorites(path: string, favorites: FavoriteMovie[]): Promise<FavoriteMovie[]> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ favorites }),
  })
  const payload = await parseJson<{ favorites: FavoriteMovie[] }>(response)
  return payload.favorites
}

export function replaceCloudFavorites(favorites: FavoriteMovie[]): Promise<FavoriteMovie[]> {
  return sendFavorites('/api/favorites/sync', favorites)
}

export async function importCloudFavorites(favorites: FavoriteMovie[]): Promise<FavoriteMovie[]> {
  const response = await fetch('/api/favorites/import', {
    method: 'POST',
    credentials: 'same-origin',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ favorites }),
  })
  const payload = await parseJson<{ favorites: FavoriteMovie[] }>(response)
  return payload.favorites
}

export async function deleteCloudData(): Promise<void> {
  const response = await fetch('/api/account/data', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'x-themeflick-request': '1' },
  })
  if (!response.ok) {
    throw new Error(`Account deletion failed (${response.status})`)
  }
}

export function signInPath(returnTo = '/'): string {
  const safeReturnTo = safeRelativeReturnTo(returnTo)
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo)}`
}

export function signOutPath(returnTo = '/'): string {
  const safeReturnTo = safeRelativeReturnTo(returnTo)
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo)}`
}

function safeRelativeReturnTo(returnTo: string): string {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return '/'
  try {
    const url = new URL(returnTo, 'https://themeflick.local')
    if (url.origin !== 'https://themeflick.local') return '/'
    if (['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(url.pathname)) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
