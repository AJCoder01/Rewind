# S034 provider-port evidence

Date: 2026-07-16
Task: S034 — define explicit provider ports and deterministic fakes
Branch: `codex/s032-oauth-claims`

## Outcome

Passed the S034 provider-boundary packet. `provider-ports.v1` defines strict scenario-specific contracts for tagged Calendar snapshots and conditional start/end updates, one approved Gmail send and its sent/permanent/uncertain outcomes, exact account-brief persistence, and separate initial/recovery/prevention-rule model proposals. The model port returns raw `unknown` output so later strict schemas remain the only authority for model decisions.

Deterministic fakes implement each port with explicit failure injection. Calendar fake updates only start/end and rolls a deterministic ETag; Gmail fake performs one send attempt and never retries or reads a mailbox; artifact fake stores supplied bytes and validates the supplied hash without generation; model fake keeps operations separate and can inject refusal/unavailable/truncation/invalid-output failures. No generic compensation or workflow interface was added.

## Requirements and contract versions

- Requirements: SAFE-05, SAFE-07, SAFE-08, SAFE-10, NFR-04, NFR-10.
- Runtime contract: `provider-ports.v1` (`lib/contracts/provider-ports.ts`).
- Existing fixture contracts remain `controlled-content.v1`, `artifact-independence.v1`, and `traceability.v1`.
- Evidence is synthetic and redacted. No real account, address, provider identifier, OAuth secret, token, prompt, model response, or receipt is recorded.

## Verification

| Command | Result |
|---|---|
| `npm.cmd test -- tests/unit/provider-ports.test.ts` | Passed: 1 file, 5 tests |
| `npm.cmd test` | Passed after evidence/traceability update: 34 files, 206 tests |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed |
| `npm.cmd run build` | Passed: Next.js production build |
| `npm.cmd run security:scan` | Passed: 161 files and 465 history blobs, no findings |
| `npm.cmd run verify:fake-production` | Passed: production fixture rejected |
| `npm.cmd run traceability:check` | Passed: 52 requirements; 3 covered, 19 partial, 30 planned |
| `git diff --check` | Passed |

## Safety boundary

No Google consent, live token exchange/refresh, Calendar call, Gmail send, mailbox read, model call, database migration, or other external effect was run. The fakes are test/non-production fixtures only, and production fake-mode rejection remains enforced by the existing configuration guard.

## Remaining risk and next boundary

Live provider adapters and deployed ownership/allowlist proof remain gated. S035 is the next task and requires a human-confirmed TTY-gated Calendar discovery/seeding operation; Codex must stop before running it.
