import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'

import { getHealth } from './api'
import { FavoritesPage } from './pages/FavoritesPage'
import { HomePage } from './pages/HomePage'
import { MovieDetailsPage } from './pages/MovieDetailsPage'
import './App.css'

function App() {
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking')

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <p className="eyebrow">Themeflick</p>
          <p className="tagline">Movie recommendation lab</p>
        </div>

        <nav className="nav-links">
          <NavLink to="/" end>
            Discover
          </NavLink>
          <NavLink to="/favorites">Favorites</NavLink>
        </nav>

        <p className={`service-pill service-${serviceStatus}`}>
          TMDB {serviceStatus === 'checking' ? 'checking' : serviceStatus}
        </p>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/movies/:id" element={<MovieDetailsPage />} />
      </Routes>
    </div>
  )
}

export default App
