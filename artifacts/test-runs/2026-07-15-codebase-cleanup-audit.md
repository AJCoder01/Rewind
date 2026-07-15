# Full codebase cleanup and regression audit — 2026-07-15

## Verdict

The implemented `S001`–`S007` foundation remains fit to proceed to `S008`. The local fixture slice, authentication boundaries, strict contracts, persistence guards, MCP boundary, UI flow, build, dependency state, documentation links, secret hygiene, and provisioned Supabase role/TLS posture passed the checks below.

This verdict is deliberately narrow. The real migration has not been applied, and no Calendar, Gmail, OpenAI, approval/execution, recovery, rule, or reset path is implemented or claimed.

## Redundancy review

- Every tracked and untracked project file was inventoried.
- No empty project files, byte-identical duplicates, backup files, or orphaned source/configuration modules were found.
- All declared direct packages have a current runtime, build, lint, type, test, or framework purpose.
- The conventional `tests/e2e/world-pr.spec.ts` and `playwright.config.ts` are intentionally retained for CI migration; `scripts/test-e2e.ts` remains the lifecycle-managed root command used locally.
- The four one-line command guards are intentionally retained because the required root commands must fail closed until their numbered implementation phases.
- Migration SQL, the S007 guide, Vercel configuration, and historical evidence are required by the next gates or by the evidence policy.
- No tracked file was removed merely to reduce file count. Ignored `.next/` output and `tsconfig.tsbuildinfo` were removed after verification because they are reproducible generated caches.
- A clean `npm ci` reproducibly installs one top-level optional `@emnapi/runtime` entry that `npm ls` labels extraneous. The package is represented in the lockfile and is pulled by the optional Sharp/WASM dependency graph; it is generated dependency state, not a project source or lockfile redundancy.

## Verification results

| Check | Result |
|---|---|
| Node runtime | Bundled Node.js `v24.14.0`; satisfies `>=24 <25`. |
| Clean install | `npm ci --prefer-offline --no-audit` passed; 441 packages installed from the lockfile. |
| Lint | `npm run lint` passed. |
| Strict typecheck | `npm run typecheck` passed. |
| Additional unused-code compiler check | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` passed. |
| Unit/contract/storage/auth tests | `npm test` passed: 5 files, 28 tests. |
| Production build | `npm run build` passed: optimized Next.js build with 8 routes. |
| Critical browser flow | `npm run test:e2e` passed wrong-passcode rejection, authenticated creation, strict review rendering, expired-session handling, and safe return to the review URL. |
| Actual MCP stdio smoke | Exactly one tool exposed; `create_world_pr` reached the authenticated fixture backend and returned only `worldPrId`, `status`, and non-secret `reviewUrl`. |
| Production fake guard | Production mode refused `memory_fixture` when durable storage was unavailable. |
| Dependency advisory audit | `npm audit --audit-level=moderate` reached the registry and reported 0 vulnerabilities. |
| Tracked secret scan | No database credential, Supabase key, Google API key, or private-key shaped value found. |
| Client bundle secret isolation | 28 static build files scanned against configured sensitive values; no match found. |
| Local secret file | `.env.local` remained mode `600`, ignored, and untracked. |
| Documentation links | 15 Markdown files scanned; no missing local link. |
| File integrity | No empty/duplicate project file; `git diff --check` passed. |
| Deferred command guards | Recovery eval, seed, preflight, and reset commands all refused with the correct phase-gate message. |
| MCP startup guard | Missing scoped token refused startup. |

## Read-only S007 regression

No migration or provider write was performed.

- Runtime URL remains distinct from the migration URL and uses the transaction pooler on port `6543` with the restricted `rewind_app` identity.
- Migration URL uses the session pooler on port `5432` with the `postgres` migration owner.
- Both connections reached database `postgres` over TLS.
- `rewind_app` retains `USAGE` but not `CREATE` on `public`, connection limit 10, and no superuser/database-create/role-create/inherit/replication/RLS-bypass flags.
- For future objects created by migration owner `postgres`, `rewind_app` has exactly table `SELECT/INSERT/UPDATE/DELETE` and sequence `SELECT/USAGE`; `anon`, `authenticated`, and `service_role` have no future-object grant. Supabase-managed defaults owned by unrelated roles were excluded from this migration-owner assertion.
- An otherwise equivalent plaintext connection was rejected with an SSL-specific error.
- All ten foundation tables remain absent, proving that `S008` was not accidentally started.

One initial local audit query contained a SQL quoting error and a later retry encountered transient DNS resolution failure. Both were read-only and performed no database mutation; the corrected, migration-owner-scoped checks completed successfully.

## Remaining scheduled work

1. `S008` must apply the migration, prove repeatability and every constraint/grant, exercise uniqueness, and add database readiness. This audit intentionally did not run `npm run db:migrate`.
2. Full lifecycle, repository, intake serialization, trust-boundary, fake-isolation, route, MCP, UI, and negative matrices remain partially complete under `S019`–`S027`.
3. Vercel, Google, OpenAI, external effects, approval, recovery, prevention, and reset remain behind their numbered gates.

No finding from this cleanup/regression audit blocks starting `S008`.
