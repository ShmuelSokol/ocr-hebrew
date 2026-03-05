---
name: supabase
description: Manage Supabase project for ocr-hebrew. Use when needing to check database status, manage tables, get connection strings, or interact with Supabase API. Triggers on mentions of supabase, database management, db status, connection string.
allowed-tools: Bash, Read, Write, Edit
---

# Supabase Management

## Project Details
- **Project ID**: ushngszdltlctmqlwgot
- **Project Ref**: ushngszdltlctmqlwgot
- **Region**: us-east-1
- **Organization ID**: dkymffxtykmlmurzuzqm
- **Database Host**: db.ushngszdltlctmqlwgot.supabase.co
- **Database Password**: testpass123abc
- **Pooler Connection (DATABASE_URL)**: `postgresql://postgres.ushngszdltlctmqlwgot:testpass123abc@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
- **Direct Connection (DIRECT_URL)**: `postgresql://postgres:testpass123abc@db.ushngszdltlctmqlwgot.supabase.co:5432/postgres`

## Access Token
Use header: `Authorization: Bearer sbp_f5f8c89c1dfac1e67b7d83e6493056d39f0520e9`

## Common API Calls

### Check project status
```bash
curl -s -H "Authorization: Bearer sbp_f5f8c89c1dfac1e67b7d83e6493056d39f0520e9" \
  "https://api.supabase.com/v1/projects/ushngszdltlctmqlwgot"
```

### List all projects
```bash
curl -s -H "Authorization: Bearer sbp_f5f8c89c1dfac1e67b7d83e6493056d39f0520e9" \
  "https://api.supabase.com/v1/projects"
```

### Get API keys
```bash
curl -s -H "Authorization: Bearer sbp_f5f8c89c1dfac1e67b7d83e6493056d39f0520e9" \
  "https://api.supabase.com/v1/projects/ushngszdltlctmqlwgot/api-keys"
```

### Run SQL query
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/ushngszdltlctmqlwgot/database/query" \
  -H "Authorization: Bearer sbp_f5f8c89c1dfac1e67b7d83e6493056d39f0520e9" \
  -H "Content-Type: application/json" \
  --data '{"query": "SELECT * FROM information_schema.tables WHERE table_schema = '\''public'\''"}'
```

### Push Prisma schema to Supabase
```bash
cd "/Users/shmuelsokol/Desktop/CURSOR AI/ocr-hebrew/web"
DATABASE_URL="postgresql://postgres.ushngszdltlctmqlwgot:testpass123abc@aws-1-us-east-1.pooler.supabase.com:5432/postgres" npx prisma db push
```

## Other Supabase Projects
- **Master DB** (cekdsvqpvoybxjzyszos) - General purpose
- **KolBramah** (cjmocbcptgcohjxuuwdp) - KolBramah project
