interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  TMDB_API_KEY?: string
  TMDB_ACCESS_TOKEN?: string
  DB?: D1Database
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
}

type AuthenticatedUser = { email: string; displayName: string }
type FavoriteRecord = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
}
type FavoriteAccount = { storageScope: string; generation: string; revision: number }
type AllowedRoute = { pattern: RegExp; queryKeys: ReadonlySet<string>; ttl: number }

const TMDB_ORIGIN = 'https://api.themoviedb.org/3'
const TMDB_TIMEOUT_MS = 10_000
const USER_EMAIL_HEADER = 'oai-authenticated-user-email'
const USER_FULL_NAME_HEADER = 'oai-authenticated-user-full-name'
const USER_FULL_NAME_ENCODING_HEADER = 'oai-authenticated-user-full-name-encoding'
const MAX_FAVORITES = 100
const MAX_JSON_BYTES = 256 * 1024
const CLIENT_BUDGET = { seconds: 600, requests: 300 }
const GLOBAL_BUDGET = { seconds: 60, requests: 600 }

const allowedRoutes: AllowedRoute[] = [
  { pattern: /^\/configuration$/, queryKeys: new Set(), ttl: 86_400 },
  { pattern: /^\/search\/movie$/, queryKeys: new Set(['query', 'include_adult', 'language', 'page']), ttl: 120 },
  { pattern: /^\/movie\/\d+$/, queryKeys: new Set(['append_to_response', 'language']), ttl: 3_600 },
  { pattern: /^\/movie\/\d+\/(?:similar|recommendations)$/, queryKeys: new Set(['language', 'page']), ttl: 900 },
  { pattern: /^\/person\/\d+\/movie_credits$/, queryKeys: new Set(['language']), ttl: 3_600 },
  {
    pattern: /^\/discover\/movie$/,
    queryKeys: new Set(['language', 'include_adult', 'sort_by', 'vote_count.gte', 'with_keywords', 'page']),
    ttl: 900,
  },
]

function privateJson(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders)
  headers.set('cache-control', 'private, no-store')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('vary', [USER_EMAIL_HEADER, USER_FULL_NAME_HEADER].join(', '))
  return Response.json(value, { status, headers })
}

function jsonError(status: number, message: string, extraHeaders?: HeadersInit): Response {
  return privateJson({ error: { message } }, status, extraHeaders)
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
  if (request.headers.get('x-themeflick-request') !== '1') return jsonError(403, 'Invalid application request')
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) return jsonError(403, 'Cross-origin writes are not allowed')
  return null
}

async function readJsonBody<T>(request: Request): Promise<T> {
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
    throw new Response(null, { status: 415 })
  }
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_JSON_BYTES) throw new Response(null, { status: 413 })
  if (!request.body) throw new Response(null, { status: 400 })
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_JSON_BYTES) {
      await reader.cancel()
      throw new Response(null, { status: 413 })
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T
  } catch {
    throw new Response(null, { status: 400 })
  }
}

function isFavoriteRecord(value: unknown): value is FavoriteRecord {
  if (!value || typeof value !== 'object') return false
  const movie = value as Record<string, unknown>
  return (
    typeof movie.id === 'number' && Number.isInteger(movie.id) && movie.id > 0 &&
    typeof movie.title === 'string' && movie.title.trim().length > 0 && movie.title.length <= 160 &&
    (movie.poster_path === null || (typeof movie.poster_path === 'string' && movie.poster_path.length <= 200 && movie.poster_path.startsWith('/'))) &&
    (movie.release_date === null || (typeof movie.release_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(movie.release_date))) &&
    typeof movie.vote_average === 'number' && Number.isFinite(movie.vote_average) && movie.vote_average >= 0 && movie.vote_average <= 10
  )
}

function normalizeFavorites(value: unknown): FavoriteRecord[] | null {
  if (!Array.isArray(value) || value.length > MAX_FAVORITES) return null
  const unique = new Map<number, FavoriteRecord>()
  for (const favorite of value) {
    if (!isFavoriteRecord(favorite)) return null
    if (!unique.has(favorite.id)) unique.set(favorite.id, { ...favorite, title: favorite.title.trim() })
  }
  return [...unique.values()]
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{16,64}$/i.test(value)
}

