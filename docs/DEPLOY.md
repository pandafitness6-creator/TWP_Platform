# Deploy to your own Cloudflare and Supabase accounts

## 1. Requirements and location

Install Node.js >=22.13, npm and the official Supabase CLI. Use a supported current Node release. Install Git only if you want to explore the history bundle. Open a terminal INSIDE the extracted Train-With-Panda directory. Do not publish the whole package.

Run:

```sh
npm ci
```

## 2. Create and install your database

In your Supabase account create a new project, choose a region and retain its database password privately. Obtain the project reference, HTTPS project URL, public Publishable (or legacy anon) key and legacy service_role key from the project settings. Only public URL/key belong in the browser. The service_role key is used locally once to create the coach.

With the Supabase CLI installed:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list
supabase db push --dry-run
supabase db push
```

This creates all tables, RLS rules, database functions and shipped library content using the 23 migrations in supabase/migrations/. These commands are for your linked project; inspect the project reference before applying them. No separate data seed is needed. See database/MIGRATION-ORDER.txt.

Alternative without db push: on a NEW empty Supabase project run database/FRESH-INSTALL.sql in the SQL Editor. It concatenates the same 23 migrations; do NOT use both methods. The combined file does not register CLI migration history. If later switching to CLI updates, compare the schema and mark the actually applied migration versions using supabase migration repair --status applied VERSION (each version is the digits before the underscore in its filename). Do not blindly replay or reset a populated database. CLI migrations are the recommended method.

Enable the email/password Auth provider. Disable public user signup and anonymous sign-in. Accounts use a username mapped internally to username@accounts.panda.invalid; keep that namespace unchanged across frontend, bootstrap script and Edge Function. It is not an email-delivery address. Accounts are created with confirmed email by the server and do not use invitation, recovery or magic-link emails. Leave optional password-change email notifications disabled. Password resets are performed by the coach in the app.

## 3. Reserve your Cloudflare Pages project

Authenticate with YOUR Cloudflare account and create a Pages project. Replace panda-customer-portal consistently with a unique name you choose; update name in wrangler.jsonc as well.

```sh
npx wrangler login
npx wrangler whoami
npx wrangler pages project create panda-customer-portal --production-branch main
```

This handover uses static Cloudflare Pages, with no Worker API, KV, D1 or R2 binding. Its backend is Supabase. The production origin will normally be https://panda-customer-portal.pages.dev; use the actual address reported for YOUR project.

## 4. Deploy the account-management function

Allow your exact app origin (scheme and hostname, no trailing slash):

```sh
supabase secrets set PANDA_ALLOWED_ORIGINS=https://panda-customer-portal.pages.dev --project-ref YOUR_PROJECT_REF
supabase functions deploy panda-accounts --project-ref YOUR_PROJECT_REF
```

supabase/config.toml sets verify_jwt=false at the gateway. The function itself validates each request token against Supabase Auth and checks the authoritative account/role table. Keep these checks intact. Its built-in server environment uses SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY. Do not copy server keys into Cloudflare static assets.

If using multiple origins, pass the complete comma-separated PANDA_ALLOWED_ORIGINS value in quotes. Do not allow '*'. When adding a custom domain, update the allowed origins and Supabase Auth URL configuration (Site URL and any needed redirect URLs) to your own addresses. For a separate preview deployment allow that exact preview origin too.

## 5. Configure the app and create the initial coach

Copy .env.example to .env.local. On PowerShell:

```powershell
Copy-Item .env.example .env.local
```

On macOS/Linux use cp .env.example .env.local. Edit locally:

- PANDA_PUBLIC_SUPABASE_URL: your HTTPS project URL.
- PANDA_PUBLIC_SUPABASE_KEY: public Publishable or legacy anon key.
- PANDA_SERVER_SERVICE_ROLE_KEY: your legacy service_role key (private).
- PANDA_BOOTSTRAP_USERNAME: your chosen coach username (3–32 characters, lowercase letters/numbers/dots/underscores/hyphens).
- PANDA_BOOTSTRAP_PASSWORD: your own random 12–128 character password.

Then run:

```sh
npm run configure
npm run bootstrap:coach
npm run build
npm run check
```

The bootstrap refuses to create a second coach. If a coach already exists, skip it. After success remove the private service_role key and bootstrap password from .env.local. Retain the two public values for future configuration. Change the initial password at first sign-in. Keep deployment-config.json locally; it contains only the public connection. The source remains unconnected; the build inserts your connection into public/index.html. No old backend is contacted.

`npm run build` first runs `npm run assemble`. That step regenerates standalone/Train-With-Panda-Portal.html from the source of truth, src/portal.template.html plus src/media/; the build then reads that file. The standalone is gitignored and overwritten on every build, so editing it directly has no effect. Make frontend changes in src/, then build and check.

## 6. Publish only public/

```sh
npx wrangler pages deploy public --project-name panda-customer-portal --branch main
```

Upload the entire public directory, including all media, article pictures and _headers. Uploading index.html alone breaks media. Build/check keep each public asset below Cloudflare's 25 MiB file limit. Do not upload .env.local, database files, scripts, the history bundle, src/ or the generated standalone HTML. This build is meant for CLI Pages upload; dashboard drag-and-drop has a smaller per-file limit and is not the recommended route for these media bundles.

For future releases: back up the database/Auth privately, check migration history, apply only missing migrations, rebuild/check, and deploy public/ with --branch main. For frontend rollback use a previous Cloudflare deployment. Do not reverse database changes blindly; historical frontend snapshots are for inspection and are not guaranteed compatible with a newer schema.

## 7. Verify and operate

Use docs/ACCEPTANCE.md before handing access to users. If login works but coach account operations fail, check Edge Function deployment, allowed origin and function logs. Missing articles usually indicate unapplied database migrations; missing images indicate an incomplete public upload. If the app reports no connection, configure and rebuild.

**Updating an existing installation to client access expiry (migrations 021 and 022).** Order: `supabase db push` (applies whichever of 021/022 is missing; both are additive), then `supabase functions deploy panda-accounts --project-ref YOUR_PROJECT_REF`, then `npm run build`, `npm run check` and `npx wrangler pages deploy public`. Deploy the database first: an app built from this version still works against an older database, but not the other way round.

How expiry works: "Access expires on" is the client's last day of access. The client keeps full access until the end of that calendar day in the client's own timezone; access ends at 00:00 on the next day there (for example, 3 November for a client in Asia/Dubai ends at 00:00 on 4 November Dubai time, which is 20:00 UTC on 3 November). An empty date means no expiry. Paused and archived take precedence over the date. The coach chooses each client's country (and, for countries with several timezones, the city); this sets the client's timezone, which can also be overridden manually. The browser's own timezone is never used. Clients without a timezone use the default from Settings → Client access timezone (Asia/Colombo unless changed). The rule is enforced by the database on every request (RLS), with daylight saving handled by PostgreSQL time zones, so no scheduled job is needed and renewal works immediately. Clients see the coach's Email, Phone and WhatsApp from the Contact settings in the warning banner and when access ends, so fill those in.

**Updating an existing installation to the client intake questionnaire (migration 023).** Apply it with `supabase db push` before deploying any app version that uses the intake, then build, check and deploy as usual. The migration is additive and safe to re-run. It changes the installed panda_save and readable() functions in place and stops with "review migration 023" if the database does not already contain migrations 009, 010 and 014, or if the record kinds differ from those it expects; nothing is changed in that case. Migration 023 briefly locks panda_records while its updated checks scan the table, so run it at a quiet time. It also raises the revision of the coach settings record: a coach page that was open during the update asks for a refresh before its next settings save.

Intake data is health information. Clients see only their own intake; coach accounts see all intakes. The answers are never written to the activity log. Coach backups exported from the portal include intake answers once the app shows them, so store exported backups as securely as the database.

Intake retention: settings/brand.intake_retention_months sets how many whole months (1–120) a client's intake is kept after the client is archived. Migration 023 sets it to 24 (2 years) if it is not already set; an empty value means intakes are never deleted automatically. There is no automatic deletion yet: the value is stored for a future scheduled job, and until then intake records are removed only when the client's account is deleted.

Supabase holds accounts, records, plan/event history, custom content and uploaded images; uploads are stored in protected records, not an external Storage bucket in this implementation. Cloudflare holds the shipped static media. Arrange database and Auth backups in your own account and test restoration. Supabase deployment settings, billing, domain/DNS and backup policies are account operations and are not automatically recreated by this ZIP.

Official references checked when preparing this guide (2026-10-02):

- [Cloudflare Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Supabase CLI](https://supabase.com/docs/reference/cli/introduction)
- [Deploy Edge Functions](https://supabase.com/docs/guides/functions/deploy)
- [Function configuration](https://supabase.com/docs/guides/functions/function-configuration)
- [Password Auth](https://supabase.com/docs/guides/auth/passwords)

