import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { getMovieDetails, getMovieRecommendations } from '../api'
import { Loader } from '../components/Loader'
import { MovieCard } from '../components/MovieCard'
import { isFavorite, toggleFavorite } from '../lib/favorites'
import type { FavoriteMovie, MovieDetails, RecommendationMovie } from '../types'

function toFavorite(movie: MovieDetails | RecommendationMovie): FavoriteMovie {
  return {
    id: movie.id,
    title: movie.title,
    poster_path: movie.poster_path,
    release_date: movie.release_date,
    vote_average: movie.vote_average,
  }
}

export function MovieDetailsPage() {
  const params = useParams<{ id: string }>()
  const movieId = Number(params.id)

  const [movie, setMovie] = useState<MovieDetails | null>(null)
  const [recommendations, setRecommendations] = useState<RecommendationMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [favoritesVersion, setFavoritesVersion] = useState(0)

  useEffect(() => {
    if (!Number.isFinite(movieId) || movieId <= 0) {
      setError('Invalid movie id')
      setLoading(false)
      return
    }

    let cancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const [details, recommended] = await Promise.all([
          getMovieDetails(movieId),
          getMovieRecommendations(movieId),
        ])

        if (!cancelled) {
          setMovie(details)
          setRecommendations(recommended.results)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load movie')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [movieId])

  function refreshFavorites() {
    setFavoritesVersion((version) => version + 1)
  }

  if (loading) {
    return <Loader label="Loading movie details…" />
  }

  if (error || !movie) {
    return (
      <main className="section-block">
        <p className="error-banner">{error ?? 'Movie not found'}</p>
        <Link to="/" className="button button-ghost">
          Back Home
        </Link>
      </main>
    )
  }

  return (
    <main>
      <section className="details-hero">
        <div className="details-backdrop" aria-hidden>
          {movie.backdrop_path && (
            <img src={`https://image.tmdb.org/t/p/original${movie.backdrop_path}`} alt="" />
          )}
        </div>

        <div className="details-content">
          <Link to="/" className="button button-ghost compact">
            ← Back
          </Link>

          <h1>{movie.title}</h1>
          <p className="movie-meta">
            <span>{movie.release_date ? movie.release_date.slice(0, 4) : 'N/A'}</span>
            <span>•</span>
            <span>{movie.vote_average.toFixed(1)}</span>
            <span>•</span>
            <span>{movie.runtime ? `${movie.runtime} min` : 'Runtime N/A'}</span>
          </p>
          <p className="hero-copy">{movie.overview || 'No overview available for this movie.'}</p>

          <div className="chip-row">
            {movie.genres.map((genre) => (
              <span key={genre.id} className="chip">
                {genre.name}
              </span>
            ))}
          </div>

          <p className="movie-meta">
            <strong>Director:</strong> {movie.director || 'Unknown'}
          </p>

          <button
            type="button"
            className={`button ${isFavorite(movie.id) ? 'button-favorite' : 'button-primary'}`}
            onClick={() => {
              toggleFavorite(toFavorite(movie))
              refreshFavorites()
            }}
          >
            {isFavorite(movie.id) ? 'Unsave from favorites' : 'Save to favorites'}
          </button>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Top Cast</h2>
        </div>
        <div className="cast-grid">
          {movie.cast.slice(0, 8).map((member) => (
            <article key={member.id} className="cast-card">
              <h3>{member.name}</h3>
              <p>{member.character || 'Unknown role'}</p>
            </article>
          ))}
        </div>
      </section>

      {recommendations.length > 0 && (
        <section className="section-block">
          <div className="section-heading">
            <h2>More Like This</h2>
          </div>
          <div className="movie-grid">
            {recommendations.map((recommendation) => (
              <MovieCard
                key={recommendation.id}
                id={recommendation.id}
                title={recommendation.title}
                posterPath={recommendation.poster_path}
                releaseDate={recommendation.release_date}
                rating={recommendation.vote_average}
                similarityScore={recommendation.similarity_score}
                isFavorite={isFavorite(recommendation.id)}
                onToggleFavorite={() => {
                  toggleFavorite(toFavorite(recommendation))
                  refreshFavorites()
                }}
              />
            ))}
          </div>
        </section>
      )}

      <span className="visually-hidden" aria-hidden>
        {favoritesVersion}
      </span>
    </main>
  )
}