async function getFavoriteAccount(db: D1Database, email: string): Promise<FavoriteAccount | null> {
  return db.prepare(
    `SELECT storage_scope AS storageScope, generation, revision FROM favorite_accounts WHERE user_email = ?`,
  ).bind(email).first<FavoriteAccount>()
}

async function ensureFavoriteAccount(db: D1Database, email: string): Promise<FavoriteAccount> {
  const existing = await getFavoriteAccount(db, email)
  if (existing) {
    await db.prepare(`DELETE FROM favorite_operations WHERE user_email = ? AND created_at < datetime('now', '-30 days')`).bind(email).run()
    return existing
  }
  await db.prepare(
    `INSERT OR IGNORE INTO favorite_accounts (user_email, storage_scope, generation) VALUES (?, ?, ?)`,
  ).bind(email, crypto.randomUUID(), crypto.randomUUID()).run()
  const account = await getFavoriteAccount(db, email)
  if (!account) throw new Error('Could not initialize favorite account')
  return account
}

async function readFavorites(db: D1Database, email: string): Promise<FavoriteRecord[]> {
  const { results } = await db.prepare(
    `SELECT movie_id AS id, title, poster_path, release_date, vote_average FROM favorites
     WHERE user_email = ? AND metadata_refreshed_at >= datetime('now', '-175 days')
     ORDER BY sort_order ASC, movie_id DESC LIMIT 100`,
  ).bind(email).all<FavoriteRecord>()
  return results
}

async function refreshStaleFavorites(db: D1Database, email: string, env: Env): Promise<void> {
  if (!env.TMDB_ACCESS_TOKEN && !env.TMDB_API_KEY) return
  const { results } = await db.prepare(
    `SELECT movie_id AS id FROM favorites WHERE user_email = ? AND metadata_refreshed_at < datetime('now', '-175 days') LIMIT 100`,
  ).bind(email).all<{ id: number }>()
  const updates: D1PreparedStatement[] = []
  for (let index = 0; index < results.length; index += 4) {
    const group = results.slice(index, index + 4)
    const records = await Promise.all(group.map(async ({ id }) => {
      const target = new URL(`${TMDB_ORIGIN}/movie/${id}`)
      target.searchParams.set('language', 'en-US')
      if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) target.searchParams.set('api_key', env.TMDB_API_KEY)
      const headers = new Headers({ accept: 'application/json' })
      if (env.TMDB_ACCESS_TOKEN) headers.set('authorization', `Bearer ${env.TMDB_ACCESS_TOKEN}`)
      try {
        const response = await fetch(target, { headers, signal: AbortSignal.timeout(TMDB_TIMEOUT_MS) })
        if (!response.ok) return null
        const payload = await response.json() as Record<string, unknown>
        const record = { id, title: payload.title, poster_path: payload.poster_path, release_date: payload.release_date || null, vote_average: payload.vote_average }
        return isFavoriteRecord(record) ? record : null
      } catch { return null }
    }))
    for (const record of records) {
      if (!record) continue
      updates.push(db.prepare(
        `UPDATE favorites SET title = ?, poster_path = ?, release_date = ?, vote_average = ?, metadata_refreshed_at = CURRENT_TIMESTAMP
         WHERE user_email = ? AND movie_id = ?`,
      ).bind(record.title, record.poster_path, record.release_date, record.vote_average, email, record.id))
    }
  }
  if (updates.length > 0) await db.batch(updates)
}

function stateResponse(account: FavoriteAccount, favorites: FavoriteRecord[]): Response {
  return privateJson({ favorites, storageScope: account.storageScope, generation: account.generation, revision: account.revision })
}

async function hasOperation(db: D1Database, email: string, operationId: string): Promise<boolean> {
  return Boolean(await db.prepare(
    `SELECT 1 AS present FROM favorite_operations WHERE user_email = ? AND operation_id = ?`,
  ).bind(email, operationId).first())
}

