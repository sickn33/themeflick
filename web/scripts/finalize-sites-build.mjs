import { access, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../dist/', import.meta.url)
const required = ['server/index.js', 'client/index.html', '.openai/hosting.json']

for (const relativePath of required) {
  await access(new URL(relativePath, root))
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
