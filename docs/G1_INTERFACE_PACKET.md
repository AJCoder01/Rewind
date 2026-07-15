# G1 interface packet

S029 freezes the non-effecting G1 boundary before provider work. The packet identifier is `g1-interface.v1`.

## Frozen sources

| Boundary | Canonical source | Frozen value |
|---|---|---|
| API and shared Zod contracts | `lib/contracts/v1.ts` | `v1` |
| Server integrity contract | `lib/contracts/initial-plan-server.ts` | `initial-plan.v1` payload and SHA-256 digest rules |
| Foundation migration | `db/migrations/0001_phase0_foundation.sql` | `0001_phase0_foundation`, checksum from `lib/db/schema.ts` |
| Database catalog | `lib/db/schema.ts` | 10 application tables, 26 named constraints |
| Golden HTTP/read-model fixtures | `tests/fixtures/contracts/golden.ts` | `golden-contracts.v1` |
| Requirement traceability | `tests/fixtures/traceability/catalog.ts` | `traceability.v1` |
| Deterministic initial fixture | `lib/domain/fixture-world-pr.ts` | `fixture-initial.v1` model/prompt marker |
| Controlled account content | `lib/domain/account-brief.ts` | `controlled-content.v1` |
| Artifact independence validator | `lib/domain/account-brief.ts` | `artifact-independence.v1` |
| Fixture-only rule/reset boundaries | `lib/contracts/v1.ts` | `prevention-rule.v1`, `reset-plan.v1` |

The executable freeze is [the G1 packet manifest](../tests/fixtures/g1-interface-packet.ts), covered by `tests/unit/g1-interface-packet.test.ts` and `npm run verify:g1-interface`. Any status, error, migration-catalog, fixture-version, or evidence-path drift fails the verifier and must be reviewed as a packet change.

## Implemented G1 surface

Only these routes are implemented and enabled in the non-effecting slice:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/session` | Create an authenticated dashboard session |
| `POST` | `/api/v1/world-prs` | Create or safely replay a World PR |
| `GET` | `/api/v1/world-prs/:worldPrId` | Read the authenticated dashboard view |
| `GET` | `/api/v1/world-prs/:worldPrId/status` | Read the restricted MCP status projection |
| `POST` | `/api/v1/world-prs/:worldPrId/cancel` | Cancel an unexecuted review |

The MCP surface exposes `create_world_pr` and the optional read-only `get_world_pr_status`. There is no MCP or dashboard approval, execution, recovery, rule activation, reset, provider credential, or mailbox-read operation in G1.

## Frozen error matrix

The complete v1 error-code-to-HTTP mapping is frozen in the manifest. The key groups are:

| HTTP status | Error codes |
|---|---|
| `401` | `unauthorized` |
| `403` | `forbidden` |
| `404` | `task_not_found`, `plan_not_found` |
| `409` | `idempotency_conflict`, `scenario_busy`, `invalid_task_state`, `plan_digest_mismatch`, `plan_stale`, `approval_required`, `provider_conflict`, `action_not_retryable`, `reset_conflict` |
| `422` | `invalid_request`, `unsupported_request`, `clarification_required`, `candidate_set_invalid`, `model_output_invalid`, `unknown_entity`, `unknown_action`, `unknown_template`, `recipient_not_allowed` |
| `500` | `internal_error` |
| `503` | `provider_unavailable`, `delivery_uncertain` |

Every error uses the strict redacted envelope from `CONTRACTS.md` and carries a request ID. `plan_not_found` is explicitly a 404; it cannot fall through to the generic 500 mapping.

## Evidence freeze

- Local create/read/cancel browser evidence: [S019–S027 report](../artifacts/test-runs/2026-07-15-s019-s027-g1.md).
- Deployed MCP → API → PostgreSQL → dashboard evidence: [S028 deployed report](../artifacts/test-runs/2026-07-16-s028-deployed.md).
- Browser assertions: `scripts/test-e2e.ts`.
- No evidence in this packet claims a live Calendar, Gmail, OpenAI, OAuth, approval, execution, recovery, rule, reset, or external-effect result.

## Change rule

Before provider work, changes to v1 schemas, the foundation migration/catalog, golden fixtures, error mapping, fixture versions, or the create/read evidence require a new packet version, updated contract tests, updated evidence, and a review of the G1 gate. Historical persisted plans remain decoded by their recorded schema version; they are not silently reinterpreted.
