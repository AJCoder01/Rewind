# Post-S041 regression audit

| Field | Value |
|---|---|
| Date | 2026-07-16 |
| Scope | Implemented S001–S041 behavior |
| Result | Passed after one test-evidence correction |
| External effects | None |

## Result

The implemented application, auth, OAuth boundary, PostgreSQL contract, Calendar/Gmail primitives, artifact boundary, Responses transport, dashboard browser flow, and model-only schemas pass their automated and read-only checks. The audit found one stale expected traceability count after FR-21 and FR-28 moved from `planned` to `partial`; that assertion was corrected and the complete suite then passed.

## Checks

- Node `v24.18.0`; npm `11.16.0`.
- Unit/contract/integration tests: 46 files / 295 tests passed.
- Typecheck, lint, and production build passed.
- Browser E2E passed auth rejection, login, create/review, expired session, cancel/back, responsive, and reduced-motion checks.
- Application/MCP private configuration, G1 interface packet, fake-production refusal, and traceability passed.
- Security scan found 0 issues across 207 files and 619 reachable history blobs.
- Dependency audit found 0 vulnerabilities.
- Read-only PostgreSQL verification passed exact catalog, columns/defaults, OAuth catalog, constraints, runtime/default privileges, migration ledger, TLS, readiness, rollback-only constraint probes, and plaintext rejection.
- Read-only OpenAI model access passed without a response/model inference call.
- Deployed health and readiness passed; schema version is `0002_oauth_transaction`.

## Intentionally not run

- `seed:demo`, `prove:gmail`, `reset:demo`, live Calendar operations, and the live model spike require a human TTY confirmation or belong to S043; running them would create external effects.
- `db:migrate` was not run because it can mutate a shared database and exact read-only catalog/ledger verification passed.
- `db:verify:ephemeral` requires the fixed CI-only loopback PostgreSQL service, which is not present in this desktop run.
- `eval:recovery` was invoked and failed closed with its explicit pre-Phase-4 message. The recovery planner and 25-paraphrase fixture set are not implemented yet; presenting a passing fallback would be dishonest.

No unresolved regression was found in the implemented S001–S041 scope.
