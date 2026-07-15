# S013–S017 independent correction pass — 2026-07-15

## Scope

This packet corrects the independent review findings on `codex/s013-g0-hardening` only. It does not begin S018 and does not read private environment files, create credentials, contact Google/Gmail/OpenAI/Supabase/Vercel, or execute a provider action.

## Corrections

- GitHub Actions migration checksum is LF/CRLF invariant, retains only the known legacy CRLF ledger checksum without rewrite, and uses a fixed CI-only loopback migration service.
- CI actions are SHA-pinned, checkout includes reachable history, and the secret scanner reports only paths/rules while scanning tracked files and historical blobs.
- The fixture E2E server has a complete explicit test environment; it cannot inherit deployment variables or load `.env.local`.
- Account-brief independence rejects the closed controlled event, region, attendee, meeting/date-time, and provider-detail universe.
- Traceability validates a closed fixture registry and repository-contained paths.
- Golden contracts now use lifecycle-aware initial/recovery plans, clarification-only intake, all prevention-rule statuses, and canonical digest verification.
- The focus ring is contrast-verified and browser assertions cover composer/login focus plus expired-session alert behavior.

## Hosted CI finding

All prior branch runs failed in unit tests because the migration checksum depended on checkout line endings. The corrected workflow has not yet run; its ephemeral PostgreSQL and browser stages remain pending a push.

## Local verification

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed; 23 files, 121 tests |
| `npm run build` | Passed; 7 routes generated |
| `npm run test:e2e` | Passed; hermetic fixture auth/create/review/expiry flow |
| `npm run traceability:check` | Passed; 52 requirements, 3 covered / 15 partial / 34 planned |
| `npm run verify:fake-production` | Passed |
| `npm run security:scan` | Passed; 126 tracked files, 244 reachable history blobs, 0 findings before staging this packet |
| `npm audit --audit-level=moderate` | Passed; 0 vulnerabilities |
| `npm ci --dry-run --no-audit` | Passed |
| `git diff --check` | Passed before final staging |

The local machine has no Docker or PostgreSQL executable, so the disposable migration replay was deliberately not run locally. The workflow runs it only against its fixed loopback CI service.

## Remaining human-only work

S018 remains the first unfinished task. Its private Supabase/Vercel clean-checkout, configuration, and readiness evidence require a human and were not started.
