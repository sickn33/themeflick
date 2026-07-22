import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

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

function getDetailsErrorMessage(error: unknown): string {
  if (error instanceof Error && /missing|api key|token|credential/i.test(error.message)) {
    return 'Movie data is not configured for this build yet.'
  }

  return 'Could not load this movie right now.'
}

export function MovieDetailsPage() {
  const params = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const movieId = Number(params.id)

  const [movie, setMovie] = useState<MovieDetails | null>(null)
  const [recommendations, setRecommendations] = useState<RecommendationMovie[]>([])
  const [detailsLoading, setDetailsLoading] = useState(true)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsAttempt, setDetailsAttempt] = useState(0)
  const [recommendationsLoading, setRecommendationsLoading] = useState(true)
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null)
  const [recommendationsAttempt, setRecommendationsAttempt] = useState(0)
  const [favoritesVersion, setFavoritesVersion] = useState(0)
  const [favoriteAnnouncement, setFavoriteAnnouncement] = useState('')

  useEffect(() => {
    if (!Number.isFinite(movieId) || movieId <= 0) {
      setMovie(null)
      setDetailsError('Invalid movie id')
      setDetailsLoading(false)
      return
    }

    let cancelled = false

    async function loadDetails() {
      setMovie(null)
      setDetailsLoading(true)
      setDetailsError(null)

      try {
        const details = await getMovieDetails(movieId)
        if (!cancelled) {
          setMovie(details)
        }
      } catch (loadError) {
        if (!cancelled) {
          setDetailsError(getDetailsErrorMessage(loadError))
        }
      } finally {
        if (!cancelled) {
          setDetailsLoading(false)
        }
      }
    }

    void loadDetails()
    return () => {
      cancelled = true
    }
  }, [detailsAttempt, movieId])

  useEffect(() => {
    if (!Number.isFinite(movieId) || movieId <= 0) {
      setRecommendations([])
      setRecommendationsError(null)
      setRecommendationsLoading(false)
      return
    }

    let cancelled = false

    async function loadRecommendations() {
      setRecommendations([])
      setRecommendationsLoading(true)
      setRecommendationsError(null)

      try {
        const recommended = await getMovieRecommendations(movieId)
        if (!cancelled) {
          setRecommendations(recommended.results)
        }
      } catch {
        if (!cancelled) {
          setRecommendationsError('Recommendations are unavailable right now.')
        }
      } finally {
        if (!cancelled) {
          setRecommendationsLoading(false)
        }
      }
    }

    void loadRecommendations()
    return () => {
      cancelled = true
    }
  }, [movieId, recommendationsAttempt])

  function refreshFavorites() {
    setFavoritesVersion((version) => version + 1)
  }

  function goBack() {
    if (location.key === 'default') {
      navigate('/')
      return
    }

    navigate(-1)
  }

  if (detailsLoading) {
    return <Loader label="Loading movie details…" />
  }

  if (detailsError || !movie) {
    return (
      <main className="section-block">
        <p className="error-banner" role="alert">{detailsError ?? 'Movie not found'}</p>
        {detailsError !== 'Invalid movie id' && (
          <button className="button button-primary" type="button" onClick={() => setDetailsAttempt((value) => value + 1)}>
            Retry
          </button>
        )}
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
            <img
              src={`https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`}
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true
              }}
            />
          )}
        </div>

        <div className="details-content">
          <button type="button" onClick={goBack} className="button button-ghost compact">
            Back
          </button>

          <h1>{movie.title}</h1>
          <p
            className="movie-meta"
            aria-label={`${movie.release_date ? movie.release_date.slice(0, 4) : 'Release year unavailable'}, TMDB rating ${movie.vote_average.toFixed(1)} out of 10, ${movie.runtime ? `${movie.runtime} minutes` : 'runtime unavailable'}`}
          >
            <span>{movie.release_date ? movie.release_date.slice(0, 4) : 'N/A'}</span>
            <span aria-hidden>|</span>
            <span>TMDB {movie.vote_average.toFixed(1)}</span>
            <span aria-hidden>|</span>
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
              const saved = toggleFavorite(toFavorite(movie))
              setFavoriteAnnouncement(saved ? `${movie.title} saved to favorites.` : `${movie.title} removed from favorites.`)
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
        {movie.cast.length > 0 ? (
          <div className="cast-grid">
            {movie.cast.slice(0, 8).map((member) => (
              <article key={member.id} className="cast-card">
                <h3>{member.name}</h3>
                <p>{member.character || 'Unknown role'}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>Cast details are not available for this title yet.</p>
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>More Like This</h2>
        </div>
        {recommendationsLoading ? (
          <Loader label="Loading recommendations…" />
        ) : recommendationsError ? (
          <div className="empty-state">
            <p role="alert">{recommendationsError}</p>
            <button
              className="button button-ghost"
              type="button"
              onClick={() => setRecommendationsAttempt((value) => value + 1)}
            >
              Retry recommendations
            </button>
          </div>
        ) : recommendations.length > 0 ? (
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
                recommendationLabel={recommendation.match_reason}
                isFavorite={isFavorite(recommendation.id)}
                onToggleFavorite={() => {
                  const saved = toggleFavorite(toFavorite(recommendation))
                  setFavoriteAnnouncement(
                    saved
                      ? `${recommendation.title} saved to favorites.`
                      : `${recommendation.title} removed from favorites.`,
                  )
                  refreshFavorites()
                }}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>
              No strong recommendation set is available for this title yet.
            </p>
          </div>
        )}
      </section>

      <span className="visually-hidden" aria-hidden>
        {favoritesVersion}
      </span>
      <p className="visually-hidden" role="status" aria-live="polite">
        {favoriteAnnouncement}
      </p>
    </main>
  )
}
