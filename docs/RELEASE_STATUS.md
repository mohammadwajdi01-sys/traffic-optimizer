# Current continuation — operations batch, 8 October 2026

Private hosted beta: https://traffic-optimizer.mohammadwajdi01.workers.dev/
Repository: https://github.com/mohammadwajdi01-sys/traffic-optimizer

Release 28 remains active at 100%; PR #15 merged, device/reminder migration applied, 141 application tests and 63 Chromium cases passed in its final CI. Owner Google identity, private access and zero-budget/provider safeguards remain intact. Owner reports password eyes/rules and Settings Save/Discard/retry/consent worked; ordinary-user mail and matching backend password configuration remain pending.

Queue 11–20 adds a complete-CI-gated main-only staged deployment path, configuration comparison, migration hash guard, local concurrency/restart drill, and recovery/billing/account evidence procedures. See [OPERATIONS.md](OPERATIONS.md) and [PROVIDER_RECONCILIATION.md](PROVIDER_RECONCILIATION.md). GitHub production secret availability and a successful production workflow run remain unverified. This tooling/documentation batch does not change application runtime or database data.

Hosted saved-route re-login/two-account acceptance remains pending. Device/private-session, GPS, nearby search, Android coordinates, maps/Arabic labels, actual notifications/PWA and Libya/A33 checks remain postponed. No full V1 acceptance or hosted capacity/billing guarantee is claimed.

Earlier evidence below is historical; use this block and the current WBS for current status.

---

# Settings and password refinement — 8 October 2026

Task 3.08 now groups Account, Journey preferences, Notifications, Privacy and Website access. Advanced buffer/timezone help, preference loading/error/retry, draft Save/Discard, saved-consent trip recording, nearby-location clear and device-example/export scope are explicit. Account saves use an expected-session check and ignore stale responses; signed-in defaults no longer inherit guest navigation/buffer defaults. Route-specific saved buffers remain intact. Recording state clears on account change.

Tasks 3.05/3.06 include independent eye icons on personal password and confirmation inputs and signup/reset validation: 8+ characters, uppercase, lowercase, number and supported symbol. Login accepts existing passwords. The owner reports the previous email/reset/login checklist worked; ordinary-user delivery, backend strength configuration and real multi-account/device acceptance remain partial.

Notification removal still has the existing account-wide scope, clearly described. Device-aware storage/removal and reliable reminder jobs remain tasks 3.09–3.11. This batch does not fix push delivery or the unresolved Libya/A33 ETA discrepancy. Android, map, GPS, push and traffic acceptance remain postponed until the user is ready. Backend password rules require the separately documented Supabase setting; client validation is not server enforcement. No database migration, paid provider activation, limit increase or owner/private-gate rewrite.

Exact-source CI, merge and deployment evidence is recorded in the authoritative WBS after successful verification. Earlier release blocks below are historical.

---

# Account flow implementation — 8 October 2026

Batch 3 tasks 3.05–3.06 add personal email/password signup and login, confirmation resend, secondary email links, and reset requests in English and Arabic. All redirects use the same origin's `/settings`. Passwords are transient form state; signup never sends role metadata. Google authentication and the server/database owner identity remain unchanged.

Recovery opens the password editor only after Supabase emits PASSWORD_RECOVERY with a user session. Invalid, expired or reused links clear sensitive URL context and offer a fresh request. The editor checks the account identity before updating only the password; logout/account change closes it. Change password in Settings uses the same verified-email recovery flow.

The public Auth settings were read on 8 October: email signup enabled, email confirmation required, Google enabled. The current connector has no Auth redirect/SMTP management endpoint. Exact allowlist and mail transport are not claimed verified or changed. Task 3.07 remains partial until configuration and real receipt/callback evidence exist. No mail was sent by automated tests; tests use fixtures. The user is available to verify email delivery. Android, map, Libya/A33 and live traffic validation remain postponed until the user is ready.

Account release automated CI/merge/deployment evidence is recorded in the authoritative WBS after successful checks. This does not establish real email delivery or full V1 acceptance. Zero budget, disabled paid/Google routing, private access, account isolation and reminder configuration are preserved.

# Current implementation status — 8 October 2026

Batch 3 first group implements tasks 3.01–3.04: named saved-route cards with distinct Use in Plan/Leave now actions, isolated edit drafts and accessible delete confirmation; selected-date/weekday weekly preflight under unchanged limits; relative checked-duration colours, nearby-check timestamps, unknown states and phone day tables; and three-distinct-day 15-minute bucket insights with a median earliest-feasible-check driving-time comparison. Password account flows and reminder delivery are not included in this group.

