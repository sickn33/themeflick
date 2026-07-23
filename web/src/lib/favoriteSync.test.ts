import { afterEach, describe, expect, it, vi } from 'vitest'

import { FavoriteSync } from './favoriteSync'

function storageMock() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('FavoriteSync durable outbox', () => {
  it('keeps a failed mutation across controller recreation and removes it only after acknowledgement', async () => {
    const storage = storageMock()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn() })
    const favorite = { id: 603, title: 'The Matrix', poster_path: null, release_date: '1999-03-30', vote_average: 8.2 }
    const state = { favorites: [], storageScope: 'opaque-scope', generation: '11111111-1111-4111-8111-111111111111', revision: 0 }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ ...state, favorites: [favorite], revision: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = new FavoriteSync(state, vi.fn())
    first.enqueue({ action: 'put', favorite, source: 'user' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(storage.getItem('themeflick:favorite-outbox:v1:opaque-scope') ?? '[]')).toHaveLength(1)

    const reloaded = new FavoriteSync(state, vi.fn())
    await reloaded.drain()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(storage.getItem('themeflick:favorite-outbox:v1:opaque-scope') ?? '[]')).toEqual([])
  })
})
