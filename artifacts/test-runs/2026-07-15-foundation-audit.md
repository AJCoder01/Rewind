# Foundation audit and repair evidence — 2026-07-15

## Verdict

The local, deterministic, non-effecting foundation is fit to proceed to `S007`. This is **not** evidence that Supabase, a deployed PostgreSQL path, OpenAI, Calendar, Gmail, approval/execution, recovery, or reset works. No provider credential or external effect was used.

## Baseline and scope

- Reviewed branch: `main`.
- Baseline before the audit: local and `origin/main` at `6972225`.
- Runtime used for accepted checks: bundled Node.js `v24.14.0`, which satisfies `package.json` engine `>=24 <25`.
- Default shell Node.js `v25.9.0` was deliberately not used because it is outside the supported engine.
- Repository documentation, app/routes, auth, shared contracts, fixture/domain code, PostgreSQL store/migration, MCP entry point, scripts, tests, dependency state, browser behavior, and Git/secret hygiene were reviewed.
- S007 was not performed because it requires the human owner's authenticated Supabase account and private credentials.

## Defects found and repaired

| Area | Repair |
|---|---|
| Dashboard auth | Removed the public development signing-secret fallback; missing configuration now fails closed; rejected malformed sessions with extra token segments. |
| Login flow | Added same-site-only return paths so an expired session returns to the intended World PR without creating an open redirect. |
| Plan contracts | Added closed two-candidate/region checks, selected-candidate/action consistency, immutable digest verification, exact artifact/mail hash verification, and complete fixture-only model metadata. Cryptographic verification remains server-only so Node crypto cannot enter client bundles. |
| Stored record integrity | Re-parse persisted JSON through canonical schemas and bind plan IDs/digest/actions/assumptions, selected/alternative labels, request, and run ID to the immutable payload. Clarification records with no plan remain readable. |
| Fixture provenance | Hash the exact parent-account source bytes and run a versioned independence validator against scenario-dimension leakage. |
| Idempotency | Return the canonical completed response unchanged; reconcile a claim when database client acquisition fails; do not claim full in-progress/lease semantics before `S021`. |
| Database configuration | Require a distinct `DATABASE_MIGRATION_URL`, load ignored local environment files for migration, require TLS for non-local URLs, and reject duplicate `sslmode` override attempts. |
| Product/UI | Show exact Calendar before/after start and end times plus recorded confidence. |
| MCP | Return only the safe World PR ID/status/review URL shape rather than the full HTTP response. |
| Tests | Expanded auth, return-path, TLS URL, digest/hash, candidate, replay, clarification, stored-view consistency, connection-failure, provenance, and expired-session E2E coverage. |

## Verification results

| Check | Result |
|---|---|
| `npm ci --prefer-offline --no-audit` | Passed; 441 packages installed from the lockfile. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 5 files, 28 tests. |
| `npm run build` | Passed: optimized Next.js production build, 8 routes. |
| `npm run test:e2e` | Passed: unauthenticated redirect, wrong-passcode rejection, authenticated creation, strict review rendering, expired-session handling, and safe return to the review URL. |
| In-app browser review | Passed at desktop and 390×844 mobile viewport; semantic content present and no horizontal overflow. |
| `npm audit --audit-level=moderate` | Passed earlier against the unchanged lockfile: 0 known vulnerabilities. A final repeat could not reach the npm advisory endpoint (`ENOTFOUND`); no package or lockfile changed between those attempts. |
| Tracked secret-pattern scan | Passed: no credential-shaped secret found; documentation contains placeholders only. |
| Git whitespace check | Passed. |
| Deferred command guards | `eval:recovery`, `seed:demo`, `preflight:demo`, and `reset:demo` refused with their explicit phase-gate messages. |
| Migration guard without credentials | Refused before connecting: `DATABASE_MIGRATION_URL is required; no database connection was attempted.` |
| MCP guard without credentials | Refused startup because `MCP_BACKEND_TOKEN` was absent. |

The first post-repair build correctly detected a Node-crypto import crossing into the client bundle. The contract implementation was split into browser-safe structural validation and server-only cryptographic integrity validation; the production build then passed. An E2E attempt initially collided with the already-running manual review server on port 3100; after that server was cleanly closed, the isolated E2E rerun passed.

## S001–S006 trace summary

These rows identify requirements exercised by the foundation; they do not mark later live acceptance criteria complete.

| Task | Evidence | Requirements touched | Schema/fixture version | Remaining risk |
|---|---|---|---|---|
| S001 | Git remote/history and clean baseline inspected | Repository prerequisite | N/A | None for proceeding to S007. |
| S002 | Foundation decisions and canonical docs reconciled | SAFE-01–10 design constraints; NFR-10 | N/A | Provider decisions still require live gate evidence. |
| S003 | Strict Next.js/TypeScript package and Node 24 command suite verified | SAFE-09; NFR-08, NFR-10 | API v1 scaffold | CI/clean-checkout proof remains S013/S018. |
| S004 | Strict schemas, opaque IDs, canonical digest and integrity tests | FR-07, FR-08; SAFE-08; NFR-04, NFR-06 | `initial-plan.v1`, `initial-reasoning.v1` | Complete lifecycle/error fixtures remain S019/S029. |
| S005 | Migration/store reviewed; uniqueness and failure behavior covered with deterministic tests | FR-02, FR-03, FR-10, FR-12; NFR-02, NFR-06 | `0001_phase0_foundation.sql` | No real PostgreSQL proof until S007/S008. Migration ledger/readiness work remains S008/S013. |
| S006 | Dashboard + thin MCP/API + fixture service + review UI + browser flow verified | FR-01, FR-06–08; SAFE-03, SAFE-04, SAFE-08, SAFE-10; NFR-04, NFR-08, NFR-10 | deterministic fixture `fixture-initial.v1`; artifact validator `artifact-independence.v1` | This is non-effecting fixture evidence only. Cancel/back, full negative matrix, and deployed database path remain G1 tasks. |

## Explicit remaining risks and next gate

1. `S007` is next: provision and harden Supabase manually using `docs/S007_SUPABASE_GUIDE.md`; no migration should run during that task.
2. `S008` must apply the migration to real PostgreSQL and verify repeatability, all constraints, runtime grants, TLS behavior, uniqueness, and readiness. The `CREATE TABLE IF NOT EXISTS` migration is not accepted merely because it exits successfully.
3. The PostgreSQL store still builds deterministic fixture plans. A deployed fake-in-production refusal is intentionally outstanding under `S023`; do not describe a PostgreSQL-backed fixture result as a live planner/provider result.
4. Full concurrent in-progress replay, crash leases, and ambiguous commit reconciliation remain `S021` work.
5. Route/MCP negative matrices, duplicate-click concurrency, accessibility, CI, and production fake guards remain `S013`, `S022`, `S023`, `S027`, and later gate work.
6. Calendar, Gmail, OpenAI, approvals, recovery, rules, and reset remain disabled/unimplemented and require their numbered gates.

No remaining finding from this audit blocks the human from completing S007.
