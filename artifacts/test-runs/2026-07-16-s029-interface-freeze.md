# S029 G1 interface freeze — 2026-07-16

## Scope

S029 freezes the non-effecting G1 interface packet before provider work. The packet identifier is `g1-interface.v1`. It covers the v1 schemas, foundation migration/catalog, golden HTTP/read-model fixtures, error mapping, fixture versions, implemented G1 routes, and create/read browser evidence.

## Implementation

- Added the executable freeze manifest at `tests/fixtures/g1-interface-packet.ts`.
- Added `npm run verify:g1-interface`, which rejects lifecycle/status drift, error-code or HTTP-status drift, migration checksum/catalog drift, fixture coverage/version drift, and missing evidence.
- Added strict unit coverage in `tests/unit/g1-interface-packet.test.ts`.
- Corrected `plan_not_found` to the frozen/documented HTTP 404 mapping; it no longer falls through to HTTP 500.
- Documented the packet and its change rule in [G1 interface packet](../../docs/G1_INTERFACE_PACKET.md).

Frozen inventory: API `v1`; initial plan `initial-plan.v1`; golden contracts `golden-contracts.v1`; traceability `traceability.v1`; deterministic fixture `fixture-initial.v1`; controlled content `controlled-content.v1`; artifact validator `artifact-independence.v1`; fixture-only rule/reset `prevention-rule.v1` and `reset-plan.v1`; 25 error codes; 12 task states; 7 action states; 10 application tables; 26 named constraints.

## Verification

All local commands used the pinned Node `v24.18.0` where applicable:

| Command | Result |
|---|---|
| `npm run verify:g1-interface` | Passed: `g1-interface.v1`, 25 error codes, 12 task states, 7 action states, 3 evidence files |
| `npm test` | Passed: 28 files, 156 tests |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed: production Next.js build |
| `npm run test:e2e` | Passed: auth rejection, login, create/read review, strict fixture rendering, expired session, cancel/back, keyboard focus, reduced motion, responsive checks |
| `npm run traceability:check` | Passed: `traceability.v1`, 52 requirements |
| `npm run security:scan` | Passed: 138 files, 379 reachable-history blobs, 0 findings |
| `npm run verify:fake-production` | Passed: production fixture mode rejected |
| `git diff --check` | Passed |

The `tsx` validators and browser smoke required the already-reviewed elevated local execution because the sandbox denied their temporary IPC pipe. They made no provider calls or external effects.

## Safety boundary

No OAuth flow, Calendar/Gmail/OpenAI call, approval, execution, seed, preflight, reset, database edit, or live provider command was run. S028 deployed proof remains the only deployed evidence; this packet does not convert fixture output into live-provider evidence.

## Result

S029 passed. S030 is now the only unfinished task in G1; provider work remains gated until S030 closes the gate.
