interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  TMDB_API_KEY?: string
  TMDB_ACCESS_TOKEN?: string
}

type AllowedRoute = {
  pattern: RegExp
  queryKeys: ReadonlySet<string>
  ttl: number
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void
}

const TMDB_ORIGIN = 'https://api.themoviedb.org/3'
const TMDB_TIMEOUT_MS = 10_000

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
  return Response.json({ error: { message } }, { status })
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
  ctx: WorkerContext,
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

  const cacheKey = new Request(incoming.toString(), { method: 'GET' })
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

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

  if (upstream.ok) ctx.waitUntil(caches.default.put(cacheKey, response.clone()))
  return response
}

const worker = {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/tmdb/')) return proxyTmdb(request, env, ctx)

    const asset = await env.ASSETS.fetch(request)
    if (!asset.headers.get('content-type')?.includes('text/html')) return asset

    const headers = new Headers(asset.headers)
    headers.set('x-content-type-options', 'nosniff')
    headers.set('referrer-policy', 'strict-origin-when-cross-origin')
    const html = (await asset.text()).replaceAll('__THEMEFLICK_ORIGIN__', url.origin)
    return new Response(html, { status: asset.status, statusText: asset.statusText, headers })
  },
}

export default worker
