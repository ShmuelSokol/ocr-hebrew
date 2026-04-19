# 3rdBHMK — Supabase project migration brief

**Paste this into the Claude session working on the 3rdBHMK project.**

---

## Context (what happened in the other session)

The OCR Hebrew project (`ksavyad.com`) discovered on 2026-04-19 that its entire production Postgres schema had been silently wiped. Every table was gone. Railway logs showed `P2021 table does not exist` on every request.

The root cause: **OCR Hebrew, 3rdBHMK, and 3D Images all share the same Supabase project** — `ushngszdltlctmqlwgot`. Prisma's `db push` drops any table that isn't in the current `schema.prisma`. When any of the three apps runs `db push`, the other two are at risk of having their tables deleted.

This is how OCR Hebrew's tables were wiped — some past `db push` from one of the other two projects dropped them. **3rdBHMK is currently in the same danger**: a stray `db push` from OCR Hebrew or 3D Images could drop your `bhmk_*` tables and your `bhmk` schema (including 149,397 bounding-box rows, 388 pages, 375 translations, 383 erased images).

OCR Hebrew already added guards on their side (`npm run db:push:prod` refuses on non-empty DB, removed auto-push from Dockerfile). **You need to do the same here AND move your DB out of the shared project.**

## Your job

Migrate 3rdBHMK's Postgres + Supabase Storage to its own dedicated Supabase project.

### Step 1 — Create a new Supabase project

Shmuel does this part via the dashboard:

1. https://supabase.com/dashboard → **New project**
2. Name: `3rdbhmk`
3. Region: **us-east-1** (must match for pooler)
4. Set DB password, save it
5. Copy the new project ref (the `xxxxxxxxxxxxxxx` part of the dashboard URL)

Ask Shmuel for:
- New project ref
- New DB password
- New service role key (`Project settings → API → service_role`)
- New anon key (`Project settings → API → anon public`)

### Step 2 — Dump everything from the shared project

Your data currently lives in `ushngszdltlctmqlwgot`. Get the current connection string from Railway (`DIRECT_URL`) and run:

```bash
pg_dump \
  --host=aws-1-us-east-1.pooler.supabase.com \
  --port=5432 \
  --username=postgres.ushngszdltlctmqlwgot \
  --dbname=postgres \
  --schema=public \
  --schema=bhmk \
  --no-owner --no-privileges \
  --table='public.bhmk_*' \
  --table='bhmk.*' \
  --format=custom \
  --file=3rdbhmk-dump.pgdump
```

Confirm counts before migrating:

```sql
SELECT 'bhmk_book' t, COUNT(*) FROM public.bhmk_book UNION ALL
SELECT 'bhmk_bounding_box', COUNT(*) FROM public.bhmk_bounding_box UNION ALL
SELECT 'bhmk_content_region', COUNT(*) FROM public.bhmk_content_region UNION ALL
SELECT 'bhmk_erased_image', COUNT(*) FROM public.bhmk_erased_image UNION ALL
SELECT 'bhmk_fitted_page', COUNT(*) FROM public.bhmk_fitted_page UNION ALL
SELECT 'bhmk_ocr_result', COUNT(*) FROM public.bhmk_ocr_result UNION ALL
SELECT 'bhmk_page', COUNT(*) FROM public.bhmk_page UNION ALL
SELECT 'bhmk_page_layout', COUNT(*) FROM public.bhmk_page_layout UNION ALL
SELECT 'bhmk_translation', COUNT(*) FROM public.bhmk_translation UNION ALL
SELECT 'bhmk_verification_ocr', COUNT(*) FROM public.bhmk_verification_ocr UNION ALL
SELECT 'bhmk.OCRResult', COUNT(*) FROM bhmk."OCRResult";
```

Expected (verified 2026-04-19 from OCR Hebrew side):
- `bhmk_book`: 3
- `bhmk_bounding_box`: 149,397
- `bhmk_content_region`: 1,878
- `bhmk_erased_image`: 383
- `bhmk_fitted_page`: 383
- `bhmk_ocr_result`: 384
- `bhmk_page`: 388
- `bhmk_page_layout`: 11
- `bhmk_translation`: 375
- `bhmk_verification_ocr`: 379

### Step 3 — Restore into the new project

```bash
pg_restore \
  --host=aws-1-us-east-1.pooler.supabase.com \
  --port=5432 \
  --username=postgres.<NEW_PROJECT_REF> \
  --dbname=postgres \
  --no-owner --no-privileges \
  3rdbhmk-dump.pgdump
```

