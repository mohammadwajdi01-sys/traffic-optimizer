# Reminder and allowance operation

Device storage uses an additive `push_devices` table and preserves the legacy subscription table for rollback. Existing endpoints are backfilled; current-endpoint removal also clears a matching legacy row. Production migration `device_reminder_deliveries` was applied at history version `20261008163253` before release 28 activation; ownership policies, grants and backfill were independently verified.

The private beta remains protected; no paid provider is enabled by this release.

- Notifications opt in separately on each browser/device. Turning off one endpoint removes only that device. An explicitly enabled endpoint transfers to the current personal account; local sign-out removes the current endpoint before clearing the session when connected.
- Plan results can schedule the exact selected departure and arrival, origin timezone, English/Arabic language and 15–60-minute UI lead. Server validation accepts 15–120 minutes within seven days. Enabled devices receive separate delivery rows. Repeating the same selection updates pending timing instead of creating duplicates; successful occurrences are never reset.
- Settings lists pending device deliveries and lets the signed-in owner cancel each delivery. Notification opening fetches its saved snapshot only through the current account's ownership policy. A reminder is an old estimate; request a new check before travelling.
- The scheduler runs every ten minutes. Delivery timing is approximate, subject to cron backlog, browser permissions/network and the push service. Expired reminders are not sent or shown. Do not market exact-minute or guaranteed reminders.
- Transient errors retry at bounded backoff, at most three attempts and only before departure. A database lease prevents concurrent cron sends. Stable notification tags replace duplicate browser notifications if a push service accepts a message but its response is lost. Network delivery is not exactly-once.
- HTTP 404/410 removes only the failed subscription and linked deliveries. Other permanent 4xx failures end that delivery. No before-success duplicate claim suppresses retries.
- Recurring route reminders store one selected occurrence after bounded forecasting. They use selected weekdays/goal and account language. Saved GPS origins are skipped; fresh GPS belongs in manual planning. Libya automatic reminder recommendations remain withheld. Overnight/long-drive usefulness still requires the postponed acceptance tests.
- Each cron processes at most one recurring job (six forecast calls) and four deliveries. Queue writes are batched over at most ten devices. Provider reservations and zero-budget guards remain in force. Actual phone receipt is unverified until the user resumes validation.
- Reminder rows expire at departure; terminal rows are removed after 30 days. Route/subscription/account deletion cascades linked rows. Route timing/day/name/reminder edits cancel pending linked occurrences and requeue recurring planning.
- Owner role defaults and UUID-based per-account overrides live in the existing BudgetLedger. Blank override removes it; zero disables analyses. Counters reset at midnight UTC, and changing limits does not reset used counts. Weekly analysis costs one allowance per checked day. All provider free/hard/rate/budget caps remain separate.
- Admin provider/budget/country/role edits are local drafts until Save; Cancel restores the last loaded values. No on-blur changes. Account override edits also require Save.

## Open configuration and acceptance

1. Supabase Email password security: minimum 8, lowercase/uppercase/digits/symbols. The available database tools cannot modify Auth settings. Matching direct-Auth rejection remains unverified.
2. Ordinary non-team email delivery: owner reset/login succeeded by user report; this does not certify SMTP or ordinary-user delivery. No new mail test or Auth configuration change was performed.
3. The bilingual privacy/terms pages describe current behavior. Operator contact uses the existing configured VAPID contact. Owner approval of public-release policy, retention and contact remains pending; no public launch is certified.
4. Phone, GPS/maps, PWA/offline, screen-reader and Libya/target-city ETA comparisons remain postponed. Synthetic checks do not close them.
