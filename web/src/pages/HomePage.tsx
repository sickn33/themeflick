import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { getMovieRecommendations, searchMovies } from '../api'
import { Loader } from '../components/Loader'
import { MovieCard } from '../components/MovieCard'
import { isFavorite, toggleFavorite } from '../lib/favorites'
import type { FavoriteMovie, RecommendationMovie, SearchMovie } from '../types'

type RecommendationState = {
  baseMovieTitle: string
  items: RecommendationMovie[]
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

export function HomePage() {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchMovie[]>([])
  const [recommendations, setRecommendations] = useState<RecommendationState | null>(null)
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loadingRecommendationsFor, setLoadingRecommendationsFor] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [favoritesVersion, setFavoritesVersion] = useState(0)

  const hasSearchResults = searchResults.length > 0

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      return
    }

    setLoadingSearch(true)
    setError(null)
    setRecommendations(null)

    try {
      const results = await searchMovies(trimmed)
      setSearchResults(results)
      if (results.length === 0) {
        setError('No movies found for this title.')
      }
    } catch (searchError) {
      setSearchResults([])
      setError(searchError instanceof Error ? searchError.message : 'Search failed')
    } finally {
      setLoadingSearch(false)
    }
  }

  async function handleLoadRecommendations(movie: SearchMovie) {
    setLoadingRecommendationsFor(movie.id)
    setError(null)
    try {
      const payload = await getMovieRecommendations(movie.id)
      setRecommendations({
        baseMovieTitle: payload.base_movie.title,
        items: payload.results,
      })
    } catch (recommendationError) {
      setRecommendations(null)
      setError(recommendationError instanceof Error ? recommendationError.message : 'Could not load recommendations')
    } finally {
      setLoadingRecommendationsFor(null)
    }
  }

  function handleToggleFavorite(movie: FavoriteMovie) {
    toggleFavorite(movie)
    setFavoritesVersion((version) => version + 1)
  }

  const healthHint = useMemo(() => {
    if (loadingSearch || loadingRecommendationsFor) {
      return 'Searching live movie data…'
    }
    return 'Powered by TMDB direct mode + client-side scoring'
  }, [loadingSearch, loadingRecommendationsFor])

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Themeflick</p>
        <h1>Find what to watch next, based on one movie you already love.</h1>
        <p className="hero-copy">
          Search any title, then let the client-side recommendation engine rank related picks by genre, cast, director,
          and rating affinity.
        </p>

        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try: Inception, The Matrix, Parasite..."
            aria-label="Movie title"
          />
          <button type="submit" className="button button-primary" disabled={loadingSearch}>
            {loadingSearch ? 'Searching…' : 'Search'}
          </button>
        </form>

        <p className="status-hint">{healthHint}</p>
      </section>

      {error && <p className="error-banner">{error}</p>}

      {loadingSearch && <Loader label="Searching movies…" />}

      {hasSearchResults && !loadingSearch && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Search Results</h2>
            <p>Select one result to generate recommendations.</p>
          </div>
          <div className="movie-grid">
            {searchResults.map((movie) => (
              <div key={movie.id} className="stacked-actions">
                <MovieCard
                  id={movie.id}
                  title={movie.title}
                  posterPath={movie.poster_path}
                  releaseDate={movie.release_date}
                  rating={movie.vote_average}
                  isFavorite={isFavorite(movie.id)}
                  onToggleFavorite={() => handleToggleFavorite(toFavorite(movie))}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => handleLoadRecommendations(movie)}
                  disabled={loadingRecommendationsFor === movie.id}
                >
                  {loadingRecommendationsFor === movie.id ? 'Scoring…' : 'Get Recommendations'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loadingRecommendationsFor !== null && <Loader label="Building recommendation graph…" />}

      {recommendations && recommendations.items.length > 0 && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Because you liked {recommendations.baseMovieTitle}</h2>
            <p>Ordered by client-side similarity score.</p>
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
                recommendationLabel="High match on style and structure"
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
