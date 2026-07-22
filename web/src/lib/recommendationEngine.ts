export type ScoreFeatures = {
  genreIds: number[]
  directorId: number | null
  composerIds: number[]
  keywordPhrases: string[]
  keywordTokens: string[]
  castIds: number[]
  voteAverage: number
  voteCount: number
  releaseYear: number | null
  runtimeMinutes: number | null
  keywordIds: number[]
  overviewTokens?: string[]
}

export type RecommendationSource = {
  fromSimilar: boolean
  fromRecommended: boolean
  fromDirectorFilmography: boolean
  fromDiscovery?: boolean
  fromTagGenome?: boolean
  similarRank?: number | null
  recommendedRank?: number | null
  directorRank?: number | null
  discoveryRank?: number | null
  discoveryHits?: number
  tagGenomeRank?: number | null
}

export type RankingCandidate = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  director_id: number | null
  features: ScoreFeatures
  source: RecommendationSource
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

type ScoringMode = 'strict' | 'relaxed' | 'fallback'

type DetailedScoringResult = {
  score: number
  reason: string
  themeStrength: number
  genreDominancePenalty: number
}

type ScoringSignals = {
  genreScore: number
  keywordIdScore: number
  keywordPhraseExactScore: number
  keywordPhraseSemanticScore: number
  keywordTokenScore: number
  keywordScore: number
  overviewScore: number
  castScore: number
  soundtrackScore: number
  yearScore: number
  runtimeScore: number
  ratingScore: number
  confidenceScore: number
  hasKeywordPhraseAnchor: boolean
  hasKeywordTokenAnchor: boolean
  sameDirector: boolean
  yearDiff: number | null
  runtimeDiff: number | null
}

type InternalRankedCandidate = RankingCandidate & {
  similarity_score: number
  match_reason: string
  relevance: number
  theme_strength: number
}

const MAX_RESULTS = 12
const MAX_PER_DIRECTOR = 2
const MIN_RESULTS_TARGET = 10

const MIN_SCORE_STRICT_SAME_DIRECTOR = 36
const MIN_SCORE_STRICT_GENERAL = 42
const MIN_SCORE_RELAXED_SAME_DIRECTOR = 24
const MIN_SCORE_RELAXED_GENERAL = 30
const MIN_SCORE_FALLBACK_SAME_DIRECTOR = 14
const MIN_SCORE_FALLBACK_GENERAL = 16

const RAW_MIN_STRICT = 0.22
const RAW_MIN_RELAXED = 0.08
const RAW_MIN_FALLBACK = 0

const CAST_POSITION_WEIGHTS = [1.0, 0.8, 0.6, 0.45, 0.3]

const SIGNAL_WEIGHTS = {
  genre: 0.19,
  keyword: 0.33,
  overview: 0.09,
  cast: 0.1,
  soundtrack: 0.07,
  director: 0.06,
  year: 0.06,
  runtime: 0.04,
  rating: 0.04,
  confidence: 0.02,
} as const

const KEYWORD_TOKEN_SYNONYMS: Record<string, string> = {
  doppelganger: 'identity-double',
  doppelgangers: 'identity-double',
  double: 'identity-double',
  doubles: 'identity-double',
  duplicate: 'identity-double',
  duplicates: 'identity-double',
  lookalike: 'identity-double',
  lookalikes: 'identity-double',
  twin: 'identity-double',
  twins: 'identity-double',
  clone: 'identity-double',
  clones: 'identity-double',
  cloning: 'identity-double',
  cloned: 'identity-double',
  impostor: 'identity-double',
  impostors: 'identity-double',
  imposter: 'identity-double',
  imposters: 'identity-double',
  alter: 'alter',
  ego: 'ego',
  personality: 'persona',
  personalities: 'persona',
  psyche: 'persona',
  psychosis: 'persona',
  murderer: 'killer',
  murderers: 'killer',
  killer: 'killer',
  killers: 'killer',
  detective: 'investigation',
  investigation: 'investigation',
  detectives: 'investigation',
  heist: 'robbery',
  robbery: 'robbery',
  robberies: 'robbery',
  revenge: 'vengeance',
  vengeance: 'vengeance',
  avenger: 'vengeance',
  avenging: 'vengeance',
  alien: 'extraterrestrial',
  aliens: 'extraterrestrial',
  extraterrestrial: 'extraterrestrial',
  spaceship: 'spacecraft',
  spacecraft: 'spacecraft',
  apocalypse: 'catastrophe',
  apocalyptic: 'catastrophe',
  catastrophe: 'catastrophe',
  dystopia: 'dystopian',
  dystopian: 'dystopian',
  time: 'time',
  timeline: 'time',
  timelines: 'time',
  temporal: 'time',
  loop: 'loop',
  loops: 'loop',
  memory: 'memory',
  amnesia: 'memory',
  forgetfulness: 'memory',
  cyborg: 'artificial-being',
  cyborgs: 'artificial-being',
  android: 'artificial-being',
  androids: 'artificial-being',
  bot: 'artificial-being',
  bots: 'artificial-being',
  robot: 'artificial-being',
  robots: 'artificial-being',
  automaton: 'artificial-being',
  automatons: 'artificial-being',
  mech: 'artificial-being',
  mecha: 'artificial-being',
  mechas: 'artificial-being',
  drone: 'artificial-being',
  drones: 'artificial-being',
  synth: 'artificial-being',
  synths: 'artificial-being',
}

