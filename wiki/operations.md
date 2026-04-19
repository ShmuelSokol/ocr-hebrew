# Operations runbook

Living doc for the homelab side of ksavyad. Edit whenever something changes.

## Mac Mini services

Two long-running processes on the Mac Mini M4 keep OCR alive:

| Process | Port | Purpose |
|---|---|---|
| `python serve.py` | 8765 | TrOCR + DocTR inference server (FastAPI) |
| `cloudflared tunnel run e28ffe57-...` | — | Exposes localhost:8765 as `trocr.ksavyad.com` |

If either is down, the app shows **Cloudflare error 1033** or **tunnel error 530** on any "Detect words" / Re-OCR action.

### Start both

```bash
cd ocr-hebrew/training
./start-services.sh
```

This kills any previous instances, launches both processes via `nohup`, and waits for the model to load before checking the external tunnel. Logs go to `/tmp/trocr.log` and `/tmp/cloudflared.log`.

### Check status

```bash
# Local TrOCR
curl -s http://localhost:8765/health | jq
# Should return: {"status":"ok","model_loaded":true,"device":"mps","doctr_loaded":...}

# Via tunnel
curl -s https://trocr.ksavyad.com/health | jq
# Should return the same thing. If HTTP 530 or 1033 — tunnel is down.
```

### Stop both

```bash
pkill -f 'python serve.py'
pkill -f 'cloudflared tunnel'
```

### Known issue — brew's cloudflared service is broken

The `homebrew.mxcl.cloudflared` plist at `~/Library/LaunchAgents/homebrew.mxcl.cloudflared.plist` has `ProgramArguments = ["cloudflared"]` only — no `tunnel run <id>`. When launchd starts it, `cloudflared` prints usage and exits; launchd restarts it in a loop, filling `/opt/homebrew/var/log/cloudflared.log` with "Use `cloudflared tunnel run`" lines and never serving the tunnel.

`brew services start cloudflared` therefore does NOT actually bring the tunnel up. Always use `start-services.sh` instead. Long-term fix: `sudo cloudflared service install` to create a proper LaunchDaemon, or patch the brew plist to include tunnel args.

## Railway (ksavyad.com web app)

Deploys on every push to `main` (GitHub trigger reconnected 2026-04-19).

- Project: `9cb5b562-6854-464d-b4b7-fd9ba8b041d4`
- Service: `49600374-a47c-4ada-8fc6-095b683c54d4`
- Domain: `ksavyad.com` (primary), `ocr-hebrew-app-production.up.railway.app` (direct)
- Health check: `/api/health` → expects `{"status":"ok","tablesChecked":5}`. Returns 503 if any critical table is missing.

### Useful commands

```bash
cd ocr-hebrew/web
railway status            # Project + service info
railway deployment list   # Recent deploys (SUCCESS / FAILED / BUILDING)
railway logs --deployment # Live tail of the running deploy
railway variables --kv    # Env vars (careful — secrets)
```

### Env vars that must exist

See `web/CLAUDE.md` for the authoritative list. The commerce additions (2026-04-19) add:

- `STRIPE_SECRET_KEY` — Stripe secret key. When unset, checkout returns 503.
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret. Needed for `/api/stripe/webhook`.

Without these, Buy buttons on `/settings/billing` show "Contact us to purchase." The rest of the app runs fine.

## Supabase (Postgres + Storage)

- Project: `ushngszdltlctmqlwgot` (exclusive to OCR Hebrew post-migration)
- Pooler host: `aws-1-us-east-1.pooler.supabase.com` (NOT aws-0)
- Storage buckets: `uploads` (OCR Hebrew — has the 2,431 preserved training images)

### Daily backups

Cron at 03:00 on the Mac Mini: `0 3 * * * ocr-hebrew/web/scripts/cron-db-backup.sh`. Writes JSON to `ocr-hebrew/web/backups/db-YYYY-MM-DD.json`, 30-day rotation. Log: `/tmp/ocr-hebrew-backup.log`.

### Manual backup anytime

```bash
cd ocr-hebrew/web
npm run db:backup
```

## Common things that break

| Symptom | Probably | Fix |
|---|---|---|
| "DocTR detection failed: Cloudflare Tunnel error" | Tunnel down or TrOCR process crashed | `training/start-services.sh` |
| `/api/health` returns 503 schema-missing | Something dropped tables | Check `wiki/safety.md` before doing anything. Do NOT run `prisma db push` blindly. |
| Railway deploy stuck in BUILDING | Docker build has errors | `railway logs --deployment` |
| Training images don't render in `/training/review` | Storage path mismatch | Check the TrainingExample's `storagePath` vs actual files in `uploads/training/` |

## Contact / ownership

All three services (Mac Mini, Railway, Supabase, Cloudflare) are run by Shmuel Sokol. If processes die overnight, there's no on-call — the Mac Mini just needs someone to run `start-services.sh` on it in the morning.
