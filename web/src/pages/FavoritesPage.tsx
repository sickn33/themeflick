import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { MovieCard } from '../components/MovieCard'
import { readFavorites, toggleFavorite } from '../lib/favorites'
import type { FavoriteMovie } from '../types'

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteMovie[]>(() => readFavorites())

  useEffect(() => {
    const listener = () => {
      setFavorites(readFavorites())
    }

    window.addEventListener('storage', listener)
    return () => {
      window.removeEventListener('storage', listener)
    }
  }, [])

  function removeFavorite(movie: FavoriteMovie) {
    toggleFavorite(movie)
    setFavorites(readFavorites())
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
    </main>
  )
}
