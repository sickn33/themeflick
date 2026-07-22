import { describe, expect, it } from 'vitest'

import {
  buildRecommendationCandidatePool,
  mapWithConcurrency,
  selectRecommendationCandidates,
  uniqueCandidates,
  type CandidateMovie,
} from './api'

function candidate(
  id: number,
  source: Partial<CandidateMovie['source']>,
): CandidateMovie {
  return {
    id,
    title: `Movie ${id}`,
    release_date: null,
    poster_path: null,
    vote_average: 7,
    vote_count: 100,
    source: {
      fromSimilar: false,
      fromRecommended: false,
      fromDirectorFilmography: false,
      fromDiscovery: false,
      fromTagGenome: false,
      similarRank: null,
      recommendedRank: null,
      directorRank: null,
      discoveryRank: null,
      discoveryHits: 0,
      tagGenomeRank: null,
      ...source,
    },
  }
}

describe('recommendation candidate shaping', () => {
  it('builds the exact ranked source union used by production and benchmarks', () => {
    const movie = (id: number, voteCount = 100) => ({
      id,
      title: `Movie ${id}`,
      vote_count: voteCount,
    })

    const selected = buildRecommendationCandidatePool(999, {
      similarPage1: [movie(1), movie(2)],
      similarPage2: [movie(3)],
      recommendedPage1: [movie(2, 200), movie(4)],
      recommendedPage2: [movie(5)],
      directorMovies: [{ ...movie(6), job: 'Director' }],
      discoveredPage1: [movie(7)],
    })

    expect(selected.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 7, 6])
    expect(selected[1].source).toMatchObject({
      fromSimilar: true,
      fromRecommended: true,
      similarRank: 2,
      recommendedRank: 1,
    })
    expect(selected[5].source).toMatchObject({ fromDiscovery: true, discoveryRank: 1 })
    expect(selected[6].source).toMatchObject({
      fromDirectorFilmography: true,
      directorRank: 1,
    })
  })

  it('preserves merged source provenance and the best TMDB rank', () => {
    const merged = uniqueCandidates([
      candidate(1, { fromSimilar: true, similarRank: 18 }),
      candidate(1, { fromSimilar: true, similarRank: 4 }),
      candidate(1, { fromRecommended: true, recommendedRank: 7 }),
    ], 999)

    expect(merged).toHaveLength(1)
    expect(merged[0].source).toMatchObject({
      fromSimilar: true,
      fromRecommended: true,
      similarRank: 4,
      recommendedRank: 7,
    })
  })

  it('balances the detail cap across ranked TMDB sources', () => {
    const similar = Array.from({ length: 40 }, (_, index) =>
      candidate(100 + index, { fromSimilar: true, similarRank: index + 1 }),
    )
    const recommended = Array.from({ length: 40 }, (_, index) =>
      candidate(200 + index, { fromRecommended: true, recommendedRank: index + 1 }),
    )
    const director = Array.from({ length: 10 }, (_, index) =>
      candidate(300 + index, { fromDirectorFilmography: true, directorRank: index + 1 }),
    )
    const discovery = Array.from({ length: 20 }, (_, index) =>
      candidate(400 + index, { fromDiscovery: true, discoveryRank: index + 1 }),
    )
    const semantic = Array.from({ length: 60 }, (_, index) =>
      candidate(500 + index, { fromTagGenome: true, tagGenomeRank: index + 1 }),
    )

    const selected = selectRecommendationCandidates(
      [...recommended.reverse(), ...director, ...discovery, ...similar.reverse(), ...semantic.reverse()],
      100,
    )

    expect(selected).toHaveLength(100)
    expect(selected.filter((movie) => movie.source.fromTagGenome)).toHaveLength(50)
    expect(selected.filter((movie) => movie.source.fromSimilar)).toHaveLength(15)
    expect(selected.filter((movie) => movie.source.fromRecommended)).toHaveLength(15)
    expect(selected.filter((movie) => movie.source.fromDiscovery)).toHaveLength(15)
    expect(selected.filter((movie) => movie.source.fromDirectorFilmography)).toHaveLength(5)
    expect(selected.filter((movie) => movie.source.fromSimilar).map((movie) => movie.source.similarRank))
      .toEqual(Array.from({ length: 15 }, (_, index) => index + 1))
  })

  it('bounds concurrent detail work and preserves result order and failures', async () => {
    let active = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      if (value === 4) throw new Error('detail failed')
      return value * 10
    })

    expect(peak).toBe(3)
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled',
    ])
    expect(results[6]).toEqual({ status: 'fulfilled', value: 70 })
  })
})
