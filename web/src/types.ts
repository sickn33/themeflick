export type SearchMovie = {
  id: number
  title: string
  release_date: string | null
  poster_path: string | null
  vote_average: number
}

export type Genre = {
  id: number
  name: string
}

export type CastMember = {
  id: number
  name: string
  character: string
}

export type MovieDetails = {
  id: number
  title: string
  overview: string
  release_date: string | null
  runtime: number | null
  genres: Genre[]
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  director: string
  cast: CastMember[]
}

export type RecommendationMovie = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
  similarity_score: number
  match_reason: string
}

export type RecommendationResponse = {
  base_movie: {
    id: number
    title: string
  }
  results: RecommendationMovie[]
}

export type FavoriteMovie = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  vote_average: number
}
