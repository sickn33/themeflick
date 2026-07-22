import type { SearchMovie } from '../types'

type MovieSearchResultsProps = {
  movies: SearchMovie[]
  pendingMovieId: number | null
  onSelect: (movie: SearchMovie) => void
}

function getYear(releaseDate: string | null): string {
  return releaseDate?.slice(0, 4) || 'Year unknown'
}

export function MovieSearchResults({ movies, pendingMovieId, onSelect }: MovieSearchResultsProps) {
  return (
    <div className="movie-grid search-results-grid" role="list">
      {movies.map((movie) => {
        const isPending = pendingMovieId === movie.id

        return (
          <article className="movie-card search-result-card" role="listitem" key={movie.id}>
            <div className="movie-card-poster-wrap">
              {movie.poster_path ? (
                <img
                  className="movie-card-poster search-result-poster"
                  src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="search-result-poster-placeholder" aria-hidden="true">
                  No poster
                </div>
              )}
            </div>
            <div className="movie-card-content search-result-copy">
              <h3>{movie.title}</h3>
              <p>{getYear(movie.release_date)}</p>
              <button
                className="button button-primary compact"
                type="button"
                onClick={() => onSelect(movie)}
                disabled={pendingMovieId !== null}
                aria-label={`Use ${movie.title} (${getYear(movie.release_date)}) for recommendations`}
              >
                {isPending ? 'Loading…' : 'Use this film'}
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
