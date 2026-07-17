# S012 — Private environment and startup-validation guide

S012 makes the private configuration contract explicit without recording any secret or provider identity. Use a password manager and the deployment secret manager. Never paste a database URL, API key, passcode, token, Google identity, calendar ID, recipient address, refresh-token ciphertext, or raw validator output into chat, Git, screenshots, or tracked evidence.

## What S012 proves

- Required local/deployed configuration names are present and correctly shaped.
- Production uses the frozen HTTPS origin, transaction-pool runtime database, PostgreSQL storage, exact Google callback, and strong server secrets.
- The MCP process receives only its base URL and scoped backend token.
- The structured `{UK,US}` recipient allowlist contains exactly one controlled address per region.
- The fixed demo date is `2026-08-20` in `America/New_York`.
- Validation reports names/status only and fails closed on malformed values.

S012 does **not** perform OAuth authorization, token exchange, Calendar discovery/write, Gmail send, OpenAI Responses calls, or encryption/persistence of a refresh token. `REWIND_GOOGLE_EXPECTED_SUB`, `GOOGLE_REFRESH_TOKEN_CIPHERTEXT`, and `REWIND_GOOGLE_CALENDAR_ID` remain deferred until the later OAuth/provider tasks obtain them; do not invent values.

## 1. Keep the private values ready

Use the values already created in S007, S009, S010, and S011:

- Supabase runtime transaction-pool `DATABASE_URL` using `rewind_app`, port `6543`, TLS parameters intact.
- Supabase direct/session `DATABASE_MIGRATION_URL`, local/admin use only.
- Google Web client ID and secret.
- OpenAI project key and verified model `gpt-5.6-sol`.
- Dedicated Google test-user email.

Generate fresh values for these S012 secrets unless the team explicitly chooses to retain the S009 values:

- `REWIND_SESSION_SECRET`
- `REWIND_DASHBOARD_PASSCODE`
- `MCP_BACKEND_TOKEN`
- `REWIND_TOKEN_ENCRYPTION_KEY`

Generate each separately and copy directly into the password manager; do not print or commit the output:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url')+'\\n')"
```

## 2. Configure local `.env.local`

In the ignored local `.env.local`, configure the local values. Do not edit `.env.example` with real values.

```text
APP_BASE_URL=http://localhost:3000
DATABASE_URL=<private runtime URL when using local PostgreSQL>
DATABASE_MIGRATION_URL=<private migration URL>
REWIND_STORAGE_MODE=postgres
REWIND_SESSION_SECRET=<private generated value>
REWIND_DASHBOARD_PASSCODE=<private generated value>
MCP_BACKEND_TOKEN=<private generated value>
REWIND_MODEL_RUNTIME=local_ollama
REWIND_LOCAL_MODEL=qwen2.5-coder:latest
GOOGLE_CLIENT_ID=<private client ID>
GOOGLE_CLIENT_SECRET=<private client secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/oauth/google/callback
REWIND_TOKEN_ENCRYPTION_KEY=<private generated value>
REWIND_GOOGLE_EXPECTED_EMAIL=<private dedicated test-user email>
REWIND_RECIPIENT_ALLOWLIST={"UK":["<private controlled UK address>"],"US":["<private controlled US address>"]}
REWIND_DEMO_DATE=2026-08-20
```

The local zero-credit path above does not require `OPENAI_API_KEY` or `OPENAI_MODEL`. To select the optional funded provider instead, use `REWIND_MODEL_RUNTIME=openai_responses` and supply both private OpenAI values. Never use a dummy key. Local Ollama is fixed to `127.0.0.1` and rejects model names ending in `:cloud`.

If you are intentionally running the fixture-only local browser tests, use `REWIND_STORAGE_MODE=memory_fixture` in a separate local environment. Never use fixture mode for a deployed live claim.

Leave these unset until later tasks produce verified values:

```text
GOOGLE_REFRESH_TOKEN_CIPHERTEXT=
REWIND_GOOGLE_EXPECTED_SUB=
REWIND_GOOGLE_CALENDAR_ID=
```

## 3. Configure Vercel Production

In **Vercel → Project Settings → Environment Variables → Production**, keep the S009 values and add/update the S010/S011/S012 values:

```text
APP_BASE_URL=https://rewind-eta-jet.vercel.app
DATABASE_URL=<private Supabase transaction-pool URL>
REWIND_STORAGE_MODE=postgres
REWIND_SESSION_SECRET=<private generated value>
REWIND_DASHBOARD_PASSCODE=<private generated value>
MCP_BACKEND_TOKEN=<private generated value>
OPENAI_API_KEY=<private OpenAI project key>
OPENAI_MODEL=gpt-5.6-sol
REWIND_MODEL_RUNTIME=openai_responses
GOOGLE_CLIENT_ID=<private Google client ID>
GOOGLE_CLIENT_SECRET=<private Google client secret>
GOOGLE_REDIRECT_URI=https://rewind-eta-jet.vercel.app/api/v1/oauth/google/callback
REWIND_TOKEN_ENCRYPTION_KEY=<private generated value>
REWIND_GOOGLE_EXPECTED_EMAIL=<private dedicated test-user email>
REWIND_RECIPIENT_ALLOWLIST={"UK":["<private controlled UK address>"],"US":["<private controlled US address>"]}
REWIND_DEMO_DATE=2026-08-20
```

Vercel cannot reach an Ollama server on your laptop through its own loopback interface. Keep hosted product execution disabled unless a funded approved model runtime is configured; use the local application for the zero-credit S058 flow.

Do **not** add `DATABASE_MIGRATION_URL` to Vercel. Do not add these deferred fields until later OAuth/provider work produces them:

```text
GOOGLE_REFRESH_TOKEN_CIPHERTEXT
REWIND_GOOGLE_EXPECTED_SUB
REWIND_GOOGLE_CALENDAR_ID
```

Keep the values Production-only; do not copy production secrets into Preview or Development environments. Redeploy after any Vercel variable change.

## 4. Run sanitized validation

From the repository root, run:

```bash
npm run config:check
```

Expected output contains only variable names and statuses. It must not include a value, key prefix, host, email, address, calendar ID, provider response, or SQL. A successful S012 check should identify the deferred OAuth fields as `deferred`, not fabricate them.

After a Production redeploy, recheck `/api/health`, `/api/ready`, and the secure dashboard cookie as in S009. Do not run a deployed create/review effect; that remains deferred to S023/S028.

## 5. S012 checkpoint

Reply with this sanitized checklist only:

```text
S012 environment checkpoint
- Local config validation: passed/failed
- Production config names: present
- Production storage mode: postgres
- Production database readiness: HTTP status only
- OpenAI model: gpt-5.6-sol
- Google redirect: exact production callback
- Allowlist shape: UK one address, US one address
- Demo date: 2026-08-20
- Deferred fields: refresh ciphertext, expected sub, calendar ID
- Secrets/logs leaked: no
```
