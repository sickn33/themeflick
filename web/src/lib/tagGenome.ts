export type TagSignatureIndex = {
  version: number
  tagCount: number
  signatureSize: number
  movies: Array<[number, number[]]>
}

function signatureMap(values: number[]): Map<number, number> {
  const result = new Map<number, number>()
  for (let index = 0; index < values.length; index += 2) {
    result.set(values[index], values[index + 1] / 255)
  }
  return result
}

export function findTagGenomeNeighbors(
  index: TagSignatureIndex,
  baseTmdbId: number,
  limit = 40,
): number[] {
  const baseEntry = index.movies.find(([tmdbId]) => tmdbId === baseTmdbId)
  if (!baseEntry) return []
  const base = signatureMap(baseEntry[1])
  const baseNorm = Math.sqrt([...base.values()].reduce((sum, value) => sum + value * value, 0))
  if (!baseNorm) return []

  return index.movies
    .flatMap(([tmdbId, packed]) => {
      if (tmdbId === baseTmdbId) return []
      let dot = 0
      let normSquared = 0
      for (let position = 0; position < packed.length; position += 2) {
        const value = packed[position + 1] / 255
        normSquared += value * value
        dot += (base.get(packed[position]) ?? 0) * value
      }
      const score = normSquared > 0 ? dot / (baseNorm * Math.sqrt(normSquared)) : 0
      return [{ tmdbId, score }]
    })
    .sort((left, right) => right.score - left.score || left.tmdbId - right.tmdbId)
    .slice(0, limit)
    .map((item) => item.tmdbId)
}
