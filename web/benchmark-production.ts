import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createHash } from 'node:crypto'

import {
  buildRecommendationCandidatePool,
  extractScoreFeatures,
  toRankingCandidate,
  type TmdbListMovie,
  type TmdbListResponse,
  type TmdbMovieDetails,
  type TmdbPersonMovieCredit,
} from './src/api.ts'
import { rankCandidates } from './src/lib/recommendationEngine.ts'
import { findTagGenomeNeighbors, type TagSignatureIndex } from './src/lib/tagGenome.ts'

type MlMovie = {
  movieId: number
  tmdbId: number
  title: string
  genres: Set<string>
}

type GoldMovie = { movieId: number; score: number; count: number }
type Split = 'tuning' | 'validation'

type BenchmarkManifest = {
  schemaVersion: number
  dataset: string
  hashes: Record<'movies.csv' | 'ratings.csv' | 'links.csv', string>
  tuningSeedMovieLensIds: number[]
  validationSeedMovieLensIds: number[]
}

type SeedSnapshot = {
  base: TmdbMovieDetails
  similarPage1: TmdbListMovie[]
  similarPage2: TmdbListMovie[]
  recommendedPage1: TmdbListMovie[]
  recommendedPage2: TmdbListMovie[]
  directorMovies: TmdbPersonMovieCredit[]
  discoveredPage1: TmdbListMovie[]
  discoveredPage2: TmdbListMovie[]
  discoveredMovies: TmdbListMovie[]
  details: Record<string, TmdbMovieDetails>
}

const DATA_DIR = path.resolve(process.env.MOVIELENS_DIR ?? '.cache/movielens/ml-latest-small')
const CACHE_DIR = path.resolve(process.env.PRODUCTION_BENCHMARK_CACHE ?? '.cache/themeflick-benchmark/v4')
const MANIFEST_PATH = path.resolve('benchmark-seeds.json')
const BASE_URL = 'https://api.themoviedb.org/3'
const TOP_K = 10
const GOLD_K = 20
const MIN_LIKERS = 15
const MIN_CO_LIKES = 3
const args = new Set(process.argv.slice(2))
const splitArg = process.argv.find((value) => value.startsWith('--split='))?.slice('--split='.length) ?? 'validation'
const split = (splitArg === 'tuning' ? 'tuning' : 'validation') satisfies Split
const limitArg = Number(process.argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) ?? '0')
const offline = args.has('--offline')
const generateManifest = args.has('--generate-manifest')
const TAG_GENOME_DIR = path.resolve(process.env.TAG_GENOME_DIR ?? '.cache/tag-genome/tag-genome')
const TAG_VECTOR_CACHE = path.join(CACHE_DIR, 'tag-genome-vectors.f32')
const TAG_ID_CACHE = path.join(CACHE_DIR, 'tag-genome-movie-ids.json')
const tagSignatureIndex = JSON.parse(
  fs.readFileSync(path.join(CACHE_DIR, 'tag-signatures.json'), 'utf8'),
) as TagSignatureIndex

function poolFor(seedTmdbId: number, lists: SeedSnapshot) {
  return buildRecommendationCandidatePool(seedTmdbId, {
    ...lists,
    semanticMovieIds: findTagGenomeNeighbors(tagSignatureIndex, seedTmdbId, 60),
  })
}

function loadEnv() {
  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...parts] = trimmed.split('=')
    if (key && process.env[key] === undefined) {
      process.env[key] = parts.join('=').trim().replace(/^["']|["']$/g, '')
    }
  }
}

loadEnv()

const apiKey = process.env.VITE_TMDB_API_KEY
const accessToken = process.env.VITE_TMDB_ACCESS_TOKEN

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

function filePath(name: string): string {
  const value = path.join(DATA_DIR, name)
  if (!fs.existsSync(value)) throw new Error(`Missing MovieLens file: ${value}`)
  return value
}

function rows(name: string): string[][] {
  return fs.readFileSync(filePath(name), 'utf8').trim().split(/\r?\n/).slice(1).map(parseCsvLine)
}

function sha256(name: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath(name))).digest('hex')
}

