import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import {
  rankCandidates,
  type RankingCandidate,
  type ScoreFeatures,
} from './src/lib/recommendationEngine.ts'

type TmdbKeyword = { id: number; name: string }
type TmdbCrewMember = { id: number; job?: string }
type TmdbCastMember = { id: number }
type TmdbMovieDetails = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  vote_count?: number
  genres?: Array<{ id: number }>
  runtime?: number | null
  credits?: { crew?: TmdbCrewMember[]; cast?: TmdbCastMember[] }
  keywords?: { keywords?: TmdbKeyword[]; results?: TmdbKeyword[] }
}
type MlMovie = {
  movieId: number
  title: string
  genres: Set<string>
  tmdbId: number
}
type GoldMovie = { movieId: number; score: number; count: number }

const DATA_DIR = path.resolve(process.env.MOVIELENS_DIR ?? '.cache/movielens/ml-latest-small')
const CACHE_DIR = path.resolve(process.env.HUMAN_BENCHMARK_CACHE ?? '.cache/themeflick-benchmark')
const CACHE_FILE = path.join(CACHE_DIR, 'tmdb-movies.json')
const BASE_URL = 'https://api.themoviedb.org/3'
const SEED_LIMIT = Number(process.env.HUMAN_BENCHMARK_SEEDS ?? '50')
const CANDIDATE_LIMIT = Number(process.env.HUMAN_BENCHMARK_CANDIDATES ?? '40')
const TOP_K = Number(process.env.HUMAN_BENCHMARK_TOPK ?? '10')
const MIN_LIKERS = Number(process.env.HUMAN_BENCHMARK_MIN_LIKERS ?? '15')
const MIN_CO_LIKES = Number(process.env.HUMAN_BENCHMARK_MIN_CO_LIKES ?? '3')
const MIN_PRECISION = Number(process.env.HUMAN_BENCHMARK_MIN_PRECISION ?? '0.32')
const MIN_NDCG = Number(process.env.HUMAN_BENCHMARK_MIN_NDCG ?? '0.34')
const MIN_COVERAGE = Number(process.env.HUMAN_BENCHMARK_MIN_COVERAGE ?? '0.85')
const KEYWORD_STOP_WORDS = new Set([
  'the',
  'and',
  'or',
  'of',
  'a',
  'an',
  'to',
  'in',
  'on',
  'for',
  'from',
  'with',
  'without',
  'into',
  'onto',
  'about',
  'movie',
  'film',
  'father',
  'mother',
  'daughter',
  'son',
  'family',
  'relationship',
  'friend',
  'friends',
])

const importMetaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) {
    return
  }

  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const [key, ...values] = trimmed.split('=')
    if (key && values.length > 0 && process.env[key.trim()] === undefined) {
      process.env[key.trim()] = values.join('=').trim().replace(/^["'](.*)["']$/, '$1')
    }
  }
}

loadEnv()

const TMDB_API_KEY = importMetaEnv?.VITE_TMDB_API_KEY || process.env.VITE_TMDB_API_KEY
const TMDB_ACCESS_TOKEN = importMetaEnv?.VITE_TMDB_ACCESS_TOKEN || process.env.VITE_TMDB_ACCESS_TOKEN

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }

  cells.push(cell)
  return cells
}

function readRows(fileName: string): string[][] {
  const filePath = path.join(DATA_DIR, fileName)
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Download: mkdir -p .cache/movielens && curl -L -o .cache/ml-latest-small.zip https://files.grouplens.org/datasets/movielens/ml-latest-small.zip && unzip -q .cache/ml-latest-small.zip -d .cache/movielens`,
    )
  }

  const content = fs.readFileSync(filePath, 'utf-8').trim()
  return content.split(/\r?\n/).slice(1).map(parseCsvLine)
}

function loadMovies(): Map<number, MlMovie> {
  const links = new Map<number, number>()
  for (const [movieIdText, , tmdbIdText] of readRows('links.csv')) {
    const movieId = Number(movieIdText)
    const tmdbId = Number(tmdbIdText)
    if (Number.isFinite(movieId) && Number.isFinite(tmdbId)) {
      links.set(movieId, tmdbId)
    }
  }

  const movies = new Map<number, MlMovie>()
  for (const [movieIdText, title, genresText] of readRows('movies.csv')) {
    const movieId = Number(movieIdText)
    const tmdbId = links.get(movieId)
    if (Number.isFinite(movieId) && tmdbId !== undefined) {
      movies.set(movieId, {
        movieId,
        title,
        genres: new Set(genresText.split('|').filter((genre) => genre !== '(no genres listed)')),
        tmdbId,
      })
    }
  }

  return movies
}

