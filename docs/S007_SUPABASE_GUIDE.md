# S007 manual guide — provision Supabase PostgreSQL

Use this guide only for `S007`. It creates and hardens the database project and stores two private connection URLs. It does **not** apply the Rewind migration; `npm run db:migrate` belongs to `S008`.

## What you will have when S007 is complete

- One Supabase project in **South Asia (Mumbai), `ap-south-1`**.
- Supabase account MFA enabled.
- PostgreSQL SSL enforcement enabled.
- The unused Supabase Data API disabled.
- A non-admin `rewind_app` login for application runtime traffic.
- `DATABASE_URL` using the transaction pooler on port `6543` and `rewind_app`.
- `DATABASE_MIGRATION_URL` using the `postgres` migration role over a direct or session connection on port `5432`.
- Both URLs stored only in the ignored, permission-restricted `.env.local` file.
- Sanitized evidence containing no password or complete connection URL.

Official references: [available regions](https://supabase.com/docs/guides/platform/regions), [database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [Postgres roles](https://supabase.com/docs/guides/database/postgres/roles), [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), [disabling the Data API](https://supabase.com/docs/guides/api/securing-your-api), and [account MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication).

## Safety rules before you begin

1. Do not paste a password, connection URL, access token, API key, QR code, or MFA secret into Codex, chat, GitHub, screenshots, or committed Markdown.
2. Use a password manager. Create two different passwords:
   - `SUPABASE_POSTGRES_ADMIN` for the project-level `postgres` role.
   - `REWIND_RUNTIME_DB` for the restricted `rewind_app` role.
3. Make each password at least 32 random characters. A 32–40 character letters-and-numbers password is easiest here because it needs no URL percent-encoding. Never reuse either password.
4. Keep this project dedicated to synthetic Rewind demo data. Do not import real customer or mailbox data.
5. Do not run `npm run db:migrate`, create Calendar events, or send mail during S007.

## Step 1 — secure the Supabase account

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and sign in.
2. Open your avatar/account menu, then **Account settings**.
3. Open **Multi-factor authentication**.
4. Add a TOTP factor using a password manager or authenticator app.
5. Add a backup TOTP factor on a separate device or securely store the backup factor. Supabase does not issue recovery codes.
6. Sign out and sign back in once to prove MFA works.
7. Never capture or share the QR code or TOTP seed. A screenshot showing only that MFA is enabled is acceptable private evidence.

If you sign in to Supabase with GitHub, also enable GitHub two-factor authentication because that account controls your Supabase organization.

## Step 2 — create the Mumbai project

1. In Supabase Dashboard, choose the organization that will own the hackathon project. Create a personal organization first if none exists.
2. Click **New project**.
3. Set the project name to a recognizable private name such as `rewind-hackathon`.
4. In your password manager, generate and save the `SUPABASE_POSTGRES_ADMIN` password.
5. Paste that password into **Database password**. Do not store it in a note, source file, or chat.
6. Under **Region**, choose the exact specific region **South Asia (Mumbai)**. Confirm that the code shown is **`ap-south-1`**. Do not choose the generic APAC region or Singapore.
7. Choose the smallest plan that fits the hackathon unless you intentionally need a paid feature. Review any displayed cost before confirming.
8. Click **Create new project** and wait until project provisioning is healthy.
9. Open **Project settings → General** and confirm the region is still `ap-south-1`. The project reference may be recorded only in redacted form, for example `abcd…wxyz`.

Region selection is the important irreversible choice here. If the project is in the wrong region, delete/recreate the empty project before continuing.

## Step 3 — disable the unused Data API

Rewind connects directly with `node-postgres`; it does not use Supabase REST, GraphQL, `supabase-js`, browser database access, `anon`, or `service_role` keys.

1. In the project dashboard, open the **Data API integration overview**. Depending on the current navigation, this appears under **Integrations → Data API** or from the project's Data API settings link.
2. Find **Enable Data API**.
3. Turn it **off** and confirm the change.
4. Verify the page now shows the Data API as disabled.
5. Do not copy an `anon`, publishable, secret, or `service_role` key into Rewind.

Disabling the Data API makes the generated REST/GraphQL endpoints unavailable regardless of table grants. This is the intended setup for Rewind.

## Step 4 — require encrypted PostgreSQL connections

1. Open **Database → Settings**.
2. Find **SSL Configuration**.
3. Turn **Enforce SSL on incoming connections** on.
4. Confirm the change. Supabase may briefly reboot the new database.
5. Wait until the database reports healthy again.
6. Confirm the setting remains enabled after refreshing the page.

Every connection URL stored below must have exactly one accepted `sslmode` and `uselibpqcompat=true`. For S007 use `sslmode=require&uselibpqcompat=true`. The compatibility flag makes the installed `pg` 8.x client apply standard libpq `require` semantics instead of treating `require` as certificate-verifying `verify-full`. `verify-full` is stronger but also requires installing and configuring Supabase's CA certificate; do not claim it unless that certificate verification has actually been configured and tested.

## Step 5 — create the restricted runtime role

The runtime must not use the powerful project `postgres` password. Supabase recommends a separate role for each external service.

1. Generate and save a different password named `REWIND_RUNTIME_DB` in your password manager.
2. Open **SQL Editor → New query**.
3. Paste the SQL below.
4. Replace `PASTE_RUNTIME_PASSWORD_HERE` inside the single quotes with the runtime password. If the password contains a single quote, generate a new letters-and-numbers password instead of trying to escape it.
5. Run the query once. Do not save or share the query, and do not include the query editor in screenshots because it temporarily contains a password.

```sql
create role rewind_app
  with login
       password 'PASTE_RUNTIME_PASSWORD_HERE'
       nosuperuser
       nocreatedb
       nocreaterole
       noinherit
       noreplication
       nobypassrls
       connection limit 10;

grant connect on database postgres to rewind_app;
grant usage on schema public to rewind_app;
revoke create on schema public from rewind_app;

-- Keep Supabase API roles away from future Rewind tables even if the Data API
-- is accidentally enabled later.
alter default privileges for role postgres in schema public
  revoke all privileges on tables
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions
  from anon, authenticated, service_role, public;

-- Migrations run as postgres; future Rewind objects receive only runtime DML
-- privileges. The runtime role receives no schema-creation or admin rights.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to rewind_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to rewind_app;
```

If the query says `role "rewind_app" already exists`, stop. Do not drop or overwrite it until you know who created it. A duplicate role can indicate that S007 was already partly completed.

## Step 6 — verify the role without exposing its password

1. Clear the prior SQL editor contents.
2. Open a fresh query and run this password-free verification:

```sql
select
  rolname,
  rolcanlogin,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolinherit,
  rolreplication,
  rolbypassrls,
  rolconnlimit
from pg_roles
where rolname = 'rewind_app';

select
  has_database_privilege('rewind_app', 'postgres', 'CONNECT') as can_connect,
  has_schema_privilege('rewind_app', 'public', 'USAGE') as can_use_public,
  has_schema_privilege('rewind_app', 'public', 'CREATE') as can_create_in_public;

select
  defaclobjtype,
  defaclacl::text
from pg_default_acl
where defaclrole = 'postgres'::regrole
  and defaclnamespace = 'public'::regnamespace
order by defaclobjtype;
```

3. Confirm exactly one `rewind_app` row exists.
4. Confirm:
   - `rolcanlogin = true`
   - `rolsuper = false`
   - `rolcreatedb = false`
   - `rolcreaterole = false`
   - `rolinherit = false`
   - `rolreplication = false`
   - `rolbypassrls = false`
   - `rolconnlimit = 10`
   - `can_connect = true`
   - `can_use_public = true`
   - `can_create_in_public = false`
5. In the default privileges result, confirm:
   - `S` (sequences) contains `postgres=rwU/postgres` and `rewind_app=rU/postgres`; `anon`, `authenticated`, and `service_role` are absent.
   - `f` (functions) contains only `postgres=X/postgres`.
   - `r` (tables) contains the owner entry for `postgres` and `rewind_app=arwd/postgres`; `anon`, `authenticated`, and `service_role` are absent.

If API roles still appear with residual letters such as `w`, `D`, `x`, `t`, or `m`, run this corrective block and then repeat the verification query:

```sql
alter default privileges for role postgres in schema public
  revoke all privileges on tables
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences
  from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions
  from anon, authenticated, service_role, public;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to rewind_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to rewind_app;
```

Do not try a table read yet; the Rewind tables intentionally do not exist before S008.

## Step 7 — obtain the two different connection URLs

Open the project's **Connect** dialog and choose URI/connection-string format. Copy the displayed strings into a private password-manager note temporarily; never paste them into chat.

### A. Runtime URL: `DATABASE_URL`

1. Select **Transaction pooler** (shared Supavisor is acceptable).
2. Confirm the port is **`6543`**.
3. Use the custom role `rewind_app`. If the dialog shows the default username `postgres.PROJECT_REF`, change only that username to `rewind_app.PROJECT_REF`; keep the project reference suffix exactly as supplied.
4. Replace the password placeholder with `REWIND_RUNTIME_DB`.
5. Append `?sslmode=require&uselibpqcompat=true` if there is no query string, or `&sslmode=require&uselibpqcompat=true` if the URL already has one.
6. Confirm the URL contains exactly one `sslmode=require` and exactly one `uselibpqcompat=true` parameter.

Expected shape—never copy this placeholder literally:

```text
postgresql://rewind_app.PROJECT_REF:RUNTIME_PASSWORD@POOLER_HOST:6543/postgres?sslmode=require&uselibpqcompat=true
```

### B. Migration URL: `DATABASE_MIGRATION_URL`

1. Select **Direct connection**.
2. Confirm the port is **`5432`** and the role is `postgres`.
3. Use `SUPABASE_POSTGRES_ADMIN` as the password.
4. Append exactly one `sslmode=require` and one `uselibpqcompat=true` parameter.
5. Prefer this direct URL for migrations. Supabase direct endpoints require IPv6 unless the IPv4 add-on is enabled.
6. If your network cannot reach IPv6, copy the **Session pooler** URL instead. It also uses port `5432`, the `postgres.PROJECT_REF` username, and is the accepted IPv4 fallback for migrations. Do **not** use transaction mode for migrations.

Expected direct shape:

```text
postgresql://postgres:ADMIN_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true
```

Expected IPv4 session-pooler fallback shape:

```text
postgresql://postgres.PROJECT_REF:ADMIN_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require&uselibpqcompat=true
```

## Step 8 — store the URLs privately on this Mac

1. Open Terminal.
2. Run:

```bash
cd /Users/ayush/everything/Projects/Rewind
touch .env.local
chmod 600 .env.local
git check-ignore -v .env.local
```

3. The last command must report that `.env.local` is ignored by `.gitignore`. If it prints nothing, stop and do not add credentials.
4. Open `.env.local` in your local editor. Add or replace only these two lines:

```dotenv
DATABASE_URL="PASTE_THE_RUNTIME_TRANSACTION_POOL_URL_HERE"
DATABASE_MIGRATION_URL="PASTE_THE_DIRECT_OR_SESSION_MIGRATION_URL_HERE"
```

5. Save the file and close the editor.
6. Run `chmod 600 .env.local` once more.
7. Do not run `git add -f .env.local`. Do not paste the file contents into a terminal command, because that may store credentials in shell history.

The migration runner now loads `.env.local` itself and refuses to fall back from `DATABASE_MIGRATION_URL` to the runtime credential.

## Step 9 — collect only sanitized S007 evidence

Keep screenshots containing full project details in your private evidence location. The committed evidence may contain only:

- Project reference: redacted, for example `abcd…wxyz`.
- Region: `South Asia (Mumbai) / ap-south-1`.
- MFA: enabled; no QR code, seed, or TOTP.
- Data API: disabled.
- SSL enforcement: enabled.
- Runtime role: `rewind_app`, non-admin, no schema `CREATE`.
- Runtime connection: transaction pooler, port `6543`, `sslmode=require`, `uselibpqcompat=true`; password/host/project reference omitted or redacted.
- Migration connection: direct or session mode, port `5432`, `sslmode=require`, `uselibpqcompat=true`; password/host/project reference omitted or redacted.
- Local secret file: `.env.local` exists with mode `600` and is Git-ignored; contents omitted.

Never screenshot the Connect dialog while a password is visible.

## Step 10 — report completion safely

Send Codex only this non-secret template, filled in:

```text
S007 manual setup complete.
- Project ref: abcd…wxyz (redacted)
- Region: South Asia (Mumbai), ap-south-1
- MFA: enabled
- Data API: disabled
- SSL enforcement: enabled
- Runtime role checks: passed
- DATABASE_URL: transaction pooler / 6543 / rewind_app / sslmode=require / uselibpqcompat=true (value not shared)
- DATABASE_MIGRATION_URL: direct OR session / 5432 / postgres / sslmode=require / uselibpqcompat=true (value not shared)
- .env.local: chmod 600 and Git-ignored
- Migration run: no
```

At that point S007 can be recorded complete. The next task is `S008`: run and independently verify the real migration, constraints, grants, TLS, repeatability, and readiness. Do not skip directly to Vercel or provider work.

## Troubleshooting

### `password authentication failed`

- Confirm the runtime URL uses the `rewind_app` password, not the project admin password.
- Confirm the migration URL uses the project `postgres` password.
- With a shared pooler, keep the `.PROJECT_REF` suffix in the username.
- If a password contains special characters, do not paste it unencoded into a URL. The simplest safe fix before any data exists is to rotate it to a new long alphanumeric password and update only `.env.local`.

### Direct migration URL cannot connect

The direct endpoint is IPv6 by default. Use the **Session pooler** on port `5432` as `DATABASE_MIGRATION_URL` when your local network is IPv4-only. Keep `sslmode=require&uselibpqcompat=true`.

### The runtime URL is on port `5432`

You copied direct or session mode. Go back to **Connect**, select **Transaction pooler**, and use port `6543` for `DATABASE_URL`.

### The SQL editor reports that `rewind_app` already exists

Stop and inspect the existing role with the password-free verification query. Do not drop it automatically. Ask Codex to review the redacted role flags and privilege output.

### `.env.local` appears in `git status`

Do not stage it. Run `git check-ignore -v .env.local`. The expected matching rule is `.env.*` from the repository `.gitignore`. If it is not ignored, stop before continuing.
