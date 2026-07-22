import { useState } from 'react'
import { Link } from 'react-router-dom'

type MovieCardProps = {
  id: number
  title: string
  posterPath: string | null
  releaseDate: string | null
  rating: number
  similarityScore?: number
  isFavorite: boolean
  onToggleFavorite: () => void
  recommendationLabel?: string
}

function getYear(date: string | null): string {
  if (!date) {
    return 'N/A'
  }
  return date.slice(0, 4)
}

export function MovieCard({
  id,
  title,
  posterPath,
  releaseDate,
  rating,
  similarityScore,
  isFavorite,
  onToggleFavorite,
  recommendationLabel,
}: MovieCardProps) {
  const [posterFailed, setPosterFailed] = useState(false)
  const hasPoster = Boolean(posterPath) && !posterFailed

  return (
    <article className="movie-card">
      <div className="movie-card-poster-wrap">
        {hasPoster ? (
          <img
            className="movie-card-poster"
            src={`https://image.tmdb.org/t/p/w500${posterPath}`}
            srcSet={`https://image.tmdb.org/t/p/w342${posterPath} 342w, https://image.tmdb.org/t/p/w500${posterPath} 500w`}
            sizes="(max-width: 640px) 40vw, (max-width: 1100px) 25vw, 210px"
            alt={`${title} poster`}
            loading="lazy"
            onError={() => setPosterFailed(true)}
          />
        ) : (
          <span className="poster-fallback" role="img" aria-label={`No poster available for ${title}`}>
            <span aria-hidden>TF</span>
            No poster available
          </span>
        )}
        {typeof similarityScore === 'number' && (
          <span className="match-badge">{Math.round(similarityScore)}% match</span>
        )}
      </div>

      <div className="movie-card-content">
        <h3>{title}</h3>
        <p className="movie-meta" aria-label={`${getYear(releaseDate)}, TMDB rating ${rating.toFixed(1)} out of 10`}>
          <span>{getYear(releaseDate)}</span>
          <span aria-hidden>|</span>
          <span>TMDB {rating.toFixed(1)}</span>
        </p>

        {recommendationLabel && <p className="movie-reason">{recommendationLabel}</p>}

        <div className="movie-card-actions">
          <Link to={`/movies/${id}`} className="button button-ghost" aria-label={`View details for ${title}`}>
            Details
          </Link>
          <button
            className={`button ${isFavorite ? 'button-favorite' : 'button-primary'}`}
            type="button"
            onClick={onToggleFavorite}
            aria-label={`${isFavorite ? 'Unsave' : 'Save'} ${title}`}
          >
            {isFavorite ? 'Unsave' : 'Save'}
          </button>
        </div>
      </div>
    </article>
  )
}