async function loadLikes(movies: Map<number, MlMovie>) {
  const ratingsPath = path.join(DATA_DIR, 'ratings.csv')
  if (!fs.existsSync(ratingsPath)) {
    throw new Error(`Missing ${ratingsPath}`)
  }

  const likedByMovie = new Map<number, Set<number>>()
  const likedMoviesByUser = new Map<number, number[]>()
  const lines = readline.createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: fs.createReadStream(ratingsPath),
  })
  let isHeader = true

  for await (const line of lines) {
    if (isHeader) {
      isHeader = false
      continue
    }

    const [userIdText, movieIdText, ratingText] = parseCsvLine(line)
    const userId = Number(userIdText)
    const movieId = Number(movieIdText)
    const rating = Number(ratingText)
    if (!movies.has(movieId) || !Number.isFinite(userId) || rating < 4) {
      continue
    }

    if (!likedByMovie.has(movieId)) {
      likedByMovie.set(movieId, new Set())
    }
    likedByMovie.get(movieId)?.add(userId)

    if (!likedMoviesByUser.has(userId)) {
      likedMoviesByUser.set(userId, [])
    }
    likedMoviesByUser.get(userId)?.push(movieId)
  }

  return { likedByMovie, likedMoviesByUser }
}

function hasGenreOverlap(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) {
    return true
  }

  for (const genre of left) {
    if (right.has(genre)) {
      return true
    }
  }

  return false
}

function buildGold(
  seedId: number,
  movies: Map<number, MlMovie>,
  likedByMovie: Map<number, Set<number>>,
  likedMoviesByUser: Map<number, number[]>,
): GoldMovie[] {
  const seedUsers = likedByMovie.get(seedId)
  if (!seedUsers || seedUsers.size < MIN_LIKERS) {
    return []
  }

  const counts = new Map<number, number>()
  for (const userId of seedUsers) {
    for (const movieId of likedMoviesByUser.get(userId) ?? []) {
      if (movieId !== seedId && movies.has(movieId)) {
        counts.set(movieId, (counts.get(movieId) ?? 0) + 1)
      }
    }
  }

  return [...counts.entries()]
    .flatMap(([movieId, count]) => {
      const likerCount = likedByMovie.get(movieId)?.size ?? 0
      if (count < MIN_CO_LIKES || likerCount === 0) {
        return []
      }

      return [{ movieId, count, score: count / Math.sqrt(seedUsers.size * likerCount) }]
    })
    .sort((left, right) => right.score - left.score || right.count - left.count)
}

function buildCandidates(
  seedId: number,
  gold: GoldMovie[],
  movies: Map<number, MlMovie>,
  likedByMovie: Map<number, Set<number>>,
): number[] {
  const seedMovie = movies.get(seedId)
  const positives = gold.slice(0, TOP_K).map((item) => item.movieId)
  const positiveSet = new Set(positives)
  const negatives = [...movies.values()]
    .filter((movie) => movie.movieId !== seedId && !positiveSet.has(movie.movieId))
    .filter((movie) => seedMovie === undefined || hasGenreOverlap(seedMovie.genres, movie.genres))
    .sort((left, right) => (likedByMovie.get(right.movieId)?.size ?? 0) - (likedByMovie.get(left.movieId)?.size ?? 0))
    .slice(0, Math.max(0, CANDIDATE_LIMIT - positives.length))
    .map((movie) => movie.movieId)

  return [...positives, ...negatives]
}

function pickSeeds(movies: Map<number, MlMovie>, likedByMovie: Map<number, Set<number>>, likedMoviesByUser: Map<number, number[]>) {
  const eligible = [...movies.keys()]
    .filter((movieId) => (likedByMovie.get(movieId)?.size ?? 0) >= MIN_LIKERS)
    .filter((movieId) => buildGold(movieId, movies, likedByMovie, likedMoviesByUser).length >= TOP_K)
    .sort((left, right) => (likedByMovie.get(right)?.size ?? 0) - (likedByMovie.get(left)?.size ?? 0))
    .slice(0, Math.max(SEED_LIMIT * 6, SEED_LIMIT))

  const seeds: number[] = []
  const step = Math.max(1, Math.floor(eligible.length / SEED_LIMIT))
  for (let index = 0; index < eligible.length && seeds.length < SEED_LIMIT; index += step) {
    seeds.push(eligible[index])
  }

  return seeds
}

