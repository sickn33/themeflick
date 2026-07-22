import fs from 'node:fs'
import path from 'node:path'
import {
  rankCandidates,
  type ScoreFeatures,
  type RankingCandidate
} from './src/lib/recommendationEngine.ts'

type TmdbKeyword = { id: number; name: string }
type TmdbCrewMember = { id: number; job?: string }
type TmdbCastMember = { id: number }
type TmdbMovieSummary = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  vote_count?: number
}
type TmdbMovieDetails = TmdbMovieSummary & {
  genres?: Array<{ id: number }>
  runtime?: number | null
  vote_count?: number
  credits?: {
    crew?: TmdbCrewMember[]
    cast?: TmdbCastMember[]
  }
  keywords?: {
    keywords?: TmdbKeyword[]
    results?: TmdbKeyword[]
  }
}
type TmdbListResponse = { results?: TmdbMovieSummary[] }
type TmdbPersonMovieCredits = { crew?: Array<TmdbMovieSummary & { job?: string }> }
type SourceTaggedMovie = TmdbMovieSummary & { _source: 'similar' | 'recommended' | 'director' }

const DEFAULT_MOVIE_IDS = [
  603, // The Matrix
  27205, // Inception
  496243, // Parasite
  129, // Spirited Away
  152601, // Her
  238, // The Godfather
  348, // Alien
  862, // Toy Story
]

const SAMPLE_LISTS = [
  '/movie/popular?page=1',
  '/movie/popular?page=2',
  '/movie/top_rated?page=1',
  '/movie/top_rated?page=2',
  '/movie/now_playing?page=1',
]

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

// Try to use import.meta.env if available (Vite)
const importMetaEnv = import.meta.env as Record<string, string | undefined> | undefined

// Polyfill load env for process.env
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env')
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const [key, ...vals] = trimmed.split('=')
        if (key && vals.length > 0) {
          const val = vals.join('=').trim()
          // Remove quotes if present
          const cleanVal = val.replace(/^["'](.*)["']$/, '$1')
          process.env[key.trim()] = cleanVal
        }
      }
    }
  } catch (e) {
    console.error('Failed to load .env', e)
  }
}

loadEnv()

const TMDB_API_KEY = importMetaEnv?.VITE_TMDB_API_KEY || process.env.VITE_TMDB_API_KEY
const TMDB_ACCESS_TOKEN = importMetaEnv?.VITE_TMDB_ACCESS_TOKEN || process.env.VITE_TMDB_ACCESS_TOKEN
const BASE_URL = 'https://api.themoviedb.org/3'

console.log('TMDB credentials detected:', TMDB_API_KEY || TMDB_ACCESS_TOKEN ? 'Yes' : 'No')

if (!TMDB_API_KEY && !TMDB_ACCESS_TOKEN) {
  console.error('No VITE_TMDB_API_KEY or VITE_TMDB_ACCESS_TOKEN found in .env or import.meta.env')
  process.exit(1)
}

