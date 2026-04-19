# Supabase project separation plan

## Why we're doing this

On 2026-04-19 we discovered that OCR Hebrew's entire production Postgres schema (`User`, `File`, `Project`, `HandwritingProfile`, `TrainingExample` — every table) had been silently dropped. Railway logs showed `P2021 table does not exist` on every API endpoint. Images and local training data survived; all relational metadata was gone.

**Root cause**: three apps (OCR Hebrew, 3rdBHMK, 3D Images) share one Supabase project: `ushngszdltlctmqlwgot`. Prisma's `db push` deletes any table not in the current `schema.prisma`. When any of the three apps runs it, the other two are at risk.

When we tried to recreate OCR Hebrew's schema to recover, Prisma warned it would drop 149,397 bounding-box rows, 388 pages, and the 3D Images user table — and refused. That refusal is the only reason 3rdBHMK and 3D Images data is still intact.

## The plan — one Supabase project per app

| App | Current project | Action |
|---|---|---|
| OCR Hebrew | `ushngszdltlctmqlwgot` (shared) | Keep this project. Postgres is already empty. |
| 3rdBHMK | `ushngszdltlctmqlwgot` (shared) | **Move** to its own new Supabase project. |
| 3D Images | `ushngszdltlctmqlwgot` (shared) | **Move** to its own new Supabase project. |

OCR Hebrew stays put because its Storage (2,450 image files including training crops) is already in this project's `uploads` bucket and moving it would risk losing the training data. Its Postgres is empty, so we recreate the schema once the other apps are out.

## Order of operations

1. **Now**: `ushngszdltlctmqlwgot` is read-only for OCR Hebrew (can't push schema without dropping 3rdBHMK/3D Images tables).
2. **Each of 3rdBHMK and 3D Images** executes the brief in this folder:
   - Creates a new Supabase project
   - Migrates their Postgres + Storage to it
   - Updates Railway env vars
   - Verifies their app works
   - Reports back: "migration complete, my tables are no longer in `ushngszdltlctmqlwgot`"
3. **Then**: OCR Hebrew pushes its schema back to `ushngszdltlctmqlwgot`, reimports training data, re-registers users.
4. **Permanent**: each app keeps `scripts/db-push-guarded.js` pattern so a stray push can't drop data.

## Briefings

- [3rdBHMK migration brief](3rdbhmk-brief.md)
- [3D Images migration brief](3d-images-brief.md)
- [OCR Hebrew recovery brief](ocr-hebrew-recovery-brief.md) — for the OCR Hebrew Claude session after the other two confirm done

Send the respective brief to the Claude session working on each project.

## Communication back to OCR Hebrew

Each app reports back via Shmuel with a single message:

> Migration complete for <3rdBHMK|3D Images>.
> - New Supabase project ref: `<xxxxxxxx>`
> - All my tables removed from `ushngszdltlctmqlwgot` (verified)
> - Railway env vars updated
> - App still works end-to-end
> - Backups configured

Once both confirm, OCR Hebrew proceeds with recovery.
