---
name: deploy
description: Full deployment workflow for ocr-hebrew to ksavyad.com. Commits code, pushes to GitHub, deploys to Railway, and verifies the site is live.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit
---

# Deploy OCR Hebrew to Production

## Pre-deploy Checklist
- Current state: !`cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web" && git status --short`
- Current branch: !`cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web" && git branch --show-current`

## Deployment Steps

### 1. Commit changes
```bash
cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web"
git add -A
git commit -m "Deploy: $ARGUMENTS"
```

### 2. Push to GitHub
```bash
cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web"
git push origin main
```

### 3. Deploy to Railway
```bash
cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web"
railway up --detach
```

### 4. Monitor build
Wait ~2 minutes then check:
```bash
railway logs --build | tail -30
```

### 5. Verify runtime
```bash
railway logs | tail -20
```

### 6. Check site is live
```bash
curl -sI https://ocr-hebrew-app-production.up.railway.app | head -5
curl -sI -k https://ksavyad.com | head -5
```

## GitHub Repo
- **URL**: https://github.com/ShmuelSokol/ocr-hebrew
- **Remote**: origin

## Key URLs
- Railway app: https://ocr-hebrew-app-production.up.railway.app
- Custom domain: https://ksavyad.com
- Railway dashboard: https://railway.com/project/9cb5b562-6854-464d-b4b7-fd9ba8b041d4
