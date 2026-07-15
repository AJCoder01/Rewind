# S018 G0 clean-checkout runbook (prepared, not complete)

S018 is the next unfinished task. This runbook and `npm run client:scan` are prepared on the hardening branch; S018 remains open until a human runs the private database/deployment checks in the intended environment.

## Safe local/CI sequence

From a clean checkout of the verified branch, use Node 24 and run:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run security:scan
npm run client:scan
npm run traceability:check
npm run verify:fake-production
npm audit --audit-level=moderate
```

The client scan reads only generated `.next/static` assets and reports sanitized rule names. It rejects credential-shaped tokens, remote connection URLs, and private server-environment names in browser assets. It is not a substitute for the tracked-file scan or the later release security task.

## Human-only checks still required

Do not mark S018 complete from this preparation alone. A human owner must, using private values without exposing them:

1. Run the frozen migration and read-only catalog verification against the restricted Supabase connections, then record sanitized migration/readiness evidence.
2. Verify the deployed Vercel origin, Node/runtime configuration, health/readiness, and secure-cookie behavior from the intended deployment environment.
3. Confirm the hosted CI PostgreSQL service applies and replays the migration, and reconcile all command results with `README.md`, `docs/TEST_PLAN.md`, and `docs/PROGRESS.md`.

No OAuth grant, Calendar/Gmail call, OpenAI Responses call, seed/reset operation, or live external effect is part of this preparation.
