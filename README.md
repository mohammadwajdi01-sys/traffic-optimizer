# Traffic Optimizer

An initial deployable implementation of the saved Traffic Optimizer blueprint. React/TypeScript/Vite frontend, Cloudflare Worker API and SQLite Durable Object budget guard, Supabase Auth/Postgres, Geoapify search, Mapbox traffic/map, optional Google Routes fallback, and web push reminders.

**Current release status: hosted beta published at https://traffic-optimizer.mohammadwajdi01.workers.dev/.** Database migrations and runtime provider secrets are deployed. Local automated checks pass, live provider credentials work, and hosted English/Arabic navigation is verified. Full guest planner verification, account login/redirects and reminder delivery are still pending. See the exact evidence and blockers in [HOSTED_VERIFICATION.md](docs/HOSTED_VERIFICATION.md).

Start with [START_HERE.md](docs/START_HERE.md). Read [RECOVERY_STATUS.md](docs/RECOVERY_STATUS.md) for the current continuation checkpoint. HOSTED_VERIFICATION.md and RELEASE_STATUS.md preserve earlier evidence; their access blockers can be stale.

## Development

Node 24. Run `npm ci`, `npm run build`, then `npm run api:dev` to serve the production app and API on port 8787. For frontend hot reload, also run `npm run dev` (port 5173, `/api` proxy to 8787). Copy `.dev.vars.example` to `.dev.vars` and fill credentials locally when testing real services. Never commit secrets.

`npm run check` runs TypeScript, unit/DOM tests, database authorization checks in PGlite, a production build, a Worker dry run and quota/security integration checks in the real workerd Durable Object runtime. Recovery verification on 6 October 2026 passed all 30 unit/DOM tests and the remaining checks. `npm run test:e2e` contains desktop and phone browser tests; they need an installed Chromium browser and a running server. The local browser download was unavailable during recovery; browser acceptance remains pending CI.

## Deployment

Use the dedicated repository and Cloudflare account described in the owner guide. Build with `npm run build`; provision the SQL migration on the dedicated Supabase project; deploy with Wrangler; populate runtime secrets through Cloudflare; provision the owner identity and invitees; configure Auth redirects; then change `APP_MODE` to `live` after the live checks pass. The current hosted guest beta uses a real Turnstile widget and signed guest cookies. Google fallback and paid provider usage remain disabled.

The GitHub verification workflow runs automated checks and browser tests. Deployment is an explicit `workflow_dispatch` while the beta is being validated. After hosted QA succeeds, this can be changed to automatic deployment on protected `main` pushes. Database migrations are intentionally separate from deployment so an app push cannot accidentally modify an unrelated database.
