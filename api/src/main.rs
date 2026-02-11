use std::env;
use std::net::SocketAddr;
use std::sync::Arc;

use api::{build_router, tmdb::TmdbProvider};
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "themeflick_api=info,tower_http=info".into()),
        )
        .init();

    let bind_addr = env::var("API_BIND").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    let cors_origin =
        env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let tmdb_base_url =
        env::var("TMDB_BASE_URL").unwrap_or_else(|_| "https://api.themoviedb.org/3".to_string());
    let tmdb_access_token = env::var("TMDB_ACCESS_TOKEN").ok();
    let tmdb_api_key = env::var("TMDB_API_KEY").ok();

    let provider = Arc::new(TmdbProvider::new(
        tmdb_base_url,
        tmdb_access_token,
        tmdb_api_key,
    ));

    let app = build_router(provider, &cors_origin);
    let addr: SocketAddr = bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;

    info!("themeflick-api listening on http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
