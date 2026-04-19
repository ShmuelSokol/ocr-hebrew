# Roadmap

Ordered by what unblocks what. A line lower on the page depends on lines above it.

## Now (before first sale)

### 1. Clean up training data pipeline
- [ ] Add full-line filter to `dedup_data.py` (width > 400 or aspect > 6:1)
- [ ] Add `(text, phash)` conflict detection to `validate_data.py` → writes `needs_human_review.json`
- [ ] UI on `/training/review` to resolve flagged conflicts inline
- [ ] Block `train.py` if conflicts unresolved (unless `--force`)

Rationale: [data quality](data-quality.md). Do this before any retraining investment.

### 2. Baseline accuracy measurement
- [ ] Run full pipeline (dedup → validate → train) and measure CER
- [ ] Per-writer CER breakdown (not just pooled) — need this to know where we'd land on a per-user model
- [ ] Benchmark on 50 held-out pages we haven't touched

### 3. Run one end-to-end paid pilot
- [ ] Find one scholar willing to pay $500 for a Starter-tier setup
- [ ] Do it manually: collect pages, train, ship a temporary web-only version (not offline)
- [ ] Measure: engineer hours to reach 85%, 92%, 95%. Cost basis for future quotes.
- [ ] Measure: how many pages/week they actually process. Informs credit pricing.

## Next (after pilot validates)

### 4. Per-user fine-tune automation
- [ ] `train.py` flag to bias toward one `HandwritingProfile`'s corrections
- [ ] Automated per-writer retraining that forks pooled base and overfits on user data
- [ ] Model storage scheme: one checkpoint per writer + latest pooled base

### 5. Offline product MVP
- [ ] Export TrOCR + DocTR to ONNX, verify accuracy parity
- [ ] Tauri shell with stripped editor UI
- [ ] SQLite + local filesystem swap
- [ ] Installer for Mac (skip Windows/Linux until we have demand)
- [ ] Ship to pilot customer as their Archival-tier delivery

### 6. Credit system
- [ ] Server-side code generator (HMAC-signed)
- [ ] Client-side verifier baked into offline app
- [ ] Phone support runbook — which numbers, who handles calls, how codes are issued

## Later (after 3+ customers)

- [ ] Windows/Linux offline builds
- [ ] Machine fingerprint license locking (only if piracy observed)
- [ ] Formatted export upsell (Word/PDF with RTL)
- [ ] TrOCR-base evaluation for Archival customers hitting the small-model ceiling
- [ ] Institutional sales motion (yeshivas, archives) — different buyer, different pitch

## Deferred indefinitely

- Mobile app
- Real-time / live OCR
- Multi-user drive (one drive per customer for v1)
- Training-on-client-device (stays on our infra)
- Non-Hebrew languages

## Blocking questions

1. **Is 95% actually achievable on one writer?** Unknown until pilot. If the ceiling is 88%, the offline product pitch changes fundamentally.
2. **What's the realistic monthly page volume per customer?** Determines whether credits are a revenue line or a trial mechanic.
3. **Who takes phone top-up calls?** Affects support cost and therefore minimum viable price.

Answer these in the pilot (step 3) before promising anything to subsequent customers.
