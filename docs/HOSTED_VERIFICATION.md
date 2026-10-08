# Current continuation — operations batch, 8 October 2026

Private hosted beta: https://traffic-optimizer.mohammadwajdi01.workers.dev/
Repository: https://github.com/mohammadwajdi01-sys/traffic-optimizer

Release 28 remains active at 100%; PR #15 merged, device/reminder migration applied, 141 application tests and 63 Chromium cases passed in its final CI. Owner Google identity, private access and zero-budget/provider safeguards remain intact. Owner reports password eyes/rules and Settings Save/Discard/retry/consent worked; ordinary-user mail and matching backend password configuration remain pending.

Queue 11–20 adds a complete-CI-gated main-only staged deployment path, configuration comparison, migration hash guard, local concurrency/restart drill, and recovery/billing/account evidence procedures. See [OPERATIONS.md](OPERATIONS.md) and [PROVIDER_RECONCILIATION.md](PROVIDER_RECONCILIATION.md). GitHub production secret availability and a successful production workflow run remain unverified. This tooling/documentation batch does not change application runtime or database data.

Hosted saved-route re-login/two-account acceptance remains pending. Device/private-session, GPS, nearby search, Android coordinates, maps/Arabic labels, actual notifications/PWA and Libya/A33 checks remain postponed. No full V1 acceptance or hosted capacity/billing guarantee is claimed.

Earlier evidence below is historical; use this block and the current WBS for current status.

---

# Hosted verification — 2026-10-05

Published beta: https://traffic-optimizer.mohammadwajdi01.workers.dev/.

Current Cloudflare deployment ID: `01f4ba2d1b0641839825e781e61de96a`.
Worker: `traffic-optimizer`. Dedicated account and project were supplied by the owner. No unrelated resource was changed.

| Check | Observed result |
|---|---|
| Cloudflare upload | Success, HTTP 200, backend module plus built frontend assets |
| Workers subdomain | Enabled for `mohammadwajdi01`; hosted app opened over HTTPS |
| Runtime configuration | APP_MODE live, PUBLIC_BETA true, GOOGLE_ENABLED false |
| Secrets | Provider, Turnstile, guest signing and VAPID secrets bound server-side |
| Observability | Query strings redacted; log sampling 0.1 |
| Scheduled trigger | Registered every ten minutes; reminder processor waits for server secret |
| Supabase migrations | Initial schema and platform-trigger permission restriction applied |
| Supabase security advisor | Zero WARN/ERROR; intentional INFO for internal notification queue with no user policies |
| TypeScript + production build | PASS |
| Unit/DOM interaction tests | 30 PASS |
| Database authorization | PASS in PGlite: cross-user isolation, roles, limits, consent and queue protection |
| Real Durable Object concurrency | PASS: 5 accepted, 15 denied from 20 requests against cap 5 |
| Security/quota integration | PASS: free caps, paid budget gate, disabled provider, guest limit, owner gate, origin denial |
| Live Mapbox credential | HTTP 200 / Ok; valid public-landmark route in Amman |
| Amman traffic coverage | No confirmed congestion annotations in that response; unconfirmed coverage |
| Live Geoapify credential | HTTP 200; one result returned for public Khalda/Amman query |
| Hosted desktop navigation | Today and Settings opened; UI responsive to navigation |
| Hosted Arabic | Language ar, direction rtl, Arabic labels observed; no horizontal overflow at desktop viewport |
| Guest security | Final production Turnstile checkbox and Refresh verification control observed; forecast button locked pending verification |
| Hosted screenshot | Saved in evidence/hosted-planner.jpg |
| GitHub source push | BLOCKED: connector account otiumaijo has pull true, push false on target repo |
| End-to-end login | PENDING: dashboard signed out, Auth redirect/email settings not available via database MCP |
| End-to-end guest analysis/map | PENDING: requires confirmation to solve human verification |
| Push delivery | PENDING: Supabase server secret unavailable; scheduler fails closed |
| Phone/GPS/offline/install | Not executed in browser |

Raw provider forecasts, private precise locations and API secrets are not saved in this evidence. Public landmarks were used for provider checks. Direct shell API probes returned Cloudflare error 1010; the hosted browser reached live configuration. An initially misleading setup fallback was corrected to distinguish a connection failure from missing configuration. Guest search/map readiness is gated to avoid unauthorized requests before verification.

The full local check log is in evidence/automated-checks.log (28 tests at that checkpoint). Two additional guest-verification security/recovery cases and the final 30-test run are in evidence/guest-recovery-checks.log. Final TypeScript and production build checks also passed. Browser screenshots and DOM observations are actual hosted evidence; authored Playwright phone/desktop tests were not executed here. This deployment is a reviewable beta, not a claim of completed production activation or calibrated city traffic accuracy.

Guest verification now offers an explicit refresh control, catches script/challenge errors and expiration, and keeps access locked until server validation succeeds. No verification bypass or test key was deployed.
