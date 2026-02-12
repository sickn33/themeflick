import type { MovieDetails, RecommendationResponse, SearchMovie } from './types'
import {
  rankCandidates,
  type RankingCandidate,
  type ScoreFeatures,
} from './lib/recommendationEngine'

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
    runtimeMinutes: payload.runtime ?? null,
    keywordIds: extractKeywordIds(payload),
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

  return [...byId.values()].sort((left, right) => {
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
      directorMovies = (credits.crew ?? [])
        .filter((movie) => movie.job === 'Director' && (movie.vote_count ?? 0) >= 50)
        .sort((left, right) => {
          if ((right.vote_count ?? 0) !== (left.vote_count ?? 0)) {
            return (right.vote_count ?? 0) - (left.vote_count ?? 0)
          }
          return (right.vote_average ?? 0) - (left.vote_average ?? 0)
        })
        .slice(0, 18)
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
    mergedCandidates.slice(0, 45).map((movie) =>
      tmdbJson<TmdbMovieDetails>(`/movie/${movie.id}`, {
        append_to_response: 'credits,keywords',
        language: 'en-US',
      }),
    ),
  )

  const baseScoreFeatures = extractScoreFeatures(basePayload)
  const rankingCandidates: RankingCandidate[] = []

  for (const result of detailedCandidates) {
    if (result.status !== 'fulfilled') {
      continue
    }

    const detail = result.value
    const mapped = mapMovieDetails(detail)
    const candidateScoreFeatures = extractScoreFeatures(detail)

    rankingCandidates.push({
      id: mapped.id,
      title: mapped.title,
      poster_path: mapped.poster_path,
      release_date: mapped.release_date,
      vote_average: mapped.vote_average,
      director_id: candidateScoreFeatures.directorId,
      features: candidateScoreFeatures,
    })
  }

  const ranked = rankCandidates(baseScoreFeatures, rankingCandidates)

  return {
    base_movie: {
      id: basePayload.id,
      title: basePayload.title,
    },
    results: ranked.map((movie) => ({
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      release_date: movie.release_date,
      vote_average: movie.vote_average,
      similarity_score: movie.similarity_score,
      match_reason: movie.match_reason,
    })),
  }
}

export function getPosterUrl(posterPath: string | null): string {
  if (!posterPath) {
    return 'https://placehold.co/600x900/15212e/f4f4ef?text=No+Poster'
  }
  return `${TMDB_IMAGE_BASE}${posterPath}`
}
