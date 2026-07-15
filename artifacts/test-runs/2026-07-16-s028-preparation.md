# S028 deployed G1 preparation — 2026-07-16

## Scope

This report records the safe implementation and local verification needed before the human-only deployed S028 checkpoint. It does not claim deployed MCP/API/PostgreSQL/dashboard proof, live provider behavior, or any external effect.

## Implementation

- Production `REWIND_STORAGE_MODE=postgres` now selects the real PostgreSQL repository for the explicitly non-effecting G1 contract slice.
- Production `memory_fixture` remains rejected by the environment and storage boundary.
- The PostgreSQL repository no longer rejects the non-effecting create/cancel path solely because `NODE_ENV=production`.
- Composer/review copy identifies `G1 non-effecting mode`, PostgreSQL persistence, no provider/model calls, and no live-provider evidence.
- Decision and architecture/contract/test-plan wording now distinguish the durable G1 contract fixture from fake Calendar/Gmail/model adapters.
- The human procedure is documented in `docs/S028_DEPLOYED_G1_GUIDE.md`.

Schema/fixture versions: `v1`, `initial-plan.v1`, `golden-contracts.v1`, `traceability.v1`, `fixture-initial.v1`, `controlled-content.v1`, `artifact-independence.v1`.

## Local verification

All commands below used Node `v24.18.0` after a clean `npm ci`:

| Command | Result |
|---|---|
| `node --version` | The default shell reported `v25.9.0`; the pinned Node 24 binary used for the verification suite reported `v24.18.0`. |
| `npm ci` | Passed: 440 packages installed from the lockfile. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 27 files, 152 tests. |
| `npm run build` | Passed: production Next.js build. |
| `npm run test:e2e` | Passed: auth rejection, login, create, strict review, expired session, cancel/back, keyboard focus, reduced motion, and responsive checks. |
| `npm run security:scan` | Passed: 135 files, 359 reachable-history blobs, 0 findings. |
| `npm run verify:fake-production` | Passed: production fixture mode rejected. |
| `npm run traceability:check` | Passed: `traceability.v1`, 52 requirements checked. |
| `git diff --check` | Passed. |

The `tsx` validators required execution outside the default sandbox because their temporary IPC pipe was denied by the sandbox. They emitted no secret values and made no external provider calls.

## Human-only work remaining

The deployed proof was not run. It requires deployment of the reviewed branch, the private dashboard session, and the scoped MCP token. The operator must follow `docs/S028_DEPLOYED_G1_GUIDE.md`, record only sanitized status/flag results, cancel the created non-effecting review, and confirm that Calendar/Gmail/OpenAI calls were absent.

Database migrations, database verification, seed, preflight, reset, live provider commands, and recovery evaluation were not run. They are either human/live-effect gates or later implementation tasks and must not be inferred from this report.

## Requirement links

This preparation packet supports the S028 boundary for FR-01, FR-02, FR-07, FR-09, SAFE-03, SAFE-04, SAFE-08, NFR-02, NFR-06, NFR-07, NFR-08, and NFR-10. It does not mark any provider, approval, execution, recovery, rule-activation, reset, or deployed-proof requirement complete.

## Result

Local implementation and verification packet passed. S028 remains open pending the human-only deployed MCP → authenticated API → PostgreSQL → authenticated dashboard proof.
