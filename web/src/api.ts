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
  credits?: {
    cast?: Array<{ id: number; name: string; character?: string }>
    crew?: Array<{ id: number; name: string; job?: string }>
  }
}

type ScoredMovie = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  similarity_score: number
}

type ScoreFeatures = {
  genreIds: number[]
  directorId: number | null
  castIds: number[]
  voteAverage: number
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

  const director =
    payload.credits?.crew?.find((member) => member.job === 'Director')?.name ?? 'Unknown'

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

function extractScoreFeatures(payload: TmdbMovieDetails): ScoreFeatures {
  const genreIds = (payload.genres ?? []).map((genre) => genre.id)
  const directorId =
    payload.credits?.crew?.find((member) => member.job === 'Director')?.id ?? null
  const castIds = (payload.credits?.cast ?? []).slice(0, 5).map((member) => member.id)

  return {
    genreIds,
    directorId,
    castIds,
    voteAverage: payload.vote_average ?? 0,
  }
}

function similarityScore(base: ScoreFeatures, candidate: ScoreFeatures): number {
  const baseGenres = new Set(base.genreIds)
  const candidateGenres = new Set(candidate.genreIds)

  const sharedGenres = [...baseGenres].filter((genreId) => candidateGenres.has(genreId)).length
  const unionGenres = new Set([...base.genreIds, ...candidate.genreIds]).size
  const genreScore = unionGenres === 0 ? 0 : sharedGenres / unionGenres

  const directorScore =
    base.directorId !== null && candidate.directorId !== null && base.directorId === candidate.directorId
      ? 1
      : 0

  const baseCast = new Set(base.castIds)
  const candidateCast = new Set(candidate.castIds)
  const sharedCast = [...baseCast].filter((castId) => candidateCast.has(castId)).length
  const castScore = Math.min(1, sharedCast / 5)

  const ratingDiff = Math.abs(base.voteAverage - candidate.voteAverage)
  const ratingScore = Math.max(0, 1 - ratingDiff / 5)

  const weighted = genreScore * 0.45 + directorScore * 0.2 + castScore * 0.2 + ratingScore * 0.15
  return Math.round(weighted * 1000) / 10
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
    append_to_response: 'credits',
    language: 'en-US',
  })
  return mapMovieDetails(payload)
}

export async function getMovieRecommendations(movieId: number): Promise<RecommendationResponse> {
  const [basePayload, similarPayload, recommendedPayload] = await Promise.all([
    tmdbJson<TmdbMovieDetails>(`/movie/${movieId}`, {
      append_to_response: 'credits',
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

  const seen = new Set<number>([movieId])
  const candidates: TmdbListMovie[] = []

  for (const movie of [...(similarPayload.results ?? []), ...(recommendedPayload.results ?? [])]) {
    if (!seen.has(movie.id)) {
      seen.add(movie.id)
      candidates.push(movie)
    }
  }

  const detailedCandidates = await Promise.allSettled(
    candidates.slice(0, 40).map((movie) =>
      tmdbJson<TmdbMovieDetails>(`/movie/${movie.id}`, {
        append_to_response: 'credits',
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
    const score = similarityScore(baseScoreFeatures, extractScoreFeatures(detail))

    scoredMovies.push({
      id: mapped.id,
      title: mapped.title,
      poster_path: mapped.poster_path,
      release_date: mapped.release_date,
      vote_average: mapped.vote_average,
      similarity_score: score,
    })
  }

  scoredMovies.sort((a, b) => b.similarity_score - a.similarity_score)

  return {
    base_movie: {
      id: basePayload.id,
      title: basePayload.title,
    },
    results: scoredMovies.slice(0, 20),
  }
}

export function getPosterUrl(posterPath: string | null): string {
  if (!posterPath) {
    return 'https://placehold.co/600x900/15212e/f4f4ef?text=No+Poster'
  }
  return `${TMDB_IMAGE_BASE}${posterPath}`
}
