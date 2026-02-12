# Themeflick

Themeflick is a movie discovery app rebuilt as **Vite + React frontend-only**.

## Project Structure
- `web/` - React frontend (Vite + TypeScript)
- `api/` - legacy/optional backend code (not required for production Pages mode)
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

## Verification
From project root:
```bash
./scripts/verify.sh
```
This runs:
- `npm run lint`
- `npm run test`
- `npm run build`
