import { describe, expect, it } from 'vitest'
import { findTagGenomeNeighbors, type TagSignatureIndex } from './tagGenome'

const index: TagSignatureIndex = {
  version: 1,
  tagCount: 3,
  signatureSize: 2,
  movies: [
    [1, [0, 255, 1, 128]],
    [2, [0, 250, 1, 120]],
    [3, [2, 255]],
  ],
}

describe('findTagGenomeNeighbors', () => {
  it('ranks the closest semantic signature first', () => {
    expect(findTagGenomeNeighbors(index, 1, 2)).toEqual([2, 3])
  })

  it('returns no neighbors for a movie outside the index', () => {
    expect(findTagGenomeNeighbors(index, 99)).toEqual([])
  })
})
