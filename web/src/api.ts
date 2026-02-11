import type { MovieDetails, RecommendationResponse, SearchMovie } from './types'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

const TMDB_API_KEY: string | undefined = import.meta.env.VITE_TMDB_API_KEY
const TMDB_ACCESS_TOKEN: string | undefined = import.meta.env.VITE_TMDB_ACCESS_TOKEN

type TmdbListResponse = {
  results?: TmdbListMovie[]
}

type TmdbListMovie = {
  id: number
  title: string
  release_date?: string
  poster_path?: string
  vote_average?: number
  vote_count?: number
  genre_ids?: number[]
}

type TmdbKeyword = {
  id: number
  name: string
}

type TmdbMovieDetails = {
  id: number
  title: string
  overview?: string
  release_date?: string
  runtime?: number
  genres?: Array<{ id: number; name: string }>
  poster_path?: string
  backdrop_path?: string
  vote_average?: number
  vote_count?: number
  credits?: {
    cast?: Array<{ id: number; name: string; character?: string }>
    crew?: Array<{ id: number; name: string; job?: string }>
  }
  keywords?: {
    keywords?: TmdbKeyword[]
    results?: TmdbKeyword[]
  }
}

type TmdbPersonMovieCredits = {
  crew?: TmdbPersonMovieCredit[]
}

type TmdbPersonMovieCredit = {
  id: number
  title: string
  release_date?: string
  poster_path?: string
  vote_average?: number
  vote_count?: number
  genre_ids?: number[]
  job?: string
}

type CandidateMovie = {
  id: number
  title: string
  release_date: string | null
  poster_path: string | null
  vote_average: number
  vote_count: number
}

type ScoredMovie = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  similarity_score: number
  match_reason: string
}

type ScoreFeatures = {
  genreIds: number[]
  directorId: number | null
  castIds: number[]
  voteAverage: number
  voteCount: number
  releaseYear: number | null
  keywordIds: number[]
}

type ScoringResult = {
  score: number
  reason: string
}

function hasTmdbConfig(): boolean {
  return Boolean(TMDB_ACCESS_TOKEN || TMDB_API_KEY)
}

function createTmdbUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${TMDB_BASE_URL}${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  if (!TMDB_ACCESS_TOKEN && TMDB_API_KEY) {
    url.searchParams.set('api_key', TMDB_API_KEY)
  }

  return url.toString()
}

