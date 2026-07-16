# S036 Calendar primitives report

| Field | Value |
|---|---|
| Task | S036 — implement and prove Calendar primitives |
| Status | Complete |
| Date | 2026-07-16 |
| Contract | `calendar-demo.v1`, `provider-ports.v1` |
| Requirements | FR-13, FR-14, FR-17, SAFE-05, SAFE-10, NFR-02, NFR-04, NFR-10 |

## Implemented boundary

- Added strict `started`, `succeeded`, `conflict`, and `uncertain` Calendar operation receipts containing typed before/desired/after state where available and a verified provider receipt on success.
- Persisted the `started` record before each conditional provider write and rolled `expected_etag`/`expected_updated_at` only after a verified response.
- Added scenario-specific move and restore services. They refetch the event, verify ownership/type/recurrence/tag/attendee/time/version preconditions, use the existing `If-Match` start/end-only `sendUpdates=none` adapter operation, and refuse generic rebase.
- Added deterministic tests for move, restore, immutable-field/duration/time-zone retention, stale local state, provider conflict, unavailable/uncertain outcomes, pre-write persistence, and restore preconditions.

## Verification

| Command | Result |
|---|---|
| `npm test` | Passed: 38 files, 248 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed: Next.js production build generated all routes |
| `npm run test:e2e` | Passed: auth, creation, strict review, expired session, cancel/back, reduced motion, and responsive checks |
| `npm run security:scan` | Passed: 181 files and 543 history blobs scanned, 0 findings |
| `npm run verify:fake-production` | Passed: production fixture rejected |
| `npm run traceability:check` | Passed: `traceability.v1`, 52 requirements, 3 covered, 22 partial, 27 planned |
| `npm audit --audit-level=moderate` | Passed: 0 vulnerabilities |
| `git diff --check` | Passed |

## External-effect boundary

No live Calendar move or restore was run. Product approval/action-ledger integration remains deferred to the later execution tasks, and any live provider write remains human-only. S037 is next.
