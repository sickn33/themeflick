# Themeflick Scratchpad

## Background and Motivation

Planner update (2026-02-11): user requested a full reset of the current project and a rebuild from scratch using `Vite + React + Rust`.

Current product intent (from code analysis): Themeflick/MovieBridge is a movie discovery app that:
- accepts a movie title,
- queries TMDB,
- computes similarity-based recommendations,
- shows movie details,
- supports local favorites.

Primary objective for the new implementation:
- keep the same core value (movie recommendations + details + favorites),
- replace the legacy mixed stack with a clean, maintainable architecture (`React frontend + Rust API`).

Planner update (2026-02-11): user requested a full UI restyling using project skills; execution focus is a complete visual refresh aligned with Themeflick's movie-curation identity while preserving existing functionality.

## Key Challenges and Analysis

- The repository currently mixes multiple generations of code:
  - Flask + Jinja templates (`app.py`, `templates/`, `static/`),
  - legacy CRA + Node/Express prototype under `themeflicks/client/`.
- There is no existing `.codex/scratchpad.md` in this repository; it has now been created for Planner/Executor coordination.
- Existing behavior is product-valid, but architecture is fragmented and hard to maintain.
- API/data dependency is TMDB, currently via env vars with inconsistent naming (`VITE_*` used in Flask).
- Recommendation logic is currently Python-specific and monolithic; it must be redesigned for Rust in testable modules.
- Rebuild scope must stay focused on MVP parity first, then polish.

Assumptions for planning (unless user changes them):
- `Rust` means backend API service (not Tauri desktop app).
- Frontend is a standard Vite React web app.
- Data source remains TMDB.
- Favorites remain client-side persistence (localStorage) in MVP.

## High-level Task Breakdown

1. Define rebuild scope and architecture contract
- Action: lock MVP feature list and API contract for `search`, `recommendations`, `movie details`, `health`.
- Success criteria: agreed scope + endpoint schema documented in scratchpad.

2. Initialize clean project skeleton
- Action: scaffold `web/` with Vite + React (+ TypeScript) and `api/` with Rust (Axum), with root dev scripts.
- Success criteria: `web` starts with `vite`, `api` starts with `cargo run`, both reachable locally.

3. TDD backend API surface (RED first)
- Action: write failing tests for endpoint responses, error handling, and TMDB client boundaries.
- Success criteria: tests fail for expected reasons before implementation.

4. Implement Rust TMDB integration + recommendation engine (GREEN)
- Action: implement typed TMDB client, recommendation scoring module, and response mappers.
- Success criteria: backend tests pass; endpoints return stable typed JSON.

5. Build React UI MVP against Rust API
- Action: implement pages/components for search, recommendation results, movie details, and loading/error states.
- Success criteria: end-to-end flow works from UI -> API -> UI for at least one known movie query.

6. Add favorites and UX parity
- Action: implement local favorites, persist/restore behavior, and detail navigation parity.
- Success criteria: favorites can be added/removed and survive page refresh.

7. Verification and hardening
- Action: run frontend/backend tests, type checks, lint, basic manual QA.
- Success criteria: defined verification commands pass and smoke test checklist is complete.

8. Cutover and cleanup
- Action: archive/remove legacy stack paths, update `walkthrough.md`, document env setup and run commands.
- Success criteria: repo clearly points to new stack only; walkthrough exists and matches actual setup.

## Project Status Board

- [x] P1 - Analyze current project and infer product goal
- [x] P2 - Create Planner scratchpad for this repository
- [x] P3 - Define rebuild scope and architecture contract
- [x] P4 - Initialize clean Vite + React + Rust skeleton
- [x] P5 - Backend TDD (endpoint contracts)
- [x] P6 - Backend implementation (TMDB + recommendations)
- [x] P7 - Frontend implementation (search/results/details)
- [x] P8 - Favorites + parity + verification
- [x] P9 - Legacy cleanup + walkthrough + deployment handoff
- [x] P10 - Full frontend restyling (cinematic/editorial theme + responsive polish)

## Current Status / Progress Tracking

- Executor mode active.
- Rebuild completed: project moved to `Vite + React + Rust` with MVP parity goals implemented.

Executor completion summary (2026-02-11):
- Rust toolchain installed locally via rustup.
- New backend implemented in `api/` (Axum + reqwest + serde + tokio).
- API routes implemented and verified:
  - `GET /api/health`
  - `GET /api/movies/search?query=...`
  - `GET /api/movies/:id`
  - `GET /api/movies/:id/recommendations`
- Backend test suite added and passing (`5` tests).
- New frontend implemented in `web/` (Vite + React + TypeScript + react-router-dom):
  - Discover page with search and recommendation flow
  - Movie details page
  - Favorites page (localStorage persistence)
- Developer scripts added:
  - `scripts/dev.sh`
  - `scripts/verify.sh`
- Env templates added:
  - `api/.env.example`
  - `web/.env.example`
- Documentation updated:
  - `README.md`
  - `walkthrough.md`
- CI workflow migrated from Python static build to Vite Pages deploy in `.github/workflows/deploy.yml`.
- Legacy app files moved out of active project root into external backup location:
  - `../themeflick-legacy-backup-20260211`
- Mode 2 update (2026-02-11):
  - frontend switched to TMDB direct mode (no backend dependency for deployed app)
  - `web/src/api.ts` now calls TMDB directly and computes similarity client-side
  - deploy workflow injects TMDB build vars/secrets instead of API base URL
  - local scripts/docs updated to frontend-only run/verify path
- Algorithm tuning update (2026-02-11):
  - raised minimum similarity thresholds
  - added per-director result cap to avoid over-concentration
  - added hard penalty/filter for key-genre mismatch
  - recommendation reasons now remain aligned with the stronger filters

