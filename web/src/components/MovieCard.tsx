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

function getPosterUrl(path: string | null): string {
  if (!path) {
    return 'https://placehold.co/600x900/15212e/f4f4ef?text=No+Poster'
  }
  return `https://image.tmdb.org/t/p/w500${path}`
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
  return (
    <article className="movie-card">
      <div className="movie-card-poster-wrap">
        <img className="movie-card-poster" src={getPosterUrl(posterPath)} alt={`${title} poster`} loading="lazy" />
        {typeof similarityScore === 'number' && (
          <span className="match-badge">{Math.round(similarityScore)}% match</span>
        )}
      </div>

      <div className="movie-card-content">
        <h3>{title}</h3>
        <p className="movie-meta">
          <span>{getYear(releaseDate)}</span>
          <span>•</span>
          <span>{rating.toFixed(1)}</span>
        </p>

        {recommendationLabel && <p className="movie-reason">{recommendationLabel}</p>}

        <div className="movie-card-actions">
          <Link to={`/movies/${id}`} className="button button-ghost">
            Details
          </Link>
          <button
            className={`button ${isFavorite ? 'button-favorite' : 'button-primary'}`}
            type="button"
            onClick={onToggleFavorite}
          >
            {isFavorite ? 'Unsave' : 'Save'}
          </button>
        </div>
      </div>
    </article>
  )
}
