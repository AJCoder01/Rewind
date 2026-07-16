# S035 human live closure

| Field | Value |
|---|---|
| Task | S035 — controlled Calendar discovery and seeding |
| Status | Complete |
| Date | 2026-07-16 |
| Contract | `calendar-demo.v1`, `0002_oauth_transaction` |
| Requirements | FR-04, SAFE-05, SAFE-10, NFR-04, NFR-10 |

## Sanitized human evidence

- The deployed Google OAuth callback completed successfully and returned `status: connected` for the intended controlled account. No token, subject, client secret, callback URL, or provider response body is recorded here.
- The first seed attempt failed closed with `invalid_configuration` because the recipient configuration had not yet been corrected. No uncontrolled Calendar write was performed by that failed attempt.
- After the configuration correction, the human-run `preflight:demo` command returned:

```json
{
  "operation": "preflight",
  "status": "ok",
  "contractVersion": "calendar-demo.v1",
  "candidateCount": 2,
  "baselineCount": 2,
  "expectedVersionCount": 2
}
```

This is the sanitized proof that the controlled target contains exactly two candidates, both have persisted semantic baselines, and both have rolling provider versions. The target identity, event IDs, attendee addresses, ETags, and credentials remain private.

## Closure assessment

- OAuth connection, explicit Calendar targeting, controlled PostgreSQL state, exact-two discovery, baseline persistence, and rolling-version persistence are proven at the human boundary.
- The failed configuration path remained fail-closed and was corrected before the successful preflight.
- S035 does not claim Calendar move, restore, conflict, Gmail delivery, model execution, or product execution; those remain later tasks.
- No live provider operation was run by Codex. The live setup commands were run and confirmed by the human owner under the TTY gate.

## Remaining risk

Calendar move/restore behavior, conditional conflict handling, and post-write verification are not part of this closure; S036 is the next implementation task.
