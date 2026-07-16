# S051 approval, cancel, and replan report

| Field | Value |
|---|---|
| Task | S051 — Implement initial approval/cancel/replan |
| Date | 2026-07-16 |
| Branch | `codex/s046-next` |
| Scope | Deterministic fixture and PostgreSQL repository boundaries; no provider effects |
| Status | Passed locally |

## Implemented boundary

- Added `initial-approval.v1` request validation for an exact plan ID, version, and SHA-256 digest.
- Added dashboard-only approval and initial-preview supersession routes. MCP can create/read status but cannot approve or replan.
- Approval validates the active World PR pointer and the verified full payload, persists an immutable execution-plan record and approval actor/time/version/digest, and repairs/replays one approval timeline item without duplicating it.
- Approval creates no action rows and calls no Calendar, Gmail, artifact, or model provider; durable execution is the S052–S055 boundary.
- Cancellation checks the approval ledger before delegation and the PostgreSQL store repeats the check under the task-row lock. An approved plan cannot be cancelled or release its scenario lock.
- An unapproved preview can be superseded into a new immutable plan ID/version/digest while the previous payload remains addressable. HTTP callers cannot provide replacement provider IDs, recipients, content, dependencies, or action payloads.
- Execution-plan validation now rejects a digest that does not match its immutable payload.

## Contract and fixture versions

- `initial-approval.v1`
- `execution-persistence.v1`
- `initial-plan.v1`
- `v1` World PR/task mutation contracts

## Verification

- `npm.cmd test -- tests/unit/initial-approval.test.ts tests/unit/execution-persistence.test.ts tests/unit/world-pr.test.ts tests/unit/g1-memory-store.test.ts tests/unit/g1-routes-auth.test.ts` — passed, 5 files / 33 tests.
- `npm.cmd test` — passed, 58 files / 375 tests.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run lint` — passed.
- `npm.cmd run verify:g1-interface` — passed, `g1-interface.v1`, 25 error codes, 12 task statuses, 7 action statuses.
- `npm.cmd run security:scan` — passed, 263 files / 811 history blobs / 0 findings.
- `npm.cmd run build` — passed; approval and refresh routes compiled successfully.
- `npm.cmd run test:e2e` — passed; auth rejection, login, creation, strict review rendering, expired-session handling, cancel/back, and reduced-motion responsive checks.
- `git diff --check` — passed.

## Safety and remaining risk

- No live Calendar/Gmail/model call, database mutation, OAuth action, or external effect was run for S051.
- Exact pointer/content drift fails closed. Provider-state, ETag, allowlist, and template drift still require the execution preflight implemented in S054/S055.
- Action-row creation, artifact persistence, Calendar execution, Gmail delivery, resume, and completed/attention read-model transitions remain S052–S057 work.
- The controlled live initial flow remains the human-only S058 boundary.
