import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  },
  (table) => [
    primaryKey({ columns: [table.userEmail, table.movieId] }),
    index('favorites_user_order_idx').on(table.userEmail, table.sortOrder, table.movieId),
  ],
)
