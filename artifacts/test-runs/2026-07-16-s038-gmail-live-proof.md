# S038 — controlled Gmail success and replay proof

| Field | Value |
|---|---|
| Task | S038 |
| Date | 2026-07-16 |
| Branch | `codex/s038-gmail-live-proof` |
| Status | Passed |
| Contract versions | `provider-ports.v1`, `gmail-delivery.v1`, `gmail-live-proof.v1` |
| Database migration | None; the command uses the existing foundation task/plan/action/audit tables |

## Implemented checkpoint

- `LIVE_INTEGRATION_TESTS=1 npm run prove:gmail` is the only S038 live command.
- It requires a human TTY, non-production PostgreSQL mode, non-CI execution, the configured connected Google subject/email, a distinct exact UK allowlist recipient, and literal confirmation of that recipient plus the unique run ID.
- It atomically creates one fixed proof task/plan/action identity with a digest-bound message and replay-key digest under the documented live-spike admin exception.
- Google token refresh and MIME preparation complete before the action claim. `dispatch_started_at` is persisted before one `users.messages.send` handoff.
- The sent receipt is persisted, the same action is replayed, and completion requires the same message ID plus exactly one persisted attempt. A completed proof cannot send again.
- In-progress, permanent, uncertain, drifted, unallowlisted, missing-credential, CI, Production, fixture, and non-TTY states fail closed.
- Final output contains only safe statuses, counts, run ID, and target/message fingerprints.

## Automated evidence

- Merged S037 baseline before S038: 41 files / 270 tests, typecheck, lint, build, browser E2E, traceability, security scan, fake-production refusal, and live database verification all passed.
- S038 focused Gmail suite: 5 files / 30 tests passed.
- Full suite after S038: 43 files / 278 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed.
- `npm run test:e2e`: passed.
- `npm run traceability:check`: passed — 52 requirements, 3 covered, 24 partial, 25 planned.
- `npm run verify:fake-production`: passed.
- `npm run security:scan`: passed — 201 staged files and 572 reachable history blobs, 0 findings.
- `npm audit --audit-level=moderate`: passed — 0 vulnerabilities.
- Non-TTY `npm run prove:gmail`: returned `tty_required` before database/provider work.
- `git diff --check`: passed.

## Human evidence still required

The human followed [the S038 guide](../../docs/S038_GMAIL_LIVE_PROOF_GUIDE.md). Run `run_s038_jvZVdxeNdGbCzRv8-60LRg` returned `firstStatus: sent`, `replayStatus: sent`, `replayVerified: true`, and `attempts: 1`. The operator confirmed exactly one inbox message arrived with that run ID and the approved Acme UK notification content. Recipient and message identifiers remain only as fingerprints in the command output. S038 is closed; S039 is next.
