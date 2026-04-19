# OCR Hebrew (ksavyad.com)

Web app that converts handwritten Hebrew Talmud/Gemara study notes into digital text using Azure Document Intelligence OCR or in-house DocTR + TrOCR pipeline.

## Architecture

- **Framework**: Next.js 14 App Router + TypeScript
- **Database**: Supabase PostgreSQL (via Prisma ORM v5)
- **File Storage**: Supabase Storage (bucket: `uploads`)
- **OCR Engine (Azure)**: Azure Document Intelligence (`prebuilt-read` with `locale=he`) — word-level bounding boxes + Hebrew text + dictionary correction post-processing
- **OCR Engine (In-House)**: DocTR (`db_resnet50`) for word detection + TrOCR for text recognition — fully local, no API costs
- **TrOCR Model**: TrOCR-small fine-tuned on user corrections (local, Python + PyTorch MPS on Mac Mini M4)
- **Inference Server**: FastAPI (`training/serve.py`) exposed via Cloudflare Tunnel (`trocr.ksavyad.com` → `localhost:8765`). Endpoints: `/predict` (TrOCR word recognition), `/predict_batch`, `/detect` (DocTR word detection)
- **Auth**: NextAuth.js with credentials provider (email/password)
- **Hosting**: Railway (Docker, standalone Next.js)
- **Domain**: ksavyad.com (Cloudflare DNS)
- **Repo**: https://github.com/ShmuelSokol/ocr-hebrew

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/ocr.ts` | Core OCR engine — Azure + DocTR methods, line detection, skew detection |
| `src/lib/supabase.ts` | Supabase client for storage (lazy Proxy pattern) |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/auth.ts` | NextAuth config |
| `src/app/editor/[fileId]/page.tsx` | Editor — image overlay with OCR text, word-level corrections |
| `src/app/dashboard/page.tsx` | Dashboard — upload, profiles, files, usage stats, corrections viewer |
| `src/app/training/page.tsx` | Training data management — view, edit, delete, add word examples |
| `src/app/training/monitor/page.tsx` | Live training dashboard — charts, stats, sample predictions |
| `src/app/api/training/route.ts` | Training examples CRUD (GET/POST/PATCH/DELETE) |
| `src/app/api/training/export/route.ts` | Export all training data as JSON+base64 images |
| `src/app/api/training/status/route.ts` | Serve live training status from `status.json` |
| `src/app/api/training/[id]/image/route.ts` | Serve training example word crop images |
| `src/app/api/files/route.ts` | File upload (to Supabase Storage) and listing |
| `src/app/api/files/[fileId]/ocr/route.ts` | Run OCR on a file (Azure or DocTR method, selectable) |
| `src/app/api/files/[fileId]/trocr/route.ts` | Re-run TrOCR inference on existing OCR results |
| `src/app/api/files/[fileId]/image/route.ts` | Serve images from Supabase Storage |
| `src/app/api/words/[wordId]/route.ts` | Word correction — saves to handwriting profile + training example |
| `src/app/admin/page.tsx` | Admin dashboard — user list, online status, activity tracking |
| `src/app/api/admin/route.ts` | Admin API — password auth, user stats |
| `src/app/dictionary/page.tsx` | Talmudic dictionary browser — abbreviations, sages, vocab, bigrams |
| `src/app/api/dictionary/route.ts` | Dictionary API — serves compiled talmudic vocabulary stats |
| `src/app/training/review/page.tsx` | Training data review — inline text editing, bbox nudge, recrop |
| `src/lib/talmudic-dictionary.ts` | Talmudic vocabulary: abbreviations, sage names, vocab, bigrams |
| `src/lib/activity.ts` | User activity tracking (fire-and-forget lastSeenAt/lastAction) |
| `prisma/schema.prisma` | Database schema |
| `Dockerfile` | Multi-stage Docker build for Railway |

## Database Schema (Prisma)

Models: User, HandwritingProfile, File, OCRResult, OCRLine, OCRWord (has `modelText` for TrOCR), TokenUsage, Correction, TrainingExample

- Uses pooled connection on port 6543 (`DATABASE_URL`) and session mode on port 5432 (`DIRECT_URL`)
- Binary targets: `native` + `linux-musl-openssl-3.0.x` (for Alpine Docker)

## How OCR Works

Two methods available, selectable in the editor UI via dropdown:

### Azure OCR (default)
1. Image uploaded to Supabase Storage
2. Azure Document Intelligence `prebuilt-read` called with `locale=he`
3. Azure returns word-level polygons (4-corner bounding boxes) + Hebrew text + confidence
4. Words grouped into lines by matching y-coordinates to Azure's line polygons
5. Words sorted right-to-left (Hebrew RTL) within each line
6. Results stored as OCRResult → OCRLine → OCRWord hierarchy (with confidence scores)
7. Dictionary correction: low-confidence words matched against verified training examples by edit distance
8. TrOCR auto-runs in background (if server available): crops each word, sends to TrOCR server, saves to `modelText`

