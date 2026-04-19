# Deployment

## Web (ksavyad.com)

- **Host**: Railway (Docker, standalone Next.js)
- **Trigger**: push to `main` → Railway auto-deploys
- **DNS**: Cloudflare → Railway edge
- **Health check**: `/api/health`
- **Project / service IDs**: see `web/CLAUDE.md`

### Pre-push checklist

```bash
cd ocr-hebrew/web
npx next lint      # catches unused-vars etc. that tsc misses
npm run build      # must succeed locally before push
git push
```

**Do not** run `railway up`. Railway auto-deploys from GitHub. Using `railway up` pushes an out-of-band build that doesn't match `main`.

### Post-push verification

```bash
railway deployment list
# if FAILED:
railway logs --build <DEPLOY_ID>
```

Common failure modes: missing env var after a `.env.example` change, Prisma binary target mismatch, Alpine missing `openssl`. All documented in `web/CLAUDE.md`.

## Inference server (trocr.ksavyad.com)

Runs on the Mac Mini M4. Cloudflare Tunnel maps `trocr.ksavyad.com → localhost:8765`.

```bash
cd ocr-hebrew/training
source venv/bin/activate
python serve.py       # port 8765
```

Tunnel runs as a brew service (`brew services start cloudflared`). Config: `~/.cloudflared/config.yml`. Tunnel ID: `e28ffe57-2733-490b-87ac-fb8d6e9641c2`.

### Cannot run simultaneously with training

Both need the model in memory. Workaround: run `serve.py --cpu --model <checkpoint>` while `train.py` uses MPS GPU. Slower but unblocks inference during training.

## Offline product (future)

Separate SKU, separate artifact. See [offline product spec](offline-product-spec.md) for the build/ship/retrain cycle. Not yet built.

## What *not* to do

- Don't skip `npm run build` locally. Railway will accept your push and fail deploys silently unless you notice.
- Don't use `process.env.KEY` (dot notation) for server-side env vars. Next.js standalone inlines these at build time. Use `process.env["KEY"]`.
- Don't upgrade Prisma to v7 inside Docker (`npx prisma` will pull it). Pin v5 and use the local binary.
- Don't delete `sharp` or `@img` from the Docker runner stage. `/_next/image` 500s without them.
