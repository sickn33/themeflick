import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from './index'

const assets = {
  fetch: vi.fn(async () => new Response('asset')),
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TMDB Worker proxy', () => {
  it('rejects routes and parameters outside the explicit allowlist', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const unknownRoute = await worker.fetch(
      new Request('https://themeflick.example/api/tmdb/account/1'),
      { ASSETS: assets, TMDB_API_KEY: 'server-secret' },
    )
    const injectedKey = await worker.fetch(
      new Request('https://themeflick.example/api/tmdb/search/movie?query=Alien&api_key=stolen'),
      { ASSETS: assets, TMDB_API_KEY: 'server-secret' },
    )

    expect(unknownRoute.status).toBe(404)
    expect(injectedKey.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds the runtime token only to the allowlisted upstream request', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ results: [] }, { headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(
      new Request('https://themeflick.example/api/tmdb/search/movie?query=Alien&include_adult=false&language=en-US&page=1'),
      { ASSETS: assets, TMDB_ACCESS_TOKEN: 'server-secret' },
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [target, init] = fetchMock.mock.calls[0]
    expect(String(target)).toBe(
      'https://api.themoviedb.org/3/search/movie?query=Alien&include_adult=false&language=en-US&page=1',
    )
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-secret')
    expect(response.headers.get('cache-control')).toBe('public, max-age=120')
  })

  it('fails closed when Sites has no runtime credential', async () => {
    const response = await worker.fetch(
      new Request('https://themeflick.example/api/tmdb/configuration'),
      { ASSETS: assets },
    )

    expect(response.status).toBe(503)
  })

  it('renders an absolute social image URL from the deployed origin', async () => {
    const htmlAssets = {
      fetch: vi.fn(async () =>
        new Response('<meta property="og:image" content="__THEMEFLICK_ORIGIN__/og.png">', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    }
    const response = await worker.fetch(
      new Request('https://private-themeflick.example/movies/603'),
      { ASSETS: htmlAssets },
    )

    expect(await response.text()).toContain('https://private-themeflick.example/og.png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