async function fetchTmdb<T>(path: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = TMDB_API_KEY
    ? `${BASE_URL}${path}${separator}api_key=${TMDB_API_KEY}&language=en-US`
    : `${BASE_URL}${path}${separator}language=en-US`
  const headers = TMDB_ACCESS_TOKEN ? { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` } : undefined
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`TMDB Error ${res.status}: ${path}`)
  return (await res.json()) as T
}

function extractFeatures(details: TmdbMovieDetails): ScoreFeatures {
  const genreIds = details.genres?.map((genre) => genre.id) || []
  const directorId = details.credits?.crew?.find((member) => member.job === 'Director')?.id || null
  const castIds = details.credits?.cast?.slice(0, 5).map((member) => member.id) || []

  const keywords = details.keywords?.keywords || details.keywords?.results || []
  const keywordIds = keywords.map((keyword) => keyword.id)

  // Minimal token extraction for debug
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

  // Composer
  const composerIds = details.credits?.crew
    ?.filter((member) => {
      const job = member.job?.toLowerCase() ?? ''
      return job === 'original music composer' || job === 'music' || job === 'music director' || job === 'composer'
    })
    .map((member) => member.id) || []

  return {
    genreIds,
    directorId,
    composerIds,
    keywordPhrases: [...keywordPhrases],
    keywordTokens: [...keywordTokens],
    castIds,
    voteAverage: details.vote_average || 0,
    voteCount: details.vote_count || 0,
    releaseYear: details.release_date ? parseInt(details.release_date.substring(0, 4)) : null,
    runtimeMinutes: details.runtime || null,
    keywordIds
  }
}

async function analyze(movieId: number) {
  const baseDetails = await fetchTmdb<TmdbMovieDetails>(`/movie/${movieId}?append_to_response=credits,keywords`)
  const baseFeatures = extractFeatures(baseDetails)

  const [similarPage1, similarPage2, recommendedPage1, recommendedPage2] = await Promise.all([
    fetchTmdb<TmdbListResponse>(`/movie/${movieId}/similar?page=1`),
    fetchTmdb<TmdbListResponse>(`/movie/${movieId}/similar?page=2`).catch(() => ({ results: [] })),
    fetchTmdb<TmdbListResponse>(`/movie/${movieId}/recommendations?page=1`),
    fetchTmdb<TmdbListResponse>(`/movie/${movieId}/recommendations?page=2`).catch(() => ({ results: [] })),
  ])
  const directorMovies = baseFeatures.directorId
    ? await fetchTmdb<TmdbPersonMovieCredits>(`/person/${baseFeatures.directorId}/movie_credits`)
        .then((credits) =>
          (credits.crew ?? [])
            .filter((movie) => movie.job === 'Director' && movie.id !== movieId)
            .sort((left, right) => (right.vote_average ?? 0) - (left.vote_average ?? 0))
            .slice(0, 10),
        )
        .catch(() => [])
    : []

  const rawCandidates: SourceTaggedMovie[] = [
    ...(similarPage1.results || []).map((movie) => ({ ...movie, _source: 'similar' as const })),
    ...(similarPage2.results || []).map((movie) => ({ ...movie, _source: 'similar' as const })),
    ...(recommendedPage1.results || []).map((movie) => ({ ...movie, _source: 'recommended' as const })),
    ...(recommendedPage2.results || []).map((movie) => ({ ...movie, _source: 'recommended' as const })),
    ...directorMovies.map((movie) => ({ ...movie, _source: 'director' as const })),
  ]

  const unique = new Map<number, SourceTaggedMovie>()
  for (const c of rawCandidates) {
    if (c.id !== movieId && !unique.has(c.id)) unique.set(c.id, c)
  }

  const toEnrich = [...unique.values()]
    .sort((left, right) => {
      const sourceRank = (movie: SourceTaggedMovie) =>
        (movie._source === 'similar' ? 2 : 0) +
        (movie._source === 'recommended' ? 2 : 0) +
        (movie._source === 'director' ? 1 : 0)
      const sourceDiff = sourceRank(right) - sourceRank(left)
      if (sourceDiff !== 0) {
        return sourceDiff
      }
      if ((right.vote_count ?? 0) !== (left.vote_count ?? 0)) {
        return (right.vote_count ?? 0) - (left.vote_count ?? 0)
      }
      return (right.vote_average ?? 0) - (left.vote_average ?? 0)
    })
    .slice(0, 70)
  const details = await Promise.allSettled(
    toEnrich.map((candidate) => fetchTmdb<TmdbMovieDetails>(`/movie/${candidate.id}?append_to_response=credits,keywords`)),
  )
  const rankingCandidates: RankingCandidate[] = details.flatMap((result, index) => {
    if (result.status !== 'fulfilled') {
      return []
    }

    const candidate = toEnrich[index]
    const features = extractFeatures(result.value)
    return [{
      id: candidate.id,
      title: candidate.title,
      poster_path: candidate.poster_path,
      release_date: candidate.release_date,
      vote_average: candidate.vote_average,
      director_id: features.directorId,
      features,
      source: {
        fromSimilar: candidate._source === 'similar',
        fromRecommended: candidate._source === 'recommended',
        fromDirectorFilmography: candidate._source === 'director',
      },
    }]
  })

  const ranked = rankCandidates(baseFeatures, rankingCandidates)
  const rejectedCount = rankingCandidates.length - ranked.length
  const top = ranked.slice(0, 8)
  const weakTop = top.filter((movie) => movie.similarity_score < 35).length
  const genericReasonCount = top.filter((movie) => /overall profile/i.test(movie.match_reason)).length
  const genreOnlyTopCount = top.filter((movie) =>
    movie.similarity_score > 44 &&
    movie.match_reason
      .split(' + ')
      .every((reason) =>
        reason === 'Genre overlap' ||
        reason === 'Strong genre overlap' ||
        reason === 'Same era' ||
        reason === 'Similar pacing',
      ),
  ).length
  const weakReasonCount = top.filter((movie) =>
    movie.match_reason
      .split(' + ')
      .every((reason) => reason === 'Same era' || reason === 'Similar pacing'),
  ).length
  const outOfOrder = ranked.some((movie, index) => index > 0 && movie.similarity_score > ranked[index - 1].similarity_score)

  return {
    id: movieId,
    title: baseDetails.title,
    candidateCount: rankingCandidates.length,
    rankedCount: ranked.length,
    rejectedCount,
    weakTop,
    genericReasonCount,
    genreOnlyTopCount,
    weakReasonCount,
    outOfOrder,
    top,
  }
}

async function loadSampleFromTmdb(): Promise<number[]> {
  const pages = await Promise.all(SAMPLE_LISTS.map((path) => fetchTmdb<TmdbListResponse>(path)))
  return [...new Set(pages.flatMap((page) => page.results ?? []).map((movie) => movie.id))].slice(0, 100)
}

const movieIds = process.argv.slice(2).map(Number).filter((id) => Number.isFinite(id) && id > 0)
const sample = movieIds.length > 0 ? movieIds : process.env.ANALYZE_SAMPLE === 'tmdb' ? await loadSampleFromTmdb() : DEFAULT_MOVIE_IDS
const topLimit = Number(process.env.ANALYZE_TOP ?? '8')
const minimumResults = Number(process.env.ANALYZE_MIN_RESULTS ?? '2')
const results = []

for (const movieId of sample) {
  const result = await analyze(movieId)
  results.push(result)
  console.log(`\n## ${result.title} (${result.id})`)
  console.log(`candidates=${result.candidateCount} ranked=${result.rankedCount} rejected=${result.rejectedCount}`)
  for (const [index, movie] of result.top.slice(0, topLimit).entries()) {
    console.log(
      `${index + 1}. ${movie.title} (${movie.release_date?.slice(0, 4) ?? 'N/A'}) - ${movie.similarity_score}% - ${movie.match_reason}`,
    )
  }
  if (
    result.rankedCount < minimumResults ||
    result.weakTop > 0 ||
    result.genericReasonCount > 0 ||
    result.weakReasonCount > 0 ||
    result.genreOnlyTopCount >= 5
  ) {
    console.log(
      `flags: lowResults=${result.rankedCount < minimumResults} weakTop=${result.weakTop} weakReasons=${result.weakReasonCount} genreOnlyTop=${result.genreOnlyTopCount} genericReasons=${result.genericReasonCount}`,
    )
  }
}

const flagged = results.filter(
  (result) =>
    result.rankedCount < minimumResults ||
    result.weakTop > 0 ||
    result.genericReasonCount > 0 ||
    result.weakReasonCount > 0 ||
    result.genreOnlyTopCount >= 5,
)
const rankedCounts = results.map((result) => result.rankedCount)
console.log('\n## Summary')
console.log(`movies=${results.length}`)
console.log(`ranked_min=${Math.min(...rankedCounts)} ranked_avg=${(rankedCounts.reduce((sum, value) => sum + value, 0) / rankedCounts.length).toFixed(1)} ranked_max=${Math.max(...rankedCounts)}`)
console.log(`flagged=${flagged.length}`)
if (flagged.length > 0) {
  console.log(`flagged_titles=${flagged.map((result) => result.title).join('; ')}`)
  process.exitCode = 1
}
