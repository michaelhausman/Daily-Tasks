# Deploying Tagpool

Two things have to exist before the app does: a Postgres database and a bucket.
Then you point the app at both and deploy it. Budget about 30 minutes.

Everything below assumes **Cloudflare R2** for storage and a long-running host
(Railway, Render, or Fly). Substitutions are noted where they matter.

---

## Why these choices

**R2 over S3.** For a site where people watch video, bandwidth — not storage —
is the bill. S3 charges roughly $0.09/GB egress; R2 charges nothing. A hundred
people watching a 50MB clip is about $0.45 on S3 and $0 on R2, every time. The
code is identical either way; it's one endpoint variable.

**A long-running host over serverless.** Uploads are processed in the same
request that receives them, so a 200MB concert video needs a few minutes.
Vercel's functions cap at 10s (Hobby) or 60s (Pro) and will kill it. Railway,
Render, and Fly run a normal container with no request timeout. If you want
Vercel specifically, uploads have to go browser-direct to R2 first — a real but
separate piece of work.

---

## 1. Create the bucket

1. Cloudflare dashboard → **R2** → **Create bucket**. Name it `tagpool-media`.
   Pick the location hint nearest your audience.
2. **R2** → **Manage API Tokens** → **Create API Token**.
   - Permission: **Object Read & Write**
   - Scope it to just this bucket
   - Save the **Access Key ID** and **Secret Access Key** — the secret is shown
     once and never again.
3. Note your **Account ID** (it's in the dashboard URL). Your endpoint is
   `https://<account-id>.r2.cloudflarestorage.com`.

You do **not** need to make the bucket public. The app proxies media through
`/api/files/` by default, so a private bucket works from the start. Serving
directly from a public bucket is a later optimization — see step 6.

> **On AWS S3 instead:** create the bucket, create an IAM user with
> `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::your-bucket/*`,
> and leave `S3_ENDPOINT` unset — the SDK derives it from `S3_REGION`.

## 2. Create the database

Any Postgres 14+ works. Easiest options:

| Provider | Free tier | Notes |
|---|---|---|
| **Neon** | yes | Serverless, scales to zero. Use the **pooled** connection string. |
| **Supabase** | yes | Use the **Connection pooling** string (port 6543), not the direct one. |
| **Railway** | no (~$5/mo) | Simplest if you're already hosting there — it wires `DATABASE_URL` in for you. |
| **Fly Postgres** | no | Lives next to your app; lowest latency. |

Copy the connection string. It should look like:

```
postgres://user:password@host:5432/dbname?sslmode=require
```

**Use the pooled endpoint** if your provider offers one. The app opens up to 10
connections by default; Neon's unpooled endpoint and Supabase's direct port both
cap low enough that a couple of instances will exhaust them. Lower
`DATABASE_POOL_MAX` if you hit connection limits anyway.

## 3. Set the environment variables

In your host's dashboard:

```bash
DATABASE_URL=postgres://user:password@host:5432/tagpool?sslmode=require

STORAGE_DRIVER=s3
S3_BUCKET=tagpool-media
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=<from step 1>
S3_SECRET_ACCESS_KEY=<from step 1>
```

`.env.example` documents every variable including the ones you rarely need.

## 4. Deploy

**Railway** — New Project → Deploy from GitHub → pick the repo and branch. It
detects Next.js. Add the variables above, then deploy.

**Render** — New → Web Service → connect the repo.
Build: `npm install && npm run build`. Start: `npm run start`.

**Fly** — `fly launch` (accept the Next.js detection), `fly secrets set KEY=value`
for each variable, then `fly deploy`.

All three set `PORT` themselves; `npm run start` respects it.

## 5. Create the schema

Once, against the production database:

```bash
DATABASE_URL='<your production url>' npm run db:migrate
```

Run it from your laptop, or from the host's shell (`railway run`, `fly ssh console`).
It's idempotent — safe to re-run after any deploy.

Optionally seed the demo data with `npm run seed`. It refuses to run if the
database already has users, so it can't clobber real content. **Skip it if this
is your actual site** — it creates four accounts that all share the password
`password123`.

## 6. Serve media from a CDN (recommended, later)

By default every image and video streams through your app server. That works,
but it's the most expensive way to move bytes and it puts video traffic on the
same process serving pages.

To bypass it: connect a custom domain to the R2 bucket (R2 → your bucket →
Settings → **Public access** → connect a domain, e.g. `media.yourdomain.com`),
then set:

```bash
MEDIA_PUBLIC_BASE_URL=https://media.yourdomain.com
```

Media URLs will point straight at Cloudflare's edge and `/api/files/` stops
being used. Objects are already written with a one-year immutable
`Cache-Control`, so they cache aggressively.

Note this makes every object readable by anyone with the URL. Keys are
unguessable, but "unlisted" stops being a real boundary — if that matters,
leave this unset and keep proxying.

---

## Before you invite anyone

Things this build does not yet have, roughly in the order they'll bite:

- **No moderation.** No reporting, no takedown queue, no admin view. A public
  media-upload site needs this on day one, not eventually.
- **No rate limiting.** Nothing stops one account uploading until your bucket
  bill hurts. Add a per-user cap.
- **Processing is inline.** Fine at low volume on a long-running host. Under
  real traffic it belongs in a job queue so uploads return immediately.
- **No video transcoding.** Originals are served as uploaded, so a phone's HEVC
  `.mov` may not play in every browser. Install ffmpeg on the host to at least
  get poster frames and audio waveforms.
- **No password reset or email verification.**
- **No backups configured.** Turn on point-in-time recovery with your Postgres
  provider, and versioning on the bucket.

## Troubleshooting

**Uploads succeed but images are broken / zero bytes.** The bucket credentials
are probably read-only, or `S3_BUCKET` names a bucket the key can't write to.
Check the app logs for an S3 `AccessDenied`.

**`relation "media" does not exist`.** Step 5 hasn't run against this database.

**`too many connections`.** Switch to your provider's pooled connection string,
or lower `DATABASE_POOL_MAX`.

**Uploads time out on large files.** You're on a serverless host with a request
timeout. Move to a container host, or switch to browser-direct uploads.

**Dates land on the wrong day.** Shouldn't happen — `event_date` is a real DATE
and the driver is configured to return it as a plain string specifically to
avoid timezone drift. If you see it, please treat it as a bug rather than a
configuration problem.
