# FreeResend Deployment Guide (Vercel + Vercel Postgres)

This guide deploys FreeResend to **Vercel** with **Vercel Postgres** (Neon-backed)
as the database. FreeResend is a Next.js 15 (App Router) app; it runs on Vercel's
**Node.js serverless runtime** (it needs the `pg` driver and the AWS SDK — it does
**not** run on the Edge runtime).

> Other managed Postgres providers (Neon directly, Supabase, Railway) work too —
> see [Alternative databases](#alternative-databases). PlanetScale does **not** work:
> it is MySQL and incompatible with this PostgreSQL schema.

---

## Prerequisites

- A Vercel account (**Pro** recommended — see [Plan notes](#plan-notes))
- This repository on GitHub/GitLab/Bitbucket (for Git integration)
- An AWS account with SES access (+ an IAM user)
- `psql` installed locally (to apply the schema once)
- A domain you control (for sending email)

---

## 1. Provision the database (Vercel Postgres)

1. In the Vercel dashboard: **Storage → Create Database → Postgres** (Neon).
2. Attach it to your project (or create the project first, step 3, then attach).
3. Vercel auto-injects connection env vars into the project. Depending on the
   integration version you'll get **either**:
   - `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (direct), **or**
   - `POSTGRES_URL` (pooled) + `POSTGRES_URL_NON_POOLING` (direct).

**The app reads `DATABASE_URL`.** It must point at the **pooled** connection
(host contains `-pooler`). If your integration only injected `POSTGRES_URL`, add a
`DATABASE_URL` env var whose value is the pooled `POSTGRES_URL`. The pooler
(PgBouncer, transaction mode) is what keeps Vercel's many serverless containers
from exhausting the database connection limit — the app's pool is intentionally
capped low (`max: 2`, see `src/lib/database.ts`).

Keep the **direct / non-pooling** URL handy — it's used only for the one-time
migration in the next step.

---

## 2. Apply the schema (one time)

`/api/setup` only seeds the admin user — it does **not** create tables. Apply
`database.sql` to the database before first use, using the **direct (non-pooling)**
connection (multi-statement DDL is happiest off the transaction pooler):

```bash
# Use the DIRECT/UNPOOLED URL from step 1 (DATABASE_URL_UNPOOLED or POSTGRES_URL_NON_POOLING)
export ADMIN_DATABASE_URL='postgresql://USER:PASS@DIRECT_HOST/DB?sslmode=require'

# database.sql is idempotent (safe to re-run): tables use IF NOT EXISTS and triggers
# are dropped-then-created.
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f database.sql

# Verify
psql "$ADMIN_DATABASE_URL" -c "\dt"
psql "$ADMIN_DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal;"
```

The default admin user is **not** seeded by the SQL — you create it after deploy via
`POST /api/setup` using `ADMIN_EMAIL` / `ADMIN_PASSWORD` (step 5).

---

## 3. Create the Vercel project

Use **Git integration** (do not use any "one-click deploy" button that points at the
upstream `eibrahim/freeresend` repo — it clones the wrong repo):

1. Vercel → **Add New → Project → Import Git Repository** → select this repo.
2. Framework preset: **Next.js** (auto-detected). Build command `next build`.
3. **Node.js Version:** Project Settings → General → set **22.x** (matches `.nvmrc`).

> If you previously used the included GitHub Actions workflow
> (`.github/workflows/deploy.yml`), note it deploys to **DigitalOcean Kubernetes**,
> not Vercel. For a Vercel-only setup, disable or delete that workflow so pushes to
> `main` don't trigger a failing K8s job. Vercel's Git integration handles deploys.

---

## 4. Environment variables

Set these in **Project Settings → Environment Variables** (Production, and Preview
if you want preview deploys to work). `DATABASE_URL` is already injected by step 1.

### Required

| Variable | Value / notes |
|---|---|
| `DATABASE_URL` | Pooled Postgres URL (from step 1). |
| `NEXTAUTH_SECRET` | `openssl rand -hex 32`. Used to sign JWTs (`src/lib/auth.ts`). |
| `NEXTAUTH_URL` | Your final URL, e.g. `https://your-app.vercel.app` (or custom domain). |
| `AWS_REGION` | **SES mode only.** e.g. `us-east-1`. |
| `AWS_ACCESS_KEY_ID` | **SES mode only.** IAM user key (step 6). |
| `AWS_SECRET_ACCESS_KEY` | **SES mode only.** IAM user secret. |
| `ADMIN_EMAIL` | Seeds the admin via `/api/setup`; also waitlist-notification recipient. |
| `ADMIN_PASSWORD` | Admin login password set on first `/api/setup`. |

### Optional

| Variable | Purpose |
|---|---|
| `EMAIL_PROVIDER` | `ses` (default) or `smtp`. In `smtp` mode the app sends through a per-domain SMTP relay (see [SMTP mode](#smtp-mode-use-your-own-mail-server)) and AWS is not required. |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `false` to allow self-signed / internal SMTP TLS certs (smtp mode). Default `true`. |
| `ENCRYPTION_KEY` | Optional. 32-byte hex (`openssl rand -hex 32`). When set, per-domain SMTP relay passwords are encrypted at rest (AES-256-GCM); otherwise stored plaintext. |
| `FROM_EMAIL` | Notification "from" address (defaults to `info@freeresend.com`). In smtp mode, internal notifications use the relay configured for this address's domain. |
| `DATABASE_SSL_STRICT` | `false` only if your DB presents an un-verifiable TLS cert. Default validates TLS. Vercel Postgres works with the default. |
| `CRON_SECRET` | `openssl rand -hex 32`. Required if you use the stats cron (step 7). |
| `DO_API_TOKEN` | DigitalOcean DNS automation. If unset, DNS is manual. |
| `STRIPE_SECRET_KEY` | Stripe metrics for the stats push. |
| `STATS_DASHBOARD_URL`, `STATS_APP_SLUG`, `STATS_PUSH_SECRET` | All three needed or the stats cron is skipped (no error). |
| `STATS_API_KEY` | Auth for the `/api/stats` endpoint. |
| `UMAMI_API_URL`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`, `UMAMI_WEBSITE_ID` | All four needed for Umami metrics. |

> Do **not** set `NODE_ENV` — Vercel manages it. There are no Supabase env vars
> (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); the project migrated to
> direct Postgres and ignores them.

---

## SMTP mode (use your own mail server)

Set `EMAIL_PROVIDER=smtp` to send through your own SMTP server instead of AWS SES.
In this mode AWS is not used at all (you can omit `AWS_*`), and SES domain
verification, SNS delivery webhooks, and DigitalOcean DNS are all bypassed.

1. Set `EMAIL_PROVIDER=smtp` (optionally `ENCRYPTION_KEY` and `SMTP_TLS_REJECT_UNAUTHORIZED`).
2. Apply the schema — `database.sql` adds the `smtp_config` column (`ADD COLUMN IF NOT EXISTS`).
3. In the dashboard, **add your domain** — it is auto-verified immediately (no DNS records).
4. Click **Configure SMTP Relay** on the domain and enter host / port / TLS / username /
   password. The connection is tested (`transporter.verify()`) before saving; the password
   is masked in the UI afterward and never returned by the API.
5. Create an API key for the domain and send via `POST /api/emails` (or the Resend SDK)
   exactly as in SES mode — the message is relayed through that domain's SMTP server.

You manage SPF/DKIM/DMARC on your own mail server. Generic SMTP provides no asynchronous
delivery/bounce tracking (that was SES → SNS), so `email_logs.status` stays `sent` unless
the server rejects the message at send time. Per-domain relay settings are stored in the
DB; which provider runs is global (the `EMAIL_PROVIDER` env). For internal notifications
(waitlist emails), configure a relay for the `FROM_EMAIL` domain — otherwise those are
skipped (logged, non-fatal).

---

## 5. Deploy & initialize

1. Trigger a deploy (push to `main`, or **Deploy** in the dashboard).
2. Seed the admin user:
   ```bash
   curl -X POST https://YOUR-DOMAIN.vercel.app/api/setup
   ```
3. Health check:
   ```bash
   curl https://YOUR-DOMAIN.vercel.app/api/health
   ```
4. Log in at `https://YOUR-DOMAIN.vercel.app/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

`vercel.json` (in the repo) configures the cron schedule and region (`iad1`). The
long-running domain routes set their own `maxDuration` via route segment config.

---

## 6. AWS SES wiring (required to actually send)

1. **IAM user (least privilege).** Create a programmatic IAM user and attach a policy
   allowing exactly:
   `ses:SendEmail`, `ses:SendRawEmail`, `ses:VerifyDomainIdentity`,
   `ses:GetIdentityVerificationAttributes`, `ses:DeleteIdentity`,
   `ses:CreateConfigurationSet`, `ses:VerifyDomainDkim`,
   `ses:GetIdentityDkimAttributes`.
   *Only if you use the per-domain SMTP-credentials feature* (`src/lib/smtp.ts`,
   which creates IAM users), also grant `iam:CreateUser`, `iam:CreateAccessKey`,
   `iam:AttachUserPolicy`, `iam:DeleteUser` (and related). Otherwise omit them.
   Put the access key/secret in the env vars above.
2. **Add your domain** in the FreeResend dashboard. The app creates the SES identity,
   enables DKIM, creates a configuration set, and generates DNS records
   (TXT `_amazonses`, SPF, DMARC, 3× DKIM CNAME, MX `inbound-smtp`). Publish them.
3. **Delivery webhooks (SNS).** Create an SNS topic, configure SES event
   notifications (or a configuration-set event destination) to publish to it, then
   add an **HTTPS** subscription to:
   `https://YOUR-DOMAIN.vercel.app/api/webhooks/ses`.
   **Confirm the subscription** in the SNS console (the route logs the confirmation
   request but does not auto-confirm it, and does not verify SNS signatures).
4. **Production access.** SES starts in **sandbox** (verified recipients only). Request
   production access via AWS Support before sending to real users.

---

## 7. Optional integrations

- **DigitalOcean DNS:** set `DO_API_TOKEN`. The domain must already exist in DO; then
  DNS records are created automatically. If unset, create DNS records by hand.
- **Stats cron:** set `CRON_SECRET` plus `STATS_DASHBOARD_URL` + `STATS_APP_SLUG` +
  `STATS_PUSH_SECRET` (and optionally `STRIPE_SECRET_KEY`, the four `UMAMI_*`). Vercel
  Cron calls `/api/cron/report-stats` on the schedule in `vercel.json` with
  `Authorization: Bearer $CRON_SECRET`; the route accepts that (and still accepts the
  legacy `x-cron-secret` header used by the k8s CronJob). Without the stats vars the
  cron returns `{ skipped: true }`.

---

## Plan notes

- **Sub-daily cron** (the default `0 */6 * * *` schedule) and **`maxDuration > 10s`**
  on the domain routes effectively require **Vercel Pro**. On **Hobby**, change the
  cron to once-daily (e.g. `0 8 * * *`) and be aware that adding a domain (which chains
  SES + DigitalOcean calls, ~11s) may hit the function time limit.

---

## Alternative databases

The app only needs a Postgres `DATABASE_URL` pointing at a **transaction-mode pooler**:

- **Neon (direct):** use the `-pooler` host, append `?sslmode=require`.
- **Supabase:** Dashboard → Database → Connection string → **Transaction** mode
  (host `...pooler.supabase.com`, **port 6543**), append `?sslmode=require`.
- **Railway:** append `?sslmode=require`; there's no built-in transaction pooler, so
  keep `pg` `max` very low (it's already `2`) and watch the connection count.

For migration, prefer each provider's **direct/non-pooling** URL with `psql`.

---

## Verify end-to-end

1. `GET /api/health` → OK.
2. Log in; add a domain; publish DNS; confirm SES verification.
3. Create an API key for the verified domain.
4. Send a test email via `POST /api/emails` (or the Resend SDK with
   `RESEND_BASE_URL=https://YOUR-DOMAIN.vercel.app`).
5. Confirm the email log status flips to `delivered` (proves the SNS webhook works).

---

## Rough monthly cost

| Item | Cost |
|---|---|
| Vercel Pro | ~$20/user/mo (or Hobby $0 with the caveats above) |
| Vercel Postgres | Free tier → ~$10–20/mo as usage grows |
| AWS SES | ~$0.10 per 1,000 emails (+ ~$0.12/GB attachments) |
| AWS SNS | First 1M HTTP notifications/mo free |
| Custom domain | ~$10–15/yr |

**Typical small production: ~$20–50/mo.** Minimal/test footprint: ~$0–5/mo on Hobby
+ free Postgres + low SES volume.

---

## Troubleshooting

- **500s on every request / "relation does not exist":** schema not applied — rerun
  step 2.
- **Cannot log in:** `ADMIN_EMAIL`/`ADMIN_PASSWORD` not set, or `/api/setup` not called.
- **DB connection errors under load:** confirm `DATABASE_URL` is the **pooled** URL.
- **TLS / self-signed cert errors:** set `DATABASE_SSL_STRICT=false`.
- **Cron 401:** `CRON_SECRET` mismatch between Vercel env and the request.
- **Domain add times out:** you're on Hobby — upgrade to Pro (routes set
  `maxDuration = 60`).
- **Local `npm run build` fails with `<Html> should not be imported outside of
  pages/_document` while prerendering `/404`:** your shell exports
  `NODE_ENV=development`. Next must build with `NODE_ENV=production`
  (`env NODE_ENV=production npm run build`). This does **not** affect Vercel, which
  always builds with `NODE_ENV=production`.
