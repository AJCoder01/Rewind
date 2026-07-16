# S035 OAuth callback compatibility correction

| Field | Value |
|---|---|
| Task | S035 — controlled Calendar discovery and seeding; OAuth callback unblock |
| Status | Provider hardening implemented locally; Production redeploy and one fresh live retry pending |
| Requirements | SAFE-04, SAFE-05, SAFE-09, SAFE-10, NFR-10 |
| Contract | Existing OAuth transaction `v1`; Google callback query boundary |

## Issue

The deployed callback first returned the sanitized `invalid_request` / incomplete-callback response after Google consent. After accepting Google's callback metadata and scope alias, the live failure advanced to the token/provider boundary and returned sanitized `provider_unavailable`. The production response did not expose a stage or provider code, so it could not distinguish token rejection, additive token metadata, JWKS failure, scope drift, encryption, or persistence.

The audit found a concrete contract mismatch capable of producing that exact `503`: Google's current web-server OAuth response documents optional `refresh_token_expires_in` for time-limited grants and requires clients to ignore unrecognized response fields, while Rewind's token schema rejected every unknown member. The same strict-addition risk existed in callback, ID-token-claim/header, and JWKS objects. See [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google code-model callback](https://developers.google.com/identity/oauth2/web/guides/use-code-model).

## Correction

- Accept Google's documented callback metadata with bounded schemas.
- Validate a returned callback `iss` only against Google's two accepted issuer spellings.
- Canonicalize only Google's redundant `userinfo.email` scope to the approved `email` identity scope.
- Reject duplicate/oversized callback inputs but ignore and project out bounded unknown provider parameters, as OAuth requires.
- Validate any returned front-channel scope before token exchange and enforce the same exact approved capability set from the token response before credential persistence; unrelated scopes remain rejected.
- Recognize bounded `refresh_token_expires_in` metadata and project all other unknown successful-token fields out without persisting or exposing them.
- Project unknown ID-token claims/header members and JWKS metadata out while retaining RS256, key, issuer, audience/`azp`, time, nonce, verified-email, stable-subject, and expected-email checks.
- Add 10-second provider timeouts and a 64 KiB token-response bound; do not retry the one-use authorization-code exchange automatically.
- Classify configuration, transaction store/secret, callback/token scope, token exchange, JWKS/identity, encryption, and credential persistence failures using only allowlisted stage/reason values. Provider descriptions, response bodies, codes, tokens, and configuration are never logged or returned.
- Keep authorization bound to the stored state, session, redirect, client, PKCE verifier, validated signed ID token, and exact scopes.
- Add regressions for time-limited/future response metadata, every supported safe token error classification, bounded unknown callback handling, partial front-channel scopes, identity/JWKS projection, and diagnostic redaction.

## Verification

| Command | Result |
|---|---|
| `npm test -- --run tests/unit/oauth-routes.test.ts tests/unit/oauth-transaction.test.ts tests/unit/google-identity.test.ts` | Passed: 3 files, 52 tests |
| `npm test` | Passed: 37 files, 240 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; OAuth callback remains a dynamic Node route |
| `npm run test:e2e` | Passed after host IPC rerun: auth rejection, login, create/review, expiry, cancel/back, reduced-motion responsive checks |
| `npm run security:scan` | Passed after host IPC rerun: 180 files and 525 history blobs, 0 findings |
| `npm run traceability:check` | Passed after host IPC rerun: `traceability.v1`, 52 requirements |
| `npm run verify:fake-production` | Passed after host IPC rerun: production fixture rejected |
| `git diff --check` | Passed |

No live Google consent, token exchange, refresh, Calendar call, Gmail call, mailbox/profile read, or external effect was performed by this correction. Production must be redeployed before the human OAuth attempt is repeated.
