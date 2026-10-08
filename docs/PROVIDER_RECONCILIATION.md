# Provider usage reconciliation — WBS 8.6

Status: procedure prepared; vendor account totals, subscription plans, billing and matching signed-in Admin counts remain unavailable. No quota or spending limit is raised. The code defaults below are reference settings, not verified purchased entitlements or a live ledger configuration export. Existing ledger data overrides defaults and is preserved during deployment.

| App counter | Unit / reset | Source defaults: free / hard / requests per minute | What to compare at the provider |
|---|---|---|---|
| `p:mapbox:YYYY-MM` | Worker Directions reservations / UTC month | 100000 / 98000 / 260 | Directions product requests for the exact account/token, including failures and other applications. |
| `p:google:YYYY-MM` | Worker Google Routes reservations / UTC month | 5000 / 4900 / 60; disabled | Actual Routes SKU/account billing only. Google OAuth login is a different service. |
| `p:geoapify:YYYY-MM-DD` | Worker search/reverse reservations / UTC day | 3000 / 2800 / 240 | Geoapify credits/request weights, plan and its own reset timezone. Credits need not equal request count. |
| `p:maps:YYYY-MM` | Map-token endpoint reservations / UTC month | 50000 / 48000 / 60 | Mapbox GL JS map loads and any other separately billed products for the public token. This counter counts token grants, not provider-confirmed map loads. |
| Account analysis allowance | Accepted day analyses / UTC day | guest 1, user 10, family 30, owner 100; overrides supported | Product allowance only; not a provider invoice or a weekly-plan count. |

Reservations occur before upstream dispatch, so a network/provider failure can still count in the app. A day comparison has at most 24 candidate forecasts; a seven-day one-direction check can use up to 168, with bounded fallback overhead. Reminder recurring planning and address/map usage also consume provider reservations. Example mode runs locally. Application counters cannot see another app using the same provider account. A token grant can lead to no map load, while provider-side/browser behavior may differ from grant count. Zero app budget does not establish zero provider-account billing.

For each reconciliation, retain this small record, using UTC and the provider's billing timezone:

| Field | Value to collect |
|---|---|
| Account/product/token identifier | A safe identifier; never the token value. |
| Exact start/end and timezone | Use the same interval on both sides. For cumulative counters, retain before/after snapshots. |
| App used count and current free/hard/rate/paid/budget settings | Signed-in owner Admin view; no private locations or user rows. |
| Vendor total, unit and plan entitlement | Dashboard/export, including shared app use, credits/SKU weights and reporting delay. |
| Difference and explanation | Reserved failed calls, other apps, timezone, product units, map-token approximation, or unresolved. Do not force equality by changing caps. |
| Billing | Amount/currency for that interval and any separate maps/search/backend/SMTP charges. |
| Resolution | Owner-approved changes only; retain zero spending unless separately authorized. |

If vendor usage exceeds the expected safe allowance, disable that provider and investigate. Credential restrictions/token separation and plan changes require account evidence; this batch does not certify them. There is no numeric active-user capacity or price recommendation without current account entitlements and observed workload. WBS 8.6 stays pending until the completed record is supported by provider-account evidence.