function loadMovies() {
  const links = new Map<number, number>()
  const tmdbOwners = new Map<number, number[]>()
  for (const [movieIdText, , tmdbIdText] of rows('links.csv')) {
    const movieId = Number(movieIdText)
    const tmdbId = Number(tmdbIdText)
    if (!Number.isFinite(movieId) || !Number.isFinite(tmdbId)) continue
    links.set(movieId, tmdbId)
    tmdbOwners.set(tmdbId, [...(tmdbOwners.get(tmdbId) ?? []), movieId])
  }
  const collisions = new Set([...tmdbOwners].filter(([, owners]) => owners.length > 1).map(([tmdbId]) => tmdbId))
  const movies = new Map<number, MlMovie>()
  const movieIdByTmdbId = new Map<number, number>()
  for (const [movieIdText, title, genresText] of rows('movies.csv')) {
    const movieId = Number(movieIdText)
    const tmdbId = links.get(movieId)
    if (!tmdbId || collisions.has(tmdbId)) continue
    const movie = { movieId, tmdbId, title, genres: new Set(genresText.split('|')) }
    movies.set(movieId, movie)
    movieIdByTmdbId.set(tmdbId, movieId)
  }
  return { movies, movieIdByTmdbId, collisionCount: collisions.size }
}

async function loadLikes(movies: Map<number, MlMovie>) {
  const likedByMovie = new Map<number, Set<number>>()
  const likedMoviesByUser = new Map<number, number[]>()
  const lines = readline.createInterface({ input: fs.createReadStream(filePath('ratings.csv')), crlfDelay: Infinity })
  let header = true
  for await (const line of lines) {
    if (header) { header = false; continue }
    const [userText, movieText, ratingText] = parseCsvLine(line)
    const userId = Number(userText)
    const movieId = Number(movieText)
    const rating = Number(ratingText)
    if (rating < 4 || !movies.has(movieId)) continue
    if (!likedByMovie.has(movieId)) likedByMovie.set(movieId, new Set())
    likedByMovie.get(movieId)?.add(userId)
    likedMoviesByUser.set(userId, [...(likedMoviesByUser.get(userId) ?? []), movieId])
  }
  return { likedByMovie, likedMoviesByUser }
}

function buildGold(
  seedId: number,
  movies: Map<number, MlMovie>,
  likedByMovie: Map<number, Set<number>>,
  likedMoviesByUser: Map<number, number[]>,
): GoldMovie[] {
  const seedUsers = likedByMovie.get(seedId)
  if (!seedUsers || seedUsers.size < MIN_LIKERS) return []
  const counts = new Map<number, number>()
  for (const userId of seedUsers) {
    for (const movieId of likedMoviesByUser.get(userId) ?? []) {
      if (movieId !== seedId && movies.has(movieId)) counts.set(movieId, (counts.get(movieId) ?? 0) + 1)
    }
  }
  return [...counts].flatMap(([movieId, count]) => {
    const likerCount = likedByMovie.get(movieId)?.size ?? 0
    if (count < MIN_CO_LIKES || likerCount === 0) return []
    return [{ movieId, count, score: count / Math.sqrt(seedUsers.size * likerCount) }]
  }).sort((a, b) => b.score - a.score || b.count - a.count || a.movieId - b.movieId)
}

type TagGenome = {
  tagCount: number
  movieIds: number[]
  indexByMovieId: Map<number, number>
  vectors: Float32Array
  norms: Float32Array
}

