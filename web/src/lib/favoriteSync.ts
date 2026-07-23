import { sendFavoriteMutation, type FavoriteMutation, type FavoriteState } from './account'
import { replaceFavoritesFromCloud, type FavoriteChange } from './favorites'

type PendingMutation = FavoriteMutation

export class FavoriteSync {
  private generation: string
  private storageScope: string
  private draining = false
  private readonly onState: (state: 'syncing' | 'synced' | 'error') => void

  constructor(state: FavoriteState, onState: (state: 'syncing' | 'synced' | 'error') => void) {
    this.generation = state.generation
    this.storageScope = state.storageScope
    this.onState = onState
  }

  private get key(): string { return `themeflick:favorite-outbox:v1:${this.storageScope}` }
  private read(): PendingMutation[] {
    try { const value = JSON.parse(localStorage.getItem(this.key) ?? '[]') as unknown; return Array.isArray(value) ? value as PendingMutation[] : [] } catch { return [] }
  }
  private write(items: PendingMutation[]): void { localStorage.setItem(this.key, JSON.stringify(items)) }

  enqueue(change: FavoriteChange): void {
    if (change.source !== 'user') return
    const item: PendingMutation = { operationId: crypto.randomUUID(), generation: this.generation, action: change.action, favorite: change.favorite, movieId: change.movieId }
    try { this.write([...this.read(), item]) }
    catch { this.onState('error'); return }
    void this.drain()
  }

  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    this.onState('syncing')
    try {
      let pending = this.read()
      while (pending.length > 0) {
        const state = await sendFavoriteMutation(pending[0])
        this.generation = state.generation
        replaceFavoritesFromCloud(state.favorites)
        pending = pending.slice(1)
        this.write(pending)
      }
      this.onState('synced')
    } catch { this.onState('error') }
    finally { this.draining = false }
  }

  clear(): void { localStorage.removeItem(this.key) }
}
