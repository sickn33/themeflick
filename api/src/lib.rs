use std::cmp::Ordering;
use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

pub mod tmdb;

pub type DynMovieProvider = Arc<dyn MovieProvider>;

#[derive(Clone)]
pub struct AppState {
    pub provider: DynMovieProvider,
}

pub fn build_router(provider: DynMovieProvider, cors_origin: &str) -> Router {
    let cors = match cors_origin.parse::<HeaderValue>() {
        Ok(origin) => CorsLayer::new()
            .allow_origin(origin)
            .allow_methods([Method::GET])
            .allow_headers(Any),
        Err(_) => CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET])
            .allow_headers(Any),
    };

    Router::new()
        .route("/api/health", get(health))
        .route("/api/movies/search", get(search_movies))
        .route("/api/movies/{id}", get(movie_details))
        .route(
            "/api/movies/{id}/recommendations",
            get(movie_recommendations),
        )
        .with_state(AppState { provider })
        .layer(cors)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMovie {
    pub id: u64,
    pub title: String,
    pub release_date: Option<String>,
    pub poster_path: Option<String>,
    pub vote_average: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Genre {
    pub id: u64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastMember {
    pub id: u64,
    pub name: String,
    pub character: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovieDetails {
    pub id: u64,
    pub title: String,
    pub overview: Option<String>,
    pub release_date: Option<String>,
    pub runtime: Option<u32>,
    pub genres: Vec<Genre>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub vote_average: f64,
    pub director: Option<String>,
    pub cast: Vec<CastMember>,
    pub director_id: Option<u64>,
    pub cast_ids: Vec<u64>,
    pub genre_ids: Vec<u64>,
}

#[async_trait]
pub trait MovieProvider: Send + Sync {
    async fn search_movies(&self, query: &str) -> Result<Vec<SearchMovie>, AppError>;
    async fn movie_details(&self, movie_id: u64) -> Result<MovieDetails, AppError>;
    async fn similar_movies(&self, movie_id: u64) -> Result<Vec<SearchMovie>, AppError>;
    async fn recommended_movies(&self, movie_id: u64) -> Result<Vec<SearchMovie>, AppError>;
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{code}: {message}")]
    BadRequest { code: String, message: String },
    #[error("{code}: {message}")]
    NotFound { code: String, message: String },
    #[error("{code}: {message}")]
    Unauthorized { code: String, message: String },
    #[error("{code}: {message}")]
    Upstream { code: String, message: String },
    #[error("{code}: {message}")]
    Internal { code: String, message: String },
}

impl AppError {
    pub fn bad_request(code: &str, message: &str) -> Self {
        Self::BadRequest {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn not_found(code: &str, message: &str) -> Self {
        Self::NotFound {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn unauthorized(code: &str, message: &str) -> Self {
        Self::Unauthorized {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn upstream(code: &str, message: &str) -> Self {
        Self::Upstream {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    pub fn internal(code: &str, message: &str) -> Self {
        Self::Internal {
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: String,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            AppError::BadRequest { code, message } => (StatusCode::BAD_REQUEST, code, message),
            AppError::NotFound { code, message } => (StatusCode::NOT_FOUND, code, message),
            AppError::Unauthorized { code, message } => (StatusCode::UNAUTHORIZED, code, message),
            AppError::Upstream { code, message } => (StatusCode::BAD_GATEWAY, code, message),
            AppError::Internal { code, message } => {
                (StatusCode::INTERNAL_SERVER_ERROR, code, message)
            }
        };

        let body = Json(ErrorEnvelope {
            error: ErrorBody { code, message },
        });

        (status, body).into_response()
    }
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "themeflick-api",
    })
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    query: Option<String>,
}

#[derive(Debug, Serialize)]
struct SearchResponse {
    results: Vec<SearchMovie>,
}

async fn search_movies(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, AppError> {
    let title = query
        .query
        .as_deref()
        .map(str::trim)
        .filter(|it| !it.is_empty())
        .ok_or_else(|| AppError::bad_request("INVALID_QUERY", "Query parameter is required"))?;

    let results = state.provider.search_movies(title).await?;
    Ok(Json(SearchResponse { results }))
}

#[derive(Debug, Serialize)]
struct MovieDetailsResponse {
    id: u64,
    title: String,
    overview: String,
    release_date: Option<String>,
    runtime: Option<u32>,
    genres: Vec<Genre>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    vote_average: f64,
    director: String,
    cast: Vec<MovieDetailsCastResponse>,
}

#[derive(Debug, Serialize)]
struct MovieDetailsCastResponse {
    id: u64,
    name: String,
    character: String,
}

async fn movie_details(
    State(state): State<AppState>,
    Path(movie_id): Path<u64>,
) -> Result<Json<MovieDetailsResponse>, AppError> {
    let details = state.provider.movie_details(movie_id).await?;

    Ok(Json(MovieDetailsResponse {
        id: details.id,
        title: details.title,
        overview: details.overview.unwrap_or_default(),
        release_date: details.release_date,
        runtime: details.runtime,
        genres: details.genres,
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path,
        vote_average: details.vote_average,
        director: details.director.unwrap_or_else(|| "Unknown".to_string()),
        cast: details
            .cast
            .into_iter()
            .map(|member| MovieDetailsCastResponse {
                id: member.id,
                name: member.name,
                character: member.character.unwrap_or_else(|| "Unknown".to_string()),
            })
            .collect(),
    }))
}

#[derive(Debug, Serialize)]
struct RecommendationsResponse {
    base_movie: RecommendationBaseMovie,
    results: Vec<RecommendationResult>,
}

#[derive(Debug, Serialize)]
struct RecommendationBaseMovie {
    id: u64,
    title: String,
}

#[derive(Debug, Serialize)]
struct RecommendationResult {
    id: u64,
    title: String,
    poster_path: Option<String>,
    release_date: Option<String>,
    vote_average: f64,
    similarity_score: f64,
}

async fn movie_recommendations(
    State(state): State<AppState>,
    Path(movie_id): Path<u64>,
) -> Result<Json<RecommendationsResponse>, AppError> {
    let base = state.provider.movie_details(movie_id).await?;

    let similar = state.provider.similar_movies(movie_id).await?;
    let recommended = state.provider.recommended_movies(movie_id).await?;
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    for movie in similar.into_iter().chain(recommended.into_iter()) {
        if movie.id == movie_id {
            continue;
        }
        if seen.insert(movie.id) {
            candidates.push(movie);
        }
    }

    let mut futures = FuturesUnordered::new();
    for candidate in candidates.into_iter().take(40) {
        let provider = state.provider.clone();
        futures.push(async move { provider.movie_details(candidate.id).await });
    }

    let mut results = Vec::new();
    while let Some(candidate) = futures.next().await {
        match candidate {
            Ok(details) => {
                let similarity_score = similarity_score(&base, &details);
                results.push(RecommendationResult {
                    id: details.id,
                    title: details.title,
                    poster_path: details.poster_path,
                    release_date: details.release_date,
                    vote_average: details.vote_average,
                    similarity_score,
                });
            }
            Err(AppError::NotFound { .. }) => {}
            Err(err) => return Err(err),
        }
    }

    results.sort_by(|a, b| {
        b.similarity_score
            .partial_cmp(&a.similarity_score)
            .unwrap_or(Ordering::Equal)
    });
    results.truncate(20);

    Ok(Json(RecommendationsResponse {
        base_movie: RecommendationBaseMovie {
            id: base.id,
            title: base.title,
        },
        results,
    }))
}

fn similarity_score(base: &MovieDetails, candidate: &MovieDetails) -> f64 {
    let base_genres: HashSet<u64> = base.genre_ids.iter().copied().collect();
    let cand_genres: HashSet<u64> = candidate.genre_ids.iter().copied().collect();
    let base_cast: HashSet<u64> = base.cast_ids.iter().copied().collect();
    let cand_cast: HashSet<u64> = candidate.cast_ids.iter().copied().collect();

    let genre_score = if base_genres.is_empty() || cand_genres.is_empty() {
        0.0
    } else {
        let shared = base_genres.intersection(&cand_genres).count() as f64;
        let union = base_genres.union(&cand_genres).count() as f64;
        if union == 0.0 { 0.0 } else { shared / union }
    };

    let director_score = match (base.director_id, candidate.director_id) {
        (Some(base_id), Some(candidate_id)) if base_id == candidate_id => 1.0,
        _ => 0.0,
    };

    let cast_score = if base_cast.is_empty() || cand_cast.is_empty() {
        0.0
    } else {
        let shared = base_cast.intersection(&cand_cast).count() as f64;
        (shared / 5.0).min(1.0)
    };

    let rating_score = {
        let diff = (base.vote_average - candidate.vote_average).abs();
        (1.0 - (diff / 5.0)).clamp(0.0, 1.0)
    };

    let total = genre_score * 0.45 + director_score * 0.2 + cast_score * 0.2 + rating_score * 0.15;
    (total * 1000.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use axum::http::Request;
    use tower::ServiceExt;

    #[derive(Default)]
    struct MockProvider {
        search: Vec<SearchMovie>,
        details: std::collections::HashMap<u64, MovieDetails>,
        similar: std::collections::HashMap<u64, Vec<SearchMovie>>,
        recommended: std::collections::HashMap<u64, Vec<SearchMovie>>,
    }

    #[async_trait]
    impl MovieProvider for MockProvider {
        async fn search_movies(&self, _query: &str) -> Result<Vec<SearchMovie>, AppError> {
            Ok(self.search.clone())
        }

        async fn movie_details(&self, movie_id: u64) -> Result<MovieDetails, AppError> {
            self.details
                .get(&movie_id)
                .cloned()
                .ok_or_else(|| AppError::not_found("MOVIE_NOT_FOUND", "Movie not found"))
        }

        async fn similar_movies(&self, movie_id: u64) -> Result<Vec<SearchMovie>, AppError> {
            Ok(self.similar.get(&movie_id).cloned().unwrap_or_default())
        }

        async fn recommended_movies(&self, movie_id: u64) -> Result<Vec<SearchMovie>, AppError> {
            Ok(self.recommended.get(&movie_id).cloned().unwrap_or_default())
        }
    }

    fn make_movie(id: u64, title: &str, genres: &[u64], director_id: Option<u64>) -> MovieDetails {
        MovieDetails {
            id,
            title: title.to_string(),
            overview: Some("Overview".to_string()),
            release_date: Some("2010-07-15".to_string()),
            runtime: Some(120),
            genres: genres
                .iter()
                .map(|genre_id| Genre {
                    id: *genre_id,
                    name: format!("Genre-{genre_id}"),
                })
                .collect(),
            poster_path: Some("/poster.jpg".to_string()),
            backdrop_path: Some("/backdrop.jpg".to_string()),
            vote_average: 8.0,
            director: Some("Director".to_string()),
            cast: vec![CastMember {
                id: 1,
                name: "Actor".to_string(),
                character: Some("Role".to_string()),
            }],
            director_id,
            cast_ids: vec![1, 2, 3],
            genre_ids: genres.to_vec(),
        }
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let app = build_router(Arc::new(MockProvider::default()), "http://localhost:5173");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["service"], "themeflick-api");
    }

    #[tokio::test]
    async fn search_endpoint_requires_query() {
        let app = build_router(Arc::new(MockProvider::default()), "http://localhost:5173");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/movies/search")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"]["code"], "INVALID_QUERY");
    }

    #[tokio::test]
    async fn search_endpoint_returns_results() {
        let provider = MockProvider {
            search: vec![SearchMovie {
                id: 27205,
                title: "Inception".to_string(),
                release_date: Some("2010-07-15".to_string()),
                poster_path: Some("/poster.jpg".to_string()),
                vote_average: 8.4,
            }],
            ..MockProvider::default()
        };
        let app = build_router(Arc::new(provider), "http://localhost:5173");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/movies/search?query=inception")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["results"][0]["title"], "Inception");
    }

    #[tokio::test]
    async fn movie_details_returns_not_found() {
        let app = build_router(Arc::new(MockProvider::default()), "http://localhost:5173");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/movies/999999")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"]["code"], "MOVIE_NOT_FOUND");
    }

    #[tokio::test]
    async fn recommendations_endpoint_returns_scored_results() {
        let base_movie_id = 1;
        let candidate_high_id = 2;
        let candidate_low_id = 3;

        let mut details = std::collections::HashMap::new();
        details.insert(
            base_movie_id,
            make_movie(base_movie_id, "Base", &[28, 878], Some(99)),
        );
        details.insert(
            candidate_high_id,
            make_movie(candidate_high_id, "High", &[28, 878], Some(99)),
        );
        details.insert(
            candidate_low_id,
            make_movie(candidate_low_id, "Low", &[35], Some(12)),
        );

        let provider = MockProvider {
            details,
            similar: std::collections::HashMap::from([(
                base_movie_id,
                vec![
                    SearchMovie {
                        id: candidate_high_id,
                        title: "High".to_string(),
                        release_date: Some("2014-11-05".to_string()),
                        poster_path: Some("/high.jpg".to_string()),
                        vote_average: 8.3,
                    },
                    SearchMovie {
                        id: candidate_low_id,
                        title: "Low".to_string(),
                        release_date: Some("2000-01-01".to_string()),
                        poster_path: Some("/low.jpg".to_string()),
                        vote_average: 6.0,
                    },
                ],
            )]),
            ..MockProvider::default()
        };

        let app = build_router(Arc::new(provider), "http://localhost:5173");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/movies/1/recommendations")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["base_movie"]["title"], "Base");
        assert_eq!(json["results"][0]["title"], "High");
        assert!(json["results"][0]["similarity_score"].as_f64().unwrap() > 0.0);
    }
}