async function loadTagGenome(): Promise<TagGenome> {
  const tagsPath = path.join(TAG_GENOME_DIR, 'tags.dat')
  const relevancePath = path.join(TAG_GENOME_DIR, 'tag_relevance.dat')
  const moviesPath = path.join(TAG_GENOME_DIR, 'movies.dat')
  if (!fs.existsSync(tagsPath) || !fs.existsSync(relevancePath) || !fs.existsSync(moviesPath)) {
    throw new Error(`Missing Tag Genome files under ${TAG_GENOME_DIR}`)
  }
  const tagCount = Math.max(...fs.readFileSync(tagsPath, 'utf8').trim().split(/\r?\n/).map((line) => Number(line.split('\t')[0]))) + 1
  const movieIds = fs.existsSync(TAG_ID_CACHE)
    ? JSON.parse(fs.readFileSync(TAG_ID_CACHE, 'utf8')) as number[]
    : fs.readFileSync(moviesPath, 'utf8').trim().split(/\r?\n/).map((line) => Number(line.split('\t')[0]))
  const indexByMovieId = new Map(movieIds.map((movieId, index) => [movieId, index]))
  let vectors: Float32Array
  if (fs.existsSync(TAG_VECTOR_CACHE)) {
    const bytes = fs.readFileSync(TAG_VECTOR_CACHE)
    const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    vectors = new Float32Array(copied)
  } else {
    vectors = new Float32Array(movieIds.length * tagCount)
    const lines = readline.createInterface({ input: fs.createReadStream(relevancePath), crlfDelay: Infinity })
    for await (const line of lines) {
      const [movieText, tagText, relevanceText] = line.split('\t')
      const movieIndex = indexByMovieId.get(Number(movieText))
      if (movieIndex !== undefined) vectors[movieIndex * tagCount + Number(tagText)] = Number(relevanceText)
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(TAG_VECTOR_CACHE, Buffer.from(vectors.buffer))
    fs.writeFileSync(TAG_ID_CACHE, JSON.stringify(movieIds))
  }
  if (vectors.length !== movieIds.length * tagCount) throw new Error('Tag Genome vector cache shape mismatch')
  const norms = new Float32Array(movieIds.length)
  for (let movieIndex = 0; movieIndex < movieIds.length; movieIndex += 1) {
    let squared = 0
    const offset = movieIndex * tagCount
    for (let tag = 0; tag < tagCount; tag += 1) squared += vectors[offset + tag] ** 2
    norms[movieIndex] = Math.sqrt(squared)
  }
  return { tagCount, movieIds, indexByMovieId, vectors, norms }
}

function buildGenomeGold(seedId: number, genome: TagGenome, allowedMovies: Map<number, MlMovie>): GoldMovie[] {
  const seedIndex = genome.indexByMovieId.get(seedId)
  if (seedIndex === undefined) return []
  const seedOffset = seedIndex * genome.tagCount
  const seedNorm = genome.norms[seedIndex]
  const scores: GoldMovie[] = []
  for (let movieIndex = 0; movieIndex < genome.movieIds.length; movieIndex += 1) {
    const movieId = genome.movieIds[movieIndex]
    if (movieId === seedId || !allowedMovies.has(movieId)) continue
    const norm = genome.norms[movieIndex]
    if (!seedNorm || !norm) continue
    const offset = movieIndex * genome.tagCount
    let dot = 0
    for (let tag = 0; tag < genome.tagCount; tag += 1) dot += genome.vectors[seedOffset + tag] * genome.vectors[offset + tag]
    scores.push({ movieId, score: dot / (seedNorm * norm), count: 0 })
  }
  return scores.sort((a, b) => b.score - a.score || a.movieId - b.movieId).slice(0, GOLD_K)
}

function eligibleSeeds(
  movies: Map<number, MlMovie>,
  likedByMovie: Map<number, Set<number>>,
  likedMoviesByUser: Map<number, number[]>,
): number[] {
  const byGenre = new Map<string, number[]>()
  const eligible = [...movies.values()]
    .filter((movie) => (likedByMovie.get(movie.movieId)?.size ?? 0) >= MIN_LIKERS)
    .filter((movie) => buildGold(movie.movieId, movies, likedByMovie, likedMoviesByUser).length >= GOLD_K)
    .sort((a, b) => ((likedByMovie.get(b.movieId)?.size ?? 0) - (likedByMovie.get(a.movieId)?.size ?? 0)) || a.movieId - b.movieId)
  for (const movie of eligible) {
    const genre = [...movie.genres].sort()[0] ?? 'Unknown'
    byGenre.set(genre, [...(byGenre.get(genre) ?? []), movie.movieId])
  }
  const result: number[] = []
  let offset = 0
  while (result.length < Math.min(80, eligible.length)) {
    let added = false
    for (const genre of [...byGenre.keys()].sort()) {
      const id = byGenre.get(genre)?.[offset]
      if (id !== undefined) { result.push(id); added = true }
      if (result.length >= 80) break
    }
    if (!added) break
    offset += 1
  }
  return result
}

function readManifest(): BenchmarkManifest {
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`Missing ${MANIFEST_PATH}; run --generate-manifest`)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as BenchmarkManifest
  for (const name of ['movies.csv', 'ratings.csv', 'links.csv'] as const) {
    if (manifest.hashes[name] !== sha256(name)) throw new Error(`MovieLens dataset hash mismatch: ${name}`)
  }
  return manifest
}

