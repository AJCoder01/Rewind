# S033 OAuth negative-test evidence

Date: 2026-07-16
Task: S033 — add OAuth negative tests
Branch: `codex/s032-oauth-claims`

## Outcome

Passed the S033 negative-test packet with deterministic provider fakes. Callback and helper tests fail closed for missing or mismatched state, replay, missing PKCE verifier, redirect drift, nonce mismatch, wrong issuer/audience/stable subject/configured account, expired and unverified identities, malformed ID tokens, and a provider-rejected mismatched PKCE verifier. Every rejected callback leaves the credential store empty. The formerly un-stubbed provider-failure test now uses a deterministic transport failure and cannot reach a live endpoint.

## Requirements and contract versions

- Requirements: SAFE-04, SAFE-05, SAFE-09, SAFE-10, NFR-10.
- Runtime contracts: `GoogleOAuthCallbackQuerySchema`, `GoogleOidcClaimsSchema`, `GoogleOAuthTokenResponseSchema`.
- Existing persistence contract: OAuth transaction `v1` and migration `0002_oauth_transaction`; no migration changed.
- Evidence is synthetic and redacted. No real account, email address, subject, OAuth secret, token, URL, or provider receipt is recorded.

## Verification

| Command | Result |
|---|---|
| `npm.cmd test -- tests/unit/oauth-transaction.test.ts tests/unit/oauth-routes.test.ts tests/unit/google-identity.test.ts` | Passed: 3 files, 38 tests |
| `npm.cmd test` | Passed: 33 files, 201 tests |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed: Next.js production build |
| `npm.cmd run security:scan` | Passed: 160 files and 456 history blobs, no findings |
| `npm.cmd run verify:fake-production` | Passed: production fixture rejected |
| `npm.cmd run traceability:check` | Passed: 52 requirements; 3 covered, 19 partial, 30 planned |
| `git diff --check` | Passed |

## Safety boundary

No Google consent, live authorization-code exchange, live refresh, Gmail profile/mailbox read, Calendar call, Gmail send, model call, database migration, or other external effect was run. All provider interactions in the tests are deterministic fakes.

## Remaining risk

Live OAuth ownership, consent, provider refresh, and the reviewed OAuth migration remain unverified. The next task defines explicit provider ports and deterministic fakes for the later Calendar/Gmail/artifact/model work; S035 will be the first TTY-gated Calendar discovery/seed boundary.
