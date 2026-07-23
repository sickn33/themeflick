# Themeflick operations runbook

## Ownership and deployment

OpenAI Sites is the only production deployment system. GitHub Actions is CI-only. Keep the Sites project private until the launch checklist, legal identity/contact configuration, and public authentication-header probe are complete.

## Health and monitoring

- `GET /api/health/live` verifies that the Worker is running.
- `GET /api/health/ready` verifies the D1 binding, database query, and TMDB runtime credential.
- Monitor 5xx rate, 429 rate, p95 latency, D1 errors, and TMDB upstream failures. Logs contain request ID, coarse route, status, and duration only; they must not contain email, name, IP, token, query text, or body.
- Run `THEMEFLICK_ORIGIN=https://… npm run smoke:production` after each private deployment. Supply an authenticated preview cookie only through the shell environment when the private access layer requires it.

## Database migration and backup

1. Run `npm run db:validate` from `web/` against a clean SQLite database.
2. Before a production migration, export the current D1 database using the Sites/D1 control-plane export facility and record the version ID and timestamp outside the repository.
3. Deploy the application and ordered migrations together through Sites.
4. Verify `/api/health/ready`, account bootstrap, one add/remove retry, export, and deletion in the private deployment.
5. Retain backups according to the operator's approved retention schedule, then delete them securely.

Restore only into a private recovery environment first. Apply migrations through the restored version, compare row counts and integrity, then switch production after smoke tests.

## Rollback

Redeploy the last known-good Sites version. Do not reverse a destructive migration in place. Restore the pre-migration D1 export into a private recovery database, verify it, then explicitly rebind/switch using the Sites control plane.

## Incidents

1. Keep or return the site to private access when confidentiality, authentication, or tenant isolation is uncertain.
2. Preserve request IDs, timestamps, release/version IDs, and sanitized logs.
3. Rotate TMDB credentials if exposure is suspected.
4. Disable affected mutations or deploy the last known-good version.
5. Assess notification duties with the named data controller and privacy contact before communicating externally.

## Rate limits

TMDB proxy requests use shared D1 budgets: 300 requests per client hash per 10 minutes and 600 globally per minute. Authenticated mutations use the same protection. Review real private-preview telemetry before changing thresholds; never replace the shared limiter with isolate memory.
