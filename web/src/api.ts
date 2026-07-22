import type { MovieDetails, RecommendationResponse, SearchMovie } from './types'
import {
  rankCandidates,
  type RankingCandidate,
  type ScoreFeatures,
} from './lib/recommendationEngine.ts'
import { findTagGenomeNeighbors, type TagSignatureIndex } from './lib/tagGenome.ts'

const TMDB_BASE_URL = '/api/tmdb'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const TMDB_TIMEOUT_MS = 12_000

const TAG_SIGNATURE_URL: string | undefined = import.meta.env.VITE_TAG_SIGNATURE_URL

export type TmdbListResponse = {
  results?: TmdbListMovie[]
}

export type TmdbListMovie = {
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

export type TmdbMovieDetails = {
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

export type TmdbPersonMovieCredit = {
  id: number
  title: string
  release_date?: string
  poster_path?: string
  vote_average?: number
  vote_count?: number
  genre_ids?: number[]
  job?: string
}

export type CandidateMovie = {
  id: number
  title: string
  release_date: string | null
  poster_path: string | null
  vote_average: number
  vote_count: number
  source: {
    fromSimilar: boolean
    fromRecommended: boolean
    fromDirectorFilmography: boolean
    fromDiscovery: boolean
    fromTagGenome: boolean
    similarRank: number | null
    recommendedRank: number | null
    directorRank: number | null
    discoveryRank: number | null
    discoveryHits: number
    tagGenomeRank: number | null
  }
}

type SourceKind = 'similar' | 'recommended' | 'director' | 'discovery' | 'semantic'

let tagSignaturePromise: Promise<TagSignatureIndex | null> | null = null

async function loadTagSignatures(): Promise<TagSignatureIndex | null> {
  const configuredUrl = TAG_SIGNATURE_URL
  if (!configuredUrl) return null
  if (!tagSignaturePromise) {
    tagSignaturePromise = fetch(configuredUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Tag signature index returned ${response.status}`)
        return response.json() as Promise<TagSignatureIndex>
      })
      .catch((error) => {
        console.warn('Semantic movie index unavailable; using TMDB-only retrieval', error)
        return null
      })
  }
  return tagSignaturePromise
}

function createTmdbUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${TMDB_BASE_URL}${path}`, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}

async function tmdbJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  const headers: HeadersInit = {
    accept: 'application/json',
  }

  const url = createTmdbUrl(path, params)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('TMDB request timed out')
    }
    throw new Error('Could not reach TMDB')
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    const debugMessage = `[TMDB] ${response.status} on ${path}`
    console.error(debugMessage)
    if (response.status === 404) {
      throw new Error('Movie not found')
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('TMDB credentials are invalid')
    }
    if (response.status === 429) {
      throw new Error('TMDB rate limit reached. Try again shortly.')
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

function extractKeywordTokens(payload: TmdbMovieDetails): string[] {
  const keywords = payload.keywords?.keywords ?? payload.keywords?.results ?? []
  const tokens = new Set<string>()

  for (const keyword of keywords) {
    for (const token of tokenizeKeyword(keyword.name)) {
      tokens.add(token)
    }
  }

  return [...tokens]
}

function extractKeywordPhrases(payload: TmdbMovieDetails): string[] {
  const keywords = payload.keywords?.keywords ?? payload.keywords?.results ?? []
  const phrases = new Set<string>()

  for (const keyword of keywords) {
    const normalized = normalizeKeywordName(keyword.name)
    if (!normalized) {
      continue
    }

    const phraseTokens = normalized
      .split(/[\s-]+/)
      .map(normalizeKeywordToken)
      .filter((token) => token.length >= 3 && !KEYWORD_STOP_WORDS.has(token))

    const canonicalPhrase = phraseTokens.join(' ')
    if (canonicalPhrase) {
      phrases.add(canonicalPhrase)
      continue
    }

    if (normalized.length >= 3) {
      phrases.add(normalized)
    }
  }

  return [...phrases]
}

function extractComposerIds(payload: TmdbMovieDetails): number[] {
  const crew = payload.credits?.crew ?? []
  const composers = crew
    .filter((member) => {
      const job = member.job?.toLowerCase() ?? ''
      return (
        job === 'original music composer' ||
        job === 'music' ||
        job === 'music director' ||
        job === 'composer'
      )
    })
    .map((member) => member.id)

  return [...new Set(composers)].slice(0, 3)
}

const OVERVIEW_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'all', 'also', 'among', 'and', 'are', 'back', 'been', 'before',
  'being', 'between', 'both', 'but', 'can', 'come', 'could', 'day', 'each', 'even', 'find', 'first', 'for',
  'from', 'gets', 'has', 'have', 'her', 'him', 'his', 'into', 'its', 'life', 'make', 'must', 'new', 'not',
  'now', 'one', 'only', 'other', 'out', 'over', 'own', 'she', 'some', 'take', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'they', 'this', 'through', 'time', 'two', 'under', 'until', 'very', 'was', 'when',
  'where', 'while', 'who', 'will', 'with', 'woman', 'world', 'years', 'young',
])

function tokenizeOverview(value: string): string[] {
  const words = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g) ?? []
  return [...new Set(
    words
      .map(normalizeKeywordToken)
      .filter((token) => token.length >= 3 && !OVERVIEW_STOP_WORDS.has(token)),
  )].slice(0, 80)
}

export function extractScoreFeatures(payload: TmdbMovieDetails): ScoreFeatures {
  const genreIds = (payload.genres ?? []).map((genre) => genre.id)
  const directorId = payload.credits?.crew?.find((member) => member.job === 'Director')?.id ?? null
  const castIds = (payload.credits?.cast ?? []).slice(0, 5).map((member) => member.id)

  return {
    genreIds,
    directorId,
    composerIds: extractComposerIds(payload),
    keywordPhrases: extractKeywordPhrases(payload),
    keywordTokens: extractKeywordTokens(payload),
    castIds,
    voteAverage: payload.vote_average ?? 0,
    voteCount: payload.vote_count ?? 0,
    releaseYear: parseYear(payload.release_date),
    runtimeMinutes: payload.runtime ?? null,
    keywordIds: extractKeywordIds(payload),
    overviewTokens: tokenizeOverview(payload.overview ?? ''),
  }
}

export function toCandidate(
  movie: TmdbListMovie | TmdbPersonMovieCredit,
  sourceKind: SourceKind,
  sourceRank: number,
): CandidateMovie {
  const source = {
    fromSimilar: sourceKind === 'similar',
    fromRecommended: sourceKind === 'recommended',
    fromDirectorFilmography: sourceKind === 'director',
    fromDiscovery: sourceKind === 'discovery',
    fromTagGenome: sourceKind === 'semantic',
    similarRank: sourceKind === 'similar' ? sourceRank : null,
    recommendedRank: sourceKind === 'recommended' ? sourceRank : null,
    directorRank: sourceKind === 'director' ? sourceRank : null,
    discoveryRank: sourceKind === 'discovery' ? sourceRank : null,
    discoveryHits: sourceKind === 'discovery' ? 1 : 0,
    tagGenomeRank: sourceKind === 'semantic' ? sourceRank : null,
  }

  return {
    id: movie.id,
    title: movie.title,
    release_date: movie.release_date ?? null,
    poster_path: movie.poster_path ?? null,
    vote_average: movie.vote_average ?? 0,
    vote_count: movie.vote_count ?? 0,
    source,
  }
}

export function uniqueCandidates(candidates: CandidateMovie[], baseMovieId: number): CandidateMovie[] {
  const byId = new Map<number, CandidateMovie>()

  for (const candidate of candidates) {
    if (candidate.id === baseMovieId) {
      continue
    }

    const existing = byId.get(candidate.id)
    if (!existing) {
      byId.set(candidate.id, candidate)
      continue
    }

    const mergedSource = {
      fromSimilar: existing.source.fromSimilar || candidate.source.fromSimilar,
      fromRecommended: existing.source.fromRecommended || candidate.source.fromRecommended,
      fromDirectorFilmography:
        existing.source.fromDirectorFilmography || candidate.source.fromDirectorFilmography,
      fromDiscovery: existing.source.fromDiscovery || candidate.source.fromDiscovery,
      fromTagGenome: existing.source.fromTagGenome || candidate.source.fromTagGenome,
      similarRank: minSourceRank(existing.source.similarRank, candidate.source.similarRank),
      recommendedRank: minSourceRank(existing.source.recommendedRank, candidate.source.recommendedRank),
      directorRank: minSourceRank(existing.source.directorRank, candidate.source.directorRank),
      discoveryRank: minSourceRank(existing.source.discoveryRank, candidate.source.discoveryRank),
      discoveryHits: existing.source.discoveryHits + candidate.source.discoveryHits,
      tagGenomeRank: minSourceRank(existing.source.tagGenomeRank, candidate.source.tagGenomeRank),
    }

    if (candidate.vote_count > existing.vote_count) {
      byId.set(candidate.id, {
        ...candidate,
        source: mergedSource,
      })
      continue
    }

    byId.set(candidate.id, {
      ...existing,
      source: mergedSource,
    })
  }

  return [...byId.values()]
}

function minSourceRank(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.min(left, right)
}

const CANDIDATE_DETAIL_LIMIT = 100
const DETAIL_FETCH_CONCURRENCY = 8

export function selectRecommendationCandidates(
  candidates: CandidateMovie[],
  limit = CANDIDATE_DETAIL_LIMIT,
): CandidateMovie[] {
  const selected: CandidateMovie[] = []
  const selectedIds = new Set<number>()

  const addByRank = (rank: (movie: CandidateMovie) => number | null, quota: number) => {
    const ranked = candidates
      .filter((movie) => rank(movie) !== null)
      .sort((left, right) => (rank(left) ?? Number.MAX_SAFE_INTEGER) - (rank(right) ?? Number.MAX_SAFE_INTEGER))

    let added = 0
    for (const movie of ranked) {
      if (selected.length >= limit || added >= quota) break
      if (selectedIds.has(movie.id)) continue
      selected.push(movie)
      selectedIds.add(movie.id)
      added += 1
    }
  }

  const discoveryRanked = candidates
    .filter((movie) => movie.source.discoveryRank !== null)
    .sort((left, right) =>
      right.source.discoveryHits - left.source.discoveryHits ||
      (left.source.discoveryRank ?? Number.MAX_SAFE_INTEGER) - (right.source.discoveryRank ?? Number.MAX_SAFE_INTEGER) ||
      right.vote_count - left.vote_count ||
      left.id - right.id,
    )

  addByRank((movie) => movie.source.tagGenomeRank, Math.min(50, limit))
  addByRank((movie) => movie.source.similarRank, Math.min(15, Math.max(0, limit - selected.length)))
  addByRank((movie) => movie.source.recommendedRank, Math.min(15, Math.max(0, limit - selected.length)))
  let discoveryAdded = 0
  const discoveryQuota = Math.min(15, Math.max(0, limit - selected.length - 5))
  for (const movie of discoveryRanked) {
    if (discoveryAdded >= discoveryQuota || selected.length >= limit) break
    if (selectedIds.has(movie.id)) continue
    selected.push(movie)
    selectedIds.add(movie.id)
    discoveryAdded += 1
  }
  addByRank((movie) => movie.source.directorRank, Math.min(5, Math.max(0, limit - selected.length)))

  const remaining = candidates
    .filter((movie) => !selectedIds.has(movie.id))
    .sort((left, right) => {
      const leftRank = Math.min(
        left.source.similarRank ?? Number.MAX_SAFE_INTEGER,
        left.source.recommendedRank ?? Number.MAX_SAFE_INTEGER,
        left.source.directorRank ?? Number.MAX_SAFE_INTEGER,
        left.source.discoveryRank ?? Number.MAX_SAFE_INTEGER,
        left.source.tagGenomeRank ?? Number.MAX_SAFE_INTEGER,
      )
      const rightRank = Math.min(
        right.source.similarRank ?? Number.MAX_SAFE_INTEGER,
        right.source.recommendedRank ?? Number.MAX_SAFE_INTEGER,
        right.source.directorRank ?? Number.MAX_SAFE_INTEGER,
        right.source.discoveryRank ?? Number.MAX_SAFE_INTEGER,
        right.source.tagGenomeRank ?? Number.MAX_SAFE_INTEGER,
      )
      return leftRank - rightRank || right.vote_count - left.vote_count || left.id - right.id
    })

  for (const movie of remaining) {
    if (selected.length >= limit) break
    selected.push(movie)
  }

  return selected
}

export type RecommendationSourceLists = {
  similarPage1: TmdbListMovie[]
  similarPage2: TmdbListMovie[]
  recommendedPage1: TmdbListMovie[]
  recommendedPage2: TmdbListMovie[]
  directorMovies: TmdbPersonMovieCredit[]
  discoveredPage1?: TmdbListMovie[]
  discoveredPage2?: TmdbListMovie[]
  discoveredMovies?: TmdbListMovie[]
  semanticMovieIds?: number[]
}

export function buildRecommendationCandidatePool(
  baseMovieId: number,
  lists: RecommendationSourceLists,
): CandidateMovie[] {
  return selectRecommendationCandidates(
    uniqueCandidates(
      [
        ...lists.similarPage1.map((movie, index) => toCandidate(movie, 'similar', index + 1)),
        ...lists.similarPage2.map((movie, index) => toCandidate(movie, 'similar', index + 21)),
        ...lists.recommendedPage1.map((movie, index) => toCandidate(movie, 'recommended', index + 1)),
        ...lists.recommendedPage2.map((movie, index) => toCandidate(movie, 'recommended', index + 21)),
        ...lists.directorMovies.map((movie, index) => toCandidate(movie, 'director', index + 1)),
        ...(lists.discoveredPage1 ?? []).map((movie, index) => toCandidate(movie, 'discovery', index + 1)),
        ...(lists.discoveredPage2 ?? []).map((movie, index) => toCandidate(movie, 'discovery', index + 21)),
        // Targeted discovery lists are concatenated in 20-item pages. Preserve
        // each query's local rank so later queries are not unfairly discarded.
        ...(lists.discoveredMovies ?? []).map((movie, index) => toCandidate(movie, 'discovery', (index % 20) + 1)),
        ...(lists.semanticMovieIds ?? []).map((id, index) => toCandidate({ id, title: '' }, 'semantic', index + 1)),
      ],
      baseMovieId,
    ),
  )
}

export function toRankingCandidate(
  detail: TmdbMovieDetails,
  candidate: CandidateMovie,
): RankingCandidate {
  const mapped = mapMovieDetails(detail)
  const features = extractScoreFeatures(detail)
  return {
    id: mapped.id,
    title: mapped.title,
    poster_path: mapped.poster_path,
    release_date: mapped.release_date,
    vote_average: mapped.vote_average,
    director_id: features.directorId,
    features,
    source: candidate.source,
  }
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer')
  }

  const results: Array<PromiseSettledResult<R>> = new Array(values.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = { status: 'fulfilled', value: await mapper(values[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

export async function getHealth(): Promise<{ status: string; service: string }> {
  await tmdbJson('/configuration')
  return {
    status: 'ok',
    service: 'themeflick-sites-worker',
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
  const [basePayload, similarPage1, similarPage2, recommendedPage1, recommendedPage2] = await Promise.all([
    tmdbJson<TmdbMovieDetails>(`/movie/${movieId}`, {
      append_to_response: 'credits,keywords',
      language: 'en-US',
    }),
    tmdbJson<TmdbListResponse>(`/movie/${movieId}/similar`, {
      language: 'en-US',
      page: '1',
    }),
    tmdbJson<TmdbListResponse>(`/movie/${movieId}/similar`, {
      language: 'en-US',
      page: '2',
    }).catch(() => ({ results: [] })),
    tmdbJson<TmdbListResponse>(`/movie/${movieId}/recommendations`, {
      language: 'en-US',
      page: '1',
    }),
    tmdbJson<TmdbListResponse>(`/movie/${movieId}/recommendations`, {
      language: 'en-US',
      page: '2',
    }).catch(() => ({ results: [] })),
  ])

  const directorId = basePayload.credits?.crew?.find((member) => member.job === 'Director')?.id
  const discoveryKeywordIds = extractKeywordIds(basePayload).slice(0, 8)
  const discoveryParams = {
    language: 'en-US',
    include_adult: 'false',
    sort_by: 'popularity.desc',
    'vote_count.gte': '20',
    with_keywords: discoveryKeywordIds.join('|'),
  }

  const discoveryResponses = discoveryKeywordIds.length > 0
    ? await Promise.all([
        tmdbJson<TmdbListResponse>('/discover/movie', { ...discoveryParams, page: '1' }).catch(() => ({ results: [] })),
        tmdbJson<TmdbListResponse>('/discover/movie', { ...discoveryParams, page: '2' }).catch(() => ({ results: [] })),
        ...discoveryKeywordIds.slice(0, 6).map((keywordId) =>
          tmdbJson<TmdbListResponse>('/discover/movie', {
            language: 'en-US',
            include_adult: 'false',
            sort_by: 'vote_average.desc',
            'vote_count.gte': '40',
            with_keywords: String(keywordId),
            page: '1',
          }).catch(() => ({ results: [] })),
        ),
      ])
    : [{ results: [] }, { results: [] }]
  const [discoveredPage1, discoveredPage2, ...targetedDiscovery] = discoveryResponses
  const tagSignatures = await loadTagSignatures()
  const semanticMovieIds = tagSignatures ? findTagGenomeNeighbors(tagSignatures, movieId, 60) : []

  let directorMovies: TmdbPersonMovieCredit[] = []
  if (directorId) {
    try {
      const credits = await tmdbJson<TmdbPersonMovieCredits>(`/person/${directorId}/movie_credits`, {
        language: 'en-US',
      })
      directorMovies = (credits.crew ?? [])
        .filter((movie) => movie.job === 'Director' && (movie.vote_count ?? 0) >= 20)
        .sort((left, right) => {
          if ((right.vote_count ?? 0) !== (left.vote_count ?? 0)) {
            return (right.vote_count ?? 0) - (left.vote_count ?? 0)
          }
          return (right.vote_average ?? 0) - (left.vote_average ?? 0)
        })
        .slice(0, 10)
    } catch (error) {
      console.warn('Director filmography fetch failed', error)
    }
  }

  const candidatesForDetails = buildRecommendationCandidatePool(movieId, {
    similarPage1: similarPage1.results ?? [],
    similarPage2: similarPage2.results ?? [],
    recommendedPage1: recommendedPage1.results ?? [],
    recommendedPage2: recommendedPage2.results ?? [],
    directorMovies,
    discoveredPage1: discoveredPage1.results ?? [],
    discoveredPage2: discoveredPage2.results ?? [],
    discoveredMovies: targetedDiscovery.flatMap((response) => response.results ?? []),
    semanticMovieIds,
  })
  const detailedCandidates = await mapWithConcurrency(
    candidatesForDetails,
    DETAIL_FETCH_CONCURRENCY,
    (movie) =>
      tmdbJson<TmdbMovieDetails>(`/movie/${movie.id}`, {
        append_to_response: 'credits,keywords',
        language: 'en-US',
      }),
  )

  const baseScoreFeatures = extractScoreFeatures(basePayload)
  const rankingCandidates: RankingCandidate[] = []

  for (const [index, result] of detailedCandidates.entries()) {
    if (result.status !== 'fulfilled') {
      continue
    }

    const candidateMeta = candidatesForDetails[index]
    if (!candidateMeta) {
      continue
    }

    rankingCandidates.push(toRankingCandidate(result.value, candidateMeta))
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