### In-House DocTR + TrOCR (free, requires local server)
1. Full page image sent to `/detect` endpoint on TrOCR server (DocTR `db_resnet50`)
2. DocTR returns word-level bounding boxes grouped into lines (sorted RTL for Hebrew)
3. Each word cropped and sent to `/predict` endpoint (TrOCR fine-tuned model)
4. Results stored in same OCRResult → OCRLine → OCRWord hierarchy
5. No background TrOCR needed (text recognition already included in pipeline)
6. Benchmarked at 87.4% F1 vs Azure boxes across 6 diverse pages (2215 words)

### Common
- User reviews word crops and corrects text in editor (can toggle Azure/TrOCR text)
- Corrections auto-saved as TrainingExample (word crop image + corrected text) for fine-tuning

## Fine-Tuning Pipeline

Located in `../training/` (sibling to `web/` directory).

| File | Purpose |
|------|---------|
| `setup.sh` | Install Python 3.11, create venv, install PyTorch + deps |
| `download_data.py` | Download training examples from web app API |
| `dedup_data.py` | Remove duplicate images (exact + perceptual hash) from training data |
| `validate_data.py` | Audit data quality (images, labels, duplicates) |
| `train.py` | TrOCR-small fine-tuning (MPS, augmentation, early stopping, checkpoints) |
| `inference.py` | Run inference on single images, directories, or benchmark |
| `serve.py` | FastAPI inference server — TrOCR `/predict` + DocTR `/detect` endpoints |
| `download_bbox_data.py` | Download page images + word boxes for DocTR fine-tuning |
| `train_doctr.py` | Fine-tune DocTR db_resnet50 word detection on corrected boxes |
| `benchmark_boxes.py` | Bounding box detection benchmark (DocTR, CC, PP methods vs Azure) |
| `benchmark_multi.py` | Multi-page benchmark across database pages |

Training writes `output/status.json` which the web dashboard reads for live monitoring.

### Initial setup (from scratch):
```bash
cd ocr-hebrew/training
bash setup.sh            # Installs Python 3.11, creates venv, installs PyTorch + training deps
source venv/bin/activate
# Install serving/inference server deps (not covered by setup.sh):
pip install fastapi uvicorn python-multipart python-doctr[torch] opencv-python-headless
```

### TrOCR training workflow:
```bash
cd ocr-hebrew/training
source venv/bin/activate
python download_data.py --cookie SESSION_COOKIE  # or use direct DB download (see below)
python dedup_data.py --apply    # Remove perceptual duplicates (keeps best-labeled version)
python validate_data.py
python train.py          # Auto-resumes from previous best checkpoint
python train.py --fresh  # Start from base model (ignore previous)
python inference.py --model output/checkpoints/best --image word.jpg
```

### Data quality pipeline:
- **Dedup**: `dedup_data.py` uses 16x16 perceptual hash to find near-identical images (even with slightly different bounding boxes). Keeps the best-labeled copy (prefers corrected > confirmed, proper geresh/gershayim).
- **Full-line filter**: Training data should be word-level crops only. Full-line images (width > 400px or aspect ratio > 6) confuse TrOCR which expects single words. Remove these from the website review page.
- **Conflicting labels**: Same image with different text actively hurts training. The dedup script resolves these by keeping the best-scored version.
- **Data quantity guide**: ~2k examples → 33% CER, ~5k → 20-30% CER, ~10k → 10-20% CER

### DocTR detection fine-tuning workflow:
```bash
cd ocr-hebrew/training
source venv/bin/activate
python download_bbox_data.py   # Downloads page images + word boxes from DB/Supabase
python train_doctr.py          # Fine-tune db_resnet50 (auto-resumes from previous best)
python train_doctr.py --fresh  # Start from pretrained (ignore previous)
```
- Data: `bbox_data/images/` (full page images) + `bbox_data/labels.json` (DocTR format)
- Output: `bbox_output/checkpoints/best/model.pt`
- `serve.py` auto-loads fine-tuned model from `bbox_output/checkpoints/best/` if it exists
- Training uses corrected bounding boxes from editor (originalXLeft/originalYTop tracking)
- Note: DocTR v1.0.1 has a bug in `compute_loss` (`l1_loss` undefined) — `train_doctr.py` monkey-patches it

