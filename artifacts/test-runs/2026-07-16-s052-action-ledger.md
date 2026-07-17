# S052 durable action-ledger report

| Field | Value |
|---|---|
| Task | S052 — Prepare the durable action ledger |
| Date | 2026-07-16 |
| Branch | `codex/s046-next` |
| Scope | Deterministic fixture and in-process ledger coordination; no provider effects |
| Status | Passed locally |

## Implemented boundary

- Added `initial-execution.v1` preparation and claim-result contracts.
- Approval now materializes exactly three immutable `planned` action rows in artifact → Calendar → Gmail order before any dispatch.
- Stable operation keys remain `planId:actionKey`; repeated preparation replays the same row IDs and rejects immutable action drift.
- Claims recheck the authenticated approval and exact plan digest, enforce earlier-action success, report active leases as `busy`, return succeeded actions as `skipped`, and allow claims only from `planned` or explicitly retryable-failed rows.
- An expired Gmail lease is durably terminalized as `delivery_uncertain`; an expired Calendar lease stops with `reconciliation_required` and is never blindly retried.
- No provider call is made by S052. Artifact, Calendar, Gmail, receipt, timeline, and completed/attention orchestration remain S053–S057 work.

## Contract and fixture versions

- `initial-execution.v1`
- `execution-persistence.v1`
- `initial-plan.v1`
- `v1` World PR/task mutation contracts

## Verification

- `npm.cmd test -- tests/unit/initial-execution.test.ts tests/unit/initial-approval.test.ts tests/unit/execution-persistence.test.ts` — passed, 3 files / 17 tests.
- `npm.cmd test` — passed, 59 files / 380 tests.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — passed.
- `npm.cmd run build` — passed; all application routes compiled.
- `npm.cmd run test:e2e` — passed; auth rejection, login, creation, strict review rendering, expired-session handling, cancel/back, and reduced-motion responsive checks.
- `npm.cmd run verify:g1-interface` — passed; 25 error codes, 12 task statuses, 7 action statuses, 3 evidence files.
- `npm.cmd run security:scan` — passed; 269 files and 830 history blobs scanned, 0 findings.
- `git diff --check` — passed after the evidence packet was added.

## Safety and remaining risk

- No live Calendar/Gmail/model call, database mutation, OAuth action, or external effect was run for S052.
- The action ledger is prepared and claim-safe, but provider before/after persistence and execution response mapping are intentionally deferred to S053–S055.
- Full repository, build, browser, interface, and security verification completed with the results above.
