import { useState } from 'react'

import type { Account, SyncState } from '../lib/account'
import { signInPath, signOutPath } from '../lib/account'

type AccountPageProps = {
  account: Account
  syncState: SyncState
  deviceFavoriteCount: number
  onDeleteData: () => Promise<void>
  onDownloadData: () => Promise<void>
  onImportDeviceFavorites: () => Promise<void>
  onRetrySync: () => void
}

function syncMessage(syncState: SyncState): string {
  switch (syncState) {
    case 'checking':
      return 'Checking your account…'
    case 'syncing':
      return 'Syncing your favorites…'
    case 'synced':
      return 'Your favorites are synced across devices.'
    case 'error':
      return 'Cloud sync is temporarily unavailable. Your local favorites are still safe.'
    default:
      return 'Favorites are stored only on this device.'
  }
}

export function AccountPage({
  account,
  syncState,
  deviceFavoriteCount,
  onDeleteData,
  onDownloadData,
  onImportDeviceFavorites,
  onRetrySync,
}: AccountPageProps) {
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  async function deleteData() {
    if (!window.confirm('Delete every synced favorite from your Themeflick account?')) return
    setDeleting(true)
    setAnnouncement('')
    try {
      await onDeleteData()
      setAnnouncement('Your synced Themeflick data was deleted.')
    } catch {
      setAnnouncement('Could not delete your synced data. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  async function importFavorites() {
    if (!window.confirm(`Import ${deviceFavoriteCount} device favorite${deviceFavoriteCount === 1 ? '' : 's'} into this account and remove the device-only copy?`)) return
    setImporting(true)
    setAnnouncement('')
    try {
      await onImportDeviceFavorites()
      setAnnouncement('Your device favorites were imported and are now synced.')
    } catch {
      setAnnouncement('Could not import your device favorites. The local copy was not changed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <main className="section-block account-page">
      <div className="section-heading">
        <h1>Account</h1>
        <p>Control how Themeflick remembers your shortlist.</p>
      </div>

      {!account.authenticated ? (
        <div className="account-panel">
          <p className="account-kicker">Device-only mode</p>
          <h2>Keep your favorites wherever you watch.</h2>
          <p>{syncMessage(syncState)}</p>
          <p className="account-disclosure">Signing in shares your ChatGPT account email and display name with Themeflick so favorites can sync. Review the Privacy notice before continuing.</p>
          <a className="button button-primary compact" href={signInPath('/account')}>
            Sign in with ChatGPT
          </a>
        </div>
      ) : (
        <div className="account-panel">
          <p className="account-kicker">Signed in</p>
          <h2>{account.displayName}</h2>
          <p>{account.email}</p>
          <p className={`sync-copy sync-${syncState}`} role="status">
            {syncMessage(syncState)}
          </p>
          {deviceFavoriteCount > 0 && (
            <div className="import-panel">
              <p>
                This device also has {deviceFavoriteCount} local favorite{deviceFavoriteCount === 1 ? '' : 's'}.
              </p>
              <button className="button button-primary" type="button" disabled={importing} onClick={() => void importFavorites()}>
                {importing ? 'Importing…' : 'Import device favorites'}
              </button>
            </div>
          )}
          {syncState === 'error' && (
            <button className="button button-secondary" type="button" onClick={onRetrySync}>Retry sync</button>
          )}
          <div className="account-actions">
            <button className="button button-secondary" type="button" onClick={() => void onDownloadData()}>
              Download my data
            </button>
            <a className="button button-secondary" href={signOutPath('/')}>
              Sign out
            </a>
            <button className="button button-danger" type="button" disabled={deleting} onClick={() => void deleteData()}>
              {deleting ? 'Deleting…' : 'Delete synced data'}
            </button>
          </div>
          <p className="account-disclosure">Deleting Themeflick data removes the synced favorites held by this product. It does not delete or change your ChatGPT account.</p>
        </div>
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </main>
  )
}
