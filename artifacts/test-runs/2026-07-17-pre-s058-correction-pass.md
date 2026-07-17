# Pre-S058 correction pass

Date: 2026-07-17

Status: implementation corrected; controlled S058 live effects intentionally not run.

## Scope

This packet closes implementation gaps discovered by a whole-repository adversarial review before S058. It does not claim Calendar or Gmail product evidence.

## Implemented corrections

- PostgreSQL product intake now uses real controlled Calendar discovery and strict model reasoning instead of fixture plan substitution.
- The zero-credit product runtime supports loopback-only local Ollama without requiring OpenAI credentials.
- Dashboard approval transitions to approved-ready execution and creates the exact three-row action ledger without provider effects.
- Dashboard execution performs whole-plan Calendar/Gmail preflight before artifact, then executes artifact → Calendar → Gmail synchronously.
- Provider drift before every action invalidates the old approval and persists a fresh immutable unapproved version; drift after execution begins stops for operator reconciliation.
- Execution requests are serialized per World PR and action claims are fenced, preventing competing clicks from duplicating effects.
- Gmail regional allowlist substitution, stale dispatch-marker retry, lost preparation ownership, Calendar unchanged-ETag success, and unowned provider preparation fail closed.
- Strict persistence schemas bind action type, terminal status, receipt, error, lease, attempts, and Gmail handoff state.
- Fixture plans remain visibly non-effecting and expose no approval or execution control.
- `connection-preflight.v2` reports product readiness honestly while keeping reset disabled.

## Safety boundary

No live provider command, OAuth flow, Calendar mutation, Gmail send, or product reset was run during this correction pass. Automated tests use deterministic adapters. The human-only next step is documented in `docs/S058_CONTROLLED_LIVE_INITIAL_FLOW_GUIDE.md`.

## Requirement coverage

FR-01–18, SAFE-01, SAFE-03–09, and NFR-02–04/NFR-06/NFR-08/NFR-10 receive additional deterministic implementation evidence. S058 remains the live gate.

## Verification

The following checks passed on `codex/pre-s058-corrections`:

| Command | Result |
| --- | --- |
| `npm test` | 68 test files passed; 467 tests passed |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Production build passed |
| `npm run test:e2e` | Authentication, login, creation, strict review rendering, session expiry, cancel/back, reduced-motion, and responsive checks passed |
| `npm run db:verify` | Rollback-only migration verification passed with every reported check true |
| `npm run security:scan` | 295 files and 917 reachable history blobs scanned; zero findings |
| `npm run traceability:check` | 52 requirements: 3 covered, 36 partial, 13 planned |
| `npm run verify:fake-production` | Passed |
| `npm run verify:g1-interface` | Passed |
| `npm run verify:g2-closure` | Passed; G3 admission remains unlocked |
| `npm run eval:model-safety` | Passed |
| `npm run config:check` | Passed |
| `npm audit --audit-level=moderate` | Zero vulnerabilities |
| `npm run prove:model-local` | Three strict local Ollama operations validated; `externalEffects:false` |
| `git diff --check` | Passed |

The local-model proof used loopback Ollama only. No paid model API was called. No Calendar or Gmail product effect was attempted, and S058 remains intentionally pending for the human-controlled live run.
