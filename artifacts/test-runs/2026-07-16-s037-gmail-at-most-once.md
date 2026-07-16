# S037 — Gmail at-most-once delivery

| Field | Value |
|---|---|
| Task | S037 |
| Date | 2026-07-16 |
| Branch | `codex/s037-gmail-at-most-once` |
| Contract versions | `provider-ports.v1`, `gmail-delivery.v1` |
| Database migration | None; the PostgreSQL bridge targets the frozen `action_executions` foundation row |
| Live provider effect | None; no Gmail send, mailbox read, draft, or OAuth refresh was run |

## Implemented boundary

- `GmailDeliveryService` rejects plan-digest drift, sender-substitution, unregistered templates, body-hash drift, and recipients outside the structured `{UK,US}` allowlist before dispatch state is claimed.
- `GmailPort.prepareApprovedMessage` completes local schema/MIME preparation while `dispatch_started_at` is still null.
- `GoogleGmailPort` sends one deterministic base64url MIME request to `users.messages.send`; it never reads or modifies a mailbox.
- `MemoryGmailDispatchStore` and `PostgresGmailDispatchStore` claim the unique mail action and persist `dispatch_started_at` before handoff. S046 will create and integrate the complete action-ledger rows.
- A local preparation failure remains `retryable_failed` with a null marker. A valid message ID is `succeeded`; explicit non-timeout 4xx is `permanently_failed`; HTTP 408/429/5xx, transport loss, timeout, cancellation, malformed 2xx, process interruption, and post-send persistence failure are `delivery_uncertain`.
- Terminal and uncertain records replay their stored result without another provider call. Ambiguous delivery is never automatically resent.
- Provider response bodies, access tokens, full message bodies, and recipient addresses are not placed in receipts or errors.

## Automated evidence

- `npm test`: passed — 41 files, 270 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `tests/unit/gmail-delivery.test.ts`: passed — allowlist/template/digest gates, marker ordering, local retry, permanent 4xx, every uncertain class, malformed success, concurrency, and no-redispatch replay.
- `tests/unit/google-gmail.test.ts`: passed — deterministic MIME, request shape, success, 4xx/408/429/5xx, transport/cancellation/timeout, malformed success, and injection rejection.
- `tests/unit/gmail-dispatch-store.test.ts`: passed — PostgreSQL marker/outcome SQL bridge and null-marker retry persistence.
- `npm run traceability:check`: passed — `traceability.v1`, 52 requirements, 3 covered, 24 partial, 25 planned.
- `npm run build`: passed — production Next.js build completed successfully.
- `npm run test:e2e`: passed — authentication rejection, login, creation, strict review, expired session, cancel/back, reduced-motion, and responsive checks.
- `npm run security:scan`: passed — 184 files and 555 reachable history blobs scanned, 0 findings.
- `npm run verify:fake-production`: passed — production fixture configuration rejected.
- `npm audit --audit-level=moderate`: passed — 0 vulnerabilities.
- `npm run db:verify`: passed — exact catalog/constraints/grants, TLS, role restrictions, migration ledger, and readiness all remained true.
- `git diff --check`: passed.
- No live Gmail effect was used; S038 is the human-gated live success/replay proof.

## Remaining risk

The full product approval, action-ledger creation, lease-expiry reconciliation, and live Gmail success/replay remain S038/S046/S055 work. S037 deliberately does not claim a live sent message.
