# Themeflick Walkthrough

## Stack (Mode 2: Sites Worker)

- Frontend: Vite + React + TypeScript (`/web`)
- Data source: TMDB through a same-origin, allowlisted Worker
- Hosting: OpenAI Sites

The lightweight Worker is built and deployed together with the frontend. The legacy Rust API is not required.

## Prerequisites

- Node.js 20+
- npm 10+

## Local Run

1. Configure local Worker secrets:

```bash
cp web/.dev.vars.example web/.dev.vars
```

1. Add at least one TMDB credential in `web/.dev.vars`:

```dotenv
TMDB_ACCESS_TOKEN=...
# alternative:
TMDB_API_KEY=...
```

1. Install dependencies:

```bash
cd web
npm install
```

1. Start app:

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
- **Fixes (2026-02-12)**:
  - Tuned logistic calibration curve to output wider score range (20–99) instead of clustering at 50–60.
  - Improved token stemmer (handles `-ed` correctly).
  - Capped relevance score components to prevent top-tier clamping.
  - Removed double-counting of exact keyword phrase matches.

  - Aligned genre dominance penalties with filter thresholds.
  - **Quality Tuning (Phase 2)**:
    - Enforced strict filtering: candidates must have a specific reasons (genre/theme/director/cast/era) to be recommended. Generic "profile matches" are now rejected.
    - Expanded synonyms: `cyborg`, `android`, `mech`, `bot` -> `robot`.

The public payload used by UI is unchanged:

- `similarity_score`
- `match_reason`

## Deploy (OpenAI Sites)

Sites stores `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY` as a secret runtime variable. Do not use a `VITE_` prefix for credentials: Vite variables are public browser values.

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
- Home search state (query, selected movie, recommendations, errors) is persisted in sessionStorage key `themeflick.home.search-state-v1` so returning from movie details restores the previous search context.
- Sites serves the app at the site root and provides the deep-link SPA fallback.
- TMDB credentials remain in the Worker runtime and are never sent to the browser.
- UI restyling (2026-02-11): full cinematic/editorial refresh applied in `web/src/index.css` and `web/src/App.css` with updated typography, palette, responsive layout, and motion system.
