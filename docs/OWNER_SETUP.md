# Owner activation — current continuation

Existing connections are available for GitHub, Cloudflare and the dedicated Supabase project. No reconnection is required.

Owner: mohammadwajdi01@gmail.com.
Supabase: https://supabase.com/dashboard/project/bdxwyehnqwylvgoxyhhx
Hosted beta: https://traffic-optimizer.mohammadwajdi01.workers.dev/

## Owner-reported completed configuration

- Supabase URL/redirect settings saved.
- Cloudflare server key saved and changed to Secret.
- Google login provider enabled.

## Verification still needed

- Determine the current server-secret binding name and reconcile code compatibility. Never print or commit secret values.
- Verify the Google provider is enabled in the correct Supabase project and add the corresponding OAuth interface to this recovered baseline.
- Verify real owner sign-in and consistent server/database authorization.
- Verify saved routes/preferences, cross-user isolation and opt-in reminder delivery.
- Keep paid usage and Google routing disabled. Do not use a login setting as evidence that traffic coverage is available.

The previous setup guides claimed GitHub read-only access and missing owner configuration. Those claims are historical and must not be used to request repeated setup. A secure sign-in may be needed only if the remaining authenticated verification cannot use existing connections; stop and state the exact blocker at that point.


## Personal password accounts — 8 October 2026

Email signup/login, resend confirmation and forgot-password flows use:
`https://traffic-optimizer.mohammadwajdi01.workers.dev/settings`

In Authentication → URL Configuration, retain the existing production Site URL and allow this exact HTTPS settings redirect. Do not add broad wildcards or change the working Google callback. All signup, magic-link, reset and Google app redirects use this URL. In the email provider settings, retain email confirmation. Public settings confirm signup enabled, confirmation required and Google enabled; SMTP and the actual allowlist have not been inspected through the current connector.

For owner email verification, sign in with Google using mohammadwajdi01@gmail.com, open Settings → Change password, then request one reset email. Open the newest email link, unlock the website if prompted, verify the account email, and set a new password yourself. Do not share the password or reset URL/token. After local personal sign-out, sign back in with the same email/password and check the owner identity and saved routes. Google login remains available and does not require creating a separate owner account.

For an ordinary account, use Create account and confirm the actual email, then sign in. A successful request message alone does not establish receipt. Supabase's default mail transport restricts delivery to project-team addresses; an ordinary non-team signup requires suitable SMTP. Current configuration is unknown, so do not assume SMTP is absent or configured. Configure only a verified zero-cost sender approved by the owner, keep confirmation enabled and do not purchase a plan. If a request fails, retain the error category and request timestamp; do not disclose passwords or email-link tokens.

Live email acceptance is pending owner evidence; Android and Libya validation stay postponed. No SMTP configuration or Auth allowlist change has been made by this account release.


## Password policy and owner acceptance — 8 October 2026

The owner reports the previous email/reset/login check all worked. This is user-reported acceptance, not an independent observation or proof of ordinary non-team email delivery.

Every personal password and confirmation input now has its own labelled eye toggle, including signup, login and recovery. Signup/new-password validation requires at least eight characters, one ASCII uppercase letter, one ASCII lowercase letter, one number and one supported symbol; existing passwords can still be used to sign in. Password drafts are never persisted.

**Backend policy still requires configuration and verification.** The current connector exposes no Auth password-policy management operation. In the dedicated project's Authentication → Sign In / Providers → Email password-security settings, set minimum password length to 8 and Required characters to lowercase + uppercase + digits + symbols. Retain email confirmation and the working Google provider/redirect. Verify by a controlled direct Auth signup/update request that a password missing each category is rejected and an accepted recovery session can set a compliant password. Do not infer server enforcement from frontend rejection. No SMTP, provider billing, redirect, owner identity or backend password policy was changed by this UI batch.

Reference: https://supabase.com/docs/guides/auth/password-security . New policy configuration is tracked under WBS 3.05–3.07 / 7.9; it does not close live two-account or postponed phone/traffic acceptance.
