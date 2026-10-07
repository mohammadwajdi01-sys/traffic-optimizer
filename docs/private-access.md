# Private beta access

The Worker runs before **all** static asset and API routes (`assets.run_worker_first = true`). Set PRIVATE_ACCESS_REQUIRED=true and provide PRIVATE_ACCESS_CREDENTIALS as a Worker **secret**, never in source, Wrangler vars, browser JavaScript or a public report.

The secret is JSON with `username`, random 16-byte `salt` (hex), PBKDF2-HMAC-SHA256 `hash` (32 bytes, hex, 100000 iterations), and a random 32-byte `signingKey` (hex). Passwords are submitted in a same-origin form POST over HTTPS; plaintext passwords are not retained. A valid login grants a signed, hostname-bound, 12-hour Secure/HttpOnly/SameSite=Lax cookie. Existing personal account authorization, guest human verification and provider limits remain in force after unlocking. Missing/invalid configuration fails closed.

Wrong credentials receive one generic message; five login attempts per source IP per ten-minute bucket are permitted. IPs are hashed for rate-limit storage. GET, foreign-origin forms, external return targets, altered and expired cookies are rejected. Credential/signing-key rotation invalidates existing sessions. Settings has a separate Lock website action; this does not merge or replace personal accounts.

Private responses are no-store. The service worker removes old traffic shell caches and uses network requests; private offline shell access is deliberately disabled. `/sw.js` alone is available without the lock so existing installs can update and purge old caches. It contains only cache-cleanup and generic push/click handlers, no app content, credentials or account data. Notification delivery still needs actual phone acceptance. Previously downloaded or already displayed content cannot be recalled; fresh requests are locked.

`privatecheck` is an isolated local/CI environment. `scripts/private-fixture.mjs` generates disposable test-only credentials in an ignored `.dev.vars.privatecheck` file. It never supplies live credentials. Real workerd tests cover authentication, routes/assets/API denial, expiry, host/origin checks, throttling and logout. Browser CI tests exercise the rendered form and Secure cookie on desktop and two phone sizes. Live owner acceptance must cover unlock, existing Google/email callback, saved-route session, Lock website, expired-cookie refresh and an incognito deep link.

Rollback to the previous PUBLIC build reopens the website. For private recovery, keep the lock-enabled Worker and repair forward, or explicitly obtain approval to reopen access. Do not silently roll back to a public version.
