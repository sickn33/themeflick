import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'

import { getHealth } from './api'
import { readFavorites, subscribeToFavorites } from './lib/favorites'
import { FavoritesPage } from './pages/FavoritesPage'
import { HomePage } from './pages/HomePage'
import { MovieDetailsPage } from './pages/MovieDetailsPage'
import './App.css'

function App() {
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [favoriteCount, setFavoriteCount] = useState(() => readFavorites().length)

  useEffect(() => {
    let cancelled = false

    async function checkHealth() {
      try {
        await getHealth()
        if (!cancelled) {
          setServiceStatus('online')
        }
      } catch {
        if (!cancelled) {
          setServiceStatus('offline')
        }
      }
    }

    void checkHealth()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeToFavorites(() => {
      setFavoriteCount(readFavorites().length)
    })
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <p className="brand-mark">Recommendation studio</p>
          <p className="eyebrow">Themeflick</p>
          <p className="tagline">Taste-led movie discovery from one title</p>
        </div>

        <nav className="nav-links">
          <NavLink to="/" end>
            Discover
          </NavLink>
          <NavLink to="/favorites" aria-label={`Favorites, ${favoriteCount} saved`}>
            Favorites ({favoriteCount})
          </NavLink>
        </nav>

        <p className={`service-pill service-${serviceStatus}`} role="status" aria-live="polite">
          TMDB {serviceStatus === 'checking' ? 'Syncing' : serviceStatus}
        </p>
      </header>

      <div className="route-shell">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/movies/:id" element={<MovieDetailsPage />} />
          <Route
            path="*"
            element={
              <main className="section-block">
                <div className="empty-state">
                  <p>Page not found.</p>
                  <p className="empty-copy">This route does not exist. Go back to discovery and start with a movie title.</p>
                  <Link className="button button-primary" to="/">
                    Back to discover
                  </Link>
                </div>
              </main>
            }
          />
        </Routes>
      </div>
    </div>
  )
}

export default App
