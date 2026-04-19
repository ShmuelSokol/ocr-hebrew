# 3D Images — Supabase project migration brief

**Paste this into the Claude session working on the 3D Images project (`3d.kbrlive.com`).**

---

## Context (what happened in the other session)

The OCR Hebrew project (`ksavyad.com`) discovered on 2026-04-19 that its entire production Postgres schema had been silently wiped. Every table was gone. Railway logs showed `P2021 table does not exist` on every request.

The root cause: **OCR Hebrew, 3rdBHMK, and 3D Images all share the same Supabase project** — `ushngszdltlctmqlwgot`. Prisma's `db push` drops any table that isn't in the current `schema.prisma`. When any of the three apps runs `db push`, the other two are at risk of having their tables deleted.

This is how OCR Hebrew's tables were wiped — some past `db push` from one of the other two projects dropped them. **3D Images is currently in the same danger**: a stray `db push` from OCR Hebrew or 3rdBHMK could drop your `td_*` tables.

OCR Hebrew already added guards on their side. **You need to do the same here AND move your DB out of the shared project.**

## Your data scope (this is a small migration)

As of 2026-04-19, the shared project contains only these 3D Images tables:

- `public.td_user`: 1 row (shmuelsokol@yahoo.com)
- `public.td_image`: 101 rows
- `public.td_coupon`, `public.td_coupon_redemption`, `public.td_payment`, `public.td_ticket`: counts unknown — verify yourself

Plus the `3d-images` Storage bucket (public) with subfolders: `anaglyph`, `color-stereo`, `depth`, `distance`, `frames`.

Small dataset, quick migration.

## Your job

Migrate 3D Images' Postgres + Supabase Storage to its own dedicated Supabase project.

### Step 1 — Create a new Supabase project

Shmuel does this part via the dashboard:

1. https://supabase.com/dashboard → **New project**
2. Name: `3d-images`
3. Region: **us-east-1** (must match for pooler)
4. Set DB password, save it
5. Copy the new project ref

Ask Shmuel for:
- New project ref
- New DB password
- New service role key (`Project settings → API → service_role`)
- New anon key

### Step 2 — Count and dump from shared project

Verify what's currently in the shared project:

```sql
SELECT 'td_user' t, COUNT(*) FROM public.td_user UNION ALL
SELECT 'td_image', COUNT(*) FROM public.td_image UNION ALL
SELECT 'td_coupon', COUNT(*) FROM public.td_coupon UNION ALL
SELECT 'td_coupon_redemption', COUNT(*) FROM public.td_coupon_redemption UNION ALL
SELECT 'td_payment', COUNT(*) FROM public.td_payment UNION ALL
SELECT 'td_ticket', COUNT(*) FROM public.td_ticket;
```

Dump:

```bash
pg_dump \
  --host=aws-1-us-east-1.pooler.supabase.com \
  --port=5432 \
  --username=postgres.ushngszdltlctmqlwgot \
  --dbname=postgres \
  --schema=public \
  --no-owner --no-privileges \
  --table='public.td_*' \
  --format=custom \
  --file=3d-images-dump.pgdump
```

### Step 3 — Restore into new project

```bash
pg_restore \
  --host=aws-1-us-east-1.pooler.supabase.com \
  --port=5432 \
  --username=postgres.<NEW_PROJECT_REF> \
  --dbname=postgres \
  --no-owner --no-privileges \
  3d-images-dump.pgdump
```

Run the same count query in the new DB. All counts must match exactly.

### Step 4 — Migrate Storage

Copy the `3d-images` bucket from old → new project:

1. In the new project, create a public bucket named `3d-images` (same name and settings)
2. Script the copy: list every object in old project's `3d-images` bucket, download, upload to new project's bucket, preserve paths
3. Verify object count matches

### Step 5 — Update Railway env vars

For the 3D Images Railway service, update:
- `DATABASE_URL` → `postgresql://postgres.<NEW_REF>:<NEW_PW>@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
- `DIRECT_URL` → `postgresql://postgres.<NEW_REF>:<NEW_PW>@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
- `NEXT_PUBLIC_SUPABASE_URL` → `https://<NEW_REF>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` → new service role key
- Any anon-key var → new anon key

Also update local `.env.local`.

### Step 6 — Stripe redeploy watchout

Your memory mentions "3D Stripe pending — code built, needs API keys on Railway." When you're already editing Railway env vars, double-check that the Stripe keys are set correctly (if still pending) so the migration doesn't regress the Stripe rollout.

### Step 7 — Redeploy + verify

Push a trivial commit to trigger redeploy. Verify:
- `/api/health` (if you have one) returns 200
- The anaglyph creation flow still works end-to-end
- Test account (shmuelsokol@yahoo.com, 40 credits) still reflects properly
- A known old image still renders — proves Storage migrated successfully

### Step 8 — Add safety guards

Copy from `ocr-hebrew/web/scripts/` (Shmuel has this path):

- `scripts/db-push-guarded.js` — refuses `prisma db push` when DB has rows unless `CONFIRM_SCHEMA_CHANGE=yes`
- `scripts/db-backup.js` — nightly JSON dump of all tables with 30-day rotation
- Update `Dockerfile` CMD to remove any automatic `prisma db push` on boot
- Expand `/api/health` to check that critical tables exist (return 503 `schema-missing` if gone)
- Add `npm run db:push:prod` and `npm run db:backup` scripts

### Step 9 — Delete `td_*` tables from shared project

**Only after confirming the new project works end-to-end.**

```sql
DROP TABLE IF EXISTS public.td_coupon_redemption CASCADE;
DROP TABLE IF EXISTS public.td_coupon CASCADE;
DROP TABLE IF EXISTS public.td_payment CASCADE;
DROP TABLE IF EXISTS public.td_ticket CASCADE;
DROP TABLE IF EXISTS public.td_image CASCADE;
DROP TABLE IF EXISTS public.td_user CASCADE;
```

Delete the `3d-images` Storage bucket from the OLD project (Supabase dashboard → Storage → 3d-images → Delete bucket).

### Step 10 — Report back

Confirm to Shmuel:

> Migration complete for 3D Images.
> - New Supabase project ref: `<xxxxxxxx>`
> - All td_* tables removed from `ushngszdltlctmqlwgot` (verified)
> - `3d-images` Storage bucket deleted from old project
> - Railway env vars updated
> - App verified end-to-end
> - Safety guards added

## Don't do these things

- **Do not** run `prisma db push` against `ushngszdltlctmqlwgot` at any point.
- **Do not** proceed to Step 9 (drop tables from shared project) until you've verified the new project works end-to-end. That's your rollback window.
- **Do not** skip adding safety guards in Step 8.

## Questions or problems

Report back to Shmuel. The OCR Hebrew Claude session has full context.