const GENERIC_THEME_TOKENS = new Set([
  'father',
  'mother',
  'daughter',
  'son',
  'family',
  'relationship',
  'friend',
  'friends',
])

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

function overlapRatio(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let shared = 0
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      shared += 1
    }
  }

  return shared / leftSet.size
}

function jaccardStringScore(left: string[], right: string[]): number {
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

function overlapRatioString(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let shared = 0
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      shared += 1
    }
  }

  return shared / leftSet.size
}

function normalizeKeywordTokenForMatch(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) {
    token = `${token.slice(0, -3)}y`
  } else if (token.length > 5 && token.endsWith('ing')) {
    token = token.slice(0, -3)
  } else if (token.length > 4 && token.endsWith('ed')) {
    const stem = token.slice(0, -2)
    if (stem.length >= 3 && /[nlvzt]$/.test(stem)) {
      token = `${stem}e`
    } else {
      token = stem
    }
  } else if (token.length > 4 && token.endsWith('es')) {
    token = token.slice(0, -2)
  } else if (token.length > 4 && token.endsWith('s')) {
    token = token.slice(0, -1)
  }

  return KEYWORD_TOKEN_SYNONYMS[token] ?? token
}

function buildBigrams(value: string): string[] {
  if (value.length < 2) {
    return [value]
  }

  const bigrams: string[] = []
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.push(value.slice(index, index + 2))
  }

  return bigrams
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) {
    return 1
  }
  if (left.length < 2 || right.length < 2) {
    return 0
  }

  const leftBigrams = buildBigrams(left)
  const rightBigrams = buildBigrams(right)
  const rightCounts = new Map<string, number>()

  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1)
  }

  let overlap = 0
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0
    if (count > 0) {
      overlap += 1
      rightCounts.set(bigram, count - 1)
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length)
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1
  }

  const normalizedLeft = normalizeKeywordTokenForMatch(left)
  const normalizedRight = normalizeKeywordTokenForMatch(right)
  if (!normalizedLeft || !normalizedRight) {
    return 0
  }

  if (normalizedLeft === normalizedRight) {
    return 0.93
  }

  if (
    (left.startsWith(right) || right.startsWith(left) || left.endsWith(right) || right.endsWith(left)) &&
    Math.min(left.length, right.length) >= 4
  ) {
    return 0.72
  }

  const dice = diceCoefficient(normalizedLeft, normalizedRight)
  if (dice >= 0.9) {
    return 0.76
  }
  if (dice >= 0.82 && (normalizedLeft.length >= 6 || normalizedRight.length >= 6)) {
    return 0.62
  }

  return 0
}

function splitPhraseTokens(phrase: string): string[] {
  return phrase
    .split(/\s+/)
    .map((token) => normalizeKeywordTokenForMatch(token.trim()))
    .filter((token) => token.length >= 3 && !GENERIC_THEME_TOKENS.has(token))
}

function normalizeThemeTokens(tokens: string[]): string[] {
  return [
    ...new Set(
      tokens
        .map((token) => normalizeKeywordTokenForMatch(token))
        .filter((token) => token.length >= 3 && !GENERIC_THEME_TOKENS.has(token)),
    ),
  ]
}

function phraseSpecificity(phrase: string): number {
  const tokens = splitPhraseTokens(phrase)
  if (tokens.length === 0) {
    return 0
  }

  if (tokens.length === 1) {
    const tokenLength = tokens[0].length
    return clamp((tokenLength - 3) / 10 + 0.04, 0, 0.24)
  }

  const uniqueCount = new Set(tokens).size
  const avgTokenLength = tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length
  const richness = uniqueCount / tokens.length
  const structureBonus = 0.2

  return clamp((avgTokenLength - 3) / 6 * 0.6 + richness * 0.2 + structureBonus, 0, 1)
}