function cachePath(seedTmdbId: number): string {
  return path.join(CACHE_DIR, `seed-${seedTmdbId}.json`)
}

async function tmdb<T>(endpoint: string): Promise<T> {
  if (!apiKey && !accessToken) throw new Error('TMDB credentials missing')
  const url = new URL(`${BASE_URL}${endpoint}`)
  if (apiKey && !accessToken) url.searchParams.set('api_key', apiKey)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } : undefined,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`TMDB ${response.status}: ${endpoint}`)
    return await response.json() as T
  } finally {
    clearTimeout(timeout)
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function snapshotFor(seedTmdbId: number): Promise<SeedSnapshot> {
  const location = cachePath(seedTmdbId)
  if (fs.existsSync(location)) {
    const cached = JSON.parse(fs.readFileSync(location, 'utf8')) as SeedSnapshot
    if (offline) return cached
    const pool = poolFor(seedTmdbId, cached)
    const missing = pool.filter((candidate) => !cached.details[String(candidate.id)])
    if (missing.length > 0) {
      const extra = await mapLimit(missing, 8, async (candidate) => {
        try { return await tmdb<TmdbMovieDetails>(`/movie/${candidate.id}?append_to_response=credits,keywords&language=en-US`) }
        catch { return null }
      })
      extra.forEach((detail) => { if (detail) cached.details[String(detail.id)] = detail })
      fs.writeFileSync(location, JSON.stringify(cached))
    }
    return cached
  }
  if (offline) throw new Error(`Missing offline snapshot for TMDB ${seedTmdbId}`)
  const [base, similar1, similar2, recommended1, recommended2] = await Promise.all([
    tmdb<TmdbMovieDetails>(`/movie/${seedTmdbId}?append_to_response=credits,keywords&language=en-US`),
    tmdb<TmdbListResponse>(`/movie/${seedTmdbId}/similar?language=en-US&page=1`),
    tmdb<TmdbListResponse>(`/movie/${seedTmdbId}/similar?language=en-US&page=2`),
    tmdb<TmdbListResponse>(`/movie/${seedTmdbId}/recommendations?language=en-US&page=1`),
    tmdb<TmdbListResponse>(`/movie/${seedTmdbId}/recommendations?language=en-US&page=2`),
  ])
  const directorId = base.credits?.crew?.find((member) => member.job === 'Director')?.id
  let directorMovies: TmdbPersonMovieCredit[] = []
  if (directorId) {
    const credits = await tmdb<{ crew?: TmdbPersonMovieCredit[] }>(`/person/${directorId}/movie_credits?language=en-US`)
    directorMovies = (credits.crew ?? []).filter((movie) => movie.job === 'Director' && (movie.vote_count ?? 0) >= 20)
      .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0) || (b.vote_average ?? 0) - (a.vote_average ?? 0)).slice(0, 10)
  }
  const keywordIds = (base.keywords?.keywords ?? base.keywords?.results ?? []).map((keyword) => keyword.id).slice(0, 8)
  const discoveryQuery = keywordIds.join('|')
  const discoveryResponses = discoveryQuery
    ? await Promise.all([
        tmdb<TmdbListResponse>(`/discover/movie?language=en-US&include_adult=false&sort_by=popularity.desc&vote_count.gte=20&with_keywords=${discoveryQuery}&page=1`),
        tmdb<TmdbListResponse>(`/discover/movie?language=en-US&include_adult=false&sort_by=popularity.desc&vote_count.gte=20&with_keywords=${discoveryQuery}&page=2`),
        ...keywordIds.slice(0, 6).map((keywordId) =>
          tmdb<TmdbListResponse>(`/discover/movie?language=en-US&include_adult=false&sort_by=vote_average.desc&vote_count.gte=40&with_keywords=${keywordId}&page=1`),
        ),
      ])
    : [{ results: [] }, { results: [] }]
  const [discovered1, discovered2, ...targetedDiscovery] = discoveryResponses
  const lists = {
    similarPage1: similar1.results ?? [], similarPage2: similar2.results ?? [],
    recommendedPage1: recommended1.results ?? [], recommendedPage2: recommended2.results ?? [], directorMovies,
    discoveredPage1: discovered1.results ?? [], discoveredPage2: discovered2.results ?? [],
    discoveredMovies: targetedDiscovery.flatMap((response) => response.results ?? []),
  }
  const pool = buildRecommendationCandidatePool(seedTmdbId, {
    ...lists,
    semanticMovieIds: findTagGenomeNeighbors(tagSignatureIndex, seedTmdbId, 60),
  })
  const detailValues = await mapLimit(pool, 8, async (candidate) => {
    try { return await tmdb<TmdbMovieDetails>(`/movie/${candidate.id}?append_to_response=credits,keywords&language=en-US`) }
    catch { return null }
  })
  const details: Record<string, TmdbMovieDetails> = {}
  detailValues.forEach((detail) => { if (detail) details[String(detail.id)] = detail })
  const snapshot = { base, ...lists, details }
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(location, JSON.stringify(snapshot))
  return snapshot
}

