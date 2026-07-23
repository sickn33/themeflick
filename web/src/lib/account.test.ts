import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteCloudData,
  getAccount,
  getCloudFavorites,
  importCloudFavorites,
  replaceCloudFavorites,
  signInPath,
  signOutPath,
} from './account'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('account API client', () => {
  it('loads account and cloud favorites without sending user identity from the browser', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ authenticated: true, displayName: 'Ada', email: 'ada@example.com' }))
      .mockResolvedValueOnce(Response.json({ favorites: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAccount()).resolves.toMatchObject({ authenticated: true, displayName: 'Ada' })
    await expect(getCloudFavorites()).resolves.toEqual([])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/account')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/favorites')
  })

  it('uses separate explicit import and replacement mutations', async () => {
    const favorite = { id: 603, title: 'The Matrix', poster_path: null, release_date: '1999-03-30', vote_average: 8.2 }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return Response.json({ favorites: [favorite] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await importCloudFavorites([favorite])
    await replaceCloudFavorites([favorite])

    const calls = fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
    expect(calls.map(([path]) => path)).toEqual(['/api/favorites/import', '/api/favorites/sync'])
    for (const [, init] of calls) {
      expect(new Headers(init?.headers).get('x-themeflick-request')).toBe('1')
      expect(JSON.parse(String(init?.body))).toEqual({ favorites: [favorite] })
    }
  })

  it('deletes cloud data through a protected mutation', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteCloudData()

    expect(fetchMock).toHaveBeenCalledWith('/api/account/data', expect.objectContaining({ method: 'DELETE' }))
  })
})

describe('dispatcher auth paths', () => {
  it('keeps safe relative return paths', () => {
    expect(signInPath('/favorites?from=account')).toBe('/signin-with-chatgpt?return_to=%2Ffavorites%3Ffrom%3Daccount')
    expect(signOutPath('/')).toBe('/signout-with-chatgpt?return_to=%2F')
  })

  it('rejects external, protocol-relative, and reserved return paths', () => {
    expect(signInPath('https://evil.example')).toBe('/signin-with-chatgpt?return_to=%2F')
    expect(signInPath('//evil.example')).toBe('/signin-with-chatgpt?return_to=%2F')
    expect(signInPath('/callback')).toBe('/signin-with-chatgpt?return_to=%2F')
  })
})