function normalizeThemePhrases(phrases: string[]): Array<{ phrase: string; specificity: number }> {
  const normalized = new Map<string, number>()
  for (const phrase of phrases) {
    const canonical = splitPhraseTokens(phrase).join(' ')
    if (!canonical) {
      continue
    }

    const specificity = phraseSpecificity(canonical)
    const existing = normalized.get(canonical) ?? 0
    if (specificity > existing) {
      normalized.set(canonical, specificity)
    }
  }

  return [...normalized.entries()].map(([phrase, specificity]) => ({ phrase, specificity }))
}

function phraseSemanticSimilarity(leftPhrase: string, rightPhrase: string): number {
  if (!leftPhrase || !rightPhrase) {
    return 0
  }
  if (leftPhrase === rightPhrase) {
    return 1
  }

  const leftTokens = splitPhraseTokens(leftPhrase)
  const rightTokens = splitPhraseTokens(rightPhrase)
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0
  }

  let score = 0
  const usedRightIndexes = new Set<number>()

  for (const leftToken of leftTokens) {
    let bestScore = 0
    let bestIndex = -1

    for (let rightIndex = 0; rightIndex < rightTokens.length; rightIndex += 1) {
      if (usedRightIndexes.has(rightIndex)) {
        continue
      }

      const similarity = tokenSimilarity(leftToken, rightTokens[rightIndex])
      if (similarity > bestScore) {
        bestScore = similarity
        bestIndex = rightIndex
      }
    }

    if (bestIndex >= 0 && bestScore >= 0.58) {
      usedRightIndexes.add(bestIndex)
      score += bestScore
    }
  }

  return clamp(score / Math.max(leftTokens.length, rightTokens.length), 0, 1)
}

