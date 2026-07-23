interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  TMDB_API_KEY?: string
  TMDB_ACCESS_TOKEN?: string
  DB?: D1Database
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
}

type AuthenticatedUser = {
  email: string
  displayName: string
}

type FavoriteRecord = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
}

type AllowedRoute = {
  pattern: RegExp
  queryKeys: ReadonlySet<string>
  ttl: number
}

const TMDB_ORIGIN = 'https://api.themoviedb.org/3'
const TMDB_TIMEOUT_MS = 10_000
const USER_EMAIL_HEADER = 'oai-authenticated-user-email'
const USER_FULL_NAME_HEADER = 'oai-authenticated-user-full-name'
const USER_FULL_NAME_ENCODING_HEADER = 'oai-authenticated-user-full-name-encoding'
const MAX_FAVORITES = 100

const allowedRoutes: AllowedRoute[] = [
  { pattern: /^\/configuration$/, queryKeys: new Set(), ttl: 86_400 },
  {
    pattern: /^\/search\/movie$/,
    queryKeys: new Set(['query', 'include_adult', 'language', 'page']),
    ttl: 120,
  },
  {
    pattern: /^\/movie\/\d+$/,
    queryKeys: new Set(['append_to_response', 'language']),
    ttl: 3_600,
  },
  {
    pattern: /^\/movie\/\d+\/(?:similar|recommendations)$/,
    queryKeys: new Set(['language', 'page']),
    ttl: 900,
  },
  {
    pattern: /^\/person\/\d+\/movie_credits$/,
    queryKeys: new Set(['language']),
    ttl: 3_600,
  },
  {
    pattern: /^\/discover\/movie$/,
    queryKeys: new Set([
      'language',
      'include_adult',
      'sort_by',
      'vote_count.gte',
      'with_keywords',
      'page',
    ]),
    ttl: 900,
  },
]

function jsonError(status: number, message: string): Response {
  return privateJson({ error: { message } }, status)
}

function privateJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      vary: [USER_EMAIL_HEADER, USER_FULL_NAME_HEADER].join(', '),
    },
  })
}

function decodeFullName(request: Request): string | null {
  const encoded = request.headers.get(USER_FULL_NAME_HEADER)
  if (!encoded || request.headers.get(USER_FULL_NAME_ENCODING_HEADER) !== 'percent-encoded-utf-8') return null
  try {
    const decoded = decodeURIComponent(encoded).trim()
    return decoded.length > 0 && decoded.length <= 160 ? decoded : null
  } catch {
    return null
  }
}

function getAuthenticatedUser(request: Request): AuthenticatedUser | null {
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim().toLowerCase()
  if (!email || email.length > 254 || !email.includes('@')) return null
  return { email, displayName: decodeFullName(request) ?? email }
}

function requireMutationRequest(request: Request): Response | null {
  if (request.headers.get('x-themeflick-request') !== '1') {
    return jsonError(403, 'Invalid application request')
  }
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) {
    return jsonError(403, 'Cross-origin writes are not allowed')
  }
  return null
}

function isFavoriteRecord(value: unknown): value is FavoriteRecord {
  if (!value || typeof value !== 'object') return false
  const movie = value as Record<string, unknown>
  return (
    typeof movie.id === 'number' &&
    Number.isInteger(movie.id) &&
    movie.id > 0 &&
    typeof movie.title === 'string' &&
    movie.title.trim().length > 0 &&
    movie.title.length <= 160 &&
    (movie.poster_path === null ||
      (typeof movie.poster_path === 'string' && movie.poster_path.length <= 200 && movie.poster_path.startsWith('/'))) &&
    (movie.release_date === null ||
      (typeof movie.release_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(movie.release_date))) &&
    typeof movie.vote_average === 'number' &&
    Number.isFinite(movie.vote_average) &&
    movie.vote_average >= 0 &&
    movie.vote_average <= 10
  )
}

function normalizeFavorites(value: unknown): FavoriteRecord[] | null {
  if (!Array.isArray(value) || value.length > MAX_FAVORITES) return null
  const deduplicated = new Map<number, FavoriteRecord>()
  for (const favorite of value) {
    if (!isFavoriteRecord(favorite)) return null
    if (!deduplicated.has(favorite.id)) {
      deduplicated.set(favorite.id, { ...favorite, title: favorite.title.trim() })
    }
  }
  return [...deduplicated.values()]
}

async function readFavorites(db: D1Database, email: string): Promise<FavoriteRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT movie_id AS id, title, poster_path, release_date, vote_average
       FROM favorites
       WHERE user_email = ?
       ORDER BY sort_order ASC, movie_id DESC
       LIMIT 100`,
    )
    .bind(email)
    .all<FavoriteRecord>()
  return results
}

function favoriteUpsert(
  db: D1Database,
  email: string,
  favorite: FavoriteRecord,
  sortOrder: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO favorites
        (user_email, movie_id, title, poster_path, release_date, vote_average, sort_order, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_email, movie_id) DO UPDATE SET
        title = excluded.title,
        poster_path = excluded.poster_path,
        release_date = excluded.release_date,
        vote_average = excluded.vote_average,
        sort_order = excluded.sort_order`,
    )
    .bind(
      email,
      favorite.id,
      favorite.title,
      favorite.poster_path,
      favorite.release_date,
      favorite.vote_average,
      sortOrder,
    )
}

