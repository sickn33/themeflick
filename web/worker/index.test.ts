import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from './index'

const assets = {
  fetch: vi.fn(async () => new Response('asset')),
}

type StoredFavorite = {
  email: string
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  sort_order: number
}

class FakeStatement {
  values: unknown[] = []

  constructor(
    private database: FakeD1,
    private query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async all<T>() {
    const email = String(this.values[0])
    const results = this.database.rows
      .filter((row) => row.email === email)
      .sort((left, right) => left.sort_order - right.sort_order || right.id - left.id)
      .map((row) => ({
        id: row.id,
        title: row.title,
        poster_path: row.poster_path,
        release_date: row.release_date,
        vote_average: row.vote_average,
      }))
    return { results: results as T[] }
  }

  async run() {
    this.database.execute(this)
    return {}
  }

  execute() {
    this.database.execute(this)
  }

  get sql() {
    return this.query
  }
}

class FakeD1 {
  rows: StoredFavorite[] = []

  prepare(query: string) {
    return new FakeStatement(this, query)
  }

  async batch(statements: FakeStatement[]) {
    statements.forEach((statement) => statement.execute())
    return []
  }

  execute(statement: FakeStatement) {
    if (statement.sql.includes('DELETE FROM favorites')) {
      const email = String(statement.values[0])
      this.rows = this.rows.filter((row) => row.email !== email)
      return
    }
    if (!statement.sql.includes('INSERT INTO favorites')) return
    const [email, id, title, posterPath, releaseDate, voteAverage, sortOrder] = statement.values
    this.rows = this.rows.filter((row) => row.email !== email || row.id !== id)
    this.rows.push({
      email: String(email),
      id: Number(id),
      title: String(title),
      poster_path: posterPath === null ? null : String(posterPath),
      release_date: releaseDate === null ? null : String(releaseDate),
      vote_average: Number(voteAverage),
      sort_order: Number(sortOrder),
    })
  }
}

function signedHeaders(email: string, name?: string): HeadersInit {
  return {
    'oai-authenticated-user-email': email,
    ...(name
      ? {
          'oai-authenticated-user-full-name': encodeURIComponent(name),
          'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
        }
      : {}),
  }
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

describe('account and favorite APIs', () => {
  it('reports optional dispatcher identity without caching it', async () => {
    const anonymous = await worker.fetch(new Request('https://themeflick.example/api/account'), { ASSETS: assets })
    const signedIn = await worker.fetch(
      new Request('https://themeflick.example/api/account', { headers: signedHeaders('ADA@EXAMPLE.COM', 'Ada Lovelace') }),
      { ASSETS: assets },
    )

    await expect(anonymous.json()).resolves.toEqual({ authenticated: false, displayName: null, email: null })
    await expect(signedIn.json()).resolves.toEqual({
      authenticated: true,
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
    })
    expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
    expect(signedIn.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('fails closed for private data without identity or a database binding', async () => {
    const anonymous = await worker.fetch(new Request('https://themeflick.example/api/favorites'), { ASSETS: assets })
    const missingDatabase = await worker.fetch(
      new Request('https://themeflick.example/api/favorites', { headers: signedHeaders('ada@example.com') }),
      { ASSETS: assets },
    )

    expect(anonymous.status).toBe(401)
    expect(missingDatabase.status).toBe(503)
  })

  it('imports explicitly, replaces atomically, and isolates users', async () => {
    const DB = new FakeD1()
    const favorite = { id: 603, title: 'The Matrix', poster_path: null, release_date: '1999-03-30', vote_average: 8.2 }
    const mutationHeaders = {
      ...signedHeaders('ada@example.com'),
      origin: 'https://themeflick.example',
      'content-type': 'application/json',
      'x-themeflick-request': '1',
    }
    const imported = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/import', {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ favorites: [favorite] }),
      }),
      { ASSETS: assets, DB },
    )
    const otherUser = await worker.fetch(
      new Request('https://themeflick.example/api/favorites', { headers: signedHeaders('grace@example.com') }),
      { ASSETS: assets, DB },
    )
    const replaced = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/sync', {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ favorites: [] }),
      }),
      { ASSETS: assets, DB },
    )

    expect(imported.status).toBe(200)
    await expect(imported.json()).resolves.toEqual({ favorites: [favorite] })
    await expect(otherUser.json()).resolves.toEqual({ favorites: [] })
    await expect(replaced.json()).resolves.toEqual({ favorites: [] })
  })

  it('rejects cross-origin, unmarked, and malformed writes', async () => {
    const DB = new FakeD1()
    const baseHeaders = { ...signedHeaders('ada@example.com'), 'content-type': 'application/json' }
    const crossOrigin = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/import', {
        method: 'POST',
        headers: { ...baseHeaders, origin: 'https://evil.example', 'x-themeflick-request': '1' },
        body: JSON.stringify({ favorites: [] }),
      }),
      { ASSETS: assets, DB },
    )
    const unmarked = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/import', {
        method: 'POST',
        headers: { ...baseHeaders, origin: 'https://themeflick.example' },
        body: JSON.stringify({ favorites: [] }),
      }),
      { ASSETS: assets, DB },
    )
    const malformed = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/import', {
        method: 'POST',
        headers: { ...baseHeaders, origin: 'https://themeflick.example', 'x-themeflick-request': '1' },
        body: JSON.stringify({ favorites: [{ id: 'not-a-number' }] }),
      }),
      { ASSETS: assets, DB },
    )

    expect(crossOrigin.status).toBe(403)
    expect(unmarked.status).toBe(403)
    expect(malformed.status).toBe(400)
    expect(DB.rows).toEqual([])
  })
})