Run the same COUNT(*) verification against the new DB. All counts must match exactly.

### Step 4 — Migrate Supabase Storage

Your app uses the `bhmk` bucket (public) in the old project. Storage objects need to be copied.

Write a Node script (or adapt one) using the service role key to:

1. List all objects in old project's `bhmk` bucket (recursively, paginated at 1000/batch)
2. Create a `bhmk` bucket in the new project with the same settings (public: true)
3. For each object: download from old → upload to new, preserving path

Sample count check before starting — in old project:
```js
const { data } = await oldSb.storage.from('bhmk').list('', { limit: 100000 });
console.log('top-level folders:', data.length);
// Walk every subfolder and count all files
```

Expected top-level folders: `books`, `config`, `exports`, `pages`, `pipeline`.

### Step 5 — Update Railway env vars

For the 3rdBHMK Railway service, update:
- `DATABASE_URL` → `postgresql://postgres.<NEW_REF>:<NEW_PW>@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
- `DIRECT_URL` → `postgresql://postgres.<NEW_REF>:<NEW_PW>@aws-1-us-east-1.pooler.supabase.com:5432/postgres`
- `NEXT_PUBLIC_SUPABASE_URL` → `https://<NEW_REF>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` → new service role key
- Any anon key env var → new anon key

Also update your local `.env.local` so you don't accidentally point at the old project during dev.

### Step 6 — Redeploy + verify

Push a trivial commit to trigger redeploy. Watch the build logs and first few requests:
- No `P2021` errors
- Load the main app page, verify data shows
- Spot-check: load a known book/page, ensure pages render

### Step 7 — Add safety guards to 3rdBHMK repo

Copy the pattern from OCR Hebrew (in `ocr-hebrew/web/scripts/`):

- `scripts/db-push-guarded.js` — refuses `prisma db push` when DB has rows unless `CONFIRM_SCHEMA_CHANGE=yes`
- `scripts/db-backup.js` — nightly JSON dump of all tables with 30-day rotation
- Update your `Dockerfile` CMD to remove any automatic `prisma db push` on boot
- `/api/health` — check that your critical tables exist (return 503 `schema-missing` if any are gone)
- Add `npm run db:push:prod` and `npm run db:backup` scripts to `package.json`

### Step 8 — Delete `bhmk_*` tables from the shared project

**Only after confirming the new project works end-to-end.** This frees OCR Hebrew to recreate its schema safely.

Connect to the OLD shared project and drop your tables:

```sql
DROP TABLE IF EXISTS public.bhmk_book CASCADE;
DROP TABLE IF EXISTS public.bhmk_bounding_box CASCADE;
DROP TABLE IF EXISTS public.bhmk_content_region CASCADE;
DROP TABLE IF EXISTS public.bhmk_erased_image CASCADE;
DROP TABLE IF EXISTS public.bhmk_fitted_page CASCADE;
DROP TABLE IF EXISTS public.bhmk_ocr_result CASCADE;
DROP TABLE IF EXISTS public.bhmk_page CASCADE;
DROP TABLE IF EXISTS public.bhmk_page_layout CASCADE;
DROP TABLE IF EXISTS public.bhmk_translation CASCADE;
DROP TABLE IF EXISTS public.bhmk_verification_ocr CASCADE;
DROP SCHEMA IF EXISTS bhmk CASCADE;
```

Also delete the `bhmk` Storage bucket from the OLD project (Supabase dashboard → Storage → bhmk → Delete bucket).

### Step 9 — Report back

Confirm to Shmuel:
> Migration complete for 3rdBHMK.
> - New Supabase project ref: `<xxxxxxxx>`
> - All bhmk_* tables and bhmk schema removed from `ushngszdltlctmqlwgot` (verified)
> - `bhmk` Storage bucket deleted from old project
> - Railway env vars updated
> - App verified end-to-end
> - Safety guards added (db-push-guarded, db-backup, health check, Dockerfile CMD)

## Don't do these things

- **Do not** run `prisma db push` against the shared `ushngszdltlctmqlwgot` at any point. You will either hit Prisma's safety block or — if you use `--accept-data-loss` — drop OCR Hebrew Storage references and 3D Images tables.
- **Do not** proceed to Step 8 (drop tables from shared project) until you've run the new project in production and verified it works. That is your safety rollback window.
- **Do not** skip adding the safety guards in Step 7. The whole point of this migration is preventing recurrence.

## Questions or problems

Report back to Shmuel. If the OCR Hebrew Claude session is around, it has full context on what happened and can advise.
