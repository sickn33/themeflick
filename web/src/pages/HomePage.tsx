import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { getMovieRecommendations, searchMovies } from '../api'
import { Loader } from '../components/Loader'
import { MovieCard } from '../components/MovieCard'
import { MovieSearchResults } from '../components/MovieSearchResults'
import { isFavorite, toggleFavorite } from '../lib/favorites'
import type { FavoriteMovie, RecommendationMovie, SearchMovie } from '../types'

type RecommendationState = {
  baseMovieTitle: string
  items: RecommendationMovie[]
}

const HOME_SEARCH_STATE_KEY = 'themeflick.home.search-state-v1'

type PersistedHomeState = {
  query: string
  selectedMovie: SearchMovie | null
  searchResults: SearchMovie[]
  recommendations: RecommendationState | null
  error: string | null
}

function isSearchMovie(value: unknown): value is SearchMovie {
  if (!value || typeof value !== 'object') {
    return false
  }

  const movie = value as Record<string, unknown>
  return (
    typeof movie.id === 'number' &&
    Number.isFinite(movie.id) &&
    typeof movie.title === 'string' &&
    movie.title.length > 0 &&
    movie.title.length <= 160 &&
    (typeof movie.release_date === 'string' || movie.release_date === null) &&
    (typeof movie.poster_path === 'string' || movie.poster_path === null) &&
    typeof movie.vote_average === 'number' &&
    Number.isFinite(movie.vote_average)
  )
}

function isRecommendationMovie(value: unknown): value is RecommendationMovie {
  const movie = value as Record<string, unknown>
  return (
    isSearchMovie(value) &&
    typeof movie.similarity_score === 'number' &&
    Number.isFinite(movie.similarity_score) &&
    typeof movie.match_reason === 'string'
  )
}

function normalizeRecommendations(value: unknown): RecommendationState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const state = value as Record<string, unknown>
  if (typeof state.baseMovieTitle !== 'string' || !Array.isArray(state.items)) {
    return null
  }

  return {
    baseMovieTitle: state.baseMovieTitle.slice(0, 160),
    items: state.items.filter(isRecommendationMovie).slice(0, 12),
  }
}

function toFavorite(movie: SearchMovie | RecommendationMovie): FavoriteMovie {
  return {
    id: movie.id,
    title: movie.title,
    poster_path: movie.poster_path,
    release_date: movie.release_date,
    vote_average: movie.vote_average,
  }
}

function getRequestErrorMessage(error: unknown, request: 'search' | 'recommendations'): string {
  if (error instanceof Error && /missing|api key|token|credential/i.test(error.message)) {
    return 'Movie data is not configured for this build yet.'
  }

  return request === 'search'
    ? 'Could not search movie data right now. Try again in a moment.'
    : 'Could not load recommendations right now. Try another title or try again in a moment.'
}

function readPersistedHomeState(): PersistedHomeState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(HOME_SEARCH_STATE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as PersistedHomeState
    if (typeof parsed.query !== 'string') {
      return null
    }

    return {
      query: parsed.query.slice(0, 160),
      selectedMovie: isSearchMovie(parsed.selectedMovie) ? parsed.selectedMovie : null,
      searchResults: Array.isArray(parsed.searchResults) ? parsed.searchResults.filter(isSearchMovie).slice(0, 8) : [],
      recommendations: normalizeRecommendations(parsed.recommendations),
      error: typeof parsed.error === 'string' ? parsed.error.slice(0, 240) : null,
    }
  } catch {
    return null
  }
}

