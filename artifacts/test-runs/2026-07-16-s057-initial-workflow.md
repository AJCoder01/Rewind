# S057 initial-workflow verification report

Date: 2026-07-16
Task: Complete deterministic verification of the approved initial workflow.
Status: Passed locally; S058 is the next human-only checkpoint.

## Implemented verification boundary

- Added `tests/unit/initial-workflow.test.ts`, composing controlled candidate resolution, bounded initial reasoning, exact plan expansion, immutable approval, durable action-row preparation, artifact execution, conditional Calendar execution, and allowlisted Gmail execution.
- Verified one exact artifact → Calendar → Gmail run with fixed order, exact approved artifact bytes/provenance, Calendar `sendUpdates=none` start/end-only input, allowlisted message content, typed receipts, and one provider effect per action.
- Verified approval replay, plan-digest rejection, MCP execution rejection, out-of-order dependency refusal, safe artifact retry/resume, and replay skipping succeeded actions.
- Verified duplicate-click busy leases, Gmail process-death uncertainty after a persisted dispatch marker, Calendar process-death reconciliation, stale Calendar ETag refusal, and allowlist drift refusal before provider handoff.
- Combined with the S052–S056 executor, contract, timeline, accessibility, browser, interface, and security suites, this is the complete deterministic no-effect initial-workflow proof for FR-01–18 and the applicable SAFE boundaries.

## Contract and fixture versions

- `initial-reasoning.v1`
- `initial-plan.v1`
- `execution-persistence.v1`
- `initial-execution.v1`
- `initial-artifact-execution.v1`
- `initial-calendar-execution.v1`
- `initial-gmail-execution.v1`
- `provider-ports.v1`
- `traceability.v1`

## Verification

| Command | Result |
|---|---|
| `npm.cmd test -- tests/unit/initial-workflow.test.ts` | Passed: 1 file, 6 tests |
| `npm.cmd test` | Passed: 64 files, 421 tests |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed with no errors or warnings |
| `npm.cmd run build` | Passed; all Next.js routes compiled |
| `npm.cmd run test:e2e` | Passed; auth/login/create/review/execution-timeline/session-expiry/cancel/back/reduced-motion responsive checks |
| `npm.cmd run verify:g1-interface` | Passed; packet version `g1-interface.v1`, 25 error codes, 12 task statuses, 7 action statuses, 3 evidence files |
| `npm.cmd run security:scan` | Passed; 292 files and 891 reachable-history blobs scanned, no findings |
| `git diff --check` | Passed; only expected Git line-ending normalization warnings |

## Effect boundary

All S057 verification uses deterministic `FakeModelPort`, `FakeCalendarPort`, `FakeArtifactPort`, a recording Gmail fake, and in-memory immutable plan/action persistence. No live OAuth refresh, Google Calendar read/write, Gmail send, model call, PostgreSQL mutation, or external effect is performed. S058 remains the separately gated controlled live initial flow.

## Remaining risk

The deterministic initial workflow is complete. The remaining G3 risk is the human-controlled live proof: exact approval, one artifact persistence, one Calendar move, one allowlisted Gmail send, redacted receipts, and replay/no-duplicate confirmation. Sent mail is not undone by any later task.
