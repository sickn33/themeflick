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

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function pickBestSearchMatch(query: string, results: SearchMovie[]): SearchMovie {
  const queryNormalized = normalizeTitle(query)

  const exact = results.find((movie) => normalizeTitle(movie.title) === queryNormalized)
  if (exact) {
    return exact
  }

  const startsWith = results.find((movie) => normalizeTitle(movie.title).startsWith(queryNormalized))
  if (startsWith) {
    return startsWith
  }

  return results[0]
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
  const [selectedMovie, setSelectedMovie] = useState<SearchMovie | null>(null)
  const [recommendations, setRecommendations] = useState<RecommendationState | null>(null)
  const [loadingRecommendations, setLoadingRecommendations] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [favoritesVersion, setFavoritesVersion] = useState(0)

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      return
    }

    setLoadingRecommendations(true)
    setError(null)
    setRecommendations(null)
    setSelectedMovie(null)

    try {
      const results = await searchMovies(trimmed)
      if (results.length === 0) {
        setError('No movies found for this title.')
        return
      }

      const bestMatch = pickBestSearchMatch(trimmed, results)
      setSelectedMovie(bestMatch)

      const payload = await getMovieRecommendations(bestMatch.id)
      setRecommendations({
        baseMovieTitle: payload.base_movie.title,
        items: payload.results,
      })
      if (payload.results.length === 0) {
        setError('No similar movies found for this title yet. Try a different movie.')
      }
    } catch (requestError) {
      setRecommendations(null)
      setError(requestError instanceof Error ? requestError.message : 'Could not load recommendations')
    } finally {
      setLoadingRecommendations(false)
    }
  }

  function handleToggleFavorite(movie: FavoriteMovie) {
    toggleFavorite(movie)
    setFavoritesVersion((version) => version + 1)
  }

  const healthHint = useMemo(() => {
    if (loadingRecommendations) {
      return 'Searching live movie data…'
    }
    return 'Powered by TMDB direct mode + client-side scoring'
  }, [loadingRecommendations])

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
          <button type="submit" className="button button-primary" disabled={loadingRecommendations}>
            {loadingRecommendations ? 'Finding similar…' : 'Search'}
          </button>
        </form>

        <p className="status-hint">{healthHint}</p>
      </section>

      {error && <p className="error-banner">{error}</p>}

      {loadingRecommendations && <Loader label="Finding title match and recommendations…" />}

      {selectedMovie && !loadingRecommendations && (
        <section className="section-block">
          <div className="section-heading">
            <h2>Selected Base Movie</h2>
            <p>Using this title as the reference for similarity scoring.</p>
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
