# Themeflick Walkthrough

## Stack (Mode 2: frontend-only)
- Frontend: Vite + React + TypeScript (`/web`)
- Data source: TMDB (direct browser calls)
- Hosting: GitHub Pages

No backend is required in this mode.

## Prerequisites
- Node.js 20+
- npm 10+

## Local Run
1. Configure frontend env:
```bash
cp web/.env.example web/.env
```
2. Add at least one TMDB credential in `web/.env`:
```dotenv
VITE_TMDB_API_KEY=...
# optional:
VITE_TMDB_ACCESS_TOKEN=...
```
3. Install dependencies:
```bash
cd web
npm install
```
4. Start app:
```bash
cd /Users/nicco/Projects/themeflick
./scripts/dev.sh
```

App URL: [http://localhost:5173](http://localhost:5173)

## Recommendation Engine V2
Path:
- `/Users/nicco/Projects/themeflick/web/src/lib/recommendationEngine.ts`

Behavior:
- weighted multi-signal scoring:
  - genre, keyword themes, cast overlap, director match, year distance, runtime distance, rating gap, vote-count confidence
- calibrated `% match` via logistic transform to avoid inflated 90+ values
- hard filters to remove weak/noisy candidates
- diversity reranking with MMR
- max 2 recommendations per director
- reasons generated from strongest signals (example: `Same director + Shared themes`)

The public payload used by UI is unchanged:
- `similarity_score`
- `match_reason`

## Deploy (GitHub Pages)
Workflow injects:
- `VITE_TMDB_API_KEY` from repo variable

Required repository settings:
- Variable: `VITE_TMDB_API_KEY`

## Verification
From project root:
```bash
./scripts/verify.sh
```
Runs:
- `npm run lint`
- `npm run test`
- `npm run build`

Optional direct checks:
```bash
cd web
npm run lint
npm run test
npm run build
```

## Notes
- Favorites are saved in localStorage key `themeflick:favorites:v1`.
- On GitHub Pages the app is served under `/themeflick/`; Vite base path and Router basename are configured accordingly.
- In frontend-only mode TMDB credentials are visible client-side by design.
- UI restyling (2026-02-11): full cinematic/editorial refresh applied in `web/src/index.css` and `web/src/App.css` with updated typography, palette, responsive layout, and motion system.
