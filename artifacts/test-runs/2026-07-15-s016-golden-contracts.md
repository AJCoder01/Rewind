# S016 golden contract fixture evidence

Date: 2026-07-15

Scope: deterministic contract fixtures and local regression checks only. No provider, OAuth, database, or private-environment operation was run.

## Result

`golden-contracts.v1` now covers every current task status, every canonical API error code, normal/replay/clarification success responses, strict initial and recovery read-model shapes, and fixture-only rule/reset review shapes. Clarification has no run/plan, recovery states use recovery plans, and terminal no-plan states do not reuse an initial plan. Initial/recovery/reset/rule digests are recomputed from canonical payloads and verified against their read-model pointers. All values use synthetic IDs, fixed timestamps, the controlled account-brief fixture, and the existing fake-provider boundary.

## Commands

- `npm.cmd test -- tests/unit/golden-contracts.test.ts` — passed (4 tests).
- `npm.cmd test` — passed (20 files, 103 tests).
- `npm.cmd run lint` — passed.
- `npm.cmd run typecheck` — passed.
- `npm.cmd run build` — passed (Next.js production build; 7 routes generated).
- `npm.cmd run test:e2e` — passed (fixture auth rejection, login, create/review, strict rendering, expired session, and safe return).
- `git diff --check` — passed.

## Remaining risk

Rule, reset, recovery, and external-action schemas are fixture contracts only. Their production routes, persistence, approvals, provider adapters, and live evidence remain assigned to later sequential tasks.
