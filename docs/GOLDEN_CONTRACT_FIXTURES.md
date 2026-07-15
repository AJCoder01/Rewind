# Golden contract fixtures

S016 freezes the deterministic, non-effecting contract sample set at `golden-contracts.v1` in `tests/fixtures/contracts/golden.ts`.

## Coverage

- Every `TaskStatusSchema` state has a strict lifecycle-aware read-model fixture: clarification has no run/plan, initial lifecycle states use an initial plan, recovery lifecycle states use a recovery plan, attention has an explicit reason, and analyzing/cancelled/failed expose no active plan.
- Success fixtures cover normal create, idempotent replay, and clarification-required create responses.
- Every `ErrorCodeSchema` value has a sanitized strict error envelope fixture.
- Initial, recovery, reset, and proposed/active/removed prevention-rule payloads are canonical inputs whose SHA-256 digests are recomputed in tests. Read-model pointers must match the corresponding immutable payload digest.
- The future rule and reset boundaries are represented by fixture-only strict schemas: `prevention-rule.v1`, `reset-plan.v1`, and the honest reset-complete response where `sentMailDeleted` is always `false`.

The fixture-only rule/reset shapes do not enable routes or provider calls. They are executable samples for contract review until their sequential implementation tasks add production schemas and services.

## Determinism and strictness

IDs, timestamps, digests, controlled recipients, and account-brief provenance are synthetic and fixed. Every object boundary is strict; tests reject unknown properties, state/view mismatches, missing attention reasons, duplicate reset candidates, candidate/region mismatches, and digest tampering. The shared `WorldPrViewSchema` includes strict initial/recovery plan views and clarification-only intake; rule/reset parsers remain deliberately fixture-scoped until their numbered implementation tasks.

Run `npm run test -- tests/unit/golden-contracts.test.ts` to validate the complete set. No credentials or external services are needed.
