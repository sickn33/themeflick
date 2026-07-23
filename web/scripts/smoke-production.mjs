const origin = (process.env.THEMEFLICK_ORIGIN ?? '').replace(/\/$/, '')
if (!origin) throw new Error('Set THEMEFLICK_ORIGIN to the deployed origin')

const headers = {}
if (process.env.THEMEFLICK_AUTH_COOKIE) headers.cookie = process.env.THEMEFLICK_AUTH_COOKIE
if (process.env.THEMEFLICK_SITES_BEARER) {
  headers['OAI-Sites-Authorization'] = `Bearer ${process.env.THEMEFLICK_SITES_BEARER}`
}
const paths = ['/', '/movies/603', '/account', '/privacy', '/terms', '/api/health/live', '/api/health/ready']
for (const path of paths) {
  const response = await fetch(`${origin}${path}`, { headers, redirect: 'manual' })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  if (path === '/') {
    const required = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    }
    for (const [name, fragment] of Object.entries(required)) {
      if (!response.headers.get(name)?.includes(fragment)) throw new Error(`${path} missing ${name}: ${fragment}`)
    }
  }
}
console.log(`Production smoke passed for ${origin}`)
