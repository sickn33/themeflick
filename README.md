# Themeflick

Themeflick is a movie discovery app built with Vite, React, an OpenAI Sites Worker, and D1.

## Project Structure
- `web/` - React frontend, Sites Worker, D1 schema, migrations, and deployment build
- `api/` - optional Rust recommendation service (not required by the Sites deployment)
- `scripts/` - local developer scripts
- `walkthrough.md` - setup and usage walkthrough

## Recommendation Engine (V2)
The active ranking engine lives in:
- `/Users/nicco/Projects/themeflick/web/src/lib/recommendationEngine.ts`

Current model characteristics:
- calibrated `% match` score (less inflated, more interpretable)
- multi-signal scoring (genre, themes, cast, director, era, pacing, rating confidence)
- hard quality filters for weak/noisy candidates
- diversity-aware reranking (MMR) and max 2 picks per director
- deterministic ordering for equal-score candidates

Public response shape is unchanged:
- `similarity_score`
- `match_reason`

## Start
Use the walkthrough for full setup and run steps:
- [`walkthrough.md`](./walkthrough.md)

Production secrets are server-side Sites environment variables: `TMDB_ACCESS_TOKEN` (preferred) or `TMDB_API_KEY`. Never expose them through a `VITE_` variable. D1 is bound as `DB` by `web/.openai/hosting.json`.

Before public access, set `VITE_LEGAL_CONTROLLER_NAME` to the real operator/controller identity and `VITE_LEGAL_CONTACT_EMAIL` to a monitored privacy/support address. The current fallback deliberately identifies the build as a private preview.

## Verification
From project root:
```bash
./scripts/verify.sh
```
This runs:
- `npm run lint`
- `npm run test`
- schema drift and clean-database migration validation
- `npm run build`
- `cargo fmt --check`
- `cargo test --locked`

For a credentialed, live quality sample against TMDB:
```bash
cd web
node --experimental-strip-types analyze.ts
```

The live gate intentionally requires at least two strong recommendations per
sample title and rejects weak or generic explanations. Themeflick returns a
shorter list instead of padding results with low-confidence matches.

## Deployment and operations

OpenAI Sites is the sole deployment path; GitHub Actions runs CI only. See [`docs/operations.md`](./docs/operations.md) for health checks, smoke tests, backups, rollback, monitoring, rate limits, and incident handling.
