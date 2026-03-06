# OCR Hebrew (ksavyad.com)

Web app that converts handwritten Hebrew Talmud/Gemara study notes into digital text using Azure Document Intelligence OCR.

## Architecture

- **Framework**: Next.js 14 App Router + TypeScript
- **Database**: Supabase PostgreSQL (via Prisma ORM v5)
- **File Storage**: Supabase Storage (bucket: `uploads`)
- **OCR Engine**: Azure Document Intelligence (`prebuilt-read` with `locale=he`) — word-level bounding boxes + Hebrew text
- **Fine-Tuning**: TrOCR-small (local, Python + PyTorch MPS on Mac Mini M4)
- **Auth**: NextAuth.js with credentials provider (email/password)
- **Hosting**: Railway (Docker, standalone Next.js)
- **Domain**: ksavyad.com (Cloudflare DNS)
- **Repo**: https://github.com/ShmuelSokol/ocr-hebrew

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/ocr.ts` | Core OCR engine — Azure Document Intelligence, line detection, skew detection |
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
| `src/app/api/files/[fileId]/ocr/route.ts` | Run OCR on a file |
| `src/app/api/files/[fileId]/image/route.ts` | Serve images from Supabase Storage |
| `src/app/api/words/[wordId]/route.ts` | Word correction — saves to handwriting profile + training example |
| `prisma/schema.prisma` | Database schema |
| `Dockerfile` | Multi-stage Docker build for Railway |

## Database Schema (Prisma)

Models: User, HandwritingProfile, File, OCRResult, OCRLine, OCRWord, TokenUsage, Correction, TrainingExample

- Uses pooled connection on port 6543 (`DATABASE_URL`) and session mode on port 5432 (`DIRECT_URL`)
- Binary targets: `native` + `linux-musl-openssl-3.0.x` (for Alpine Docker)

## How OCR Works

1. Image uploaded to Supabase Storage
2. Azure Document Intelligence `prebuilt-read` called with `locale=he`
3. Azure returns word-level polygons (4-corner bounding boxes) + Hebrew text + confidence
4. Words grouped into lines by matching y-coordinates to Azure's line polygons
5. Words sorted right-to-left (Hebrew RTL) within each line
6. Results stored as OCRResult → OCRLine → OCRWord hierarchy (with confidence scores)
7. User reviews word crops and corrects text in editor
8. Corrections auto-saved as TrainingExample (word crop image + corrected text) for fine-tuning

## Fine-Tuning Pipeline

Located in `../training/` (sibling to `web/` directory).

| File | Purpose |
|------|---------|
| `setup.sh` | Install Python 3.11, create venv, install PyTorch + deps |
| `download_data.py` | Download training examples from web app API |
| `validate_data.py` | Audit data quality (images, labels, duplicates) |
| `train.py` | TrOCR-small fine-tuning (MPS, augmentation, early stopping, checkpoints) |
| `inference.py` | Run inference on single images, directories, or benchmark |

Training writes `output/status.json` which the web dashboard reads for live monitoring.

### Training workflow:
```bash
cd ocr-hebrew/training
source venv/bin/activate
python download_data.py --cookie SESSION_COOKIE
python validate_data.py
python train.py
python inference.py --model output/checkpoints/best --image word.jpg
```

## Deployment

Deploy via Railway CLI:
```bash
railway up --detach
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

## Development

```bash
npm run dev  # Requires .env.local with all env vars
```

Test user: temimasokol@gmail.com