async function tmdbJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  if (!hasTmdbConfig()) {
    throw new Error('TMDB credentials missing. Configure VITE_TMDB_API_KEY or VITE_TMDB_ACCESS_TOKEN.')
  }

  const headers: HeadersInit = {
    accept: 'application/json',
  }
  if (TMDB_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${TMDB_ACCESS_TOKEN}`
  }

  const url = createTmdbUrl(path, params)
  const response = await fetch(url, { headers })

  if (!response.ok) {
    const debugMessage = `[TMDB] ${response.status} on ${path}`
    console.error(debugMessage)
    if (response.status === 404) {
      throw new Error('Movie not found')
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('TMDB credentials are invalid')
    }
    throw new Error(`TMDB request failed (${response.status})`)
  }

  return (await response.json()) as T
}

function mapSearchMovie(movie: TmdbListMovie): SearchMovie {
  return {
    id: movie.id,
    title: movie.title,
    release_date: movie.release_date ?? null,
    poster_path: movie.poster_path ?? null,
    vote_average: movie.vote_average ?? 0,
  }
}

function mapMovieDetails(payload: TmdbMovieDetails): MovieDetails {
  const cast = (payload.credits?.cast ?? []).slice(0, 10).map((member) => ({
    id: member.id,
    name: member.name,
    character: member.character ?? 'Unknown',
  }))

  const director = payload.credits?.crew?.find((member) => member.job === 'Director')?.name ?? 'Unknown'

  return {
    id: payload.id,
    title: payload.title,
    overview: payload.overview ?? '',
    release_date: payload.release_date ?? null,
    runtime: payload.runtime ?? null,
    genres: payload.genres ?? [],
    poster_path: payload.poster_path ?? null,
    backdrop_path: payload.backdrop_path ?? null,
    vote_average: payload.vote_average ?? 0,
    director,
    cast,
  }
}

function parseYear(date?: string): number | null {
  if (!date || date.length < 4) {
    return null
  }
  const year = Number(date.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

function extractKeywordIds(payload: TmdbMovieDetails): number[] {
  const keywords = payload.keywords?.keywords ?? payload.keywords?.results ?? []
  return keywords.map((keyword) => keyword.id)
}

function extractScoreFeatures(payload: TmdbMovieDetails): ScoreFeatures {
  const genreIds = (payload.genres ?? []).map((genre) => genre.id)
  const directorId = payload.credits?.crew?.find((member) => member.job === 'Director')?.id ?? null
  const castIds = (payload.credits?.cast ?? []).slice(0, 5).map((member) => member.id)

  return {
    genreIds,
    directorId,
    castIds,
    voteAverage: payload.vote_average ?? 0,
    voteCount: payload.vote_count ?? 0,
    releaseYear: parseYear(payload.release_date),
    keywordIds: extractKeywordIds(payload),
  }
}

function jaccardScore(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length
  const union = new Set([...left, ...right]).size

  return union === 0 ? 0 : intersection / union
}

function overlapCount(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const rightSet = new Set(right)
  return left.filter((value) => rightSet.has(value)).length
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function buildReason(params: {
  sameDirector: boolean
  sharedKeywords: number
  sharedGenres: number
  sharedCast: number
  yearDiff: number | null
}): string {
  const reasons: string[] = []

  if (params.sameDirector) {
    reasons.push('Same director')
  }
  if (params.sharedKeywords >= 2) {
    reasons.push('Shared themes')
  }
  if (params.sharedGenres >= 2) {
    reasons.push('Strong genre overlap')
  }
  if (params.sharedCast >= 1) {
    reasons.push('Shared cast')
  }
  if (params.yearDiff !== null && params.yearDiff <= 6) {
    reasons.push('Same era')
  }

  return reasons.length > 0 ? reasons.slice(0, 2).join(' + ') : 'Strong overall profile match'
}

function scoreCandidate(base: ScoreFeatures, candidate: ScoreFeatures): ScoringResult | null {
  const sharedGenres = overlapCount(base.genreIds, candidate.genreIds)
  const sharedKeywords = overlapCount(base.keywordIds, candidate.keywordIds)
  const sharedCast = overlapCount(base.castIds, candidate.castIds)
  const sameDirector =
    base.directorId !== null && candidate.directorId !== null && base.directorId === candidate.directorId

  const yearDiff =
    base.releaseYear !== null && candidate.releaseYear !== null
      ? Math.abs(base.releaseYear - candidate.releaseYear)
      : null

  if (!sameDirector && sharedGenres === 0 && sharedKeywords === 0 && sharedCast === 0) {
    return null
  }

  if (!sameDirector && candidate.voteCount < 40) {
    return null
  }

  const genreScore = jaccardScore(base.genreIds, candidate.genreIds)
  const keywordScore = clamp(sharedKeywords / 4, 0, 1)
  const directorScore = sameDirector ? 1 : 0
  const castScore = clamp(sharedCast / 3, 0, 1)
  const yearScore = yearDiff === null ? 0.45 : clamp(1 - yearDiff / 18, 0, 1)
  const ratingScore = clamp(1 - Math.abs(base.voteAverage - candidate.voteAverage) / 3.5, 0, 1)
  const voteCountScore = clamp(Math.log10(candidate.voteCount + 1) / 4, 0, 1)

  let score =
    genreScore * 0.33 +
    keywordScore * 0.24 +
    directorScore * 0.13 +
    castScore * 0.1 +
    yearScore * 0.1 +
    ratingScore * 0.06 +
    voteCountScore * 0.04

  if (sameDirector) {
    score += 0.07
  }
  if (sharedKeywords >= 3) {
    score += 0.05
  }
  if (sharedGenres >= 2) {
    score += 0.03
  }
  if (sharedCast >= 2) {
    score += 0.03
  }

  if (candidate.voteAverage < 6.2) {
    score -= 0.06
  }
  if (!sameDirector && candidate.voteCount < 150) {
    score -= 0.03
  }
  if (yearDiff !== null && yearDiff > 20) {
    score -= 0.04
  }

  const score100 = clamp(score * 100, 0, 100)
  const minThreshold = sameDirector ? 28 : 34
  if (score100 < minThreshold) {
    return null
  }

  const reason = buildReason({
    sameDirector,
    sharedKeywords,
    sharedGenres,
    sharedCast,
    yearDiff,
  })

  return {
    score: Math.round(score100 * 10) / 10,
    reason,
  }
}

function toCandidate(movie: TmdbListMovie | TmdbPersonMovieCredit): CandidateMovie {
  return {
    id: movie.id,
    title: movie.title,
    release_date: movie.release_date ?? null,
    poster_path: movie.poster_path ?? null,
    vote_average: movie.vote_average ?? 0,
    vote_count: movie.vote_count ?? 0,
  }
}

function uniqueCandidates(candidates: CandidateMovie[], baseMovieId: number): CandidateMovie[] {
  const byId = new Map<number, CandidateMovie>()

  for (const candidate of candidates) {
    if (candidate.id === baseMovieId) {
      continue
    }

    const existing = byId.get(candidate.id)
    if (!existing || candidate.vote_count > existing.vote_count) {
      byId.set(candidate.id, candidate)
    }
  }

  return [...byId.values()]
    .sort((left, right) => {
      if (right.vote_count !== left.vote_count) {
        return right.vote_count - left.vote_count
      }
      return right.vote_average - left.vote_average
    })
}

export async function getHealth(): Promise<{ status: string; service: string }> {
  if (!hasTmdbConfig()) {
    throw new Error('TMDB not configured')
  }

  await tmdbJson('/configuration')
  return {
    status: 'ok',
    service: 'tmdb-direct',
  }
}

export async function searchMovies(query: string): Promise<SearchMovie[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const payload = await tmdbJson<TmdbListResponse>('/search/movie', {
    query: trimmed,
    include_adult: 'false',
    language: 'en-US',
    page: '1',
  })

  return (payload.results ?? []).map(mapSearchMovie)
}

export async function getMovieDetails(movieId: number): Promise<MovieDetails> {
  const payload = await tmdbJson<TmdbMovieDetails>(`/movie/${movieId}`, {
    append_to_response: 'credits,keywords',
    language: 'en-US',
  })
  return mapMovieDetails(payload)
}

export async function getMovieRecommendations(movieId: number): Promise<RecommendationResponse> {
  const [basePayload, similarPayload, recommendedPayload] = await Promise.all([
    tmdbJson<TmdbMovieDetails>(`/movie/${movieId}`, {
      append_to_response: 'credits,keywords',
      language: 'en-US',
    }),
    tmdbJson<TmdbListResponse>(`/movie/${movieId}/similar`, {
      language: 'en-US',
      page: '1',
    }),
    tmdbJson<TmdbListResponse>(`/movie/${movieId}/recommendations`, {
      language: 'en-US',
      page: '1',
    }),
  ])

  const directorId = basePayload.credits?.crew?.find((member) => member.job === 'Director')?.id

  let directorMovies: TmdbPersonMovieCredit[] = []
  if (directorId) {
    try {
      const credits = await tmdbJson<TmdbPersonMovieCredits>(`/person/${directorId}/movie_credits`, {
        language: 'en-US',
      })
      directorMovies = (credits.crew ?? []).filter((movie) => movie.job === 'Director')
    } catch (error) {
      console.warn('Director filmography fetch failed', error)
    }
  }

  const mergedCandidates = uniqueCandidates(
    [
      ...(similarPayload.results ?? []).map(toCandidate),
      ...(recommendedPayload.results ?? []).map(toCandidate),
      ...directorMovies.map(toCandidate),
    ],
    movieId,
  )

  const detailedCandidates = await Promise.allSettled(
    mergedCandidates.slice(0, 55).map((movie) =>
      tmdbJson<TmdbMovieDetails>(`/movie/${movie.id}`, {
        append_to_response: 'credits,keywords',
        language: 'en-US',
      }),
    ),
  )

  const baseScoreFeatures = extractScoreFeatures(basePayload)
  const scoredMovies: ScoredMovie[] = []

  for (const result of detailedCandidates) {
    if (result.status !== 'fulfilled') {
      continue
    }

    const detail = result.value
    const mapped = mapMovieDetails(detail)
    const candidateScoreFeatures = extractScoreFeatures(detail)
    const scored = scoreCandidate(baseScoreFeatures, candidateScoreFeatures)

    if (!scored) {
      continue
    }

    scoredMovies.push({
      id: mapped.id,
      title: mapped.title,
      poster_path: mapped.poster_path,
      release_date: mapped.release_date,
      vote_average: mapped.vote_average,
      similarity_score: scored.score,
      match_reason: scored.reason,
    })
  }

  scoredMovies.sort((left, right) => right.similarity_score - left.similarity_score)

  return {
    base_movie: {
      id: basePayload.id,
      title: basePayload.title,
    },
    results: scoredMovies.slice(0, 24),
  }
}

export function getPosterUrl(posterPath: string | null): string {
  if (!posterPath) {
    return 'https://placehold.co/600x900/15212e/f4f4ef?text=No+Poster'
  }
  return `${TMDB_IMAGE_BASE}${posterPath}`
}
