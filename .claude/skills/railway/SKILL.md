---
name: railway
description: Manage Railway deployment for ocr-hebrew. Use when deploying, checking logs, managing environment variables, or troubleshooting the Railway service.
allowed-tools: Bash, Read
---

# Railway Deployment Management

## Project Details
- **Project**: ocr-hebrew (ID: 9cb5b562-6854-464d-b4b7-fd9ba8b041d4)
- **Service**: ocr-hebrew-app (ID: 49600374-a47c-4ada-8fc6-095b683c54d4)
- **PostgreSQL**: Postgres-Zk7F (ID: a199cea4-f249-4cf9-bd84-c46001fe7b64) — NOT IN USE, switched to Supabase
- **Environment**: production
- **Railway Domain**: https://ocr-hebrew-app-production.up.railway.app
- **Custom Domain**: https://ksavyad.com

## Railway CLI Commands

### Check status
```bash
railway status
```

### Deploy (from web directory)
```bash
cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web"
railway up --detach
```

### Check build logs
```bash
railway logs --build | tail -40
```

### Check runtime logs
```bash
railway logs | tail -30
```

### Set environment variable
```bash
railway variables set KEY="value"
```

### List environment variables
```bash
railway variables
```

### Add custom domain
```bash
railway domain ksavyad.com
```

## Current Environment Variables
- `ANTHROPIC_API_KEY` — Claude API key for OCR
- `NEXTAUTH_SECRET` — Auth secret
- `NEXTAUTH_URL` — https://ksavyad.com
- `DATABASE_URL` — Supabase PostgreSQL connection string

## Deployment Architecture
- Docker multi-stage build (node:20-alpine)
- Next.js standalone output
- Prisma db push runs at container startup
- Prisma v5 (local binary, NOT npx which pulls v7)
- Files uploaded to `/app/uploads` (needs Railway volume for persistence)

## Dockerfile Location
`/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web/Dockerfile`

## Common Issues
- **Prisma v7 conflict**: npx pulls latest Prisma (v7) which breaks schema. Use `node node_modules/prisma/build/index.js` instead
- **OpenSSL on Alpine**: Must `apk add --no-cache openssl` in base image
- **No public directory**: Must exist or Docker COPY fails
- **Permission errors**: Prisma generate at runtime fails because `nextjs` user can't write to node_modules — this is OK, client is pre-generated during build