export function HomePage() {
  const persistedState = useMemo(() => readPersistedHomeState(), [])

  const [query, setQuery] = useState(persistedState?.query ?? '')
  const [selectedMovie, setSelectedMovie] = useState<SearchMovie | null>(persistedState?.selectedMovie ?? null)
  const [searchResults, setSearchResults] = useState<SearchMovie[]>(persistedState?.searchResults ?? [])
  const [recommendations, setRecommendations] = useState<RecommendationState | null>(
    persistedState?.recommendations ?? null
  )
  const [searching, setSearching] = useState(false)
  const [loadingRecommendations, setLoadingRecommendations] = useState(false)
  const [pendingMovieId, setPendingMovieId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(persistedState?.error ?? null)
  const [status, setStatus] = useState('')
  const [favoritesVersion, setFavoritesVersion] = useState(0)
  const requestIdRef = useRef(0)
  const searchResultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const recommendationsHeadingRef = useRef<HTMLHeadingElement>(null)
  const focusTargetRef = useRef<'search-results' | 'recommendations' | null>(null)

  useEffect(() => {
    return () => {
      requestIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    const target = focusTargetRef.current
    const element = target === 'search-results' ? searchResultsHeadingRef.current : recommendationsHeadingRef.current
    if (!target || !element) {
      return
    }

    focusTargetRef.current = null
    element.focus({ preventScroll: true })
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }, [recommendations, searchResults])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const shouldClear =
      query.trim() === '' &&
      selectedMovie === null &&
      searchResults.length === 0 &&
      recommendations === null &&
      error === null

    if (shouldClear) {
      window.sessionStorage.removeItem(HOME_SEARCH_STATE_KEY)
      return
    }

    const payload: PersistedHomeState = {
      query,
      selectedMovie,
      searchResults,
      recommendations,
      error,
    }
    try {
      window.sessionStorage.setItem(HOME_SEARCH_STATE_KEY, JSON.stringify(payload))
    } catch {
      try {
        window.sessionStorage.removeItem(HOME_SEARCH_STATE_KEY)
      } catch {
        // Ignore unavailable session storage.
      }
    }
  }, [error, query, recommendations, searchResults, selectedMovie])

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      setError('Type a movie title to start.')
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setSearching(true)
    setLoadingRecommendations(false)
    setPendingMovieId(null)
    setError(null)
    setStatus(`Searching for ${trimmed}.`)

    try {
      const results = await searchMovies(trimmed)
      if (requestId !== requestIdRef.current) {
        return
      }
      if (results.length === 0) {
        setSearchResults([])
        setError('No movies found for this title.')
        setStatus(`No movies found for ${trimmed}.`)
        return
      }

      const visibleResults = results.slice(0, 8)
      setSearchResults(visibleResults)
      setStatus(`${visibleResults.length} movie matches found. Choose the film you meant.`)
      focusTargetRef.current = 'search-results'
    } catch (requestError) {
      if (requestId !== requestIdRef.current) {
        return
      }
      setError(getRequestErrorMessage(requestError, 'search'))
      setStatus('The movie search failed. Previous results are still available.')
    } finally {
      if (requestId === requestIdRef.current) {
        setSearching(false)
      }
    }
  }

  async function handleSelectMovie(movie: SearchMovie) {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoadingRecommendations(true)
    setPendingMovieId(movie.id)
    setError(null)
    setStatus(`Loading recommendations for ${movie.title}.`)

    try {
      const payload = await getMovieRecommendations(movie.id)
      if (requestId !== requestIdRef.current) {
        return
      }

      setSelectedMovie(movie)
      setRecommendations({
        baseMovieTitle: payload.base_movie.title,
        items: payload.results,
      })
      setSearchResults([])

      if (payload.results.length === 0) {
        setError('No similar movies found for this title yet. Try a different movie.')
        setStatus(`No recommendations are available for ${movie.title}.`)
      } else {
        setStatus(`${payload.results.length} recommendations loaded for ${movie.title}.`)
        focusTargetRef.current = 'recommendations'
      }
    } catch (requestError) {
      if (requestId !== requestIdRef.current) {
        return
      }
      setError(getRequestErrorMessage(requestError, 'recommendations'))
      setStatus(`Recommendations for ${movie.title} failed to load. Previous recommendations are still available.`)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingRecommendations(false)
        setPendingMovieId(null)
      }
    }
  }

  function handleToggleFavorite(movie: FavoriteMovie) {
    toggleFavorite(movie)
    setFavoritesVersion((version) => version + 1)
  }

  const healthHint = useMemo(() => {
    if (searching) {
      return 'Searching live movie data...'
    }
    if (loadingRecommendations) {
      return 'Building your recommendation set...'
    }
    return 'Private by default: your TMDB credential stays on the server'
  }, [loadingRecommendations, searching])

  const hasUsefulResults = recommendations !== null && recommendations.items.length > 0

  return (
    <main>
      <section className={`hero${hasUsefulResults ? ' hero-compact' : ''}`}>
        <div className="hero-content">
          <h1>
            {hasUsefulResults ? 'Find another film to follow.' : 'Find the next film that feels right.'}
          </h1>
          {!hasUsefulResults && (
            <p className="hero-copy">
              Tell us a movie you love. We’ll surface films with a similar story, tone, and feeling—then explain why
              each one belongs on your watchlist.
            </p>
          )}

          <form className="search-form" onSubmit={handleSearch}>
            <label htmlFor="movie-search">Movie title</label>
            <div className="search-control">
              <input
                id="movie-search"
                type="text"
                value={query}
                onChange={(event) => {
                  requestIdRef.current += 1
                  setQuery(event.target.value)
                  setSearching(false)
                  setLoadingRecommendations(false)
                  setPendingMovieId(null)
                  if (error) setError(null)
                }}
                placeholder="Try Inception, The Matrix, Parasite"
                autoComplete="off"
                aria-describedby="search-hint"
              />
              <button type="submit" className="button button-primary" disabled={searching}>
                {searching ? 'Searching...' : 'Find similar films'}
              </button>
            </div>
          </form>

          <p className="status-hint" id="search-hint">{healthHint}</p>
          <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {status}
          </p>
        </div>

      </section>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      {(searching || loadingRecommendations) && (
        <Loader label={searching ? 'Finding matching titles…' : 'Building recommendations…'} />
      )}

      {searchResults.length > 0 && (
        <section className="section-block search-results" aria-labelledby="search-results-heading">
          <div className="section-heading">
            <h2 id="search-results-heading" ref={searchResultsHeadingRef} tabIndex={-1}>
              Which film did you mean?
            </h2>
            <p>Confirm the title and year before Themeflick builds recommendations.</p>
          </div>
          <MovieSearchResults movies={searchResults} pendingMovieId={pendingMovieId} onSelect={handleSelectMovie} />
        </section>
      )}

      {selectedMovie && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Your reference film</h2>
            <p>This is the title Themeflick used to shape the recommendation set.</p>
          </div>
          <div className="movie-grid">
            <MovieCard
              id={selectedMovie.id}
              title={selectedMovie.title}
              posterPath={selectedMovie.poster_path}
              releaseDate={selectedMovie.release_date}
              rating={selectedMovie.vote_average}
              recommendationLabel="Base movie used for recommendations"
              isFavorite={isFavorite(selectedMovie.id)}
              onToggleFavorite={() => handleToggleFavorite(toFavorite(selectedMovie))}
            />
          </div>
        </section>
      )}
      {recommendations && recommendations.items.length > 0 && (
        <section className="section-block">
          <div className="section-heading">
            <h2 ref={recommendationsHeadingRef} tabIndex={-1}>
              Because you liked {recommendations.baseMovieTitle}
            </h2>
            <p>Ranked by affinity score, then diversified so the list does not collapse into one narrow lane.</p>
          </div>
          <div className="movie-grid">
            {recommendations.items.map((movie) => (
              <MovieCard
                key={movie.id}
                id={movie.id}
                title={movie.title}
                posterPath={movie.poster_path}
                releaseDate={movie.release_date}
                rating={movie.vote_average}
                similarityScore={movie.similarity_score}
                recommendationLabel={movie.match_reason}
                isFavorite={isFavorite(movie.id)}
                onToggleFavorite={() => handleToggleFavorite(toFavorite(movie))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Re-render trigger for favorite state */}
      <span className="visually-hidden" aria-hidden>
        {favoritesVersion}
      </span>
    </main>
  )
}
