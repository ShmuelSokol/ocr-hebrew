# OCR Hebrew (ksavyad.com)

Web app that converts handwritten Hebrew Talmud/Gemara study notes into digital text using Claude Opus Vision API.

## Architecture

- **Framework**: Next.js 14 App Router + TypeScript
- **Database**: Supabase PostgreSQL (via Prisma ORM v5)
- **File Storage**: Supabase Storage (bucket: `uploads`)
- **OCR Engine**: Claude Opus 4 Vision API (claude-opus-4-20250514) — full-page single-call
- **Auth**: NextAuth.js with credentials provider (email/password)
- **Hosting**: Railway (Docker, standalone Next.js)
- **Domain**: ksavyad.com (Cloudflare DNS)
- **Repo**: https://github.com/ShmuelSokol/ocr-hebrew

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/ocr.ts` | Core OCR engine — line detection, Claude API calls, correction context |
| `src/lib/supabase.ts` | Supabase client for storage |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/auth.ts` | NextAuth config |
| `src/app/editor/[fileId]/page.tsx` | Editor — image overlay with OCR text, word-level corrections |
| `src/app/dashboard/page.tsx` | Dashboard — upload, profiles, files, usage stats, corrections viewer |
| `src/app/api/files/route.ts` | File upload (to Supabase Storage) and listing |
| `src/app/api/files/[fileId]/ocr/route.ts` | Run OCR on a file |
| `src/app/api/files/[fileId]/image/route.ts` | Serve images from Supabase Storage |
| `src/app/api/words/[wordId]/route.ts` | Word correction — saves to handwriting profile |
| `prisma/schema.prisma` | Database schema |
| `Dockerfile` | Multi-stage Docker build for Railway |

## Database Schema (Prisma)

Models: User, HandwritingProfile, File, OCRResult, OCRLine, OCRWord, TokenUsage, Correction

- Uses pooled connection on port 6543 (`DATABASE_URL`) and session mode on port 5432 (`DIRECT_URL`)
- Binary targets: `native` + `linux-musl-openssl-3.0.x` (for Alpine Docker)

## How OCR Works

1. Image uploaded to Supabase Storage
2. Line detection via pixel density analysis (sharp library)
3. Correction context built from handwriting profile (grouped by frequency)
4. Claude Opus Vision called with full image + line positions + corrections + optional first-line hint
5. Results stored as OCRResult → OCRLine → OCRWord hierarchy
6. User corrects words in editor → corrections saved to profile → improves future OCR

### Known Issue: Hallucination

Claude can generate plausible Talmudic text from memory instead of reading actual handwriting. The first-line hint and correction feedback loop help mitigate this.

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
| `ANTHROPIC_API_KEY` | Claude API for OCR |
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
