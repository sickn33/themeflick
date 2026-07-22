import { beforeEach, describe, expect, it } from 'vitest'

import { FAVORITES_CHANGED_EVENT, readFavorites, saveFavorites, toggleFavorite } from './favorites'

const store = new Map<string, string>()
const dispatchedEvents: string[] = []

beforeEach(() => {
  store.clear()
  dispatchedEvents.length = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
      },
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event.type)
        return true
      },
    },
  })
})

describe('favorites storage', () => {
  it('drops malformed favorites instead of trusting localStorage', () => {
    store.set(
      'themeflick:favorites:v1',
      JSON.stringify([
        { id: 1, title: 'Valid', poster_path: null, release_date: null, vote_average: 8 },
        { id: 'bad', title: 'Invalid', poster_path: null, release_date: null, vote_average: 8 },
      ]),
    )

    expect(readFavorites()).toEqual([
      { id: 1, title: 'Valid', poster_path: null, release_date: null, vote_average: 8 },
    ])
  })

  it('ignores unavailable storage writes', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota')
          },
        },
      },
    })

    expect(() =>
      saveFavorites([{ id: 1, title: 'Valid', poster_path: null, release_date: null, vote_average: 8 }]),
    ).not.toThrow()
  })

  it('stores newly saved favorites first and notifies same-tab listeners', () => {
    const first = { id: 1, title: 'First', poster_path: null, release_date: null, vote_average: 8 }
    const newest = { id: 2, title: 'Newest', poster_path: null, release_date: null, vote_average: 9 }

    toggleFavorite(first)
    toggleFavorite(newest)

    expect(readFavorites()).toEqual([newest, first])
    expect(dispatchedEvents).toEqual([FAVORITES_CHANGED_EVENT, FAVORITES_CHANGED_EVENT])
  })
})
