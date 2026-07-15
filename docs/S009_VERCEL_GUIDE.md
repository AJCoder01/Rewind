# S009 — Vercel provisioning and verification guide

This is the human checkpoint for S009. Complete it in the Vercel dashboard with a team-controlled account protected by MFA. Do not paste any secret, database URL, passcode, token, cookie value, or deployment log containing private data into chat, Git, screenshots, or the evidence file.

S009 proves the deployment platform, origin, database readiness, and secure dashboard session. It does **not** prove the deployed create/review saga yet: the PostgreSQL store still has the controlled fixture plan, and the deployed fake-provider isolation gate is S023/S028.

Official references: [Deploying Git repositories](https://vercel.com/docs/git), [environment variables](https://vercel.com/docs/environment-variables), [Vercel environments](https://vercel.com/docs/deployments/environments), and [Vercel environment-variable CLI](https://vercel.com/docs/cli/env).

## 1. Prepare the private values

Have these values ready in a password manager or secure local note. Do not put them in a command, screenshot, or message:

- The existing Supabase `DATABASE_URL` runtime transaction-pool URL (port `6543`, `rewind_app`, TLS parameters intact). Do **not** use `DATABASE_MIGRATION_URL` on Vercel.
- A new random `REWIND_SESSION_SECRET` of at least 32 random bytes.
- A new random `REWIND_DASHBOARD_PASSCODE` for the single demo operator.
- A new random `MCP_BACKEND_TOKEN` for the local stdio MCP client.

Generate secrets locally without printing them into a transcript. For example, run the following command separately for each secret and copy the output directly into the password manager; never commit the output:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url')+'\n')"
```

Do not create Google or OpenAI variables in S009. Those belong to S010/S011. Do not fabricate `GOOGLE_REFRESH_TOKEN_CIPHERTEXT` or an expected Google subject; the OAuth work creates those later.

## 2. Sign in and import the repository

1. Open [Vercel](https://vercel.com) and sign in with the team-controlled account. Enable MFA if it is not already enabled.
2. Choose **Add New… → Project** and connect GitHub if Vercel asks for authorization.
3. Import the personal repository `AJCoder01/Rewind`. If it is not listed, the GitHub account must be the repository owner; an outside collaborator on a personal repository cannot create the Vercel connection.
4. Set the production branch to `main`.
5. Set the project root to the repository root (`./`). Do not configure a monorepo root or a second package.
6. Keep the framework as Next.js. Keep the install command compatible with the repository (`npm ci`) and the build command `npm run build`.
7. Before deploying, verify the imported commit is the pushed S008 `main` commit. The exact commit is visible locally with `git rev-parse main`; report only the short hash, not any secret.

## 3. Confirm Node, Fluid Compute, and Mumbai

1. In the project settings, select the latest available Node `24.x` runtime. The repository also pins Node 24 with `.nvmrc` and `package.json` engines.
2. Leave Fluid Compute enabled. The tracked [vercel.json](../vercel.json) declares:

   - Fluid Compute: enabled (`"fluid": true`)
   - Function region: Mumbai (`"regions": ["bom1"]`)

3. Confirm the deployment summary shows the Next.js framework and Node 24. If the dashboard offers a conflicting region/runtime override, use the project configuration above and verify the resulting deployment details before continuing.

## 4. Discover and freeze the production origin

1. Deploy once from `main` so Vercel assigns the project’s production `*.vercel.app` URL. A custom domain is optional; using the stable production Vercel domain is acceptable for this controlled demo.
2. Copy only the origin, for example `https://rewind-example.vercel.app`, into the password manager. Do not include a path, trailing slash, deployment token, or preview URL.
3. This exact HTTPS origin becomes `APP_BASE_URL` and must remain stable before Google redirects are registered in S010.

## 5. Add Production environment variables

Open **Project → Settings → Environment Variables**. Add each variable to **Production only** and mark secret values as sensitive when the dashboard offers that option:

| Name | Value/source | Scope |
|---|---|---|
| `DATABASE_URL` | Existing private Supabase transaction-pool URL | Production |
| `APP_BASE_URL` | Frozen production HTTPS origin from step 4 | Production |
| `REWIND_SESSION_SECRET` | Newly generated random value | Production |
| `REWIND_DASHBOARD_PASSCODE` | Newly generated operator passcode | Production |
| `MCP_BACKEND_TOKEN` | Newly generated random value | Production |
| `REWIND_STORAGE_MODE` | `postgres` | Production |

Do not add `DATABASE_MIGRATION_URL`; migrations remain a local/admin operation. Do not add Preview variables containing the production database or secrets. Do not add Google/OpenAI variables until S010/S011.

Environment changes apply only to a new deployment, so redeploy `main` after saving them. Vercel documents that variable updates do not change previous deployments.

## 6. Verify the deployment without private output

Use the frozen origin locally. Substitute it in your terminal, but never save the resulting output with cookies or authorization headers:

```bash
curl --fail --silent --show-error --dump-header - "https://YOUR_FROZEN_ORIGIN/api/health"
curl --fail --silent --show-error --dump-header - "https://YOUR_FROZEN_ORIGIN/api/ready"
```

Expected results:

- `/api/health`: HTTP `200`, JSON `status: "ok"`, `service: "rewind"`, and `Cache-Control: no-store`.
- `/api/ready`: HTTP `200`, JSON `status: "ready"`, `service: "rewind"`, schema version `0001_phase0_foundation`, and `Cache-Control: no-store`.
- Neither body contains a database host, role, SQL, password, or provider diagnostic.

If `/api/ready` returns `503`, do not paste the response or Vercel logs. Check only that the Production `DATABASE_URL` is present and is the same private transaction URL already verified in S007/S008, then redeploy. Report the sanitized status only.

## 7. Verify secure dashboard cookies

1. Open `https://YOUR_FROZEN_ORIGIN/login` in a private browser window.
2. Enter the Production `REWIND_DASHBOARD_PASSCODE` manually. Do not place it in a URL or screenshot.
3. In browser developer tools, inspect the sign-in response’s `rewind_session` cookie. Confirm these flags without copying the cookie value:

   - `Secure`
   - `HttpOnly`
   - `SameSite=Lax`
   - `Path=/`
   - an expiry/max-age consistent with eight hours

4. Confirm the browser remains on the HTTPS origin and the dashboard loads. Do not create a deployed World PR in S009; that action would exercise the still-fixture-backed deployed slice before S023/S028.

## 8. S009 checkpoint to report

Reply with only this sanitized checklist:

```text
S009 Vercel checkpoint
- Production origin: <domain only>
- Production branch: main
- Node: 24.x
- Fluid Compute: enabled/disabled
- Function region: bom1/other
- Production variable names present: DATABASE_URL, APP_BASE_URL, REWIND_SESSION_SECRET, REWIND_DASHBOARD_PASSCODE, MCP_BACKEND_TOKEN, REWIND_STORAGE_MODE
- /api/health: HTTP status only
- /api/ready: HTTP status only
- Cookie flags: Secure, HttpOnly, SameSite=Lax, Path=/
- Deployed create/review proof: deferred to S023/S028
```

Never include variable values, the passcode, token, cookie, database URL, Vercel token, Google/OpenAI data, or raw logs. After this checkpoint is complete, Codex will independently rerun the non-secret repository checks and close S009 before preparing S010.
