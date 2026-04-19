# Safety & data protection

Written 2026-04-19 after a full production-database wipe of OCR Hebrew (every table in the `public` schema of the shared Supabase project `ushngszdltlctmqlwgot` was missing). All app rows were lost. Raw images and the local training-data backup were the only things that saved us.

This page exists so that doesn't happen again.

## Rules

### 1. Never share a Supabase project across apps

The root cause of the wipe: `ushngszdltlctmqlwgot` hosts tables for **three apps simultaneously** — OCR Hebrew (unprefixed `User`, `File`, …), 3rdBHMK (`bhmk_*` + `bhmk` schema), and 3D Images (`td_*`). When any of the other apps' owners runs `prisma db push` or a migration, our unprefixed tables are at risk of being dropped as "extra schema."

**Every app gets its own Supabase project.** No exceptions. It costs nothing on the free tier.

### 2. Never auto-run `prisma db push` in production

The Docker CMD previously ran `prisma db push --skip-generate && node server.js` on every container boot. That runs a destructive-by-default command in production silently on every deploy. It's now removed.

Schema changes in prod are applied manually via `npm run db:push:prod`, which is guarded (see below).

### 3. Never point `.env.local` at production DATABASE_URL

A local `prisma db push` against `.env.local`'s DATABASE_URL will hit prod. If the local `schema.prisma` is stale or diverges from what prod needs, data can silently disappear. Local dev gets a separate Supabase project (free tier).

### 4. Always check `/api/health` after a deploy

Health check now verifies that `User`, `Project`, `HandwritingProfile`, `File`, `TrainingExample` tables exist. Returns 503 with `status: "schema-missing"` if any are gone. Railway will mark the deploy unhealthy and alert.

### 5. Backups are daily, rotated 30 days

`scripts/db-backup.js` dumps every table to JSON. Run nightly via cron on the Mac Mini:

```cron
0 3 * * *  cd /path/to/ocr-hebrew/web && npm run db:backup
```

Backups live at `web/backups/db-YYYY-MM-DD.json`. 30 most recent are kept; older pruned automatically.

## Tools

| Tool | What it does |
|---|---|
| `npm run db:push:prod` | Guarded schema push. Refuses if any user-table has rows unless `CONFIRM_SCHEMA_CHANGE=yes` is set. |
| `npm run db:backup` | Dumps every OCR Hebrew table to timestamped JSON in `./backups/`. |
| `npm run db:import-training` | Reconstructs TrainingExample rows from `training/data/labels.json`. Used for disaster recovery. |
| `/api/health` | Returns 503 if any required table is missing. Railway consumes this. |

## Recovery runbook (what we did on 2026-04-19)

1. **Identified**: Railway logs showing `P2021 table does not exist` on every endpoint.
2. **Confirmed**: local `prisma` query showed zero OCR Hebrew tables in `public`.
3. **Checked PITR**: Supabase plan evaluation (user-driven).
4. **Recreated schema**: `CONFIRM_SCHEMA_CHANGE=yes npm run db:push:prod` against the empty DB.
5. **Re-imported training data**: `npm run db:import-training -- --user-id <uid> --create-profile "Recovered"`.
6. **Re-registered user accounts**: temimasokol@gmail.com and any others, fresh signups.
7. **Deployed**: pushed safety changes, verified `/api/health` returned 200.

## What we did NOT get back

- File → profile relations for pre-wipe uploads
- Per-word OCR results and confidence scores
- Correction history (which original word was corrected to what)
- ApprovedText rows / project assignments
- Token usage logs

The training-example *text* labels survived (local backup). The word-crop images survived (Supabase Storage preserved). The relational metadata did not.

## If this happens again

1. **Do not run `prisma db push`** until we understand why the tables are gone.
2. Check if Supabase PITR is available on this project.
3. Restore from the most recent nightly backup (`backups/db-YYYY-MM-DD.json`) — there's a companion restore script to be written (TODO).
4. File an incident note under `wiki/incidents/` with date, cause, data lost, time to recover.

## Still-open hardening

- [ ] Move OCR Hebrew to its own Supabase project
- [ ] Restore script that reads `backups/*.json` and repopulates rows
- [ ] Weekly integrity check: compare row counts in DB vs latest backup, alert on >10% delta
- [ ] Prisma migrations instead of `db push` (requires baselining existing schema)
