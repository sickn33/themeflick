import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const directory = new URL('../drizzle/', import.meta.url)
function fingerprint() {
  const files = readdirSync(directory, { recursive: true })
    .filter((name) => typeof name === 'string' && statSync(new URL(name, directory)).isFile())
    .sort()
  const hash = createHash('sha256')
  for (const name of files) { hash.update(name); hash.update(readFileSync(new URL(name, directory))) }
  return hash.digest('hex')
}

const before = fingerprint()
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['drizzle-kit', 'generate'], { stdio: 'inherit' })
if (fingerprint() !== before) throw new Error('Database schema drift detected: commit the newly generated migration files')
console.log('Database schema and migration history are in sync.')
