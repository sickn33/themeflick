use async_trait::async_trait;
use reqwest::StatusCode;
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::{AppError, CastMember, Genre, MovieDetails, MovieProvider, SearchMovie};

#[derive(Clone)]
pub struct TmdbProvider {
    client: reqwest::Client,
    base_url: String,
    access_token: Option<String>,
    api_key: Option<String>,
}

impl TmdbProvider {
    pub fn new(base_url: String, access_token: Option<String>, api_key: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
            access_token,
            api_key,
        }
    }

    fn ensure_auth_configured(&self) -> Result<(), AppError> {
        if self.access_token.is_none() && self.api_key.is_none() {
            return Err(AppError::unauthorized(
                "TMDB_AUTH_MISSING",
                "TMDB credentials are missing",
            ));
        }
        Ok(())
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        let mut req = self.client.get(url).header("accept", "application/json");
        if let Some(token) = &self.access_token {
            req = req.bearer_auth(token);
        }
        if self.access_token.is_none() {
            if let Some(api_key) = &self.api_key {
                req = req.query(&[("api_key", api_key)]);
            }
        }
        req
    }

    async fn send_json<T: DeserializeOwned>(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<T, AppError> {
        let response = req.send().await.map_err(|_| {
            AppError::upstream("TMDB_REQUEST_FAILED", "Failed to send request to TMDB")
        })?;

        match response.status() {
            StatusCode::OK => response.json::<T>().await.map_err(|_| {
                AppError::upstream("TMDB_DECODE_FAILED", "Failed to decode TMDB response")
            }),
            StatusCode::NOT_FOUND => Err(AppError::not_found("MOVIE_NOT_FOUND", "Movie not found")),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(AppError::unauthorized(
                "TMDB_UNAUTHORIZED",
                "TMDB credentials are invalid",
            )),
            _ => Err(AppError::upstream(
                "TMDB_UPSTREAM_ERROR",
                "TMDB returned a non-success response",
            )),
        }
    }
}

#[async_trait]
impl MovieProvider for TmdbProvider {
    async fn search_movies(&self, query: &str) -> Result<Vec<SearchMovie>, AppError> {
        self.ensure_auth_configured()?;
        let response = self
            .send_json::<TmdbListResponse>(self.get("/search/movie").query(&[
                ("query", query),
                ("include_adult", "false"),
                ("language", "en-US"),
            ]))
            .await?;

        Ok(response
            .results
            .into_iter()
            .map(|item| SearchMovie {
                id: item.id,
                title: item.title,
                release_date: item.release_date,
                poster_path: item.poster_path,
                vote_average: item.vote_average.unwrap_or_default(),
            })
            .collect())
    }

    async fn movie_details(&self, movie_id: u64) -> Result<MovieDetails, AppError> {
        self.ensure_auth_configured()?;
        let response = self
            .send_json::<TmdbMovieDetails>(self.get(&format!("/movie/{movie_id}")).query(&[
                ("append_to_response", "credits,keywords"),
                ("language", "en-US"),
            ]))
            .await?;

        let director = response
            .credits
            .as_ref()
            .and_then(|credits| credits.crew.as_ref())
            .and_then(|crew| {
                crew.iter()
                    .find(|member| member.job.as_deref() == Some("Director"))
            });

        let cast = response
            .credits
            .as_ref()
            .and_then(|credits| credits.cast.clone())
            .unwrap_or_default()
            .into_iter()
            .take(10)
            .map(|member| CastMember {
                id: member.id,
                name: member.name,
                character: member.character,
            })
            .collect::<Vec<_>>();

        let cast_ids = response
            .credits
            .as_ref()
            .and_then(|credits| credits.cast.clone())
            .unwrap_or_default()
            .into_iter()
            .take(5)
            .map(|member| member.id)
            .collect::<Vec<_>>();

        let genres = response.genres.unwrap_or_default();
        let genre_ids = genres.iter().map(|genre| genre.id).collect::<Vec<_>>();

        Ok(MovieDetails {
            id: response.id,
            title: response.title,
            overview: response.overview,
            release_date: response.release_date,
            runtime: response.runtime,
            genres,
            poster_path: response.poster_path,
            backdrop_path: response.backdrop_path,
            vote_average: response.vote_average.unwrap_or_default(),
            director: director.map(|member| member.name.clone()),
            cast,
            director_id: director.map(|member| member.id),
            cast_ids,
            genre_ids,
        })
    }

    async fn similar_movies(&self, movie_id: u64) -> Result<Vec<SearchMovie>, AppError> {
        self.ensure_auth_configured()?;
        let response = self
            .send_json::<TmdbListResponse>(
                self.get(&format!("/movie/{movie_id}/similar"))
                    .query(&[("language", "en-US"), ("page", "1")]),
            )
            .await?;
        Ok(response
            .results
            .into_iter()
            .map(|item| SearchMovie {
                id: item.id,
                title: item.title,
                release_date: item.release_date,
                poster_path: item.poster_path,
                vote_average: item.vote_average.unwrap_or_default(),
            })
            .collect())
    }

    async fn recommended_movies(&self, movie_id: u64) -> Result<Vec<SearchMovie>, AppError> {
        self.ensure_auth_configured()?;
        let response = self
            .send_json::<TmdbListResponse>(
                self.get(&format!("/movie/{movie_id}/recommendations"))
                    .query(&[("language", "en-US"), ("page", "1")]),
            )
            .await?;
        Ok(response
            .results
            .into_iter()
            .map(|item| SearchMovie {
                id: item.id,
                title: item.title,
                release_date: item.release_date,
                poster_path: item.poster_path,
                vote_average: item.vote_average.unwrap_or_default(),
            })
            .collect())
    }
}

#[derive(Debug, Deserialize)]
struct TmdbListResponse {
    results: Vec<TmdbListMovie>,
}

#[derive(Debug, Deserialize)]
struct TmdbListMovie {
    id: u64,
    title: String,
    release_date: Option<String>,
    poster_path: Option<String>,
    vote_average: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct TmdbMovieDetails {
    id: u64,
    title: String,
    overview: Option<String>,
    release_date: Option<String>,
    runtime: Option<u32>,
    genres: Option<Vec<Genre>>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    vote_average: Option<f64>,
    credits: Option<TmdbCredits>,
}

#[derive(Debug, Deserialize)]
struct TmdbCredits {
    cast: Option<Vec<TmdbCast>>,
    crew: Option<Vec<TmdbCrew>>,
}

#[derive(Debug, Deserialize, Clone)]
struct TmdbCast {
    id: u64,
    name: String,
    character: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TmdbCrew {
    id: u64,
    name: String,
    job: Option<String>,
}
