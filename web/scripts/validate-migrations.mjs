import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('../drizzle/', import.meta.url)
const migrations = readdirSync(root).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()
if (migrations.length === 0) throw new Error('No database migrations found')

const temporary = mkdtempSync(join(tmpdir(), 'themeflick-migrations-'))
const database = join(temporary, 'database.sqlite')
try {
  for (const migration of migrations) {
    const sql = readFileSync(new URL(migration, root), 'utf8').replaceAll('--> statement-breakpoint', '')
    const file = join(temporary, migration)
    writeFileSync(file, `PRAGMA foreign_keys=ON;\nBEGIN;\n${sql}\nCOMMIT;\n`)
    execFileSync('sqlite3', [database, `.read ${file}`], { stdio: 'inherit' })
  }
  const integrity = execFileSync('sqlite3', [database, 'PRAGMA integrity_check;'], { encoding: 'utf8' }).trim()
  if (integrity !== 'ok') throw new Error(`Migration integrity check failed: ${integrity}`)
  const required = ['favorites', 'favorite_accounts', 'favorite_operations', 'request_budgets']
  const tables = execFileSync('sqlite3', [database, ".tables"], { encoding: 'utf8' })
  for (const table of required) if (!tables.split(/\s+/).includes(table)) throw new Error(`Missing table after migrations: ${table}`)
  console.log(`Validated ${migrations.length} migrations on a clean SQLite database.`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
