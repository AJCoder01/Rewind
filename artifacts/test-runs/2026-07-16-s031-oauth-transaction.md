# S031 OAuth transaction flow

Date: 2026-07-16
Task: S031
Branch: `codex/s031-oauth-transaction`

## Scope

Implemented the fail-closed Google OAuth transaction boundary:

- high-entropy `state`, OIDC `nonce`, PKCE S256 verifier/challenge, fixed scopes, and exact callback redirect;
- ten-minute browser-session-bound transaction storage with hashed state/session/nonce values;
- atomic PostgreSQL one-use consumption and deterministic memory coverage;
- AES-256-GCM envelopes for PKCE verifiers and refresh tokens;
- numbered `0002_oauth_transaction` migration with exact catalog/checksum and restricted runtime grants;
- authenticated start/callback routes. The callback intentionally stops before token exchange or credential storage until S032 validates signed OIDC identity claims.

No Google consent, live token exchange, Calendar call, Gmail call, mailbox/profile read, or external effect was performed.

## Verification

All results below are sanitized; no secret, token, connection string, recipient address, or provider identifier is included.

- `node --version`: `v25.9.0` (the repository pins Node `>=24 <25`; `npm ci` completed with the expected engine warning because this host does not have Node 24).
- `npm ci`: passed; 441 packages installed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: passed, 31 files / 173 tests.
- `npm run build`: passed; both OAuth routes compiled as dynamic Node routes.
- `npm run test:e2e`: passed; existing auth, create/read, strict review, expiry, cancel/back, keyboard/reduced-motion/responsive smoke remained green.
- `npm audit --audit-level=moderate`: passed; 0 vulnerabilities.
- `npm run security:scan`: passed; 156 files and 400 reachable-history blobs scanned, 0 findings.
- `npm run config:check`: passed for application and MCP scopes.
- `npm run verify:fake-production`: passed; production fixture mode rejected.
- `npm run verify:g1-interface`: passed; `g1-interface.v1`, 25 error codes, 12 task statuses, 7 action statuses, 3 evidence files.
- `npm run traceability:check`: passed; `traceability.v1`, 52 requirements, 3 covered / 18 partial / 31 planned.
- Focused S031 tests: passed; state/nonce/PKCE, exact redirect, AES-GCM tamper/wrong-key, session binding/replay, duplicate callback-parameter rejection, readiness requiring the OAuth migration, route behavior, encrypted credential, and migration checksum/catalog tests are included in the full 173-test result.
- `npm run eval:recovery`: intentionally remains unavailable before the planned Phase 4 recovery planner and 25-paraphrase fixture set; this is unrelated to S031.
- Disposable PostgreSQL apply/replay was not run locally because no PostgreSQL 16 image is available on this host. The CI `db:verify:ephemeral` job now applies and replays both migrations; Production migration remains a human-only step.

## Remaining risk and manual action

S032 must add signed OIDC claim validation and wire the provider token exchange before any callback can report a connected identity. After this branch is merged, a human must apply the reviewed `0002_oauth_transaction` migration using the private `DATABASE_MIGRATION_URL`, run the sanitized `npm run db:verify` checks, and redeploy; no production migration or OAuth consent was run by Codex.