The user explicitly postponed core/device/Libya validation until the user is ready and authorized continuing the next WBS on 8 October. This permits implementation of the next group, not accepted-core or full-V1 closure. A33, real Android and live email/push acceptance remain open.

Core follow-up: arrival-window-start alternatives are limited to arrival modes. Map failures retain the canvas so a later load can recover, report a safe localized failure category instead of always claiming setup is missing, and retry only on request. Arabic label-loader failures no longer destroy the map. Hosted map/provider and Android acceptance still require fresh evidence; this is not a Libya ETA accuracy fix.

Batch 2 implements inline Today/Plan results, one shared saved-route selector, explicit shortest-drive/soonest-arrival goals, overnight bounds, cancellable requests, selectable sampled charts and checked-departure tables. Existing saved buffers are preserved; a migration changes only the default for new account preferences to zero.

The reported Libya ETA discrepancy remains unvalidated. Known Libya routes retain inspectable estimates, but automatic daily best/latest/lowest and weekly recommendations are withheld until the matching route/time comparison is reproduced and resolved. This is not an accuracy repair or a claim that Libya has no provider coverage.

Daily comparison remains adaptive and capped at 24 checks, not an exhaustive check of every minute. Partial segment annotations are reported as partial. Google Routes stays disabled and spending guards stay unchanged.

The authoritative execution and acceptance records are Traffic-Optimizer-UX-Implementation-Plan-and-WBS.md and Traffic-Optimizer-Audit-WBS-2026-10-06.md. Batch 2 regression/deployment evidence and actual Android checks must be recorded before acceptance; A33 still needs the reported paired Libya case. Batch 3 tasks 3.05–3.16, reminder delivery and full V1 acceptance remain pending; 3.01–3.04 implementation still needs exact-source CI/deployment and hosted/device evidence.

The original release snapshot below is historical and describes an earlier implementation.

---

# Release status — 2026-10-05

## Actual status

**Hosted beta deployed; automated checks passed. Account activation, reminders and complete browser forecast verification remain pending.**

Hosted URL: https://traffic-optimizer.mohammadwajdi01.workers.dev/. See HOSTED_VERIFICATION.md for deployment IDs, provider results and permission blockers.

The frontend concepts in the earlier conversation were generated images, not an existing runnable frontend codebase. This package implements their product layout and visual direction. It does not claim pixel identity with illustrations containing inconsistent timing examples.

## Implemented

- Responsive phone/desktop controls, sidebar/bottom navigation, English and Arabic RTL.
- Today/planner/results/week/routes/settings/owner surfaces.
- Three travel intents, time/date controls, origin-timezone conversion, manual coordinates, optional GPS and provider autocomplete.
- Deadline-first candidate validity, nonlinear early-arrival penalty, leave-around preference penalty, adaptive coarse/refinement search and deduplication.
- Best balanced, minimum congestion when a real static baseline exists, minimum driving time otherwise, latest tested on time, avoid windows, partial/no-feasible states.
- Clearly labeled synthetic example mode; example routes stay on the device.
- Mapbox GL JS loaded on demand; real map/route geometry only after credentials.
- Mapbox Directions adapter and gated Google Routes fallback; no Google geometry on Mapbox, no false static baseline from Mapbox typical duration.
- API request validation, same-origin restriction, bounded body size, server-side secrets, fail-closed identity, verified guest-session foundation.
- SQLite Durable Object atomic request reservation, per-provider caps/rate limits, per-user daily analysis limits, spending switch/budget, country rules and audit/error metadata.
- Supabase schema, row ownership policies, protected roles, concurrency-aware saved-route limits, opt-in actual journey records, private notification queue.
- Auth sign-in-link integration and saved-route/preference APIs.
- Web-push service worker, per-route reminder scheduler and push subscription endpoints; credentials and delivery verification pending.
- Install manifest, PNG icons, offline application shell, security headers.
- Pinned dependency lockfile, GitHub verification workflow and explicit deployment workflow.

## Passed verification

