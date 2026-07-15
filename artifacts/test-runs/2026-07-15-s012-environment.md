# S012 private environment evidence (sanitized)

Date: 2026-07-15

## Scope

Private environment shape and startup-validation checkpoint. No secret values, provider identities, database URLs, recipient addresses, calendar IDs, refresh-token ciphertext, or raw logs are recorded.

## Human checkpoint

- Local `config:check`: passed; application and MCP scopes both `ok`
- Production configuration: updated and redeployed with the S012 Production-only values
- Production storage mode: `postgres`
- Production `/api/health`: HTTP 200; service status `ok`
- Production `/api/ready`: HTTP 200; service status `ready`; schema `0001_phase0_foundation`
- Dashboard login: passed
- `rewind_session` cookie: `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` confirmed
- Deferred fields remain unset: refresh-token ciphertext, expected Google subject, and Calendar ID
- Secret/log leakage: none reported or recorded

## Result

Passed. S012’s validator, sanitized config check, Production environment, and deployment readiness checkpoint are complete.

## Remaining risk

OAuth token exchange, Google account/calendar ownership, live Calendar/Gmail effects, and strict model output remain later G2 work. S013 is the next task.