function dcg(values: number[]): number {
  return values.reduce((sum, value, index) => sum + value / Math.log2(index + 2), 0)
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

async function main() {
  const { movies, movieIdByTmdbId, collisionCount } = loadMovies()
  const { likedByMovie, likedMoviesByUser } = await loadLikes(movies)
  const genome = await loadTagGenome()
  if (generateManifest) {
    const ids = eligibleSeeds(movies, likedByMovie, likedMoviesByUser)
      .filter((movieId) => genome.indexByMovieId.has(movieId))
    console.log(JSON.stringify({
      schemaVersion: 1,
      dataset: 'ml-latest-small',
      hashes: { 'movies.csv': sha256('movies.csv'), 'ratings.csv': sha256('ratings.csv'), 'links.csv': sha256('links.csv') },
      tuningSeedMovieLensIds: ids.slice(0, 28),
      validationSeedMovieLensIds: ids.slice(28, 78),
    }, null, 2))
    return
  }
  const manifest = readManifest()
  const allSeedIds = split === 'tuning' ? manifest.tuningSeedMovieLensIds : manifest.validationSeedMovieLensIds
  const seedIds = limitArg > 0 ? allSeedIds.slice(0, limitArg) : allSeedIds
  const summaries = []
  for (const seedId of seedIds) {
    const seed = movies.get(seedId)
    if (!seed) { summaries.push({ title: `missing:${seedId}`, unavailable: true }); continue }
    try {
      const snapshot = await snapshotFor(seed.tmdbId)
      const pool = poolFor(seed.tmdbId, snapshot)
      const detailedPool = pool.filter((candidate) => snapshot.details[String(candidate.id)])
      const ranked = rankCandidates(
        extractScoreFeatures(snapshot.base),
        detailedPool.map((candidate) => toRankingCandidate(snapshot.details[String(candidate.id)], candidate)),
      )
      const gold = buildGenomeGold(seedId, genome, movies)
      if (gold.length < GOLD_K) throw new Error('Seed is not covered by the frozen Tag Genome')
      const coLikeGold = buildGold(seedId, movies, likedByMovie, likedMoviesByUser).slice(0, GOLD_K)
      const goldById = new Map(gold.map((item) => [item.movieId, item.score]))
      const goldIds = new Set(goldById.keys())
      const candidateMlIds = new Set(pool.map((item) => movieIdByTmdbId.get(item.id)).filter((id): id is number => id !== undefined))
      const detailedMlIds = new Set(detailedPool.map((item) => movieIdByTmdbId.get(item.id)).filter((id): id is number => id !== undefined))
      const outputMlIds = ranked.slice(0, TOP_K).map((item) => movieIdByTmdbId.get(item.id)).filter((id): id is number => id !== undefined)
      const availableGold = gold.filter((item) => detailedMlIds.has(item.movieId))
      const relevance = outputMlIds.map((id) => goldById.get(id) ?? 0)
      const ideal = [...gold].sort((a, b) => b.score - a.score).slice(0, TOP_K).map((item) => item.score)
      const conditionalIdeal = [...availableGold].sort((a, b) => b.score - a.score).slice(0, TOP_K).map((item) => item.score)
      summaries.push({
        title: seed.title,
        unavailable: false,
        retrievalRecall: gold.filter((item) => candidateMlIds.has(item.movieId)).length / GOLD_K,
        detailRecall: gold.filter((item) => detailedMlIds.has(item.movieId)).length / GOLD_K,
        precision: outputMlIds.filter((id) => goldIds.has(id)).length / TOP_K,
        coLikePrecision: outputMlIds.filter((id) => coLikeGold.some((item) => item.movieId === id)).length / TOP_K,
        ndcg: dcg(relevance) / Math.max(dcg(ideal), Number.EPSILON),
        conditionalHitRate: availableGold.length ? outputMlIds.filter((id) => goldIds.has(id)).length / Math.min(TOP_K, availableGold.length) : null,
        conditionalNdcg: availableGold.length ? dcg(relevance) / Math.max(dcg(conditionalIdeal), Number.EPSILON) : null,
        coverage: Math.min(TOP_K, ranked.length) / TOP_K,
        outputCount: ranked.length,
        top: ranked.slice(0, 3).map((item) => item.title).join(' | '),
        goldTop: gold.slice(0, 5).map((item) => movies.get(item.movieId)?.title ?? String(item.movieId)).join(' | '),
        retrievedGold: gold.filter((item) => candidateMlIds.has(item.movieId)).map((item) => movies.get(item.movieId)?.title ?? String(item.movieId)).join(' | '),
      })
    } catch (error) {
      summaries.push({ title: seed.title, unavailable: true, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const evaluated = summaries.filter((item) => !item.unavailable) as Array<Exclude<(typeof summaries)[number], { unavailable: true }>>
  const metric = (name: 'retrievalRecall' | 'detailRecall' | 'precision' | 'ndcg' | 'coverage') => evaluated.map((item) => Number(item[name]))
  const retrieval = mean(metric('retrievalRecall'))
  const detail = mean(metric('detailRecall'))
  const precision = mean(metric('precision'))
  const ndcg = mean(metric('ndcg'))
  const coverage = mean(metric('coverage'))
  const conditionalHitRate = mean(evaluated.map((item) => Number(item.conditionalHitRate ?? 0)))
  const conditionalNdcg = mean(evaluated.map((item) => Number(item.conditionalNdcg ?? 0)))
  const ndcgP10 = percentile(metric('ndcg'), 0.1)
  const withAtLeastTwo = evaluated.filter((item) => Number(item.outputCount) >= 2).length / Math.max(evaluated.length, 1)
  console.log(`## Production-path human benchmark (${split})`)
  console.log(`seeds=${seedIds.length} evaluated=${evaluated.length} unavailable=${summaries.length - evaluated.length} collisions_excluded=${collisionCount}`)
  console.log(`retrieval_recall@70=${retrieval.toFixed(3)}`)
  console.log(`detail_recall@70=${detail.toFixed(3)}`)
  console.log(`precision@10=${precision.toFixed(3)}`)
  console.log(`nDCG@10=${ndcg.toFixed(3)} p10=${ndcgP10.toFixed(3)}`)
  console.log(`coverage@10=${coverage.toFixed(3)} seeds_with_2plus=${withAtLeastTwo.toFixed(3)}`)
  console.log(`conditional_hit@10=${conditionalHitRate.toFixed(3)} conditional_nDCG@10=${conditionalNdcg.toFixed(3)}`)
  for (const item of evaluated.sort((a, b) => Number(a.ndcg) - Number(b.ndcg)).slice(0, 10)) {
    console.log(`- ${item.title}: ret=${Number(item.retrievalRecall).toFixed(2)} p=${Number(item.precision).toFixed(2)} colike=${Number(item.coLikePrecision).toFixed(2)} ndcg=${Number(item.ndcg).toFixed(2)} out=${item.outputCount} top=${item.top} gold=${item.goldTop} retrieved=${item.retrievedGold}`)
  }
  if (split === 'validation') {
    const passed = evaluated.length >= 45 && retrieval >= 0.70 && precision >= 0.40 && ndcg >= 0.45 && coverage >= 0.90 && ndcgP10 >= 0.20 && withAtLeastTwo >= 0.90
    if (!passed) process.exitCode = 1
  }
}

await main()