### Serving the model (TrOCR + DocTR):
```bash
cd ocr-hebrew/training
source venv/bin/activate

# Install serving dependencies (not in requirements.txt):
pip install fastapi uvicorn python-multipart python-doctr[torch] opencv-python-headless

python serve.py          # Starts on port 8765
```
- Endpoints: `GET /health`, `POST /predict` (TrOCR), `POST /predict_batch`, `POST /detect` (DocTR)
- DocTR model (`db_resnet50`) lazy-loads on first `/detect` call
- Cloudflare Tunnel maps `trocr.ksavyad.com` → `localhost:8765`
- Tunnel runs as a brew service (`brew services start cloudflared`)
- Config at `~/.cloudflared/config.yml`, tunnel ID: `e28ffe57-2733-490b-87ac-fb8d6e9641c2`
- Cannot run simultaneously with training (both need GPU/model in memory)
- **Workaround**: Run `serve.py --cpu --model output/checkpoints/best_v1_1128examples` to serve on CPU while training uses MPS GPU. Slower inference but allows data curation during training.

## Deployment

**Pre-deploy checks** — `npx tsc --noEmit` is NOT sufficient. Next.js build runs ESLint with `@typescript-eslint/no-unused-vars` which catches things tsc doesn't. Always run:
```bash
npx next lint   # Catches unused vars, etc. that tsc misses
```

Deploy via Railway CLI:
```bash
railway up --detach
```

After deploying, verify with:
```bash
railway deployment list   # Check latest deploy status (SUCCESS/FAILED)
railway logs --build DEPLOY_ID  # Check build logs if failed
```

Or use the `/deploy` skill which commits, pushes to GitHub, and deploys.

### Environment Variables (Railway)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase pooler connection (port 6543) |
| `DIRECT_URL` | Supabase session mode connection (port 5432) |
| `AZURE_DOC_INTELLIGENCE_ENDPOINT` | Azure Document Intelligence endpoint |
| `AZURE_DOC_INTELLIGENCE_KEY` | Azure Document Intelligence API key |
| `ANTHROPIC_API_KEY` | Claude API (future refinement) |
| `GOOGLE_CLOUD_VISION_API_KEY` | Google Cloud Vision API (legacy, kept as fallback) |
| `NEXTAUTH_SECRET` | Auth session signing |
| `NEXTAUTH_URL` | https://ksavyad.com |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role for storage access |
| `TROCR_SERVER_URL` | TrOCR inference server (`https://trocr.ksavyad.com`) |

### Docker Notes

- Uses `node:20-alpine` — requires `apk add openssl` for Prisma
- Must explicitly COPY `@supabase`, `sharp`, and `prisma` node_modules (standalone doesn't auto-include them)
- Prisma db push runs at container startup using local binary (NOT npx, which pulls v7 and breaks)
- `NEXT_PUBLIC_` vars must be set at build time
- **Critical**: Server-side env vars (`SUPABASE_SERVICE_ROLE_KEY` etc.) get inlined by webpack at build time if accessed with dot notation (`process.env.KEY`). Use bracket notation (`process.env["KEY"]`) in modules to ensure runtime reading. The Supabase client in `src/lib/supabase.ts` uses a lazy Proxy pattern to guarantee env vars are read at request time, not module load time.
- Health check endpoint at `/api/health` — configured on Railway for zero-downtime deploys

## Skills

Available skills in `.claude/skills/`:
- `/deploy` — Full deploy workflow
- `/railway` — Railway management
- `/supabase` — Supabase database management
- `/cloudflare-dns` — DNS management for ksavyad.com

## Wiki

Product strategy, pricing, offline-product spec, model strategy, data-quality notes, roadmap, and decision log live in `wiki/`. Start at `wiki/index.md`. Update proactively when strategy or architecture changes.

## Infrastructure IDs
- Railway project: `9cb5b562-6854-464d-b4b7-fd9ba8b041d4`
- Railway service: `49600374-a47c-4ada-8fc6-095b683c54d4`
- Supabase project: `ushngszdltlctmqlwgot` (region: us-east-1)
- Supabase pooler: `aws-1-us-east-1.pooler.supabase.com` (NOT aws-0)
- Cloudflare zone: `2df4edb4071417959108d83e9be051c5`
- Cloudflare Tunnel: `trocr.ksavyad.com` → `localhost:8765` (tunnel ID: `e28ffe57-2733-490b-87ac-fb8d6e9641c2`)

## Talmudic Dictionary
- Post-processing uses curated vocab + 196 pages of Sefaria Talmud text (2,667 words, 1,915 bigrams)
- Training data: ~2,185 clean examples → ~33% CER; need ~5k for 20-30% CER range

## Development

```bash
npm run dev  # Requires .env.local with all env vars
```

Test user: temimasokol@gmail.com
