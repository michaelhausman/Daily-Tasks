# Putting Tagpool on the internet

The short path: **one Railway project holding three things** — the app, a
Postgres database, and a disk for the uploaded files. No Cloudflare account, no
S3 keys, no separate signups. Around 20 minutes, about $5/month.

If you later outgrow it, [scaling up](#scaling-up-later) covers moving media to
Cloudflare R2 without changing any code.

---

## Before you start

You need a [Railway](https://railway.app) account (sign in with GitHub) and this
repository pushed to GitHub — it already is, on the branch
`claude/media-sharing-tagging-platform-inmmg3`.

Pick your invite code now. Anyone with it can create an account, so make it
something you wouldn't mind reading aloud but wouldn't be guessed:

```bash
node -e "console.log(require('crypto').randomBytes(6).toString('base64url'))"
```

---

## 1. Create the project and the database

1. Railway → **New Project** → **Deploy from GitHub repo** → pick
   `michaelhausman/Daily-Tasks`.
2. Under **Settings → Source**, set the branch to
   `claude/media-sharing-tagging-platform-inmmg3`.
3. The first deploy will fail. That's expected — there's no database yet.
4. In the same project: **New** → **Database** → **Add PostgreSQL**.

Railway wires `DATABASE_URL` into your app automatically. You don't have to copy
it anywhere.

## 2. Add a disk for the uploads

This is the step people miss. Railway containers have a **temporary**
filesystem — anything written there vanishes on the next deploy. Uploaded photos
need a volume, which persists.

1. Click your **app** service (not the database) → **Settings** → **Volumes** →
   **Add Volume**.
2. Mount path: `/data`
3. Size: 5GB is plenty to start and can be grown later.

## 3. Set the environment variables

App service → **Variables** → **Raw Editor**, and paste this, editing the last
three lines:

```bash
STORAGE_ROOT=/data/media
NODE_ENV=production

ADMIN_HANDLES=michael
SIGNUP_INVITE_CODE=paste-the-code-you-generated
TAKEDOWN_CONTACT_EMAIL=you@example.com
```

What these do:

| Variable | Why it matters |
|---|---|
| `STORAGE_ROOT` | Points uploads at the volume. **Miss this and every photo disappears on your next deploy.** |
| `ADMIN_HANDLES` | Who can moderate. Without it nobody can hide, delete, or suspend anything. Use the handle you'll sign up with. |
| `SIGNUP_INVITE_CODE` | Required to create an account. Browsing stays public. |
| `TAKEDOWN_CONTACT_EMAIL` | Shown on `/takedown` for rights holders without an account. |

`DATABASE_URL` and `PORT` are set by Railway. Don't add them yourself.

Optional, with sensible defaults already: `MAX_UPLOAD_MB` (50),
`UPLOADS_PER_HOUR` (30), `SIGNUP_DISABLED`. See `.env.example`.

## 4. Deploy

**Deploy** on the app service. The build takes a few minutes.

There's **no migration step** — the app creates its own database tables on
startup. Watch the deploy log for:

```
[tagpool] schema ready — Postgres at ...
✓ Ready
```

If the schema line is missing, the app couldn't reach the database — check that
the Postgres service is in the same project.

## 5. Get a URL

App service → **Settings** → **Networking** → **Generate Domain**. You'll get
something like `tagpool-production.up.railway.app`.

Open it. You should see an empty site — no moments, no uploads. That's correct:
your production database starts empty, and the demo data only exists locally.

## 6. Make yourself the first account

1. Go to `/signup`.
2. Enter your invite code.
3. **Use exactly the handle you put in `ADMIN_HANDLES`.** Admin is matched by
   handle, so `michael` in the variable means signing up as `michael`.
4. Upload something and confirm it appears.
5. Confirm **Moderation** shows in the top nav. If it doesn't, your handle
   doesn't match the variable — fix the variable and redeploy.

Then hand out the invite code.

---

## Should you seed the demo data?

Probably not. `npm run seed` creates four fictional accounts that all share the
password `password123` — fine locally, bad on a public URL. It refuses to run if
any account already exists, so it can't overwrite real content, but there's no
reason to invite it in.

If you do want the demo content to look at, run it against production from your
own machine and delete the accounts afterwards:

```bash
DATABASE_URL='<the Postgres URL from Railway>' npm run seed
```

---

## Keeping it running

**Backups.** Railway's Postgres service has a Backups tab — turn it on. The
volume holding your photos is **not** backed up automatically; if the media
matters, copy it somewhere periodically.

**Costs.** Roughly $5/month for the app plus a few dollars for the database and
volume. Railway's usage page shows the real number. Bandwidth is the thing that
grows if people watch a lot of video.

**Updates.** Push to the branch and Railway redeploys. Schema changes apply
themselves on boot.

**ffmpeg.** Not installed by default, so video posters and audio waveforms
won't generate — everything still uploads and plays. To add it, create a
`nixpacks.toml` in the project root:

```toml
[phases.setup]
nixPkgs = ["...", "ffmpeg"]
```

The literal `"..."` matters; it means "keep the defaults and add to them".

---

## Scaling up later

Two limits you'll hit in this order, both fixable without code changes:

**Media bandwidth.** Every photo and video streams through the app. Move it to
Cloudflare R2 — no egress charges, which is what dominates a video site's bill:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=tagpool-media
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Existing files stay on the volume, so copy them into the bucket keeping the same
`media/<id>/...` paths before switching. Then optionally put a domain in front
and set `MEDIA_PUBLIC_BASE_URL` so the app stops touching media bytes entirely.

**Upload processing.** Thumbnails are generated inside the upload request. Fine
at this scale; under real traffic it belongs in a job queue.

---

## Before you open signups to strangers

Invite-only is doing a lot of work for you. Removing `SIGNUP_INVITE_CODE` changes
the risk profile completely, and these should be in place first:

- **Have a lawyer read `/rules` and `/takedown`.** Both are plain-English drafts,
  not reviewed terms. You'll also want a privacy policy.
- **Register a DMCA agent** if you're operating in the US. That registration is
  what limits your liability for what other people upload — paperwork, not code.
- **Automated scanning.** No CSAM hashing or NSFW classification exists here.
  Cloudflare offers CSAM scanning free once media sits behind them.
- **Rate-limit comments**, not just uploads.
- **An audit log** of moderation actions, for the first time a removal is
  disputed.

---

## When something goes wrong

**Deploy fails immediately.** Usually the database isn't attached yet. Confirm
the Postgres service sits in the same project as the app.

**Site loads but every image is broken.** `STORAGE_ROOT` isn't set, or doesn't
match the volume's mount path. It must be `/data/media` for a volume mounted at
`/data`.

**Photos vanished after a deploy.** Same cause — they were written to the
container's temporary disk rather than the volume. Files already lost are gone;
fix the variable before uploading more.

**No Moderation link.** Your handle doesn't match `ADMIN_HANDLES` exactly. It's
case-insensitive but otherwise literal.

**"relation does not exist".** The app couldn't run its startup migration. The
deploy log will say why — usually a database it can't reach.

**Uploads fail on big files.** The default ceiling is 50MB. Raise it with
`MAX_UPLOAD_MB`.
