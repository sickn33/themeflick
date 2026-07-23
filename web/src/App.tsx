import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'

import { getHealth } from './api'
import {
  deleteCloudData,
  getAccount,
  getCloudFavorites,
  importCloudFavorites,
  replaceCloudFavorites,
  signInPath,
  type Account,
  type SyncState,
} from './lib/account'
import {
  activateAccountFavorites,
  activateDeviceFavorites,
  clearDeviceFavorites,
  readDeviceFavorites,
  readFavorites,
  saveFavorites,
  subscribeToFavorites,
} from './lib/favorites'
import { AccountPage } from './pages/AccountPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { HomePage } from './pages/HomePage'
import { MovieDetailsPage } from './pages/MovieDetailsPage'
import './App.css'

function App() {
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [favoriteCount, setFavoriteCount] = useState(() => readFavorites().length)
  const [account, setAccount] = useState<Account>({ authenticated: false, displayName: null, email: null })
  const [syncState, setSyncState] = useState<SyncState>('checking')
  const [cloudReady, setCloudReady] = useState(false)
  const [deviceFavoriteCount, setDeviceFavoriteCount] = useState(() => readDeviceFavorites().length)

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
    let cancelled = false

    async function loadAccount() {
      try {
        const currentAccount = await getAccount()
        if (cancelled) return
        setAccount(currentAccount)
        if (!currentAccount.authenticated || !currentAccount.email) {
          activateDeviceFavorites()
          setSyncState('local')
          return
        }

        activateAccountFavorites(currentAccount.email)
        setSyncState('syncing')
        const cloudFavorites = await getCloudFavorites()
        if (cancelled) return
        activateAccountFavorites(currentAccount.email, cloudFavorites)
        setDeviceFavoriteCount(readDeviceFavorites().length)
        setCloudReady(true)
        setSyncState('synced')
      } catch {
        if (!cancelled) setSyncState('error')
      }
    }

    void loadAccount()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeToFavorites(() => {
      setFavoriteCount(readFavorites().length)
    })
  }, [])

  useEffect(() => {
    if (!cloudReady || !account.authenticated) return
    let timer: number | undefined
    let cancelled = false
    const unsubscribe = subscribeToFavorites(() => {
      window.clearTimeout(timer)
      setSyncState('syncing')
      timer = window.setTimeout(async () => {
        try {
          await replaceCloudFavorites(readFavorites())
          if (!cancelled) setSyncState('synced')
        } catch {
          if (!cancelled) setSyncState('error')
        }
      }, 250)
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [account.authenticated, cloudReady])

  async function importDeviceFavorites() {
    const deviceFavorites = readDeviceFavorites()
    if (deviceFavorites.length === 0 || !account.email) return
    setSyncState('syncing')
    try {
      const favorites = await importCloudFavorites(deviceFavorites)
      activateAccountFavorites(account.email, favorites)
      clearDeviceFavorites()
      setDeviceFavoriteCount(0)
      setSyncState('synced')
    } catch (error) {
      setSyncState('error')
      throw error
    }
  }

  async function deleteAccountData() {
    try {
      await deleteCloudData()
      saveFavorites([])
      setSyncState('synced')
    } catch (error) {
      setSyncState('error')
      throw error
    }
  }

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
          <NavLink to="/account">Account</NavLink>
        </nav>

        <div className="topbar-status">
          <p className={`service-pill service-${serviceStatus}`} role="status" aria-live="polite">
            TMDB {serviceStatus === 'checking' ? 'Syncing' : serviceStatus}
          </p>
          {account.authenticated ? (
            <Link className="account-link" to="/account">
              {account.displayName}
            </Link>
          ) : (
            <a className="account-link" href={signInPath(`${window.location.pathname}${window.location.search}`)}>
              Sign in to sync
            </a>
          )}
        </div>
      </header>

      <div className="route-shell">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route
            path="/account"
            element={
              <AccountPage
                account={account}
                syncState={syncState}
                deviceFavoriteCount={deviceFavoriteCount}
                onDeleteData={deleteAccountData}
                onImportDeviceFavorites={importDeviceFavorites}
              />
            }
          />
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
