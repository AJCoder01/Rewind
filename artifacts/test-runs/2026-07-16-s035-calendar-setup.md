# S035 controlled Calendar setup report

| Field | Value |
|---|---|
| Task | S035 — controlled Calendar discovery and seeding |
| Status | Safe implementation complete; human live checkpoint pending |
| Date | 2026-07-16 |
| Contract | `calendar-demo.v1`, `provider-ports.v1`; existing `0001_phase0_foundation` `demo_event_state`/`audit_events` tables |
| Requirements | FR-04, SAFE-05, SAFE-10, NFR-04, NFR-10 |

## Implemented boundary

- Added a strict Google Calendar wire adapter that maps only the required event fields, refuses malformed/all-day/recurring/untagged responses, binds operations to the explicit configured calendar, uses `sendUpdates=none`, and sends `If-Match` on narrow start/end updates.
- Added DST-aware construction for exactly two one-off 30-minute Acme events on `2026-08-20`: UK at 10:00–10:30 ET and US at 11:00–11:30 ET, with exact private tags and one configured recipient per region.
- Added exact-two candidate validation for ownership, event type, recurrence absence, time zone, duration, title, region, tags, organizer digest, attendee-set digest, and calendar target.
- Added immutable semantic-baseline persistence and rolling ETag/updated tracking. Seed audits are persisted before each create; provider, validation, partial, and persistence failures remain visible and are never auto-retried.
- Added `seed:demo` and `preflight:demo` guards for real TTY input, non-production mode, non-CI execution, PostgreSQL storage, explicit calendar target, and interactive run-specific confirmation. Output contains only sanitized status/counts/fingerprints.
- No generic compensation/workflow abstraction was added.

## Automated evidence

| Command | Result |
|---|---|
| `node --version` | Passed: `v24.14.0` |
| `npm.cmd ci` | Passed after approved retry for a local npm-cache permission error: 438 packages installed, 439 audited, 0 vulnerabilities |
| `npm.cmd test -- tests/unit/calendar-demo.test.ts tests/unit/calendar-demo-command.test.ts tests/unit/google-calendar.test.ts tests/unit/provider-ports.test.ts` | Passed after contract hardening: 4 files, 23 tests |
| `npm.cmd test` | Passed after clean install and contract hardening: 37 files, 224 tests |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed sequentially: Next.js production build, 9 static pages and all routes generated |
| `npm.cmd run test:e2e` | Passed sequentially: fixture auth, creation, review, expiry, cancel/back, and reduced-motion checks |
| `npm.cmd run verify:g1-interface` | Passed: packet version `g1-interface.v1`, 25 error codes, 12 task statuses, 7 action statuses |
| `npm.cmd audit --audit-level=moderate` | Passed: 0 vulnerabilities |
| `npm.cmd run security:scan` | Passed: 168 files and 480 history blobs scanned, 0 findings |
| `npm.cmd run verify:fake-production` | Passed: production fixture rejection |
| `npm.cmd run traceability:check` | Passed: `traceability.v1`, 52 requirements (3 covered, 20 partial, 29 planned) |
| `npm.cmd run eval:recovery` | Expected exit 1: recovery evaluation is unavailable before the Phase 4 planner and 25-paraphrase fixture set |
| `git diff --check` | Passed; only Git's local line-ending normalization warnings were emitted |

Tests cover positive seed/preflight, DST boundaries, exact candidate count, wrong ownership/tag/type/recurrence/recipient/time, existing tagged events, immutable state, stale rolling versions, provider failure/audit, malformed Google responses, 404/412 mapping, narrow create/update payloads, bearer headers, and TTY/CI/production/fixture/implicit-primary rejection.

The first combined build/E2E attempt was intentionally discarded after concurrent commands raced on the shared `.next` directory and produced a transient missing `/_document` error. The commands were rerun sequentially and both passed; no source change was required.

## Human-only boundary not performed

No OAuth refresh, credential read, database connection/migration, Google Calendar read, Google Calendar create, Calendar preflight, Gmail call, model call, or external effect was performed for this packet. The command wrappers are intentionally not runnable in the current non-TTY automated session.

Before S035 can be marked complete, the human owner must, in a private terminal and without pasting secrets into chat:

1. Confirm the intended controlled PostgreSQL target and that `0002_oauth_transaction` is applied/verified; never use an unknown `DATABASE_URL`.
2. Confirm the connected Google grant belongs to the configured subject/email, has only the approved OIDC, `calendar.events.owned`, and `gmail.send` scopes, and has an explicit `REWIND_GOOGLE_CALENDAR_ID`.
3. From a real TTY on this branch, run `npm.cmd run seed:demo`, inspect the target fingerprint, and enter the run-specific confirmation phrase. Confirm only a sanitized success/partial/failure result.
4. From the same controlled environment, run `npm.cmd run preflight:demo` and confirm sanitized evidence reports exactly two owned, timed, non-recurring tagged events, matching baselines, rolling versions, and allowlist digests.
5. Share only pass/fail, counts, contract version, and redacted status. Do not share secrets, tokens, full event IDs, attendee addresses, or provider response bodies.

## Remaining risk

Live account/calendar ownership, token refresh, target selection, exact provider response behavior, baseline persistence against the intended database, and TTY command execution remain unverified. S036 remains the next implementation task only after this S035 human checkpoint is complete.
