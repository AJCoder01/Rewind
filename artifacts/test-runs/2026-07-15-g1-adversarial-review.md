# G1 adversarial review and correction evidence

Date: 2026-07-15
Branch reviewed: `codex/s019-s027-g1`
Baseline: `origin/main...5201b1a8646e354b74fbb35f502c4715d91cf6c3` before this correction pass
Scope: existing S019–S027 G1 work only; no later implementation task started
Mode: local deterministic fixture/test mode

## Verdict

Pass with non-blocking risks. The review found no P0 issue. Every confirmed in-scope P1 and reasonable P2 issue was corrected and regression tested. Deployed G1 proof, disposable PostgreSQL replay in this workspace, recovery evaluation, and all provider/live gates remain unverified and are not claimed as passing.

## Findings and corrections

### P1 corrected

1. MCP-created World PRs could not be opened by the authenticated dashboard operator because the two principals were treated as separate resource owners. The fixed single-tenant scope explicitly permits only `mcp:scoped-token` and `demo-operator` to share the controlled workspace; unrelated actor identifiers remain rejected. Regression coverage exercises memory, PostgreSQL, and route paths.
2. PostgreSQL lease reclamation deleted an expired lock without terminalizing its preview task. A later idempotent replay could then attempt to join an immutable plan against a failed read model. Reclamation now writes a validated `failed` view, clears the run/plan/lease, appends a redacted audit event, and replay returns the current durable view without entering a second saga.
3. A concurrent cancellation replay could synthesize a `cancelled` response before the first cancellation transaction committed. It now returns the current durable state with `replayPending: true`; the review UI accepts cancellation only when the response ID matches and its durable status is `cancelled`.
4. The sign-in route could issue a production session while required scoped-MCP configuration was absent, and read/status routes mapped `provider_unavailable` to HTTP 500. Production sign-in now fails closed, and all thin route handlers use the canonical status/retry mapping.
5. Strict contracts allowed terminal no-plan views to retain a run ID, and MCP status could carry clarification/attention metadata in incompatible states. The Zod schemas now reject those contradictions.

### P2 corrected

1. The review UI displayed `Preview ready` and offered cancellation for other initial-plan lifecycle states. It now renders the actual text state and exposes cancellation only in `preview_ready`.
2. CSRF documentation said `Origin`/`Referer`, while code required `Origin` only. The implementation now accepts same-origin `Referer` only when `Origin` is absent; a supplied `Origin` always takes precedence. Contract tests cover both cases.
3. The controlled-content inventory omitted clarification, cancelled, and attention review states introduced in G1. It now matches the implemented fixture UI and copy.

## Requirement links

The corrected fixture slice strengthens the existing partial evidence for FR-01, FR-02, FR-03, FR-07, FR-09, SAFE-03, SAFE-04, SAFE-08, NFR-02, NFR-06, NFR-07, NFR-08, and NFR-10. No provider, approval, execution, recovery, rule-activation, or reset requirement is newly marked complete.

Schema/fixture versions remain `v1`, `initial-plan.v1`, `golden-contracts.v1`, `traceability.v1`, `fixture-initial.v1`, `prevention-rule.v1`, `reset-plan.v1`, `controlled-content.v1`, and `artifact-independence.v1`.

## Executed verification

| Command | Exit | Result / mode |
|---|---:|---|
| `node --version` | 0 | `v24.14.0`; within `>=24 <25`, below the repository’s `24.18.0` pin |
| `npm.cmd ci` | 0 | clean locked install; 438 packages, audit reported 0 vulnerabilities |
| targeted auth/contracts/store/route tests | 0 | targeted regression suites passed before the complete suite |
| `npm.cmd run lint` | 0 | local static check passed |
| `npm.cmd run typecheck` | 0 | local TypeScript check passed |
| `npm.cmd test` | 0 | 27 files, 150 tests passed, 0 skipped reported |
| `npm.cmd run build` | 0 | production build generated all current routes |
| `npm.cmd run test:e2e` | 0 | deterministic fixture browser flow passed: login, creation, review, expiry, cancellation/back, keyboard, reduced motion, responsive viewport |
| `npm.cmd audit --audit-level=high` | 0 | 0 vulnerabilities; rerun with approved network/cache access after sandbox advisory access failed |
| `npm.cmd run security:scan` | 0 | 134 tracked files, 335 reachable-history blobs, no findings |
| `npm.cmd run traceability:check` | 0 | 52 records: 3 covered, 18 partial, 31 planned |
| `npm.cmd run verify:fake-production` | 0 | production fixture configuration rejected |
| `git check-ignore -v .env.local` | 0 | ignored by `.gitignore`; no content read |
| `git diff --check` | 0 | no whitespace errors |

## Unverified checks and remaining risks

- `npm.cmd run db:verify:ephemeral` exited 1 safely because this is not a CI disposable PostgreSQL environment. Docker is unavailable in this workspace, so no fresh disposable migration replay was possible. No shared, preview, Supabase, or production database was contacted.
- `npm.cmd run eval:recovery` exited 1 as expected because the Phase 4 recovery planner and 25-paraphrase fixture set do not exist yet. This remains S060–S074 work, not a G1 failure.
- The deployed non-effecting MCP → API → PostgreSQL → dashboard proof remains S028. No live provider, OAuth, model, Calendar, Gmail, seed, preflight, reset, deployment, or external-effect command ran in this review.
- The local Node patch is `24.14.0`; the repository development pin remains `24.18.0`.

## Privacy and handoff

- No private credential or `.env.local` content was read, logged, or committed.
- No unauthorized live provider call occurred.
- The exact next unfinished task remains **S028 — prove the deployed non-effecting slice**.
