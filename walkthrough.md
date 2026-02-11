# Themeflick Walkthrough

## Stack
- Frontend: Vite + React + TypeScript (`/web`)
- Backend: Rust + Axum (`/api`)
- Data source: TMDB API

## Prerequisites
- Node.js 20+
- npm 10+
- Rust stable (rustup)

## Quick Start
1. Configure backend env:
```bash
cp api/.env.example api/.env
```
2. Add TMDB credential in `api/.env` (`TMDB_ACCESS_TOKEN` recommended).
3. Install frontend dependencies:
```bash
cd web && npm install
```
4. Run both services:
```bash
cd /Users/nicco/Projects/themeflick
./scripts/dev.sh
```

- Web app: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## API Contract (v1)
- `GET /api/health`
- `GET /api/movies/search?query=<title>`
- `GET /api/movies/:id`
- `GET /api/movies/:id/recommendations`

Errors use envelope:
```json
{ "error": { "code": "...", "message": "..." } }
```

## Verification
From project root:
```bash
./scripts/verify.sh
```
This runs:
- `cargo fmt -- --check`
- `cargo test`
- `npm run lint`
- `npm run build`

## Notes
- Favorites are stored in browser localStorage (`themeflick:favorites:v1`).
- In local development, Vite proxies `/api` to `http://localhost:3000`.
- For production frontend deployments, set `VITE_API_BASE_URL` in `web/.env`.
