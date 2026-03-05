---
name: cloudflare-dns
description: Manage Cloudflare DNS records for ksavyad.com. Use when needing to add/update/delete DNS records, check domain status, manage SSL, or configure Cloudflare settings.
allowed-tools: Bash, Read
---

# Cloudflare DNS Management for ksavyad.com

## Zone Details
- **Domain**: ksavyad.com
- **Zone ID**: 2df4edb4071417959108d83e9be051c5
- **Status**: Active

## API Token
Use header: `Authorization: Bearer ibvFbRxU8-_is71X7VU6mBPW4qH8GpxsRMo89aJ-`

## Common API Calls

### List DNS records
```bash
curl -s -H "Authorization: Bearer ibvFbRxU8-_is71X7VU6mBPW4qH8GpxsRMo89aJ-" \
  "https://api.cloudflare.com/client/v4/zones/2df4edb4071417959108d83e9be051c5/dns_records" | jq '.result[] | {id, type, name, content, proxied}'
```

### Add DNS record
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/2df4edb4071417959108d83e9be051c5/dns_records" \
  -H "Authorization: Bearer ibvFbRxU8-_is71X7VU6mBPW4qH8GpxsRMo89aJ-" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"@","content":"target.example.com","ttl":1,"proxied":false}'
```

### Update DNS record
```bash
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/2df4edb4071417959108d83e9be051c5/dns_records/{record_id}" \
  -H "Authorization: Bearer ibvFbRxU8-_is71X7VU6mBPW4qH8GpxsRMo89aJ-" \
  -H "Content-Type: application/json" \
  --data '{"content":"new-target.example.com","proxied":false}'
```

### Delete DNS record
```bash
curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/2df4edb4071417959108d83e9be051c5/dns_records/{record_id}" \
  -H "Authorization: Bearer ibvFbRxU8-_is71X7VU6mBPW4qH8GpxsRMo89aJ-"
```

### Check zone status
```bash
curl -s -H "Authorization: Bearer ibvFbRxU8-_is71X7VU6mBPW4qH8GpxsRMo89aJ-" \
  "https://api.cloudflare.com/client/v4/zones/2df4edb4071417959108d83e9be051c5" | jq '{status: .result.status, name_servers: .result.name_servers}'
```

## Current DNS Records
- **CNAME** `@` → `ljttf1a4.up.railway.app` (DNS-only, not proxied)
- **TXT** `_railway-verify` → Railway domain verification
- **CNAME** `www` → `ljttf1a4.up.railway.app` (DNS-only, not proxied)

## Important Notes
- Railway custom domains need **DNS-only mode** (proxied: false) so Railway can handle SSL
- If using Cloudflare proxy (proxied: true), set SSL mode to "Full (strict)" in Cloudflare dashboard
