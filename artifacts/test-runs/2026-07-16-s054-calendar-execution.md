# S054 Calendar execution report

Date: 2026-07-16
Task: Execute the exact approved initial Calendar move through the durable action ledger.
Status: Passed locally; S055 is next.

## Implemented boundary

- Added `initial-calendar-execution.v1` with typed before-state, after-state, move receipt, decision, and redacted failure contracts.
- Added the dashboard-only `executeApprovedInitialCalendar` service.
- Revalidated the immutable plan/approval binding and artifact dependency before provider access.
- Refetched the exact Calendar target immediately before mutation and checked the approved ETag, target identity, approved start/end, 30-minute duration, IANA time zone, organizer digest, attendee-set digest, configured allowlist, ownership, event type, recurrence, and private tags.
- Persisted the complete typed before-state before the provider call.
- Passed only the approved calendar/event IDs, ETag, start, end, and `sendUpdates: "none"` to the conditional Calendar port.
- Required a verified desired after-state with preserved static fields and a new ETag before recording success.
- Classified pre-write read unavailability as retryable; stale/precondition drift, missing targets, provider conflict, ambiguous update outcomes, malformed snapshots, and verification failures as durable stops; succeeded replay skips the provider call.

## Verification

| Command | Result |
|---|---|
| `npm.cmd test -- tests/unit/initial-calendar-execution.test.ts` | Passed: 1 file, 9 tests |
| `npm.cmd test` | Passed: 61 files, 396 tests |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed with no errors or warnings |
| `npm.cmd run build` | Passed; all Next.js routes compiled |
| `npm.cmd run test:e2e` | Passed; auth/login/create/review/session expiry/cancel/back/reduced-motion responsive checks |
| `npm.cmd run verify:g1-interface` | Passed; packet version `g1-interface.v1`, 25 error codes, 12 task statuses, 7 action statuses |
| `npm.cmd run security:scan` | Passed; 277 files and 851 reachable-history blobs scanned, no findings |
| `git diff --check` | Passed |

The focused suite proves exact before-state ordering, start/end-only input, `sendUpdates: "none"`, new-ETag verification, replay skip, stale ETag refusal, allowlist drift refusal, retryable read unavailability, ambiguous update conflict, persistence failure with zero Calendar writes, verification failure, and artifact-before-Calendar ordering.

## Effect boundary

All S054 verification used deterministic candidate resolution, initial plan expansion, in-memory execution persistence, `FakeArtifactPort`, and `FakeCalendarPort`. No live OAuth refresh, Google Calendar read/write, Gmail call, model call, PostgreSQL mutation, or external effect was performed. The controlled live initial flow remains the human-only S058 checkpoint; this task does not authorize or perform it.

## Remaining risk

The Calendar executor is not yet connected to a user-facing execution/resume route, Gmail remains S055, and the complete browser/timeline workflow remains S056-S057. Any ambiguous post-update result remains a durable conflict requiring reconciliation; it is never automatically retried.