function normalizeKeywordName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeKeywordToken(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`
  }
  if (token.length > 5 && token.endsWith('ing')) {
    return token.slice(0, -3)
  }
  if (token.length > 4 && token.endsWith('ed')) {
    const stem = token.slice(0, -2)
    return stem.length >= 3 && /[nlvzt]$/.test(stem) ? `${stem}e` : stem
  }
  if (token.length > 4 && token.endsWith('es')) {
    return token.slice(0, -2)
  }
  if (token.length > 4 && token.endsWith('s')) {
    return token.slice(0, -1)
  }

  return token
}

function tokenizeKeyword(value: string): string[] {
  const normalized = normalizeKeywordName(value)
  if (!normalized) {
    return []
  }

  return normalized
    .split(/[\s-]+/)
    .map(normalizeKeywordToken)
    .filter((token) => token.length >= 3 && !KEYWORD_STOP_WORDS.has(token))
}

function extractFeatures(details: TmdbMovieDetails): ScoreFeatures {
  const keywords = details.keywords?.keywords || details.keywords?.results || []
  const keywordTokens = new Set<string>()
  const keywordPhrases = new Set<string>()

  for (const keyword of keywords) {
    const phraseTokens = tokenizeKeyword(keyword.name)
    for (const token of phraseTokens) {
      keywordTokens.add(token)
    }
    const phrase = phraseTokens.join(' ')
    if (phrase) {
      keywordPhrases.add(phrase)
    }
  }

  return {
    genreIds: details.genres?.map((genre) => genre.id) ?? [],
    directorId: details.credits?.crew?.find((member) => member.job === 'Director')?.id ?? null,
    composerIds:
      details.credits?.crew
        ?.filter((member) => {
          const job = member.job?.toLowerCase() ?? ''
          return job === 'original music composer' || job === 'music' || job === 'music director' || job === 'composer'
        })
        .map((member) => member.id) ?? [],
    keywordPhrases: [...keywordPhrases],
    keywordTokens: [...keywordTokens],
    castIds: details.credits?.cast?.slice(0, 5).map((member) => member.id) ?? [],
    voteAverage: details.vote_average || 0,
    voteCount: details.vote_count || 0,
    releaseYear: details.release_date ? Number(details.release_date.slice(0, 4)) : null,
    runtimeMinutes: details.runtime || null,
    keywordIds: keywords.map((keyword) => keyword.id),
  }
}

function loadCache(): Map<string, TmdbMovieDetails> {
  if (!fs.existsSync(CACHE_FILE)) {
    return new Map()
  }

  return new Map(Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Record<string, TmdbMovieDetails>))
}

function saveCache(cache: Map<string, TmdbMovieDetails>) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache), null, 2))
}

async function fetchTmdbMovie(tmdbId: number, cache: Map<string, TmdbMovieDetails>): Promise<TmdbMovieDetails | null> {
  const cacheKey = String(tmdbId)
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }
  if (!TMDB_API_KEY && !TMDB_ACCESS_TOKEN) {
    throw new Error('Missing VITE_TMDB_API_KEY or VITE_TMDB_ACCESS_TOKEN in web/.env')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  const url = TMDB_API_KEY
    ? `${BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=credits,keywords`
    : `${BASE_URL}/movie/${tmdbId}?language=en-US&append_to_response=credits,keywords`
  const headers = TMDB_ACCESS_TOKEN ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` } : undefined

  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (res.status === 404) {
      return null
    }
    if (!res.ok) {
      throw new Error(`TMDB ${res.status} for movie ${tmdbId}`)
    }

    const details = (await res.json()) as TmdbMovieDetails
    cache.set(cacheKey, details)
    return details
  } finally {
    clearTimeout(timeout)
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function run() {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await worker(items[currentIndex])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function toCandidate(movieId: number, details: TmdbMovieDetails, movies: Map<number, MlMovie>): RankingCandidate {
  const features = extractFeatures(details)
  return {
    id: details.id,
    title: details.title || movies.get(movieId)?.title || String(details.id),
    poster_path: details.poster_path,
    release_date: details.release_date,
    vote_average: details.vote_average,
    director_id: features.directorId,
    features,
    source: {
      fromSimilar: false,
      // ponytail: benchmark candidates are an already-retrieved pool; all get the same source context.
      fromRecommended: true,
      fromDirectorFilmography: false,
    },
  }
}

function dcg(scores: number[]): number {
  return scores.reduce((sum, score, index) => sum + score / Math.log2(index + 2), 0)
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

async function main() {
  const movies = loadMovies()
  const { likedByMovie, likedMoviesByUser } = await loadLikes(movies)
  const seeds = pickSeeds(movies, likedByMovie, likedMoviesByUser)
  const cache = loadCache()
  const summaries = []

  for (const seedId of seeds) {
    const seedMovie = movies.get(seedId)
    if (!seedMovie) {
      continue
    }

    const gold = buildGold(seedId, movies, likedByMovie, likedMoviesByUser).slice(0, TOP_K)
    const goldScores = new Map(gold.map((item) => [item.movieId, item.score]))
    const candidateIds = buildCandidates(seedId, gold, movies, likedByMovie)
    const [seedDetails, ...candidateDetails] = await mapLimit(
      [seedId, ...candidateIds],
      6,
      async (movieId) => fetchTmdbMovie(movies.get(movieId)?.tmdbId ?? 0, cache),
    )

    if (!seedDetails) {
      continue
    }

    const candidates = candidateIds.flatMap((movieId, index) => {
      const details = candidateDetails[index]
      return details ? [toCandidate(movieId, details, movies)] : []
    })
    const ranked = rankCandidates(extractFeatures(seedDetails), candidates)
    const rankedMlIds = ranked
      .slice(0, TOP_K)
      .map((movie) => candidateIds.find((movieId) => movies.get(movieId)?.tmdbId === movie.id))
      .filter((movieId): movieId is number => movieId !== undefined)
    const precision = rankedMlIds.filter((movieId) => goldScores.has(movieId)).length / TOP_K
    const relevance = rankedMlIds.map((movieId) => goldScores.get(movieId) ?? 0)
    const ideal = [...goldScores.values()].sort((left, right) => right - left).slice(0, TOP_K)
    const ndcg = dcg(relevance) / Math.max(dcg(ideal), Number.EPSILON)
    const coverage = ranked.length >= TOP_K ? 1 : ranked.length / TOP_K

    summaries.push({
      title: seedMovie.title,
      candidates: candidates.length,
      ranked: ranked.length,
      precision,
      ndcg,
      coverage,
      top: ranked.slice(0, 3).map((movie) => movie.title).join(' | '),
    })
  }

  saveCache(cache)

  const precision = mean(summaries.map((summary) => summary.precision))
  const ndcg = mean(summaries.map((summary) => summary.ndcg))
  const coverage = mean(summaries.map((summary) => summary.coverage))
  const weak = summaries
    .filter((summary) => summary.precision < MIN_PRECISION || summary.coverage < 1)
    .sort((left, right) => left.precision - right.precision || left.coverage - right.coverage)
    .slice(0, 8)

  console.log('## Human benchmark')
  console.log(`dataset=${DATA_DIR}`)
  console.log(`seeds=${summaries.length} candidates=${CANDIDATE_LIMIT} topK=${TOP_K}`)
  console.log(`precision@${TOP_K}=${precision.toFixed(3)} min=${MIN_PRECISION}`)
  console.log(`nDCG@${TOP_K}=${ndcg.toFixed(3)} min=${MIN_NDCG}`)
  console.log(`coverage=${coverage.toFixed(3)} min=${MIN_COVERAGE}`)
  if (weak.length > 0) {
    console.log('weak_seeds=')
    for (const summary of weak) {
      console.log(`- ${summary.title}: p=${summary.precision.toFixed(2)} ndcg=${summary.ndcg.toFixed(2)} ranked=${summary.ranked}/${summary.candidates} top=${summary.top}`)
    }
  }

  if (summaries.length < Math.min(SEED_LIMIT, 10) || precision < MIN_PRECISION || ndcg < MIN_NDCG || coverage < MIN_COVERAGE) {
    process.exitCode = 1
  }
}

await main()