function keywordPhraseScores(
  baseKeywordPhrases: string[],
  candidateKeywordPhrases: string[],
): {
  exact: number
  semantic: number
  hasAnchor: boolean
} {
  if (baseKeywordPhrases.length === 0 || candidateKeywordPhrases.length === 0) {
    return {
      exact: 0,
      semantic: 0,
      hasAnchor: false,
    }
  }

  const baseSet = normalizeThemePhrases(baseKeywordPhrases)
  const candidateSet = normalizeThemePhrases(candidateKeywordPhrases)
  if (baseSet.length === 0 || candidateSet.length === 0) {
    return {
      exact: 0,
      semantic: 0,
      hasAnchor: false,
    }
  }

  const candidateLookup = new Map(candidateSet.map((item) => [item.phrase, item.specificity]))

  let exactMatches = 0
  let semanticSum = 0
  let exactDenominator = 0
  let semanticDenominator = 0
  let hasAnchor = false

  for (const basePhrase of baseSet) {
    const baseTokenCount = splitPhraseTokens(basePhrase.phrase).length
    const granularityWeight = baseTokenCount <= 1 ? 0.18 : baseTokenCount === 2 ? 0.72 : 1
    const specificityWeight = 0.35 + basePhrase.specificity * 0.65
    exactDenominator += specificityWeight
    semanticDenominator += specificityWeight

    const exactSpecificity = candidateLookup.get(basePhrase.phrase)
    if (exactSpecificity !== undefined) {
      const matchStrength = clamp((basePhrase.specificity + exactSpecificity) / 2, 0.2, 1)
      exactMatches += specificityWeight * matchStrength * granularityWeight
      // semanticSum += specificityWeight * Math.max(0.25, granularityWeight) // Removed double-counting
      hasAnchor = granularityWeight >= 0.7
      continue
    }

    let bestSemantic = 0
    for (const candidatePhrase of candidateSet) {
      const semantic = phraseSemanticSimilarity(basePhrase.phrase, candidatePhrase.phrase)
      if (semantic > bestSemantic) {
        bestSemantic = semantic
      }
    }

    if (bestSemantic >= 0.58) {
      semanticSum += specificityWeight * bestSemantic * Math.max(0.25, granularityWeight)
    }
    if (bestSemantic >= 0.82 && granularityWeight >= 0.7) {
      hasAnchor = true
    }
  }

  return {
    exact: exactDenominator > 0 ? exactMatches / exactDenominator : 0,
    semantic: semanticDenominator > 0 ? clamp(semanticSum / semanticDenominator, 0, 1) : 0,
    hasAnchor,
  }
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
  const baseThemeTokens = normalizeThemeTokens(base.keywordTokens)
  const candidateThemeTokens = normalizeThemeTokens(candidate.keywordTokens)
  const keywordPhrase = keywordPhraseScores(base.keywordPhrases, candidate.keywordPhrases)
  const candidateKeywordIds = new Set(candidate.keywordIds)
  const sharedKeywordIdCount = base.keywordIds.filter((id) => candidateKeywordIds.has(id)).length
  const keywordIdScore = Math.max(
    jaccardScore(base.keywordIds, candidate.keywordIds) * 0.35 +
      Math.sqrt(overlapRatio(base.keywordIds, candidate.keywordIds)) * 0.65,
    clamp(sharedKeywordIdCount / 3, 0, 1) * 0.42,
  )
  const keywordTokenScore =
    jaccardStringScore(baseThemeTokens, candidateThemeTokens) * 0.3 +
    Math.sqrt(overlapRatioString(baseThemeTokens, candidateThemeTokens)) * 0.7
  const keywordScore = clamp(
    keywordPhrase.exact * 0.5 +
      keywordPhrase.semantic * 0.24 +
      keywordTokenScore * 0.18 +
      keywordIdScore * 0.08,
    0,
    1,
  )
  const baseOverviewTokens = normalizeThemeTokens(base.overviewTokens ?? [])
  const candidateOverviewTokens = normalizeThemeTokens(candidate.overviewTokens ?? [])
  const overviewScore =
    jaccardStringScore(baseOverviewTokens, candidateOverviewTokens) * 0.3 +
    Math.sqrt(overlapRatioString(baseOverviewTokens, candidateOverviewTokens)) * 0.7
  const castScore = weightedCastOverlap(base.castIds, candidate.castIds)
  const soundtrackScore = jaccardScore(base.composerIds, candidate.composerIds)

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
    keywordIdScore,
    keywordPhraseExactScore: keywordPhrase.exact,
    keywordPhraseSemanticScore: keywordPhrase.semantic,
    keywordTokenScore,
    keywordScore,
    overviewScore,
    castScore,
    soundtrackScore,
    yearScore: yearDiff === null ? 0.45 : clamp(1 - yearDiff / 18, 0, 1),
    runtimeScore: runtimeDiff === null ? 0.55 : clamp(1 - runtimeDiff / 70, 0, 1),
    ratingScore: clamp(1 - Math.abs(base.voteAverage - candidate.voteAverage) / 3.5, 0, 1),
    confidenceScore: clamp(Math.log10(candidate.voteCount + 1) / 4, 0, 1),
    hasKeywordPhraseAnchor: keywordPhrase.hasAnchor,
    hasKeywordTokenAnchor:
      baseThemeTokens.length > 0 &&
      candidateThemeTokens.length > 0 &&
      baseThemeTokens.some((baseToken) =>
        candidateThemeTokens.some((candidateToken) => tokenSimilarity(baseToken, candidateToken) >= 0.9),
      ),
    sameDirector,
    yearDiff,
    runtimeDiff,
  }
}

function computeThemeStrength(signals: ScoringSignals): number {
  const baseStrength =
    signals.keywordPhraseExactScore * 0.42 +
    signals.keywordPhraseSemanticScore * 0.23 +
    signals.keywordIdScore * 0.25 +
    signals.keywordTokenScore * 0.1 +
    signals.overviewScore * 0.12

  const anchorBoost = signals.hasKeywordPhraseAnchor ? 0.09 : signals.hasKeywordTokenAnchor ? 0.03 : 0
  return clamp(baseStrength + anchorBoost, 0, 1)
}

