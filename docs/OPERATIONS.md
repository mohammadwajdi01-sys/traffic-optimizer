# Traffic Optimizer operations — queue 11–20

Production is a private beta: https://traffic-optimizer.mohammadwajdi01.workers.dev . The owner is mohammadwajdi01@gmail.com. BudgetLedger storage is `2332bf33ad63463ba531f7b510695668`; never replace it to reset quotas. Paid usage remains disabled with a zero monthly budget, and Google routing remains disabled independently of Google login.

The current runtime is release 28, version `35d6fd3e-7918-4214-98d0-74ed307cf2f0`, active at 100%. Its source is PR #15; merge `a0db1a915f68250b152235aa89a087b304607344`. The final tested tree is `027694b6ce72a6a9ee6b6f6e58b524ae47c71bcd`; CI run `37809246273` passed 141 application tests and 63 Chromium cases. This operations batch changes deployment tooling and documentation, not the application runtime.

## Publish a compatible application release

1. Merge the reviewed source only after its complete Verify workflow passes. Use Actions → **Publish Cloudflare**, selecting **main**. The workflow runs the same complete verification again, including database authorization, Worker budget/reminder integration, the local capacity/restart drill and all Chromium projects. Browser fixtures use separate temporary persistence directories, avoiding concurrent local SQLite store locks. Production jobs are serialized and do not cancel an in-flight deployment.
2. Existing production environment secrets must provide `CLOUDFLARE_ACCOUNT_ID` for account `8021bdc634228f81e497bdcd8fcbd153` and a scoped `CLOUDFLARE_API_TOKEN` for the Worker operations. The workflow's read-only GitHub token checks main. Do not copy provider keys or personal login credentials into GitHub. Existing environment secret availability and a successful GitHub production run are not verified by this batch; the connector cannot read/manage that secret configuration or dispatch this workflow. Do not repeat unrelated account setup.
3. The script verifies the workflow/repository/account/main SHA, compares SQL hashes with `docs/approved-migrations.json`, reads the current 100% version and stages a new version using `wrangler versions upload --keep-vars --strict`. Upload does not activate it. Changed SQL or a new Durable Object migration requires its separate reviewed application, verification and manifest update. This script does not apply database migrations or prove that their live contents match the manifest.
4. Before activation, all binding names/types/available values/resource IDs and full runtime/assets/header metadata must match the active version. Private access, owner identity, owner Google login, routing disable, database project, BudgetLedger, required secret names, fetch/scheduled handlers and migration tag `v1` are checked. Main and the active version/settings are read again immediately before activation. Secret values are not read; name equality cannot prove secret-value equality. The upload carries forward secrets and contains no secret-update command.
5. Activation requests one version at 100%. Configuration is independently read afterward. Unauthenticated root, reminder deep link, new main asset and account APIs must return 401/no-store/CSP. `/sw.js` intentionally returns 200/no-store for old-cache cleanup and must equal the tested source. Private cleanup access is not permission to expose an offline application shell.
6. Save the `production-release-record` artifact, which contains the source SHA and dry-run Worker build hash, previous/staged/active version IDs, deployment result and private smoke checks. That build hash is not an independent download/hash of the uploaded Worker. Inspect failed runs: a staged version may exist without activation; a timed-out activation may have succeeded. Always read current deployment before retrying. The record deliberately contains no raw bindings, tokens or subprocess output. A successful toolchain test is not a successful GitHub production run or owner acceptance.

The GitHub concurrency group serializes this workflow only. Other dashboard/connector operators must avoid simultaneous releases; the Cloudflare deployment endpoint has no compare-and-swap in this script. An external deployment after the last read is a remaining race. No triggers, provider limits, account roles or stored routes are changed by the release script. Cron remains `*/10 * * * *` and the existing Durable Object is retained.

## Recovery

First retain the failing source/version, UTC timestamp, request ID and safe error category. Never place precise route locations, Auth cookies, reset links, provider tokens or private website credentials into public issues or logs.

