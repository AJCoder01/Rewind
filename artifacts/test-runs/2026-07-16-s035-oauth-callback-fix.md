# S035 OAuth callback compatibility correction

| Field | Value |
|---|---|
| Task | S035 — controlled Calendar discovery and seeding; OAuth callback unblock |
| Status | Implemented locally; Production redeploy and live retry pending |
| Requirements | SAFE-04, SAFE-05, SAFE-09, SAFE-10, NFR-10 |
| Contract | Existing OAuth transaction `v1`; Google callback query boundary |

## Issue

The deployed callback returned the sanitized `invalid_request` / incomplete-callback response after Google consent. The callback schema was strict but allowed only the core `state`, `code`, and provider-error fields. Google's authorization-code response may also include bounded metadata such as `scope`, numeric `authuser`, hosted-domain `hd`, and `prompt`.

## Correction

- Accept Google's documented callback metadata with bounded schemas.
- Keep the metadata informational only; authorization remains bound to the stored state, session, redirect, client, PKCE verifier, and validated signed ID token.
- Keep unknown callback fields rejected.
- Keep exact approved scopes enforced from the token response before credential persistence.
- Add a regression proving the documented metadata path connects with deterministic provider fakes and an unknown field remains rejected.

## Verification

| Command | Result |
|---|---|
| `npm test -- tests/unit/oauth-routes.test.ts tests/unit/oauth-transaction.test.ts` | Passed: 2 files, 27 tests |
| `npm test` | Passed: 37 files, 227 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; OAuth callback remains a dynamic Node route |
| `npm run test:e2e` | Passed after rerun with host IPC permission |
| `npm run security:scan` | Passed: 179 files and 513 history blobs, 0 findings |
| `npm run traceability:check` | Passed: 52 requirements |
| `npm run verify:fake-production` | Passed |
| `git diff --check` | Passed |

No live Google consent, token exchange, refresh, Calendar call, Gmail call, mailbox/profile read, or external effect was performed by this correction. Production must be redeployed before the human OAuth attempt is repeated.
