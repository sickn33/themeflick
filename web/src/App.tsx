import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'

import { getHealth } from './api'
import {
  deleteCloudData,
  downloadCloudData,
  getAccount,
  getCloudFavorites,
  importCloudFavorites,
  signInPath,
  signOutPath,
  type Account,
  type SyncState,
} from './lib/account'
import {
  activateAccountFavorites,
  activateDeviceFavorites,
  clearDeviceFavorites,
  readDeviceFavorites,
  readFavorites,
  subscribeToFavorites,
} from './lib/favorites'
import { FavoriteSync } from './lib/favoriteSync'
import { AccountPage } from './pages/AccountPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { HomePage } from './pages/HomePage'
import { MovieDetailsPage } from './pages/MovieDetailsPage'
import { AboutPage, PrivacyPage, SupportPage, TermsPage } from './pages/LegalPages'
import { SiteFooter } from './components/SiteFooter'
import { RouteMetadata } from './components/RouteMetadata'
import './App.css'

function App() {
  const location = useLocation()
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [favoriteCount, setFavoriteCount] = useState(() => readFavorites().length)
  const [account, setAccount] = useState<Account>({ authenticated: false, displayName: null, email: null })
  const [syncState, setSyncState] = useState<SyncState>('checking')
  const [cloudReady, setCloudReady] = useState(false)
  const [generation, setGeneration] = useState<string | null>(null)
  const [deviceFavoriteCount, setDeviceFavoriteCount] = useState(() => readDeviceFavorites().length)
  const syncRef = useRef<FavoriteSync | null>(null)

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

        setSyncState('syncing')
        const cloudState = await getCloudFavorites()
        if (cancelled) return
        activateAccountFavorites(cloudState.storageScope, cloudState.favorites)
        setGeneration(cloudState.generation)
        syncRef.current = new FavoriteSync(cloudState, setSyncState)
        setDeviceFavoriteCount(readDeviceFavorites().length)
        setCloudReady(true)
        setSyncState('synced')
        void syncRef.current.drain()
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
    return subscribeToFavorites((change) => { if (change) syncRef.current?.enqueue(change) })
  }, [account.authenticated, cloudReady])

  async function importDeviceFavorites() {
    const deviceFavorites = readDeviceFavorites()
    if (deviceFavorites.length === 0 || !generation) return
    setSyncState('syncing')
    try {
      const state = await importCloudFavorites(generation, deviceFavorites)
      activateAccountFavorites(state.storageScope, state.favorites)
      setGeneration(state.generation)
      clearDeviceFavorites()
      setDeviceFavoriteCount(0)
      setSyncState('synced')
    } catch (error) {
      setSyncState('error')
      throw error
    }
  }

  async function deleteAccountData() {
    if (!generation) throw new Error('Cloud state unavailable')
    try {
      await deleteCloudData(generation)
      syncRef.current?.clear()
      window.location.assign(signOutPath('/'))
    } catch (error) {
      setSyncState('error')
      throw error
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <RouteMetadata pathname={location.pathname} />
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

      <div className="route-shell" id="main-content" tabIndex={-1}>
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
                onDownloadData={downloadCloudData}
                onImportDeviceFavorites={importDeviceFavorites}
                onRetrySync={() => syncRef.current?.drain()}
              />
            }
          />
          <Route path="/movies/:id" element={<MovieDetailsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/support" element={<SupportPage />} />
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
      <SiteFooter />
    </div>
  )
}

export default App
