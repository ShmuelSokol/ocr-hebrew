# OCR Hebrew recovery — post-migration brief

**Run this once both 3rdBHMK and 3D Images confirm their migrations complete** (see `README.md` for the hand-off message they each send).

At that point, the shared Supabase project `ushngszdltlctmqlwgot` contains only:
- `auth.*` (Supabase built-ins)
- OCR Hebrew's Storage buckets (`uploads` — 21 page images + 2,431 training images)
- No user tables in `public` (every `bhmk_*` and `td_*` table and the `bhmk` schema should be gone)

Verify this first:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'bhmk')
ORDER BY table_schema, table_name;
```

Expected: no rows. (Supabase system tables in `auth`, `storage`, etc. are fine; those are not in `public`.)

## Recovery steps

### 1. Push OCR Hebrew schema

```bash
cd ocr-hebrew/web
# Confirm the schema guard sees 0 rows (DB is empty)
npm run db:push:prod
```

Prisma will create every table from `schema.prisma` with no warnings.

### 2. Verify tables + health

```bash
curl https://ksavyad.com/api/health
# { "status": "ok", "tablesChecked": 5 }
```

Should return 200 OK with all 5 required tables checked.

### 3. Re-register user accounts

The User rows are gone. Have Shmuel + any active users sign up fresh at https://ksavyad.com/login.

For the test account `temimasokol@gmail.com`: sign up again with the original password (it's in Shmuel's notes) so existing session cookies don't cause confusion.

Capture the new user IDs:

```sql
SELECT id, email, "createdAt" FROM "User" ORDER BY "createdAt";
```

### 4. Re-import training data

The local backup at `ocr-hebrew/training/data/labels.json` has 2,185 training examples with their correct text labels. The word-crop images are still in Supabase Storage at `uploads/training/<original-user-id>/<example-id>.jpg`.

The images are already in Storage — we only need to reconstruct the `TrainingExample` rows.

```bash
cd ocr-hebrew/web
npm run db:import-training -- --dry-run                   # preview
npm run db:import-training -- \
  --user-id <NEW_SHMUEL_USER_ID> \
  --create-profile "Recovered (pre-wipe)"
```

The script creates rows pointing at the existing Storage paths.

**Caveat on Storage paths**: the original image paths are `uploads/training/<OLD_USER_ID>/<example-id>.jpg`. After re-registration, users get new IDs. The import script's default path construction assumes the *new* user ID — this will be WRONG for pre-wipe images.

**Fix options:**

A. **Server-side rename** — use the service role key to rename storage folders from old IDs to new IDs. One script, runs once.

B. **Import-time path override** — pass `--storage-user-id <OLD_USER_ID>` to the import script so it writes the old path into `TrainingExample.imagePath`.

C. **Re-upload** — read local `training/data/images/*.jpg` and re-upload under the new user's namespace. Most reliable but slowest.

Pick B for speed. Update the import script to accept `--storage-user-id` and write `imagePath: training/${storageUserId}/${entry.id}.jpg`. The old Storage folders still exist, `/api/training/[id]/image` should still resolve them.

### 5. Test the training review flow

Visit `/training/review` and verify:
- Word crops render (confirms Storage paths resolve)
- Texts show correctly (confirms label import)
- Edit + save a single correction — ensures writes work end-to-end

### 6. Set up nightly backups

Schedule `scripts/db-backup.js` on the Mac Mini via cron:

```bash
crontab -e
```

Add:

```cron
0 3 * * *  cd /Users/shmuelsokol/Desktop/CURSOR\ AI/ocr-hebrew/web && /opt/homebrew/bin/node scripts/db-backup.js >> /tmp/ocr-hebrew-backup.log 2>&1
```

Run once manually to seed the first backup:

```bash
cd ocr-hebrew/web && node scripts/db-backup.js
```

### 7. Close out

- Update `wiki/safety.md` with the final date this recovery was completed
- Update `wiki/decisions.md` to mark the 2026-04-19 wipe as resolved, with what was lost vs recovered
- Push all docs/infra changes to the repo

## What this recovery does NOT restore

- Per-word OCR results + confidence scores from pre-wipe files (those files themselves are still in Storage but had no OCR run metadata)
- Correction history tied to original word IDs
- ApprovedText / project assignments from pre-wipe
- Token usage history

These are gone. The scanned pages still exist and can be re-processed through OCR at any time.

## Once done

OCR Hebrew is:
- Fully isolated in its own Supabase project (originally shared, now exclusive)
- Protected by the `db:push:prod` guard against future pushes over data
- Backed up nightly with 30-day rotation
- Monitored via `/api/health` — Railway will mark the deploy unhealthy if critical tables disappear
- Documented in `wiki/safety.md` so the next operator knows why all this exists
