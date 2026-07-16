# S044 connection/preflight UI report

Date: 2026-07-16

## Scope

S044 adds an authenticated, read-only connection/preflight status boundary and dashboard panel. The panel reports safe configuration field/code gaps, exact account-bound Google identity state, fixture/live-capable/blocked runtime state, database readiness, controlled Calendar target status, four preflight checks, selected model evidence runtime, and disabled product execution/reset.

The status service does not refresh OAuth credentials, call Calendar/Gmail/OpenAI/Ollama, mutate PostgreSQL state, or run the human-gated Calendar preflight. A pending or failed prerequisite remains visible; no product workflow success is claimed.

## Implementation

- `connection-preflight.v1` is defined in `lib/contracts/connection-preflight.ts` with strict unknown-field rejection and bounded safe issue/detail fields.
- `lib/services/connection-preflight.ts` keeps environment validation redacted, checks PostgreSQL readiness only when configured, exposes the stored Google email only after exact subject/email/approved-scope binding, and fails closed on mismatch/unavailable state. It also exposes the fixed demo-date prerequisite.
- `GET /api/v1/connection/status` requires the dashboard session, rejects MCP bearer access, returns `Cache-Control: no-store`, and maps unexpected failures to a sanitized `503`.
- The composer displays the panel with explicit fixture/live-capable/blocked and “Product execution is disabled” copy. The existing World PR remains non-effecting.

## Verification

- `npm test -- --run tests/unit/connection-preflight.test.ts tests/unit/accessibility-contract.test.ts` — passed, 8 tests.
- `npm test` — passed, 52 test files / 349 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; the new status route is dynamic Node.js server code.
- `npm run test:e2e` — passed; unauthenticated status returned `401`, authenticated fixture status returned `200`, and the existing browser flow passed.
- `npm run security:scan` — passed with no findings; `npm run traceability:check` — passed; `npm run verify:fake-production` — passed; `npm run verify:g1-interface` — passed; `npm run db:verify` — passed all recorded readiness/catalog/TLS/privilege predicates.

No live provider/model command or external effect was run for S044. Existing human S035/S038/S043 evidence remains separate and is not re-used as a product workflow success claim.
