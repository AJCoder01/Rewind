# Golden contract fixtures

S016 freezes the deterministic, non-effecting contract sample set at `golden-contracts.v1` in `tests/fixtures/contracts/golden.ts`.

## Coverage

- Every `TaskStatusSchema` state has a strict read-model fixture: `analyzing`, `clarification_required`, `preview_ready`, `executing`, `completed`, `correction_pending`, `recovery_ready`, `recovering`, `recovered`, `attention_required`, `cancelled`, and `failed`.
- Success fixtures cover the normal create response and an idempotent replay response.
- Every `ErrorCodeSchema` value has a sanitized strict error envelope fixture.
- The future rule and reset boundaries are represented by fixture-only strict schemas: `prevention-rule.v1`, `reset-plan.v1`, and the honest reset-complete response where `sentMailDeleted` is always `false`.

The fixture-only rule/reset shapes do not enable routes or provider calls. They are executable samples for contract review until their sequential implementation tasks add production schemas and services.

## Determinism and strictness

IDs, timestamps, digests, controlled recipients, and account-brief provenance are synthetic and fixed. Every object boundary is strict; tests reject unknown properties, state/view mismatches, missing attention reasons, duplicate reset candidates, and candidate/region mismatches. The current production `WorldPrViewSchema` remains the parser for task read models, while the rule/reset parsers are deliberately scoped to this fixture directory.

Run `npm run test -- tests/unit/golden-contracts.test.ts` to validate the complete set. No credentials or external services are needed.
