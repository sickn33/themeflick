import { execFileSync, spawn } from 'node:child_process'
import { access, readFile, rm, writeFile } from 'node:fs/promises'

const port = 4179
const origin = `http://127.0.0.1:${port}`
const childEnv = { ...process.env, WRANGLER_LOG_PATH: '.wrangler/wrangler.log' }
const devVarsUrl = new URL('../.dev.vars', import.meta.url)
let createdDevVars = false

execFileSync('./node_modules/.bin/wrangler', ['d1', 'migrations', 'apply', 'site-creator-d1', '--local'], {
  env: childEnv,
  stdio: 'inherit',
})

try {
  const legacyEnv = await readFile(new URL('../.env', import.meta.url), 'utf8')
  for (const line of legacyEnv.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key === 'VITE_TMDB_ACCESS_TOKEN' && value) childEnv.TMDB_ACCESS_TOKEN = value
    if (key === 'VITE_TMDB_API_KEY' && value) childEnv.TMDB_API_KEY = value
  }
} catch {
  // The documented .dev.vars path is loaded directly by the Cloudflare plugin.
}

try {
  await access(devVarsUrl)
} catch {
  const entries = []
  if (childEnv.TMDB_ACCESS_TOKEN) entries.push(`TMDB_ACCESS_TOKEN=${childEnv.TMDB_ACCESS_TOKEN}`)
  if (childEnv.TMDB_API_KEY) entries.push(`TMDB_API_KEY=${childEnv.TMDB_API_KEY}`)
  if (entries.length > 0) {
    await writeFile(devVarsUrl, `${entries.join('\n')}\n`, { mode: 0o600 })
    createdDevVars = true
  }
}

const server = spawn('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(port)], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })

const deadline = Date.now() + 15_000
try {
  while (Date.now() < deadline) {
    try {
      const root = await fetch(`${origin}/`)
      if (root.ok) break
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const [root, deepLink, privacy, readiness, configuration, search] = await Promise.all([
    fetch(`${origin}/`),
    fetch(`${origin}/movies/603`),
    fetch(`${origin}/privacy`),
    fetch(`${origin}/api/health/ready`),
    fetch(`${origin}/api/tmdb/configuration`),
    fetch(`${origin}/api/tmdb/search/movie?query=Alien&include_adult=false&language=en-US&page=1`),
  ])
  const rootHtml = await root.text()
  const deepHtml = await deepLink.text()
  const configurationBody = await configuration.json()
  const searchBody = await search.json()

  if (![root, deepLink, privacy, readiness, configuration, search].every((response) => response.ok)) {
    throw new Error(`Unexpected status: ${[root, deepLink, privacy, readiness, configuration, search].map((item) => item.status).join(', ')}`)
  }
  if (!rootHtml.includes(`${origin}/og.png`) || !deepHtml.includes(`${origin}/og.png`)) {
    throw new Error('Absolute social image metadata was not rendered')
  }
  if (!configurationBody.images || !Array.isArray(searchBody.results) || searchBody.results.length === 0) {
    throw new Error('TMDB smoke response did not match the expected shape')
  }
  if (root.headers.get('x-frame-options') !== 'DENY' || !root.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) {
    throw new Error('HTML anti-framing headers are missing')
  }

  const identity = { 'oai-authenticated-user-email': 'smoke@example.invalid' }
  const initial = await fetch(`${origin}/api/favorites`, { headers: identity }).then((response) => response.json())
  const favorite = { id: 603, title: 'The Matrix', poster_path: null, release_date: '1999-03-30', vote_average: 8.2 }
  const operationId = crypto.randomUUID()
  const mutation = { operationId, generation: initial.generation, action: 'put', favorite }
  const mutationHeaders = { ...identity, origin, 'content-type': 'application/json', 'x-themeflick-request': '1' }
  const added = await fetch(`${origin}/api/favorites/mutation`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify(mutation) })
  const retried = await fetch(`${origin}/api/favorites/mutation`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify(mutation) })
  const isolated = await fetch(`${origin}/api/favorites`, { headers: { 'oai-authenticated-user-email': 'other@example.invalid' } })
  const exported = await fetch(`${origin}/api/account/export`, { headers: identity })
  const deleted = await fetch(`${origin}/api/account/data`, { method: 'DELETE', headers: mutationHeaders, body: JSON.stringify({ generation: initial.generation }) })
  const stale = await fetch(`${origin}/api/favorites/mutation`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ ...mutation, operationId: crypto.randomUUID() }) })
  const [addedBody, retriedBody, isolatedBody, exportedBody] = await Promise.all([added.json(), retried.json(), isolated.json(), exported.json()])
  if (!added.ok || !retried.ok || !exported.ok || deleted.status !== 204 || stale.status !== 409) throw new Error('Account lifecycle smoke failed')
  if (addedBody.favorites.length !== 1 || retriedBody.revision !== addedBody.revision || isolatedBody.favorites.length !== 0 || exportedBody.favorites.length !== 1) {
    throw new Error('Favorite idempotency, isolation, or export smoke failed')
  }

  console.log(`Smoke passed: root=${root.status}, deep=${deepLink.status}, ready=${readiness.status}, TMDB=${search.status}, account lifecycle=ok`)
} catch (error) {
  console.error(output)
  throw error
} finally {
  server.kill('SIGTERM')
  if (createdDevVars) await rm(devVarsUrl, { force: true })
}
