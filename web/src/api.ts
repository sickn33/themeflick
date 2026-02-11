import type { MovieDetails, RecommendationResponse, SearchMovie } from './types'

type ApiErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function buildUrl(path: string): string {
  if (!API_BASE) {
    return path
  }
  return `${API_BASE}${path}`
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(buildUrl(path))

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = (await response.json()) as ApiErrorEnvelope
      if (payload.error?.message) {
        message = payload.error.message
      }
    } catch {
      // Keep fallback error message.
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

export async function searchMovies(query: string): Promise<SearchMovie[]> {
  const encoded = encodeURIComponent(query)
  const payload = await fetchJson<{ results: SearchMovie[] }>(`/api/movies/search?query=${encoded}`)
  return payload.results
}

export async function getMovieDetails(movieId: number): Promise<MovieDetails> {
  return fetchJson<MovieDetails>(`/api/movies/${movieId}`)
}

export async function getMovieRecommendations(movieId: number): Promise<RecommendationResponse> {
  return fetchJson<RecommendationResponse>(`/api/movies/${movieId}/recommendations`)
}

export async function getHealth(): Promise<{ status: string; service: string }> {
  return fetchJson<{ status: string; service: string }>('/api/health')
}