| Incident | Action | Recovery evidence |
|---|---|---|
| Failed upload/preflight | Keep the current deployment. Inspect missing environment configuration or the reported incompatible field; repair source and rerun CI. | Deployment ID/version unchanged; no activation attempt. |
| Activation timeout or failed post-check | Read Cloudflare's active deployment first. Determine whether the candidate is live. Keep private access required while repairing. | Current version percentages and locked root/API/asset responses. |
| Frontend regression | Prefer a tested forward fix. If needed, choose a known private version with compatible runtime, bindings and database schema, then activate it at 100%. | Version ID, binding/runtime comparison, private smoke checks and signed-in owner acceptance when available. |
| Reminder failure | Inspect safe status/attempt/expiry counts and cron errors. Keep approximate delivery wording; expired occurrences must not be resurrected. No live push test while postponed. | Queue expiry/retry state; failed endpoint removal remains device-specific. |
| Provider quota/billing mismatch | Disable the affected provider using owner Admin drafts/Save while retaining private access and zero budget. Reconcile its account usage; do not increase caps to mask the difference. | Provider period/units/account, app counters and owner-approved resolution. |
| Personal-account mismatch | Stop writes, use local personal sign-out, reopen the intended account and reload routes/preferences. Never change the owner UUID or weaken RLS. | Correct account identity and owned route/preferences after re-login. |

Release 27 (`c71a2311-f210-40bc-94b7-f85e4c2085e6`) is the prior private candidate. Release 28's device/reminder migration is additive and retains legacy subscriptions, but older code may not honor every new device/reminder semantic. Confirm compatibility before using it and record the limitations. Rolling back Worker code does not roll back PostgreSQL, Durable Object data, quotas or already delivered notifications. Do not delete the new tables or restore an old database snapshot as a routine frontend rollback. No new production rollback exercise is claimed.

## Capacity and monitoring

`npm run worker:build && npm run test:capacity` runs a disposable local workerd drill: 100 locked requests with a missing verifier fail closed, 100 simultaneous provider reservations accept exactly 20, and 50 simultaneous analyses for one account accept exactly 10. A full runtime restart with the same persistent storage must preserve provider/account counters and zero-budget configuration. All outbound calls are blocked; this spends no real provider quota. The temporary storage is removed. Results are in `artifacts/operations/capacity.json`.

Those wall times are local end-to-end fixture durations, not production CPU, memory, p95 latency, active-user capacity or a Free-plan guarantee. Hosted CPU/memory/quota and real-phone cold/warm measurements remain open. Production load tests would need a bounded route/provider-free plan and current platform/account limits; they are not run here. Do not use a forecast route to generate an unbounded load test.

For each release and when investigating an incident, inspect Worker request/error/CPU trends, cron outcome counts, Supabase project health, and Admin provider usage/allowance errors. Current Worker logs sample 10%; redacted query strings help limit location leakage, but sampled logs cannot give a complete delivery or billing count. Save aggregate counts and safe request IDs, not raw provider forecasts or private row contents. No recurring monitoring automation is created by this procedure.

## Account evidence still needed

When hosted account acceptance resumes, use a disposable named route under the intended account, preserving existing routes and preferences. Record deployed version and time, then verify create/edit/Cancel/delete, Today/Plan fast launch and buffer/timezone/language/preferences after local sign-out and re-login. Delete only that disposable route. Re-login persistence cannot be certified from an existing row or a database-admin read.

For isolation, use two ordinary user sessions and a second session for the same user: A must not see or edit B's rows; local sign-out in A's first browser must clear its visible account state while A's other session and B remain usable. A website unlock is distinct from a personal account session. Existing RLS/client/Worker fixture checks support the implementation; actual hosted two-account/device evidence is still required. Do not create users, send mail or collect passwords just to fill this report.

Queue 16–20 remains postponed: real private Remember me/expiry/lock across devices, GPS approval/denial/fresh origin/pin, target-market nearby/reverse search, Android coordinate Apply/Cancel/Arabic/zero/error cases, and map route recovery/Arabic road shaping. The separate Libya ETA blocker A33 stays open. Full V1 is not accepted.

## Primary references

- Cloudflare version staging, storage and deployment behavior: https://developers.cloudflare.com/workers/versions-and-deployments/
- Wrangler upload/keep-vars/strict flags: https://developers.cloudflare.com/workers/wrangler/commands/workers/
- GitHub deployment environments/concurrency: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
- Supabase local sign-out and access-token lifetime: https://supabase.com/docs/guides/auth/signout
