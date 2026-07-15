# S028 — Deployed G1 non-effecting proof

This is the human-only checkpoint for the deployed G1 slice. It proves authenticated MCP → API → PostgreSQL → dashboard behavior. It does not prove Google OAuth, Calendar, Gmail, OpenAI, or any external effect.

Never paste a passcode, bearer token, cookie, database URL, provider ID, recipient address, full mail body, prompt, or raw deployment log into chat, Git, screenshots, or the evidence report.

## Preconditions

1. Deploy the reviewed S028 branch to the configured Vercel production origin, or otherwise confirm that the deployed commit includes the S028 PostgreSQL boundary change.
2. Confirm the deployed environment uses `NODE_ENV=production` and `REWIND_STORAGE_MODE=postgres`. Do not change it to `memory_fixture`; production must reject that mode.
3. Have the private dashboard passcode and scoped MCP token available only in the password manager/local MCP configuration.
4. Confirm the Supabase migration/readiness checkpoint is still green. Do not run a migration against an unknown database.

## Safe proof

1. From a private terminal, check only the frozen origin’s status responses. Record status codes and sanitized JSON fields, not headers containing cookies or diagnostics:

   ```text
   GET https://YOUR_FROZEN_ORIGIN/api/health → 200, status ok
   GET https://YOUR_FROZEN_ORIGIN/api/ready → 200, status ready, schema 0001_phase0_foundation
   ```

2. Open the deployed `/login` page in a private browser window. Enter the passcode manually. Confirm the dashboard loads and inspect only cookie flags: `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. Do not copy the cookie value.
3. Point the local stdio MCP configuration at the same frozen origin and use the private token from local configuration. Call only `create_world_pr` with the fixed supported request:

   ```text
   Move the Acme renewal meeting on 2026-08-20 to 3:00 PM ET, prepare a risk brief from the shared Acme parent-account notes, and email the attendees.
   ```

4. Confirm the MCP result is `preview_ready` and contains only the opaque World PR ID, review URL, status, and request ID. The review URL must use the frozen origin and must not contain a bearer/capability secret.
5. Open that review URL in the already authenticated dashboard session. Confirm:

   - the request, selected Acme UK candidate, visible Acme US alternative, assumption/evidence, exact contract plan, dependency labels, and digest render;
   - the notice says `G1 non-effecting mode` and `not live-provider evidence`;
   - the plan does not show any claim that Calendar, Gmail, artifact, or model effects occurred;
   - no provider/model call, approval, or execution action is available.

6. Click `Cancel review` once. Confirm the durable state is `cancelled`, the page says no effect was approved or executed, and the composer is reachable. This cleanup is safe and prevents the demonstration record from retaining the scenario lock.

## Stop conditions

Stop immediately and record only the sanitized status if any of these occur:

- readiness is not `200`/`ready`;
- authentication, resource scope, or CSRF checks fail unexpectedly;
- the MCP result is not `preview_ready` or exposes more than the safe projection;
- the review omits the non-effecting notice or claims a live provider/model result;
- the application asks for Calendar/Gmail/OpenAI credentials or attempts an external effect;
- any provider, database, or deployment state is ambiguous.

Do not switch to fixture storage, edit the database, seed/reset Calendar, resend mail, or repair the deployed database manually.

## Sanitized evidence template

```text
S028 deployed G1 proof — YYYY-MM-DD
- Deployed commit: <short hash>
- Frozen origin: <domain only>
- /api/health: HTTP <status>; sanitized status <ok/fail>
- /api/ready: HTTP <status>; sanitized status <ready/fail>; schema <version or omitted>
- Dashboard login: passed/failed
- Cookie flags: Secure, HttpOnly, SameSite=Lax, Path=/ (values omitted)
- MCP create_world_pr: passed/failed; status <preview_ready or safe error>
- MCP output: opaque ID/review URL/status only; no token or private data
- PostgreSQL persistence/read: passed/failed
- Authenticated dashboard read: passed/failed
- Visible non-effecting notice: passed/failed
- Cancel cleanup: passed/failed
- Calendar/Gmail/OpenAI calls: none
- External effects: none
- Manual intervention: <none or sanitized description>
- Result: passed/blocked
- Remaining risk: S029/S030 freeze and G1 closure remain pending
```

This checkpoint does not close S029 or S030 and does not advance G2. Only the human operator may fill the evidence fields that require the deployed environment/session.