function favoriteUpsert(db: D1Database, email: string, favorite: FavoriteRecord, sortOrder: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO favorites
      (user_email, movie_id, title, poster_path, release_date, vote_average, sort_order, saved_at, metadata_refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(user_email, movie_id) DO UPDATE SET title = excluded.title, poster_path = excluded.poster_path,
      release_date = excluded.release_date, vote_average = excluded.vote_average, sort_order = excluded.sort_order,
      metadata_refreshed_at = CURRENT_TIMESTAMP`,
  ).bind(email, favorite.id, favorite.title, favorite.poster_path, favorite.release_date, favorite.vote_average, sortOrder)
}

async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function consumeBudget(db: D1Database, scope: string, seconds: number, limit: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const start = now - (now % seconds)
  const row = await db.prepare(
    `INSERT INTO request_budgets (scope, window_start, request_count) VALUES (?, ?, 1)
     ON CONFLICT(scope) DO UPDATE SET
      window_start = CASE WHEN request_budgets.window_start = excluded.window_start THEN request_budgets.window_start ELSE excluded.window_start END,
      request_count = CASE WHEN request_budgets.window_start = excluded.window_start THEN request_budgets.request_count + 1 ELSE 1 END
     RETURNING request_count AS requestCount`,
  ).bind(scope, start).first<{ requestCount: number }>()
  return Boolean(row && row.requestCount <= limit)
}

async function enforceRateLimit(request: Request, env: Env): Promise<Response | null> {
  if (!env.DB) return jsonError(503, 'Request protection is not configured')
  const url = new URL(request.url)
  const edgeIp = request.headers.get('cf-connecting-ip') ?? (['localhost', '127.0.0.1'].includes(url.hostname) ? 'local' : null)
  if (!edgeIp) return jsonError(503, 'Request protection is unavailable')
  const client = await hashValue(edgeIp)
  const [clientOk, globalOk] = await Promise.all([
    consumeBudget(env.DB, `client:${client}`, CLIENT_BUDGET.seconds, CLIENT_BUDGET.requests),
    consumeBudget(env.DB, 'global', GLOBAL_BUDGET.seconds, GLOBAL_BUDGET.requests),
  ])
  await env.DB.prepare('DELETE FROM request_budgets WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 86_400).run()
  if (!clientOk || !globalOk) return jsonError(429, 'Too many requests. Try again shortly.', { 'retry-after': '60' })
  return null
}

async function handleAccountApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const user = getAuthenticatedUser(request)
  if (url.pathname === '/api/account' && request.method === 'GET') {
    return privateJson(user ? { authenticated: true, displayName: user.displayName, email: user.email } : { authenticated: false, displayName: null, email: null })
  }
  if (!user) return jsonError(401, 'Sign in with ChatGPT to continue')
  if (!env.DB) return jsonError(503, 'Favorite sync is not configured')

  if (url.pathname === '/api/favorites' && request.method === 'GET') {
    const account = await ensureFavoriteAccount(env.DB, user.email)
    await refreshStaleFavorites(env.DB, user.email, env)
    return stateResponse(account, await readFavorites(env.DB, user.email))
  }

  if (url.pathname === '/api/account/export' && request.method === 'GET') {
    const account = await ensureFavoriteAccount(env.DB, user.email)
    await refreshStaleFavorites(env.DB, user.email, env)
    return privateJson(
      { exportedAt: new Date().toISOString(), account: { displayName: user.displayName, email: user.email }, favorites: await readFavorites(env.DB, user.email), revision: account.revision },
      200,
      { 'content-disposition': `attachment; filename="themeflick-export-${new Date().toISOString().slice(0, 10)}.json"` },
    )
  }

  if (url.pathname === '/api/favorites/mutation' && request.method === 'POST') {
    const invalid = requireMutationRequest(request)
    if (invalid) return invalid
    const limited = await enforceRateLimit(request, env)
    if (limited) return limited
    let payload: { operationId?: unknown; generation?: unknown; action?: unknown; favorite?: unknown; movieId?: unknown }
    try { payload = await readJsonBody(request) } catch (error) {
      if (error instanceof Response) return jsonError(error.status, error.status === 413 ? 'Request body is too large' : error.status === 415 ? 'JSON content type is required' : 'Invalid JSON payload')
      throw error
    }
    if (!isToken(payload.operationId) || !isToken(payload.generation) || !['put', 'remove'].includes(String(payload.action))) return jsonError(400, 'Invalid mutation payload')
    const account = await getFavoriteAccount(env.DB, user.email)
    if (!account || account.generation !== payload.generation) return jsonError(409, 'Favorite sync session expired; reload before retrying')
    if (await hasOperation(env.DB, user.email, payload.operationId)) return stateResponse(account, await readFavorites(env.DB, user.email))
    const statements: D1PreparedStatement[] = []
    if (payload.action === 'put') {
      if (!isFavoriteRecord(payload.favorite)) return jsonError(400, 'Invalid favorite')
      statements.push(env.DB.prepare('UPDATE favorites SET sort_order = sort_order + 1 WHERE user_email = ?').bind(user.email))
      statements.push(favoriteUpsert(env.DB, user.email, { ...payload.favorite, title: payload.favorite.title.trim() }, 0))
      statements.push(env.DB.prepare(
        `DELETE FROM favorites WHERE user_email = ? AND movie_id NOT IN
         (SELECT movie_id FROM favorites WHERE user_email = ? ORDER BY sort_order ASC, movie_id DESC LIMIT 100)`,
      ).bind(user.email, user.email))
    } else {
      if (typeof payload.movieId !== 'number' || !Number.isInteger(payload.movieId) || payload.movieId <= 0) return jsonError(400, 'Invalid movie id')
      statements.push(env.DB.prepare('DELETE FROM favorites WHERE user_email = ? AND movie_id = ?').bind(user.email, payload.movieId))
    }
    statements.push(env.DB.prepare(
      'INSERT OR IGNORE INTO favorite_operations (user_email, operation_id, generation) VALUES (?, ?, ?)',
    ).bind(user.email, payload.operationId, account.generation))
    statements.push(env.DB.prepare(
      `UPDATE favorite_accounts SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE user_email = ? AND generation = ?`,
    ).bind(user.email, account.generation))
    await env.DB.batch(statements)
    const updated = await getFavoriteAccount(env.DB, user.email)
    return stateResponse(updated!, await readFavorites(env.DB, user.email))
  }

  if (url.pathname === '/api/favorites/import' && request.method === 'POST') {
    const invalid = requireMutationRequest(request)
    if (invalid) return invalid
    const limited = await enforceRateLimit(request, env)
    if (limited) return limited
    let payload: { operationId?: unknown; generation?: unknown; favorites?: unknown }
    try { payload = await readJsonBody(request) } catch (error) {
      if (error instanceof Response) return jsonError(error.status, error.status === 413 ? 'Request body is too large' : error.status === 415 ? 'JSON content type is required' : 'Invalid JSON payload')
      throw error
    }
    const favorites = normalizeFavorites(payload.favorites)
    if (!isToken(payload.operationId) || !isToken(payload.generation) || !favorites) return jsonError(400, 'Invalid import payload')
    const account = await getFavoriteAccount(env.DB, user.email)
    if (!account || account.generation !== payload.generation) return jsonError(409, 'Favorite sync session expired; reload before retrying')
    if (await hasOperation(env.DB, user.email, payload.operationId)) return stateResponse(account, await readFavorites(env.DB, user.email))
    const statements = favorites.map((favorite, index) => favoriteUpsert(env.DB!, user.email, favorite, index))
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO favorite_operations (user_email, operation_id, generation) VALUES (?, ?, ?)').bind(user.email, payload.operationId, account.generation))
    statements.push(env.DB.prepare(`UPDATE favorite_accounts SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE user_email = ? AND generation = ?`).bind(user.email, account.generation))
    await env.DB.batch(statements)
    const updated = await getFavoriteAccount(env.DB, user.email)
    return stateResponse(updated!, await readFavorites(env.DB, user.email))
  }

  if (url.pathname === '/api/account/data' && request.method === 'DELETE') {
    const invalid = requireMutationRequest(request)
    if (invalid) return invalid
    const limited = await enforceRateLimit(request, env)
    if (limited) return limited
    let payload: { generation?: unknown }
    try { payload = await readJsonBody(request) } catch (error) {
      if (error instanceof Response) return jsonError(error.status, error.status === 413 ? 'Request body is too large' : 'Invalid JSON payload')
      throw error
    }
    const account = await getFavoriteAccount(env.DB, user.email)
    if (!account || !isToken(payload.generation) || account.generation !== payload.generation) return jsonError(409, 'Favorite sync session expired; reload before retrying')
    await env.DB.batch([
      env.DB.prepare('DELETE FROM favorites WHERE user_email = ?').bind(user.email),
      env.DB.prepare('DELETE FROM favorite_operations WHERE user_email = ?').bind(user.email),
      env.DB.prepare('DELETE FROM favorite_accounts WHERE user_email = ? AND generation = ?').bind(user.email, account.generation),
    ])
    return new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', vary: USER_EMAIL_HEADER } })
  }
  return jsonError(404, 'Account route not found')
}

function hasValidValue(key: string, value: string): boolean {
  switch (key) {
    case 'query': return value.trim().length > 0 && value.length <= 100
    case 'include_adult': return value === 'false'
    case 'language': return value === 'en-US'
    case 'page': return value === '1' || value === '2'
    case 'append_to_response': return value === 'credits,keywords'
    case 'sort_by': return value === 'popularity.desc' || value === 'vote_average.desc'
    case 'vote_count.gte': return /^\d{1,6}$/.test(value)
    case 'with_keywords': return /^\d+(?:\|\d+)*$/.test(value) && value.length <= 120
    default: return false
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

async function proxyTmdb(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return jsonError(405, 'Method not allowed')
  const limited = await enforceRateLimit(request, env)
  if (limited) return limited
  const incoming = new URL(request.url)
  const path = incoming.pathname.slice('/api/tmdb'.length)
  const route = allowedRoutes.find((candidate) => candidate.pattern.test(path))
  if (!route) return jsonError(404, 'Movie data route not found')
  if (!validateQuery(incoming.searchParams, route)) return jsonError(400, 'Invalid movie data query')
  if (!env.TMDB_ACCESS_TOKEN && !env.TMDB_API_KEY) return jsonError(503, 'Movie data is not configured')
  const target = new URL(`${TMDB_ORIGIN}${path}`)
  for (const [key, value] of incoming.searchParams) target.searchParams.set(key, value)
  if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) target.searchParams.set('api_key', env.TMDB_API_KEY)
  const headers = new Headers({ accept: 'application/json' })
  if (env.TMDB_ACCESS_TOKEN) headers.set('authorization', `Bearer ${env.TMDB_ACCESS_TOKEN}`)
  let upstream: Response
  try { upstream = await fetch(target, { headers, signal: AbortSignal.timeout(TMDB_TIMEOUT_MS) }) }
  catch { return jsonError(502, 'Movie data service is unavailable') }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: {
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
    'cache-control': upstream.ok ? `public, max-age=${route.ttl}` : 'no-store',
    'x-content-type-options': 'nosniff',
  } })
}

function hardenHtml(response: Response): Headers {
  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('content-security-policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'")
  headers.set('x-frame-options', 'DENY')
  return headers
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now()
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID()
    const url = new URL(request.url)
    let response: Response
    try {
      if (url.pathname === '/api/health/live') response = privateJson({ status: 'ok' })
      else if (url.pathname === '/api/health/ready') {
        if (!env.DB || (!env.TMDB_ACCESS_TOKEN && !env.TMDB_API_KEY)) response = jsonError(503, 'Service dependencies are not configured')
        else { await env.DB.prepare('SELECT 1 AS ready').first(); response = privateJson({ status: 'ready' }) }
      } else if (url.pathname.startsWith('/api/tmdb/')) response = await proxyTmdb(request, env)
      else if (url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/favorites')) response = await handleAccountApi(request, env)
      else if (url.pathname === '/robots.txt') response = new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
      else if (url.pathname === '/sitemap.xml') response = new Response(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/favorites', '/account', '/about', '/privacy', '/terms', '/support'].map((path) => `<url><loc>${url.origin}${path}</loc></url>`).join('')}</urlset>`,
        { headers: { 'content-type': 'application/xml; charset=utf-8' } },
      )
      else {
        let asset = await env.ASSETS.fetch(request)
        const lastSegment = url.pathname.split('/').pop() ?? ''
        if (asset.status === 404 && request.method === 'GET' && !lastSegment.includes('.')) {
          asset = await env.ASSETS.fetch(new Request(`${url.origin}/`, { headers: request.headers }))
        }
        if (!asset.headers.get('content-type')?.includes('text/html')) response = asset
        else {
          const html = (await asset.text()).replaceAll('__THEMEFLICK_ORIGIN__', url.origin)
          response = new Response(html, { status: asset.status, statusText: asset.statusText, headers: hardenHtml(asset) })
        }
      }
    } catch {
      response = jsonError(500, 'The service is temporarily unavailable')
    }
    console.log(JSON.stringify({ requestId, method: request.method, route: url.pathname.startsWith('/api/tmdb/') ? '/api/tmdb/*' : url.pathname, status: response.status, durationMs: Date.now() - started }))
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('x-request-id', requestId)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  },
}

export { readJsonBody }
export default worker
