# Themeflick Web

Vite + React frontend with a Sites Worker that protects TMDB credentials.

## Local Run

```bash
cp .dev.vars.example .dev.vars
npm install
npm run dev
```

Set `TMDB_ACCESS_TOKEN` (preferred) or `TMDB_API_KEY` in `.dev.vars` for local development. Hosted credentials are stored as secret runtime variables in Sites and are never included in the browser bundle.

## Checks

```bash
npm run lint
npm run test
npm run benchmark:human
npm run build
```

`benchmark:human` compares ranking against MovieLens co-liked human ratings. Put a MovieLens archive in `.cache/movielens` first, for example:

```bash
mkdir -p .cache/movielens
curl -L -o .cache/ml-latest-small.zip https://files.grouplens.org/datasets/movielens/ml-latest-small.zip
unzip -q .cache/ml-latest-small.zip -d .cache/movielens
```

Sites serves the SPA at the site root and routes `/api/*` through the Worker. Deep links use the platform's single-page application fallback.
