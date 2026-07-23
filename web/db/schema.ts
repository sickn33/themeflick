import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const favorites = sqliteTable(
  'favorites',
  {
    userEmail: text('user_email', { length: 254 }).notNull(),
    movieId: integer('movie_id').notNull(),
    title: text('title', { length: 160 }).notNull(),
    posterPath: text('poster_path', { length: 200 }),
    releaseDate: text('release_date', { length: 10 }),
    voteAverage: real('vote_average').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    savedAt: text('saved_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    metadataRefreshedAt: text('metadata_refreshed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userEmail, table.movieId] }),
    index('favorites_user_order_idx').on(table.userEmail, table.sortOrder, table.movieId),
  ],
)

export const favoriteAccounts = sqliteTable(
  'favorite_accounts',
  {
    userEmail: text('user_email', { length: 254 }).primaryKey(),
    storageScope: text('storage_scope', { length: 64 }).notNull(),
    generation: text('generation', { length: 64 }).notNull(),
    revision: integer('revision').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex('favorite_accounts_storage_scope_idx').on(table.storageScope)],
)

export const favoriteOperations = sqliteTable(
  'favorite_operations',
  {
    userEmail: text('user_email', { length: 254 }).notNull(),
    operationId: text('operation_id', { length: 64 }).notNull(),
    generation: text('generation', { length: 64 }).notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userEmail, table.operationId] }),
    index('favorite_operations_created_idx').on(table.createdAt),
  ],
)

export const requestBudgets = sqliteTable('request_budgets', {
  scope: text('scope', { length: 160 }).primaryKey(),
  windowStart: integer('window_start').notNull(),
  requestCount: integer('request_count').notNull(),
})
