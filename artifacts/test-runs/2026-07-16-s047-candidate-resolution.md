# S047 candidate-resolution verification

Date: 2026-07-16
Branch: `codex/s046-next`
Scope: Calendar-backed exact-two candidate lookup, rule-before-lock ordering, deterministic UK/US ranking, and stale refresh/supersession.

## Evidence

- `npm.cmd test -- tests/unit/candidate-resolution.test.ts` — passed, 1 file / 4 tests.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — passed with no warnings or errors.

The tests use `FakeCalendarPort` and `MemoryPlanningLockPort` only. They prove exact-two validation, duplicate/missing/wrong-date rejection, deterministic ranking, clarification without a lock, lock acquisition only after a no-match rule result, versioned refresh, and ETag drift detection. No OAuth credential, live provider, database, model, Calendar write, Gmail send, or artifact effect was run.

Requirements covered: FR-03, FR-04, FR-05, FR-06, NFR-02, SAFE-06. Remaining risk is integration of this boundary into the initial planning/approval path in S048–S057; live-provider evidence remains human-only.