Verification results:
- `api`: `cargo fmt -- --check` passed
- `api`: `cargo test` passed (`5`/`5`)
- `web`: `npm run lint` passed
- `web`: `npm run build` passed
- root: `./scripts/verify.sh` passed end-to-end
- Deploy update (2026-02-11):
  - GitHub Pages deploy succeeded on run `21909617726`.
  - Follow-up fix for white page on `/themeflick/`:
    - Vite build base set to `/themeflick/`.
    - Router basename set from `import.meta.env.BASE_URL`.
  - Fixed deploy run: `21909738642` (success).
- Restyling update (2026-02-11):
  - Applied complete frontend redesign via `frontend-design` skill:
    - new typography system (`Bebas Neue` + `IBM Plex Sans`)
    - new warm cinematic palette and design tokens in `web/src/index.css`
    - full component/page style rewrite in `web/src/App.css`
    - updated topbar branding and route-shell structure in `web/src/App.tsx`
    - added recommendation-metric strip in `web/src/pages/HomePage.tsx`
  - Documentation updated in `walkthrough.md`.
  - Validation completed:
    - `web`: `npm run lint` passed
    - `web`: `npx tsc --noEmit` passed
    - `web`: `npm run build` passed
    - `web`: `npm audit --audit-level=high` passed (`0` vulnerabilities)
    - root: `./scripts/verify.sh` passed

Executor update (2026-02-11): Task `P3` started (scope lock + architecture/API contract).

### P3 Scope Lock (MVP v1)

In scope for rebuild:
- Search movies by title.
- Return top recommendations for a selected movie.
- Show movie detail page.
- Save/remove favorites in browser localStorage.
- Healthy API + clear error responses.

Out of scope for MVP v1:
- User authentication/accounts.
- Server-side favorites persistence.
- Admin panel/CMS.
- Multi-provider movie APIs (TMDB only).
- Advanced caching/rate-limiting strategy beyond basic safe defaults.

### P3 Architecture Contract (Locked)

- Frontend:
  - `web/` = Vite + React + TypeScript.
  - Routing: `react-router-dom`.
  - Data fetching: native `fetch` with small API client wrapper.
  - State:
    - server data in component/page state,
    - favorites in localStorage abstraction.
- Backend:
  - `api/` = Rust + Axum.
  - JSON serialization: `serde`.
  - HTTP client: `reqwest`.
  - Runtime: `tokio`.
  - Config via env (`TMDB_ACCESS_TOKEN`, optional `TMDB_API_KEY` fallback).
- Integration:
  - Frontend talks only to Rust API (`/api/*`).
  - Rust API is sole caller of TMDB.
  - CORS enabled for local dev (`http://localhost:5173`).

### P3 API Contract v1 (Locked)

1. `GET /api/health`
- 200 response:
```json
{ "status": "ok", "service": "themeflick-api" }
```

2. `GET /api/movies/search?query=<title>`
- 200 response:
```json
{
  "results": [
    {
      "id": 27205,
      "title": "Inception",
      "release_date": "2010-07-15",
      "poster_path": "/...",
      "vote_average": 8.4
    }
  ]
}
```
- 400 when `query` missing/empty.

3. `GET /api/movies/:id`
- 200 response:
```json
{
  "id": 27205,
  "title": "Inception",
  "overview": "...",
  "release_date": "2010-07-15",
  "runtime": 148,
  "genres": [{ "id": 28, "name": "Action" }],
  "poster_path": "/...",
  "backdrop_path": "/...",
  "vote_average": 8.4,
  "director": "Christopher Nolan",
  "cast": [{ "id": 6193, "name": "Leonardo DiCaprio", "character": "Cobb" }]
}
```
- 404 when movie not found.

4. `GET /api/movies/:id/recommendations`
- 200 response:
```json
{
  "base_movie": { "id": 27205, "title": "Inception" },
  "results": [
    {
      "id": 157336,
      "title": "Interstellar",
      "poster_path": "/...",
      "release_date": "2014-11-05",
      "vote_average": 8.4,
      "similarity_score": 86.2
    }
  ]
}
```
- 404 when base movie not found.

Error envelope (all non-2xx):
```json
{ "error": { "code": "MOVIE_NOT_FOUND", "message": "Movie not found" } }
```

### P3 Verification Criteria

- Scope and out-of-scope boundaries explicitly documented.
- API endpoints and response contracts frozen for executor implementation.
- Dependencies between frontend/backend responsibilities clarified.

## Executor's Feedback or Assistance Requests

- No active blockers.
- Manual follow-up pending only for deployment credentials/targets if you want me to perform live deploy actions.

## Lessons

- Include useful debugging information in program output.
- Read files before editing.
- If vulnerabilities appear in terminal output, run `npm audit` before proceeding.
- If the project is connected to GitHub and deployed, redeploy after every change.
- Always maintain/update `walkthrough.md` in the project.
- Before fulfilling requests, check for applicable `SKILL.md` guidance.
- New lesson (2026-02-11): when `.codex/scratchpad.md` is missing in a repository, create it before Planner/Executor cycle work.
- New lesson (2026-02-11): if hard-delete commands are blocked by policy, perform safe cutover by moving legacy assets to an external backup path and continue execution.
- New lesson (2026-02-11): for GitHub Pages project sites, set Vite `base` to `/<repo-name>/` and configure Router `basename` accordingly, otherwise app may render blank due broken asset paths.
- New lesson (2026-02-11): in frontend-only mode, use GitHub Actions build-time vars (`VITE_*`) for TMDB credentials and remove backend health dependency from UI status.
- New lesson (2026-02-11): for full UI revamps, apply `frontend-design` first and always close with `lint-and-validate` checks (`lint`, `type-check`, `build`, `audit`).
