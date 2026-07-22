import fs from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve('.cache/movielens/ml-latest-small')
const cacheDir = path.resolve('.cache/themeflick-benchmark/v4')
const tagIds = JSON.parse(fs.readFileSync(path.join(cacheDir, 'tag-genome-movie-ids.json'), 'utf8')) as number[]
const bytes = fs.readFileSync(path.join(cacheDir, 'tag-genome-vectors.f32'))
const vectors = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const tagCount = vectors.length / tagIds.length
const signatureSize = 128
if (!Number.isInteger(tagCount)) throw new Error('Invalid Tag Genome vector cache')

const links = new Map<number, number>()
for (const line of fs.readFileSync(path.join(dataDir, 'links.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const [movieText, , tmdbText] = line.split(',')
  const movieId = Number(movieText)
  const tmdbId = Number(tmdbText)
  if (Number.isFinite(movieId) && Number.isFinite(tmdbId)) links.set(movieId, tmdbId)
}

const movies: Array<[number, number[]]> = []
for (let movieIndex = 0; movieIndex < tagIds.length; movieIndex += 1) {
  const tmdbId = links.get(tagIds[movieIndex])
  if (!tmdbId) continue
  const top: Array<{ tag: number; value: number }> = []
  const offset = movieIndex * tagCount
  for (let tag = 0; tag < tagCount; tag += 1) {
    const value = vectors[offset + tag]
    if (top.length < signatureSize) {
      top.push({ tag, value })
      if (top.length === signatureSize) top.sort((a, b) => a.value - b.value)
    } else if (value > top[0].value) {
      top[0] = { tag, value }
      top.sort((a, b) => a.value - b.value)
    }
  }
  const signature = top.sort((a, b) => b.value - a.value).flatMap(({ tag, value }) => [tag, Math.round(value * 255)])
  movies.push([tmdbId, signature])
}

// Research/evaluation artifact only. The GroupLens 2014 license does not
// permit redistribution without separate permission, so never emit this into
// public/ or commit it as a web asset.
const output = path.join(cacheDir, 'tag-signatures.json')
fs.writeFileSync(output, JSON.stringify({ version: 1, tagCount, signatureSize, movies }))
console.log(`wrote ${movies.length} semantic signatures to ${output}`)