function buildReason(signals: ScoringSignals, themeStrength: number): string | null {
  const reasons: Array<{ label: string; contribution: number }> = []

  if (signals.keywordPhraseExactScore >= 0.1) {
    reasons.push({
      label: 'Exact thematic match',
      contribution: signals.keywordPhraseExactScore * SIGNAL_WEIGHTS.keyword + 0.08,
    })
  }

  if (
    themeStrength >= 0.18 ||
    signals.keywordPhraseSemanticScore >= 0.16 ||
    (themeStrength >= 0.1 && signals.keywordIdScore >= 0.28)
  ) {
    const contribution =
      signals.keywordScore * SIGNAL_WEIGHTS.keyword +
      signals.keywordPhraseSemanticScore * 0.1 +
      (signals.hasKeywordPhraseAnchor ? 0.04 : 0)
    reasons.push({ label: 'Shared themes', contribution })
  }

  if (signals.overviewScore >= 0.12) {
    reasons.push({
      label: 'Similar story',
      contribution: signals.overviewScore * SIGNAL_WEIGHTS.overview + 0.05,
    })
  }

  if (
    signals.sameDirector &&
    (signals.genreScore >= 0.24 ||
      themeStrength >= 0.1 ||
      signals.castScore >= 0.15 ||
      signals.soundtrackScore >= 0.2)
  ) {
    const contribution = SIGNAL_WEIGHTS.director + 0.12
    reasons.push({ label: 'Same director', contribution })
  }

  if (signals.genreScore >= 0.45) {
     reasons.push({ label: 'Strong genre overlap', contribution: signals.genreScore * SIGNAL_WEIGHTS.genre })
  } else if (signals.genreScore >= 0.22) {
    reasons.push({
      label: 'Genre overlap',
      contribution: signals.genreScore * SIGNAL_WEIGHTS.genre,
    })
  }

  if (signals.castScore >= 0.12) {
    reasons.push({
      label: 'Shared cast',
      contribution: signals.castScore * SIGNAL_WEIGHTS.cast,
    })
  }

  if (signals.soundtrackScore >= 0.2) {
    reasons.push({
      label: 'Similar soundtrack vibe',
      contribution: signals.soundtrackScore * SIGNAL_WEIGHTS.soundtrack,
    })
  }

  if (signals.yearDiff !== null && signals.yearScore >= 0.7) {
    reasons.push({
      label: 'Same era',
      contribution: signals.yearScore * SIGNAL_WEIGHTS.year,
    })
  }

  if (signals.runtimeDiff !== null && signals.runtimeScore >= 0.58) {
    reasons.push({
      label: 'Similar pacing',
      contribution: signals.runtimeScore * SIGNAL_WEIGHTS.runtime,
    })
  }

  reasons.sort((left, right) => right.contribution - left.contribution)

  if (reasons.length === 0) {
    return null
  }

  return reasons.slice(0, 2).map((reason) => reason.label).join(' + ')
}

function hasCoreAffinity(signals: ScoringSignals, themeStrength: number): boolean {
  return (
    themeStrength >= 0.05 ||
    signals.genreScore >= 0.22 ||
    signals.castScore >= 0.12 ||
    signals.soundtrackScore >= 0.2 ||
    signals.overviewScore >= 0.12
  )
}

function hasSpecificReason(reason: string): boolean {
  return reason
    .split(' + ')
    .some((label) => label !== 'Same era' && label !== 'Similar pacing')
}

function hasBeyondGenreReason(reason: string): boolean {
  return reason
    .split(' + ')
    .some(
      (label) =>
        label !== 'Same era' &&
        label !== 'Similar pacing' &&
        label !== 'Genre overlap' &&
        label !== 'Strong genre overlap',
    )
}

function calibrateToMatchScore(rawScore: number): number {
  const logistic = 1 / (1 + Math.exp(-(rawScore - 0.36) / 0.14))
  const calibrated = clamp(22 + logistic * 74, 0, 99.4)
  return roundToSingleDecimal(calibrated)
}

function computeSourceBoost(source: RecommendationSource, mode: ScoringMode, sameDirector: boolean): number {
  const similarBoost = mode === 'strict' ? 0.06 : mode === 'relaxed' ? 0.045 : 0.035
  const recommendedBoost = mode === 'strict' ? 0.05 : mode === 'relaxed' ? 0.04 : 0.03
  const discoveryBoost = mode === 'strict' ? 0.035 : mode === 'relaxed' ? 0.025 : 0.015
  const semanticBoost = mode === 'strict' ? 0.22 : mode === 'relaxed' ? 0.19 : 0.16

  let boost = 0
  if (source.fromSimilar) {
    boost += similarBoost * sourceRankWeight(source.similarRank)
  }
  if (source.fromRecommended) {
    boost += recommendedBoost * sourceRankWeight(source.recommendedRank)
  }
  if (source.fromDiscovery) {
    const fusionWeight = clamp(0.8 + 0.12 * (source.discoveryHits ?? 1), 0.8, 1.4)
    boost += discoveryBoost * sourceRankWeight(source.discoveryRank) * fusionWeight
  }
  if (source.fromTagGenome) {
    boost += semanticBoost * sourceRankWeight(source.tagGenomeRank)
  }
  if (source.fromSimilar && source.fromRecommended) {
    boost += 0.015
  }
  if (source.fromDirectorFilmography && sameDirector && !source.fromSimilar && !source.fromRecommended) {
    boost += mode === 'strict' ? 0.005 : 0
  }
  if (source.fromDirectorFilmography && sameDirector) {
    boost += mode === 'strict' ? 0.025 : mode === 'relaxed' ? 0.015 : 0.01
  }

  return Math.min(boost, 0.26)
}

