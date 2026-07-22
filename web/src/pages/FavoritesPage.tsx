import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { MovieCard } from '../components/MovieCard'
import { readFavorites, subscribeToFavorites, toggleFavorite } from '../lib/favorites'
import type { FavoriteMovie } from '../types'

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteMovie[]>(() => readFavorites())
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    return subscribeToFavorites(() => {
      setFavorites(readFavorites())
    })
  }, [])

  function removeFavorite(movie: FavoriteMovie) {
    toggleFavorite(movie)
    setAnnouncement(`${movie.title} removed from favorites.`)
  }

  return (
    <main className="section-block">
      <div className="section-heading">
        <h1>Favorites</h1>
        <p>Your saved picks from Themeflick.</p>
      </div>

      {favorites.length === 0 ? (
        <div className="empty-state">
          <p>No favorites yet.</p>
          <p className="empty-copy">Save a recommendation or reference film to keep a short list for later.</p>
          <Link className="button button-primary" to="/">
            Start exploring
          </Link>
        </div>
      ) : (
        <div className="movie-grid">
          {favorites.map((movie) => (
            <MovieCard
              key={movie.id}
              id={movie.id}
              title={movie.title}
              posterPath={movie.poster_path}
              releaseDate={movie.release_date}
              rating={movie.vote_average}
              isFavorite
              onToggleFavorite={() => removeFavorite(movie)}
            />
          ))}
        </div>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </main>
  )
}
