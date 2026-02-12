import { describe, expect, it } from 'vitest'

import {
  rankCandidates,
  scoreCandidate,
  type RankingCandidate,
  type ScoreFeatures,
} from './recommendationEngine'

function features(overrides: Partial<ScoreFeatures> = {}): ScoreFeatures {
  return {
    genreIds: [28, 878, 53],
    directorId: 99,
    castIds: [1, 2, 3, 4, 5],
    voteAverage: 8.2,
    voteCount: 1500,
    releaseYear: 2010,
    runtimeMinutes: 132,
    keywordIds: [10, 20, 30, 40],
    ...overrides,
  }
}

function candidate(id: number, featureSet: Partial<ScoreFeatures>, directorId?: number | null): RankingCandidate {
  const resolvedFeatures = features(featureSet)
  if (directorId !== undefined) {
    resolvedFeatures.directorId = directorId
  }

  return {
    id,
    title: `Movie ${id}`,
    poster_path: null,
    release_date: `${resolvedFeatures.releaseYear ?? 2000}-01-01`,
    vote_average: resolvedFeatures.voteAverage,
    director_id: resolvedFeatures.directorId,
    features: resolvedFeatures,
  }
}

describe('recommendationEngine', () => {
  it('scores near-perfect same-director candidates very high', () => {
    const base = features()
    const scored = scoreCandidate(base, features())

    expect(scored).not.toBeNull()
    expect(scored?.score).toBeGreaterThanOrEqual(85)
    expect(scored?.reason).toContain('Same director')
  })

  it('rejects candidates with no core overlap and different director', () => {
    const base = features()
    const scored = scoreCandidate(
      base,
      features({
        genreIds: [18],
        keywordIds: [999],
        castIds: [77, 78],
        directorId: 12,
        voteCount: 400,
      }),
    )

    expect(scored).toBeNull()
  })

  it('rejects low vote-count candidates when director differs', () => {
    const base = features()
    const scored = scoreCandidate(
      base,
      features({
        directorId: 12,
        genreIds: [28, 18],
        keywordIds: [10, 88],
        castIds: [1],
        voteCount: 20,
      }),
    )

    expect(scored).toBeNull()
  })

  it('enforces max two recommendations per director', () => {
    const base = features()
    const sameDirector: RankingCandidate[] = [
      candidate(1, { voteAverage: 8.7, keywordIds: [10, 20, 30, 40] }, 7),
      candidate(2, { voteAverage: 8.6, keywordIds: [10, 20, 30] }, 7),
      candidate(3, { voteAverage: 8.5, keywordIds: [10, 20] }, 7),
      candidate(4, { voteAverage: 8.4, keywordIds: [10, 20, 30, 40] }, 7),
    ]

    const otherDirectors: RankingCandidate[] = [
      candidate(20, { directorId: 20, keywordIds: [10, 20, 30] }, 20),
      candidate(21, { directorId: 21, keywordIds: [10, 20, 30] }, 21),
    ]

    const ranked = rankCandidates(base, [...sameDirector, ...otherDirectors])
    const fromDirector7 = ranked.filter((movie) => movie.director_id === 7)

    expect(fromDirector7.length).toBeLessThanOrEqual(2)
    expect(ranked.length).toBeGreaterThan(0)
  })

  it('builds reasons from strongest matching signals', () => {
    const base = features()
    const ranked = rankCandidates(base, [
      candidate(
        40,
        {
          directorId: 12,
          genreIds: [28, 878],
          keywordIds: [10, 20, 30, 90],
          castIds: [99],
          voteCount: 900,
        },
        12,
      ),
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0].match_reason).toMatch(/Shared themes|Strong genre overlap/)
  })

  it('is deterministic for the same input', () => {
    const base = features()
    const input = [
      candidate(50, { keywordIds: [10, 20, 30, 40], voteAverage: 8.4 }, 50),
      candidate(51, { keywordIds: [10, 20, 30], voteAverage: 8.3 }, 51),
      candidate(52, { keywordIds: [10, 20], voteAverage: 8.2 }, 52),
    ]

    const first = rankCandidates(base, input)
    const second = rankCandidates(base, input)

    expect(second).toEqual(first)
  })

  it('keeps medium matches below inflated 90+ scores', () => {
    const base = features()
    const scored = scoreCandidate(
      base,
      features({
        directorId: 12,
        genreIds: [28, 878],
        keywordIds: [10, 20, 88],
        castIds: [2, 44],
        voteAverage: 7.4,
        voteCount: 700,
        releaseYear: 2006,
        runtimeMinutes: 115,
      }),
    )

    expect(scored).not.toBeNull()
    expect(scored?.score).toBeGreaterThanOrEqual(46)
    expect(scored?.score).toBeLessThan(90)
  })
})
