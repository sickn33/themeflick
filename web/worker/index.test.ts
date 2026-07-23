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

  async first<T>() {
    if (this.query.includes('RETURNING request_count')) {
      const scope = String(this.values[0])
      const count = (this.database.budgets.get(scope) ?? 0) + 1
      this.database.budgets.set(scope, count)
      return { requestCount: count } as T
    }
    if (this.query.includes('FROM favorite_accounts')) {
      const account = this.database.accounts.get(String(this.values[0]))
      return account ? { ...account } as T : null
    }
    if (this.query.includes('FROM favorite_operations')) {
      return (this.database.operations.has(`${this.values[0]}:${this.values[1]}`) ? { present: 1 } : null) as T | null
    }
    if (this.query.includes('SELECT 1 AS ready')) return { ready: 1 } as T
    return null
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
  accounts = new Map<string, { storageScope: string; generation: string; revision: number }>()
  operations = new Set<string>()
  budgets = new Map<string, number>()

  prepare(query: string) {
    return new FakeStatement(this, query)
  }

  async batch(statements: FakeStatement[]) {
    statements.forEach((statement) => statement.execute())
    return []
  }

  execute(statement: FakeStatement) {
    if (statement.sql.includes('INSERT OR IGNORE INTO favorite_accounts')) {
      const [email, storageScope, generation] = statement.values.map(String)
      if (!this.accounts.has(email)) this.accounts.set(email, { storageScope, generation, revision: 0 })
      return
    }
    if (statement.sql.includes('INSERT OR IGNORE INTO favorite_operations')) {
      this.operations.add(`${statement.values[0]}:${statement.values[1]}`)
      return
    }
    if (statement.sql.includes('UPDATE favorite_accounts')) {
      const email = String(statement.values[0]); const account = this.accounts.get(email)
      if (account) account.revision += 1
      return
    }
    if (statement.sql.includes('DELETE FROM favorite_accounts')) {
      this.accounts.delete(String(statement.values[0])); return
    }
    if (statement.sql.includes('DELETE FROM favorite_operations')) {
      const email = `${statement.values[0]}:`
      this.operations = new Set([...this.operations].filter((item) => !item.startsWith(email))); return
    }
    if (statement.sql.includes('DELETE FROM favorites') && statement.sql.includes('movie_id = ?')) {
      const [email, id] = statement.values
      this.rows = this.rows.filter((row) => row.email !== email || row.id !== id); return
    }
    if (statement.sql.includes('DELETE FROM favorites') && !statement.sql.includes('NOT IN')) {
      const email = String(statement.values[0])
      this.rows = this.rows.filter((row) => row.email !== email)
      return
    }
    if (statement.sql.includes('UPDATE favorites SET sort_order')) {
      const email = String(statement.values[0]); this.rows.filter((row) => row.email === email).forEach((row) => { row.sort_order += 1 }); return
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
      new Request('https://themeflick.example/api/tmdb/account/1', { headers: { 'cf-connecting-ip': '203.0.113.1' } }),
      { ASSETS: assets, TMDB_API_KEY: 'server-secret', DB: new FakeD1() },
    )
    const injectedKey = await worker.fetch(
      new Request('https://themeflick.example/api/tmdb/search/movie?query=Alien&api_key=stolen', { headers: { 'cf-connecting-ip': '203.0.113.1' } }),
      { ASSETS: assets, TMDB_API_KEY: 'server-secret', DB: new FakeD1() },
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
      new Request('https://themeflick.example/api/tmdb/search/movie?query=Alien&include_adult=false&language=en-US&page=1', { headers: { 'cf-connecting-ip': '203.0.113.1' } }),
      { ASSETS: assets, TMDB_ACCESS_TOKEN: 'server-secret', DB: new FakeD1() },
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
      { ASSETS: assets, DB: new FakeD1() },
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
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
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

  it('imports explicitly, applies incremental mutations, and isolates users', async () => {
    const DB = new FakeD1()
    const favorite = { id: 603, title: 'The Matrix', poster_path: null, release_date: '1999-03-30', vote_average: 8.2 }
    const mutationHeaders = {
      ...signedHeaders('ada@example.com'),
      origin: 'https://themeflick.example',
      'content-type': 'application/json',
      'x-themeflick-request': '1',
      'cf-connecting-ip': '203.0.113.8',
    }
    const bootstrap = await worker.fetch(
      new Request('https://themeflick.example/api/favorites', { headers: signedHeaders('ada@example.com') }),
      { ASSETS: assets, DB },
    )
    const initialState = await bootstrap.json() as { generation: string }
    const imported = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/import', {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ operationId: '11111111-1111-4111-8111-111111111111', generation: initialState.generation, favorites: [favorite] }),
      }),
      { ASSETS: assets, DB },
    )
    const otherUser = await worker.fetch(
      new Request('https://themeflick.example/api/favorites', { headers: signedHeaders('grace@example.com') }),
      { ASSETS: assets, DB },
    )
    const removed = await worker.fetch(
      new Request('https://themeflick.example/api/favorites/mutation', {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({ operationId: '22222222-2222-4222-8222-222222222222', generation: initialState.generation, action: 'remove', movieId: 603 }),
      }),
      { ASSETS: assets, DB },
    )

    expect(imported.status).toBe(200)
    await expect(imported.json()).resolves.toMatchObject({ favorites: [favorite], revision: 1 })
    await expect(otherUser.json()).resolves.toMatchObject({ favorites: [] })
    await expect(removed.json()).resolves.toMatchObject({ favorites: [], revision: 2 })
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
        headers: { ...baseHeaders, origin: 'https://themeflick.example', 'x-themeflick-request': '1', 'cf-connecting-ip': '203.0.113.8' },
        body: JSON.stringify({ favorites: [{ id: 'not-a-number' }] }),
      }),
      { ASSETS: assets, DB },
    )

    expect(crossOrigin.status).toBe(403)
    expect(unmarked.status).toBe(403)
    expect(malformed.status).toBe(400)
    expect(DB.rows).toEqual([])
  })

  it('rejects an oversized body before JSON parsing', async () => {
    const DB = new FakeD1()
    const response = await worker.fetch(new Request('https://themeflick.example/api/favorites/import', {
      method: 'POST',
      headers: {
        ...signedHeaders('ada@example.com'),
        origin: 'https://themeflick.example',
        'content-type': 'application/json',
        'content-length': String(256 * 1024 + 1),
        'x-themeflick-request': '1',
        'cf-connecting-ip': '203.0.113.8',
      },
      body: '{}',
    }), { ASSETS: assets, DB })

    expect(response.status).toBe(413)
  })
})
