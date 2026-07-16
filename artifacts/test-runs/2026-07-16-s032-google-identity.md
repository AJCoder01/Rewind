# S032 Google identity evidence

Date: 2026-07-16
Task: S032 — enforce connected Google identity claims
Branch: `codex/s032-oauth-claims`

## Outcome

Passed the local S032 implementation packet with deterministic provider fakes. The callback now requires a signed RS256 Google ID token, accepted issuer and audience/`azp`, valid time claims, the transaction nonce, `email_verified`, the configured stable subject, the configured email, and the exact four approved OAuth scopes before storing an encrypted refresh token. Refresh validates the token response and encrypts a rotated refresh token. The callback test observed only the token and JWKS endpoints; no Gmail profile or mailbox endpoint was called.

The Postgres OAuth transaction regression test also confirms that the consumed timestamp is bound to the timestamp parameter rather than the redirect URI.

## Requirements and contract versions

- Requirements: SAFE-04, SAFE-05, SAFE-09, SAFE-10, NFR-10.
- Runtime contracts: `GoogleOidcClaimsSchema`, `GoogleOidcJwtHeaderSchema`, `GoogleOAuthTokenResponseSchema`.
- Existing persistence contract: OAuth transaction `v1` and migration `0002_oauth_transaction`; no migration changed.
- Evidence is synthetic and redacted. No real account, email address, subject, OAuth secret, token, URL, or provider receipt is recorded.

## Verification

| Command | Result |
|---|---|
| `npm.cmd test -- tests/unit/oauth-transaction.test.ts tests/unit/oauth-routes.test.ts tests/unit/environment-config.test.ts tests/unit/google-identity.test.ts tests/unit/oauth-store.test.ts` | Passed: 5 files, 39 tests |
| `npm.cmd test` | Passed: 33 files, 190 tests; one traceability-count expectation was corrected after the first full-suite run |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed: Next.js production build |
| `npm.cmd run traceability:check` | Passed: 52 requirements; 3 covered, 19 partial, 30 planned |
| `git diff --check` | Passed; only local Git ignore/line-ending warnings were emitted |

## Safety boundary

No Google consent, live authorization-code exchange, live refresh, Gmail profile/mailbox read, Calendar call, Gmail send, model call, database migration, or other external effect was run. Live OAuth configuration, ownership confirmation, and provider refresh remain human/provider-gated work for S043 and the later TTY-gated steps.

## Remaining risk

The implementation is locally verified with generated RSA keys and deterministic token/JWKS responses. Deployment still requires the reviewed OAuth migration and human-controlled provider configuration/consent before any live identity or refresh proof can be claimed.