async function handleAccountApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const user = getAuthenticatedUser(request)

  if (url.pathname === '/api/account' && request.method === 'GET') {
    return privateJson(
      user
        ? { authenticated: true, displayName: user.displayName, email: user.email }
        : { authenticated: false, displayName: null, email: null },
    )
  }

  if (!user) return jsonError(401, 'Sign in with ChatGPT to continue')
  if (!env.DB) return jsonError(503, 'Favorite sync is not configured')

  if (url.pathname === '/api/favorites' && request.method === 'GET') {
    return privateJson({ favorites: await readFavorites(env.DB, user.email) })
  }

  if (
    (url.pathname === '/api/favorites/sync' || url.pathname === '/api/favorites/import') &&
    request.method === 'POST'
  ) {
    const invalidRequest = requireMutationRequest(request)
    if (invalidRequest) return invalidRequest
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
      return jsonError(415, 'JSON content type is required')
    }
    let payload: { favorites?: unknown }
    try {
      payload = (await request.json()) as { favorites?: unknown }
    } catch {
      return jsonError(400, 'Invalid JSON payload')
    }
    const favorites = normalizeFavorites(payload.favorites)
    if (!favorites) {
      return jsonError(400, 'Invalid favorites payload')
    }

    const statements = favorites.map((favorite, index) => favoriteUpsert(env.DB!, user.email, favorite, index))
    if (url.pathname === '/api/favorites/sync') {
      statements.unshift(env.DB.prepare('DELETE FROM favorites WHERE user_email = ?').bind(user.email))
    }
    if (statements.length > 0) await env.DB.batch(statements)
    return privateJson({ favorites: await readFavorites(env.DB, user.email) })
  }

  if (url.pathname === '/api/account/data' && request.method === 'DELETE') {
    const invalidRequest = requireMutationRequest(request)
    if (invalidRequest) return invalidRequest
    await env.DB.prepare('DELETE FROM favorites WHERE user_email = ?').bind(user.email).run()
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        vary: USER_EMAIL_HEADER,
      },
    })
  }

  return jsonError(404, 'Account route not found')
}

function hasValidValue(key: string, value: string): boolean {
  switch (key) {
    case 'query':
      return value.trim().length > 0 && value.length <= 100
    case 'include_adult':
      return value === 'false'
    case 'language':
      return value === 'en-US'
    case 'page':
      return value === '1' || value === '2'
    case 'append_to_response':
      return value === 'credits,keywords'
    case 'sort_by':
      return value === 'popularity.desc' || value === 'vote_average.desc'
    case 'vote_count.gte':
      return /^\d{1,6}$/.test(value)
    case 'with_keywords':
      return /^\d+(?:\|\d+)*$/.test(value) && value.length <= 120
    default:
      return false
  }
}

function validateQuery(searchParams: URLSearchParams, route: AllowedRoute): boolean {
  const seen = new Set<string>()
  for (const [key, value] of searchParams) {
    if (seen.has(key) || !route.queryKeys.has(key) || !hasValidValue(key, value)) return false
    seen.add(key)
  }
  return true
}

async function proxyTmdb(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== 'GET') return jsonError(405, 'Method not allowed')

  const incoming = new URL(request.url)
  const path = incoming.pathname.slice('/api/tmdb'.length)
  const route = allowedRoutes.find((candidate) => candidate.pattern.test(path))
  if (!route) return jsonError(404, 'Movie data route not found')
  if (!validateQuery(incoming.searchParams, route)) return jsonError(400, 'Invalid movie data query')

  if (!env.TMDB_ACCESS_TOKEN && !env.TMDB_API_KEY) {
    return jsonError(503, 'Movie data is not configured')
  }

  const target = new URL(`${TMDB_ORIGIN}${path}`)
  for (const [key, value] of incoming.searchParams) target.searchParams.set(key, value)
  if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) target.searchParams.set('api_key', env.TMDB_API_KEY)

  const headers = new Headers({ accept: 'application/json' })
  if (env.TMDB_ACCESS_TOKEN) headers.set('authorization', `Bearer ${env.TMDB_ACCESS_TOKEN}`)

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers,
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
    })
  } catch {
    return jsonError(502, 'Movie data service is unavailable')
  }

  const responseHeaders = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': upstream.ok ? `public, max-age=${route.ttl}` : 'no-store',
    'x-content-type-options': 'nosniff',
  })
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })

  return response
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/tmdb/')) return proxyTmdb(request, env)
    if (url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/favorites')) {
      try {
        return await handleAccountApi(request, env)
      } catch {
        return jsonError(500, 'Account data is temporarily unavailable')
      }
    }

    const asset = await env.ASSETS.fetch(request)
    if (!asset.headers.get('content-type')?.includes('text/html')) return asset

    const headers = new Headers(asset.headers)
    headers.set('x-content-type-options', 'nosniff')
    headers.set('referrer-policy', 'strict-origin-when-cross-origin')
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
    const html = (await asset.text()).replaceAll('__THEMEFLICK_ORIGIN__', url.origin)
    return new Response(html, { status: asset.status, statusText: asset.statusText, headers })
  },
}

export default worker