| Check | Result |
|---|---|
| TypeScript | PASS |
| Production frontend build | PASS |
| Worker bundle/dry-run | PASS |
| Unit + DOM interaction tests | 30 PASS |
| Deadline/buffer and earliest-arrival rules | PASS |
| Adaptive budget, duplicate avoidance, partial/outage behavior | PASS |
| Origin timezone and daylight-saving ambiguity handling | PASS |
| Provider contract/metric normalization | PASS |
| Example planner, navigation URL, saved route, morning/afternoon weekly computation, saved settings, keyboard address selection, Arabic RTL DOM, owner UI gate | PASS |
| PostgreSQL migration and auth trigger in PGlite | PASS |
| Cross-user row isolation and role escalation prevention | PASS |
| Saved-route cap, consent checks, private job queue, deletion cascade | PASS |
| Real workerd Durable Object concurrent reservations | PASS: 5 accepted, 15 denied from 20 concurrent attempts against a cap of 5 |
| Free cap, paid budget, disabled provider, guest quota, owner API gate, cross-origin denial | PASS |
| Production dependency audit | 0 vulnerabilities reported |

## Not yet verified / launch blockers

- Full hosted guest route analysis/map flow: an interactive Turnstile check requires action-time confirmation before the agent can solve it.
- Supabase Auth redirects, SMTP/OAuth, real owner login and hosted account persistence: dashboard secure sign-in is required because database MCP cannot configure those settings.
- Push delivery: VAPID and cron are configured, but the modern Supabase server secret is unavailable; scheduler processing fails closed.
- Phone visual QA, GPS denial, offline/install behavior, hosted CPU/memory and capacity.
- GitHub source push/CI: the connected identity `otiumaijo` has read-only access to the empty target repository.
- City traffic quality: the live Amman Mapbox route passed road-routing validation but returned no confirmed congestion annotations.

Cloudflare deployment and hosted English/Arabic navigation are verified. Supabase migrations and hosted security checks are complete. Direct command-line API probes returned Cloudflare 1010, while the hosted browser reached live configuration. No unrelated Otium resource was changed and no paid usage was enabled.

## Remaining product hardening beyond initial activation

- Review weekly heatmap duration thresholds against route length in browser QA. Rendering now follows the selected travel window, including afternoon trips.
- Reminder worker currently sends periodically sampled departure suggestions. It does not yet maintain a calibrated change-from-last-plan alert model or a delivery guarantee.
- Empirical provider accuracy/city routing is not calibrated. The owner surface explicitly reports insufficient data. Actual-trip measurements are stored only after consent; provider prediction retention/comparison needs a permitted design before computing accuracy.
- Complete a hosted accessibility audit. Location suggestions support arrow keys, Enter and Escape; screen-reader testing remains pending.
- Enforce privacy/terms language and actual production contact details for a public launch; the current pages are baseline content.
- Validate Worker CPU and memory on the Free plan; reduce provider payloads/scoring work if necessary before promising a zero-cost hosted experience.

## Better logic than the original blueprint

1. **Feasibility before ranking.** An attractive but late departure cannot win.
2. **Useful choices before fake certainty.** Label the latest *tested* on-time departure honestly; sampled search is not proof of a global optimum or a probability of punctuality.
3. **Measure the correct quantity.** Typical traffic is not free-flow traffic. When congestion cannot be measured reliably, rank driving duration and label it accurately.
4. **Budget before dispatch.** Atomic reservations prevent overlapping users from simultaneously consuming the last free requests.
5. **Fallback once, not twice per sample.** A provider failure can switch the analysis to an allowed alternate without repeatedly doubling its API cost.
6. **Keep the free beta narrow.** Verified guests with one fresh daily analysis, one bounded travel window, strategic refreshes, no continuous polling, no unnecessary AI/GPU service.
7. **Validate before public scale.** Country coverage does not prove route quality, and an application cap does not cover other applications using the same vendor account.

## Cost and scaling model

Initial goal: Cloudflare Free, a dedicated Supabase Free project if eligible, Mapbox included allowance, Geoapify Free, Google fallback disabled. A domain is optional. This is a conditional operating target, not a guaranteed permanently free service.

At a maximum of 24 forecast candidates per day analysis, a seven-day plan uses at most 168 candidates. A one-time provider fallback may add one failed provider request per day. Reserve a margin for map loads, address search, reminders, shared account usage and failed attempts. User limits are configurable but still constrained by global provider limits.

Using the blueprint reference allowance of 100,000 monthly Directions requests: 98,000 / 168 is about 583 fresh weekly one-direction analyses before other usage. That is **not** 583 unlimited active users. One outbound and one return weekly plan roughly doubles the traffic request demand. Actual beta telemetry should determine capacity.

When you choose paid scale, first verify current provider pricing and account allowances, then raise provider limits and set a nonzero monthly budget. Upgrade Cloudflare and Supabase only where measured limits or uptime needs justify it. Keep credential restrictions, rate limits and monitoring. Billing for maps, search, SMTP and backend plans exists outside the Directions-only spending estimate, so reconcile against vendor usage dashboards.
