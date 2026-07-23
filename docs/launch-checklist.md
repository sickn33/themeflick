# Public launch checklist

## Automated gates

- [x] Frontend lint, unit tests, Worker tests, TypeScript build
- [x] Rust formatting and tests
- [x] D1 schema drift check and clean-database migration validation
- [x] Local Sites smoke: HTML/deep routes, readiness, TMDB, CSP/anti-frame headers
- [x] Account lifecycle smoke: tenant isolation, add, duplicate retry, export, delete, stale-generation rejection
- [x] Browser verification: desktop/mobile layout, no horizontal overflow, route focus, metadata, legal routes, accessible names and target sizes
- [x] Server-only TMDB credentials; build rejects legacy public credential references
- [x] Shared D1 rate limiting and pre-parse request-body cap
- [x] Official TMDB logo and required attribution notice
- [x] CI-only GitHub workflow; Sites is the sole deployer

## Required human/operator gates before public access

- [x] Configure the real operator/data-controller identity with `VITE_LEGAL_CONTROLLER_NAME`.
- [ ] Configure the privacy/support address with `VITE_LEGAL_CONTACT_EMAIL`; confirm that the mailbox is actively monitored before public access.
- [ ] Confirm whether intended use is non-commercial; obtain the appropriate TMDB commercial license before monetization or other commercial use.
- [x] Verify the deployed Sites authentication boundary rejects client-supplied `oai-authenticated-user-*` headers before they reach the Worker.
- [ ] Record a production D1 export/restore drill and monitoring owner.
- [x] Run `THEMEFLICK_ORIGIN=https://… npm run smoke:production` against the final private version.

The site must remain private until every item in the second section is checked. A private deployment is not approval to make the product public.