function sourceRankWeight(rank: number | null | undefined): number {
  if (rank === null || rank === undefined) return 1
  return clamp(1.1 - (Math.max(1, rank) - 1) / 80, 0.6, 1.1)
}

function scoreCandidateDetailed(
  base: ScoreFeatures,
  candidate: ScoreFeatures,
  source: RecommendationSource,
  mode: ScoringMode,
): DetailedScoringResult | null {
  const signals = scoreSignals(base, candidate)
  const baseIsDocumentary = base.genreIds.includes(99)
  const candidateIsDocumentary = candidate.genreIds.includes(99)
  if (baseIsDocumentary !== candidateIsDocumentary) {
    return null
  }
  const themeStrength = computeThemeStrength(signals)
  const isSeededByTmdb = source.fromSimilar || source.fromRecommended
  const isPureDirectorFilmography = source.fromDirectorFilmography && !isSeededByTmdb

  if (!signals.sameDirector) {
    const robustThemeEvidence =
      signals.keywordIdScore * 0.35 +
      signals.keywordPhraseExactScore * 0.25 +
      signals.keywordPhraseSemanticScore * 0.2 +
      signals.keywordTokenScore * 0.2

    const minimumThemeStrength =
      mode === 'strict'
        ? isSeededByTmdb
          ? 0.09
          : 0.1
        : mode === 'relaxed'
          ? isSeededByTmdb
            ? 0.06
            : 0.08
          : 0.04

    if (themeStrength < minimumThemeStrength && signals.castScore < 0.12) {
      return null
    }

    const genreOnlyThemeFloor = mode === 'strict' ? 0.085 : mode === 'relaxed' ? 0.065 : 0.05
    if (signals.genreScore >= 0.18 && themeStrength < genreOnlyThemeFloor && signals.castScore < 0.18) {
      return null
    }

    const minimumRobustThemeEvidence =
      mode === 'strict' ? 0.055 : mode === 'relaxed' ? 0.035 : 0.02
    if (signals.genreScore >= 0.16 && robustThemeEvidence < minimumRobustThemeEvidence && signals.castScore < 0.18) {
      return null
    }
  }

  if (mode !== 'fallback') {
    const weakGenreThreshold =
      mode === 'strict'
        ? isSeededByTmdb
          ? 0.02
          : 0.08
        : isSeededByTmdb
          ? 0
          : 0.03

    const weakCastThreshold =
      mode === 'strict'
        ? isSeededByTmdb
          ? 0.05
          : 0.16
        : isSeededByTmdb
          ? 0.02
          : 0.08

    const weakThemeThreshold =
      mode === 'strict'
        ? isSeededByTmdb
          ? 0.07
          : 0.14
        : isSeededByTmdb
          ? 0.03
          : 0.07

    const weakPhraseThreshold =
      mode === 'strict'
        ? isSeededByTmdb
          ? 0.06
          : 0.1
        : isSeededByTmdb
          ? 0.02
          : 0.06

    if (
      !signals.sameDirector &&
      signals.genreScore < weakGenreThreshold &&
      signals.keywordScore < weakThemeThreshold &&
      signals.keywordPhraseSemanticScore < weakPhraseThreshold &&
      signals.overviewScore < 0.08 &&
      signals.castScore < weakCastThreshold
    ) {
      return null
    }
  }

  if (isPureDirectorFilmography && !signals.sameDirector) {
    return null
  }

  if (isPureDirectorFilmography && signals.genreScore < 0.12 && signals.keywordScore < 0.1) {
    return null
  }

  const minVoteCount =
    mode === 'strict'
      ? isSeededByTmdb
        ? 8
        : 25
      : mode === 'relaxed'
        ? isSeededByTmdb
          ? 0
          : 6
        : 0

  if (!signals.sameDirector && candidate.voteCount < minVoteCount) {
    return null
  }

  let rawScore =
    signals.genreScore * SIGNAL_WEIGHTS.genre +
    signals.keywordScore * SIGNAL_WEIGHTS.keyword +
    signals.overviewScore * SIGNAL_WEIGHTS.overview +
    signals.castScore * SIGNAL_WEIGHTS.cast +
    signals.soundtrackScore * SIGNAL_WEIGHTS.soundtrack +
    (signals.sameDirector ? 1 : 0) * SIGNAL_WEIGHTS.director +
    signals.yearScore * SIGNAL_WEIGHTS.year +
    signals.runtimeScore * SIGNAL_WEIGHTS.runtime +
    signals.ratingScore * SIGNAL_WEIGHTS.rating +
    signals.confidenceScore * SIGNAL_WEIGHTS.confidence

  rawScore += computeSourceBoost(source, mode, signals.sameDirector)

  if (signals.keywordPhraseExactScore >= 0.05) {
    rawScore += 0.06
  }
  if (signals.keywordPhraseExactScore >= 0.16) {
    rawScore += 0.09
  }
  if (signals.keywordPhraseSemanticScore >= 0.14) {
    rawScore += 0.05
  }
  if (signals.keywordPhraseSemanticScore >= 0.28) {
    rawScore += 0.06
  }
  if (signals.keywordTokenScore >= 0.16) {
    rawScore += 0.02
  }
  if (signals.keywordTokenScore >= 0.3) {
    rawScore += 0.03
  }
  if (signals.hasKeywordPhraseAnchor) {
    rawScore += 0.03
  } else if (signals.hasKeywordTokenAnchor) {
    rawScore += 0.015
  }

  if (signals.sameDirector && signals.genreScore >= 0.16) {
    rawScore += 0.02
  }
  if (signals.keywordScore >= 0.32) {
    rawScore += 0.04
  }
  if (signals.keywordScore >= 0.22 && signals.castScore >= 0.12) {
    rawScore += 0.02
  }
  if (!signals.sameDirector && themeStrength >= 0.16 && signals.genreScore >= 0.08) {
    rawScore += 0.025
  }
  if (!signals.sameDirector && themeStrength >= 0.24) {
    rawScore += 0.03
  }
  if (!signals.sameDirector && signals.genreScore === 0 && signals.keywordScore < 0.06) {
    rawScore -= mode === 'strict' ? 0.08 : mode === 'relaxed' ? 0.04 : 0
  }
  if (!signals.sameDirector && signals.keywordScore < 0.07 && signals.genreScore >= 0.2) {
    rawScore -= mode === 'strict' ? 0.13 : mode === 'relaxed' ? 0.08 : 0.03
  }
  if (
    !signals.sameDirector &&
    signals.keywordPhraseExactScore === 0 &&
    signals.keywordPhraseSemanticScore < 0.05 &&
    signals.genreScore >= 0.28
  ) {
    rawScore -= mode === 'strict' ? 0.08 : mode === 'relaxed' ? 0.05 : 0.02
  }
  if (!signals.sameDirector && signals.keywordScore < 0.03 && signals.genreScore < 0.08) {
    rawScore -= mode === 'strict' ? 0.08 : 0.04
  }
  if (signals.yearDiff !== null && signals.yearDiff > 28) {
    rawScore -= 0.03
  }

  const genreDominancePenalty =
    !signals.sameDirector && signals.genreScore >= 0.14
      ? mode === 'strict'
        ? themeStrength < 0.085 ? 0.17 : 0
        : mode === 'relaxed'
          ? themeStrength < 0.065 ? 0.11 : 0
          : 0
      : 0

  rawScore -= genreDominancePenalty

  rawScore = clamp(rawScore, 0, 1)

  const rawMin = mode === 'strict' ? RAW_MIN_STRICT : mode === 'relaxed' ? RAW_MIN_RELAXED : RAW_MIN_FALLBACK
  if (rawScore < rawMin) {
    return null
  }

  let score = calibrateToMatchScore(rawScore)
  const threshold = signals.sameDirector
    ? mode === 'strict'
      ? MIN_SCORE_STRICT_SAME_DIRECTOR
      : mode === 'relaxed'
        ? MIN_SCORE_RELAXED_SAME_DIRECTOR
        : MIN_SCORE_FALLBACK_SAME_DIRECTOR
    : mode === 'strict'
      ? MIN_SCORE_STRICT_GENERAL
      : mode === 'relaxed'
        ? MIN_SCORE_RELAXED_GENERAL
        : MIN_SCORE_FALLBACK_GENERAL

  if (score < threshold) {
    return null
  }

  const reason = buildReason(signals, themeStrength)
  if (!reason || !hasCoreAffinity(signals, themeStrength) || !hasSpecificReason(reason)) {
    return null
  }

  const hasSpecificSignal =
    signals.sameDirector || themeStrength >= 0.05 || signals.castScore >= 0.12 || signals.soundtrackScore >= 0.2
  if ((!hasSpecificSignal && candidate.voteCount < 100) || (!hasBeyondGenreReason(reason) && candidate.voteCount < 300)) {
    return null
  }
  if (!hasBeyondGenreReason(reason)) {
    score = Math.min(score, 44)
  }

  return {
    score,
    reason,
    themeStrength,
    genreDominancePenalty,
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

function collectScoredCandidates(
  base: ScoreFeatures,
  candidates: RankingCandidate[],
  mode: ScoringMode,
): InternalRankedCandidate[] {
  const relevanceBoost = mode === 'strict' ? 0.03 : mode === 'relaxed' ? 0.015 : 0

  const scored = candidates
    .map((candidate) => {
      const scoredCandidate = scoreCandidateDetailed(base, candidate.features, candidate.source, mode)
      if (!scoredCandidate) {
        return null
      }

      return {
        ...candidate,
        similarity_score: scoredCandidate.score,
        match_reason: scoredCandidate.reason,
        theme_strength: scoredCandidate.themeStrength,
        relevance: clamp(
          scoredCandidate.score / 100 * 0.55 +
            scoredCandidate.themeStrength * 0.45 -
            scoredCandidate.genreDominancePenalty +
            relevanceBoost,
          0,
          1,
        ),
      }
    })
    .filter((candidate): candidate is InternalRankedCandidate => candidate !== null)

  scored.sort((left, right) => {
    if (right.relevance !== left.relevance) {
      return right.relevance - left.relevance
    }
    if (right.theme_strength !== left.theme_strength) {
      return right.theme_strength - left.theme_strength
    }
    if (right.similarity_score !== left.similarity_score) {
      return right.similarity_score - left.similarity_score
    }
    if (right.vote_average !== left.vote_average) {
      return right.vote_average - left.vote_average
    }
    return left.id - right.id
  })

  return scored
}

function rerankWithDiversity(scored: InternalRankedCandidate[]): InternalRankedCandidate[] {
  const remaining = [...scored]
  const selected: InternalRankedCandidate[] = []
  const directorCounts = new Map<number, number>()

  // The first screen should lead with the strongest evidence. Diversity is
  // valuable after that trust contract is established, not at its expense.
  while (remaining.length > 0 && selected.length < Math.min(3, MAX_RESULTS)) {
    const bestIndex = remaining.findIndex((candidate) =>
      candidate.director_id === null || (directorCounts.get(candidate.director_id) ?? 0) < MAX_PER_DIRECTOR,
    )
    if (bestIndex === -1) break
    const [picked] = remaining.splice(bestIndex, 1)
    if (picked.director_id !== null) {
      directorCounts.set(picked.director_id, (directorCounts.get(picked.director_id) ?? 0) + 1)
    }
    selected.push(picked)
  }

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

      const diversityPenalty = selected.length < MIN_RESULTS_TARGET ? 0.12 : 0.18
      const mmr = 0.88 * candidate.relevance - diversityPenalty * maxSimilarity

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

  return selected
}

export function scoreCandidate(base: ScoreFeatures, candidate: ScoreFeatures): ScoringResult | null {
  const strict = scoreCandidateDetailed(
    base,
    candidate,
    {
      fromSimilar: false,
      fromRecommended: false,
      fromDirectorFilmography: false,
    },
    'strict',
  )

  if (!strict) {
    return null
  }

  return {
    score: strict.score,
    reason: strict.reason,
  }
}

export function rankCandidates(base: ScoreFeatures, candidates: RankingCandidate[]): RankedMovie[] {
  const strictScored = collectScoredCandidates(base, candidates, 'strict')

  let candidatePool = strictScored

  if (candidatePool.length < MIN_RESULTS_TARGET) {
    const knownIds = new Set(candidatePool.map((movie) => movie.id))
    const relaxedScored = collectScoredCandidates(base, candidates, 'relaxed').filter(
      (movie) => !knownIds.has(movie.id),
    )
    candidatePool = [...candidatePool, ...relaxedScored]
  }

  const thematicFloor = 0.05
  const sameDirectorId = base.directorId
  const thematicCandidates = candidatePool.filter(
    (movie) =>
      movie.theme_strength >= thematicFloor ||
      (sameDirectorId !== null && movie.director_id !== null && movie.director_id === sameDirectorId),
  )

  // A short trustworthy list is preferable to padding the result set with
  // genre-only titles that do not have meaningful thematic or authorship evidence.
  candidatePool = thematicCandidates

  const selected = rerankWithDiversity(candidatePool)
    .filter((movie) => movie.similarity_score >= 45)

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
