export type ScoreFeatures = {
  genreIds: number[]
  directorId: number | null
  castIds: number[]
  voteAverage: number
  voteCount: number
  releaseYear: number | null
  runtimeMinutes: number | null
  keywordIds: number[]
}

export type RankingCandidate = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  director_id: number | null
  features: ScoreFeatures
}

export type ScoringResult = {
  score: number
  reason: string
}

export type RankedMovie = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  similarity_score: number
  match_reason: string
  director_id: number | null
}

type DetailedScoringResult = {
  score: number
  rawScore: number
  reason: string
  sameDirector: boolean
}

type ScoringSignals = {
  genreScore: number
  keywordScore: number
  castScore: number
  yearScore: number
  runtimeScore: number
  ratingScore: number
  confidenceScore: number
  sameDirector: boolean
  yearDiff: number | null
  runtimeDiff: number | null
}

const MAX_RESULTS = 18
const MAX_PER_DIRECTOR = 2
const MIN_SCORE_SAME_DIRECTOR = 40
const MIN_SCORE_GENERAL = 46
const CAST_POSITION_WEIGHTS = [1.0, 0.8, 0.6, 0.45, 0.3]

const SIGNAL_WEIGHTS = {
  genre: 0.3,
  keyword: 0.2,
  cast: 0.14,
  director: 0.12,
  year: 0.09,
  runtime: 0.07,
  rating: 0.05,
  confidence: 0.03,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function jaccardScore(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size
  if (union === 0) {
    return 0
  }

  return intersection / union
}

function weightedCastOverlap(baseCast: number[], candidateCast: number[]): number {
  if (baseCast.length === 0 || candidateCast.length === 0) {
    return 0
  }

  const candidateSet = new Set(candidateCast)
  const limitedBase = baseCast.slice(0, CAST_POSITION_WEIGHTS.length)

  let score = 0
  let maxScore = 0
  for (let index = 0; index < limitedBase.length; index += 1) {
    const weight = CAST_POSITION_WEIGHTS[index]
    maxScore += weight
    if (candidateSet.has(limitedBase[index])) {
      score += weight
    }
  }

  if (maxScore === 0) {
    return 0
  }

  return score / maxScore
}

function scoreSignals(base: ScoreFeatures, candidate: ScoreFeatures): ScoringSignals {
  const genreScore = jaccardScore(base.genreIds, candidate.genreIds)
  const keywordScore = jaccardScore(base.keywordIds, candidate.keywordIds)
  const castScore = weightedCastOverlap(base.castIds, candidate.castIds)

  const sameDirector =
    base.directorId !== null && candidate.directorId !== null && base.directorId === candidate.directorId

  const yearDiff =
    base.releaseYear !== null && candidate.releaseYear !== null
      ? Math.abs(base.releaseYear - candidate.releaseYear)
      : null
  const runtimeDiff =
    base.runtimeMinutes !== null && candidate.runtimeMinutes !== null
      ? Math.abs(base.runtimeMinutes - candidate.runtimeMinutes)
      : null

  return {
    genreScore,
    keywordScore,
    castScore,
    yearScore: yearDiff === null ? 0.45 : clamp(1 - yearDiff / 18, 0, 1),
    runtimeScore: runtimeDiff === null ? 0.55 : clamp(1 - runtimeDiff / 70, 0, 1),
    ratingScore: clamp(1 - Math.abs(base.voteAverage - candidate.voteAverage) / 3.5, 0, 1),
    confidenceScore: clamp(Math.log10(candidate.voteCount + 1) / 4, 0, 1),
    sameDirector,
    yearDiff,
    runtimeDiff,
  }
}

function buildReason(signals: ScoringSignals): string {
  const reasons: Array<{ label: string; contribution: number }> = []

  if (signals.sameDirector) {
    const contribution =
      SIGNAL_WEIGHTS.director + (signals.genreScore >= 0.2 ? 0.04 : 0)
    reasons.push({ label: 'Same director', contribution })
  }

  if (signals.keywordScore >= 0.18) {
    const contribution =
      signals.keywordScore * SIGNAL_WEIGHTS.keyword + (signals.keywordScore >= 0.35 ? 0.03 : 0)
    reasons.push({ label: 'Shared themes', contribution })
  }

  if (signals.genreScore >= 0.18) {
    reasons.push({
      label: 'Strong genre overlap',
      contribution: signals.genreScore * SIGNAL_WEIGHTS.genre,
    })
  }

  if (signals.castScore >= 0.2) {
    reasons.push({
      label: 'Shared cast',
      contribution: signals.castScore * SIGNAL_WEIGHTS.cast,
    })
  }

  if (signals.yearDiff !== null && signals.yearScore >= 0.55) {
    reasons.push({
      label: 'Same era',
      contribution: signals.yearScore * SIGNAL_WEIGHTS.year,
    })
  }

  if (signals.runtimeDiff !== null && signals.runtimeScore >= 0.65) {
    reasons.push({
      label: 'Similar pacing',
      contribution: signals.runtimeScore * SIGNAL_WEIGHTS.runtime,
    })
  }

  reasons.sort((left, right) => right.contribution - left.contribution)

  if (signals.sameDirector) {
    const secondary = reasons.find((reason) => reason.label !== 'Same director')
    if (secondary) {
      return `Same director + ${secondary.label}`
    }
    return 'Same director'
  }

  if (reasons.length === 0) {
    return 'Strong overall profile match'
  }

  return reasons.slice(0, 2).map((reason) => reason.label).join(' + ')
}

function calibrateToMatchScore(rawScore: number): number {
  const logistic = 1 / (1 + Math.exp(-(rawScore - 0.52) / 0.1))
  const calibrated = clamp(12 + logistic * 86, 0, 99.4)
  return roundToSingleDecimal(calibrated)
}

function scoreCandidateDetailed(base: ScoreFeatures, candidate: ScoreFeatures): DetailedScoringResult | null {
  const signals = scoreSignals(base, candidate)

  if (!signals.sameDirector && signals.genreScore < 0.1 && signals.keywordScore < 0.1 && signals.castScore < 0.2) {
    return null
  }

  if (!signals.sameDirector && candidate.voteCount < 35) {
    return null
  }

  let rawScore =
    signals.genreScore * SIGNAL_WEIGHTS.genre +
    signals.keywordScore * SIGNAL_WEIGHTS.keyword +
    signals.castScore * SIGNAL_WEIGHTS.cast +
    (signals.sameDirector ? 1 : 0) * SIGNAL_WEIGHTS.director +
    signals.yearScore * SIGNAL_WEIGHTS.year +
    signals.runtimeScore * SIGNAL_WEIGHTS.runtime +
    signals.ratingScore * SIGNAL_WEIGHTS.rating +
    signals.confidenceScore * SIGNAL_WEIGHTS.confidence

  if (signals.sameDirector && signals.genreScore >= 0.2) {
    rawScore += 0.04
  }
  if (signals.keywordScore >= 0.35) {
    rawScore += 0.03
  }
  if (!signals.sameDirector && signals.genreScore === 0) {
    rawScore -= 0.1
  }
  if (signals.yearDiff !== null && signals.yearDiff > 25) {
    rawScore -= 0.04
  }

  rawScore = clamp(rawScore, 0, 1)

  if (rawScore < 0.34) {
    return null
  }

  const score = calibrateToMatchScore(rawScore)
  const threshold = signals.sameDirector ? MIN_SCORE_SAME_DIRECTOR : MIN_SCORE_GENERAL
  if (score < threshold) {
    return null
  }

  return {
    score,
    rawScore,
    reason: buildReason(signals),
    sameDirector: signals.sameDirector,
  }
}

function pairSimilarity(left: RankingCandidate, right: RankingCandidate): number {
  const sameDirector =
    left.features.directorId !== null &&
    right.features.directorId !== null &&
    left.features.directorId === right.features.directorId
      ? 1
      : 0

  const genreSimilarity = jaccardScore(left.features.genreIds, right.features.genreIds)

  const eraSimilarity =
    left.features.releaseYear !== null && right.features.releaseYear !== null
      ? clamp(1 - Math.abs(left.features.releaseYear - right.features.releaseYear) / 20, 0, 1)
      : 0.35

  return clamp(sameDirector * 0.5 + genreSimilarity * 0.35 + eraSimilarity * 0.15, 0, 1)
}

export function scoreCandidate(base: ScoreFeatures, candidate: ScoreFeatures): ScoringResult | null {
  const detailed = scoreCandidateDetailed(base, candidate)
  if (!detailed) {
    return null
  }

  return {
    score: detailed.score,
    reason: detailed.reason,
  }
}

export function rankCandidates(base: ScoreFeatures, candidates: RankingCandidate[]): RankedMovie[] {
  const scored = candidates
    .map((candidate) => {
      const scoredCandidate = scoreCandidateDetailed(base, candidate.features)
      if (!scoredCandidate) {
        return null
      }

      return {
        ...candidate,
        similarity_score: scoredCandidate.score,
        match_reason: scoredCandidate.reason,
        relevance: scoredCandidate.score / 100,
      }
    })
    .filter((candidate): candidate is RankingCandidate & {
      similarity_score: number
      match_reason: string
      relevance: number
    } => candidate !== null)

  scored.sort((left, right) => {
    if (right.similarity_score !== left.similarity_score) {
      return right.similarity_score - left.similarity_score
    }
    if (right.vote_average !== left.vote_average) {
      return right.vote_average - left.vote_average
    }
    return left.id - right.id
  })

  const remaining = [...scored]
  const selected: typeof scored = []
  const directorCounts = new Map<number, number>()

  while (remaining.length > 0 && selected.length < MAX_RESULTS) {
    let bestIndex = -1
    let bestMmr = Number.NEGATIVE_INFINITY

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      if (candidate.director_id !== null) {
        const count = directorCounts.get(candidate.director_id) ?? 0
        if (count >= MAX_PER_DIRECTOR) {
          continue
        }
      }

      const maxSimilarity =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((picked) => pairSimilarity(candidate, picked)))

      const mmr = 0.78 * candidate.relevance - 0.22 * maxSimilarity

      if (mmr > bestMmr) {
        bestMmr = mmr
        bestIndex = index
        continue
      }

      if (mmr === bestMmr && bestIndex >= 0) {
        const currentBest = remaining[bestIndex]
        if (candidate.similarity_score > currentBest.similarity_score) {
          bestIndex = index
        } else if (
          candidate.similarity_score === currentBest.similarity_score &&
          candidate.id < currentBest.id
        ) {
          bestIndex = index
        }
      }
    }

    if (bestIndex === -1) {
      break
    }

    const [picked] = remaining.splice(bestIndex, 1)

    if (picked.director_id !== null) {
      directorCounts.set(picked.director_id, (directorCounts.get(picked.director_id) ?? 0) + 1)
    }

    selected.push(picked)
  }

  return selected.map((movie) => ({
    id: movie.id,
    title: movie.title,
    poster_path: movie.poster_path,
    release_date: movie.release_date,
    vote_average: movie.vote_average,
    similarity_score: movie.similarity_score,
    match_reason: movie.match_reason,
    director_id: movie.director_id,
  }))
}
