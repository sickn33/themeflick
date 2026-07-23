import { access, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../dist/', import.meta.url)
const required = ['server/index.js', 'client/index.html', '.openai/hosting.json']

for (const relativePath of required) {
  await access(new URL(relativePath, root))
}

// Sites may serve a root index asset before invoking the Worker. Keep the SPA
// shell under a non-index name so every document route receives Worker headers.
await rename(new URL('client/index.html', root), new URL('client/app.html', root))

const hosting = JSON.parse(await readFile(new URL('.openai/hosting.json', root), 'utf8'))
if (hosting.d1) {
  const migrationDirectory = new URL('.openai/drizzle/', root)
  const migrations = await readdir(migrationDirectory)
  if (!migrations.some((name) => name.endsWith('.sql'))) {
    throw new Error('D1 is enabled but the build contains no SQL migration')
  }
}

// Cloudflare creates this preview-only file from local development variables.
// It must never enter a Sites archive, even when the values are non-production.
await rm(new URL('server/.dev.vars', root), { force: true })

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await inspect(path)
      continue
    }
    if (entry.name.startsWith('.dev.vars')) {
      throw new Error(`Local runtime variables leaked into build output: ${path}`)
    }
    const content = await readFile(path)
    if (content.includes('VITE_TMDB_API_KEY') || content.includes('VITE_TMDB_ACCESS_TOKEN')) {
      throw new Error(`Legacy public TMDB credential reference found in build output: ${path}`)
    }
  }
}

await inspect(root.pathname)
