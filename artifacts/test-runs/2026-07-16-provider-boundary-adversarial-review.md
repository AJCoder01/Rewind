# Provider-boundary adversarial review

| Field | Value |
|---|---|
| Scope | Current `codex/s032-oauth-claims` diff against `origin/main` after S031-S035 |
| Date | 2026-07-16 |
| Verdict | PASS WITH NON-BLOCKING RISKS |
| Requirements | FR-04, SAFE-05, SAFE-10, NFR-04, NFR-10 |

## Confirmed findings and corrections

1. **P1 - Calendar response projection.** The Google adapter used the
   collection-only `items(...)` partial-response selector for single Event
   `get`, `insert`, and `patch` calls. Google Event operations return an Event,
   not an event collection, so the provider would reject those requests. The
   adapter now uses a dedicated Event selector for each single-event operation
   and retains `items(...),nextPageToken` only for list requests. Regression
   tests assert both projections and cover `get`, `create`, and `update`.
2. **P1 - Interactive setup confirmation.** The TTY seed/preflight prompt
   displayed only a target fingerprint. That did not let the operator confirm
   the exact configured Calendar required by the setup exception. The private
   confirmation phrase now includes the exact Calendar ID and unique run ID;
   normal command results remain sanitized status/counts/fingerprints only.
   A regression test rejects newline-bearing target values.

No P0 issue and no additional confirmed P1/P2 issue remained after review of
the OAuth claim boundary, strict provider contracts, Calendar seed state,
command guards, persistence paths, and deterministic fake adapters.

## Verification

| Command | Result |
|---|---|
| `node --version` | Passed: `v24.14.0` |
| `npm.cmd ci` | Passed: 438 packages installed; 439 audited; 0 vulnerabilities |
| `npm.cmd test -- tests/unit/calendar-demo-command.test.ts tests/unit/google-calendar.test.ts` | Passed: 2 files, 15 tests |
| `npm.cmd run lint` | Passed |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd test` | Passed: 37 files, 226 tests |
| `npm.cmd run build` | Passed: production build and 9 static pages |
| `npm.cmd run test:e2e` | Passed: deterministic fixture auth/create/review/expiry/cancel/reduced-motion flow |
| `npm.cmd audit --audit-level=high` | Passed: 0 vulnerabilities |
| `npm.cmd run security:scan` | Passed: 178 files and 504 history blobs; 0 findings |
| `npm.cmd run verify:fake-production` | Passed: production fixture rejection |
| `npm.cmd run traceability:check` | Passed: `traceability.v1`, 52 requirements (3 covered, 20 partial, 29 planned) |
| `npm.cmd run verify:g1-interface` | Passed: `g1-interface.v1`, 25 error codes, 12 task statuses, 7 action statuses |
| `git check-ignore -v .env.local` | Passed: ignored by `.gitignore`; file contents were not read |
| `git diff --check` | Passed; only local line-ending normalization warnings were emitted |
| `npm.cmd run eval:recovery` | Expected exit 1: unavailable before the Phase 4 recovery planner and fixture set |

## Deliberately unrun checks

No `.env.local` content, credentialed configuration check, database migration
or verification command, OAuth refresh, Google Calendar call, Gmail call,
OpenAI call, seed/preflight/reset command, or other live external effect was
run. Database commands require a known, intended target; seed/preflight/reset
are human-only TTY operations. No credential or private provider value was
read or committed.

## Remaining risk

S035 remains incomplete pending the documented human-only controlled database,
OAuth, TTY Calendar seed, and TTY preflight checkpoint. The next sequential
implementation task is S036 only after that checkpoint passes.
