# Offline product spec

## Goal

Ship a USB thumb drive that contains everything needed to run Hebrew handwriting OCR for one user's specific writer(s), with no internet connectivity required at any point after first boot.

## User story

1. Customer receives drive. Plugs into Mac/Windows/Linux laptop.
2. Double-click the app. It runs from the drive (or installs to disk on first run).
3. Customer scans a page, drops image file into app, clicks OCR. Word boxes appear, each with the model's best guess.
4. Customer clicks any wrong word, types correction, hits enter. Saved locally.
5. When they want to top up credits, they call our number and enter the code we give them.
6. When they want retraining, they click "Export for retraining" — produces a signed zip on the drive. They mail the drive back. We retrain. We mail it back with new model.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri** (Rust + webview) | 10MB installer vs Electron's 100MB; already have a React/Next.js UI to port |
| UI | Existing editor + dashboard pages | `src/app/editor/` and `dashboard/` — strip auth, keep the word-box correction UI |
| DB | **SQLite** via Prisma SQLite adapter | Drop-in for Postgres; Prisma supports both datasources |
| Storage | Local filesystem | Replace Supabase Storage calls with `./data/images/` writes |
| Inference | **ONNX Runtime** (CPU) | ~50MB vs PyTorch's ~2GB; cross-platform; fast enough on CPU |
| Models | TrOCR-small + DocTR db_resnet50, int8 quantized | ~150MB total |
| Credit token | HMAC-signed 12-char codes | Verifiable offline against baked-in public key |
| Export format | Zip of `training_examples.json` + word-crop PNGs | Mirror existing `/api/training/export` output |
| Package | Tauri bundler → `.dmg` (Mac), `.msi` (Windows), AppImage (Linux) | One codebase, three installers |

## Model size budget

| Artifact | Size | Notes |
|---|---|---|
| TrOCR-small fp32 | ~240 MB | |
| TrOCR-small fp16 | ~120 MB | Probably fine for inference |
| TrOCR-small int8 quantized | ~60 MB | Slight accuracy hit; measure before shipping |
| DocTR db_resnet50 fp32 | ~100 MB | |
| App binaries + JS bundles | ~50 MB | Tauri is small |
| **Total per drive** | **~250–500 MB** | Fits any USB stick; a $5 stick is fine |

## Performance budget (CPU inference)

TrOCR-small on a modern Intel/M-series CPU:
- Single word: ~0.3–1s
- Page of 100 words: **30–100s**
- An 8-year-old laptop: probably 2–3× slower → up to 5 min/page

5 min/page is the floor we can tolerate. Below that the product feels broken. **Measure on target hardware before shipping.**

## What must be built

| Component | Effort | Status |
|---|---|---|
| Port TrOCR + DocTR PyTorch → ONNX | 1–2 days | not started |
| Tauri shell wrapping stripped editor UI | 3–5 days | not started |
| Prisma Postgres → SQLite swap | 1 day | not started |
| Local inference worker (Rust `ort` or Python sidecar) | 2–3 days | not started |
| Export/import flows (zip on drive) | 1 day | existing `/api/training/export` logic reusable |
| Credit-code signing service (server-side) | 1 day | new — small Node script |
| Credit-code verification (client) | 1 day | HMAC verify with baked public key |
| Installer builds (Mac/Win/Linux) | 1–2 days | Tauri handles most of this |
| Phone-top-up runbook for support | 0.5 day | just a phone script + code generator |

**Rough total: 2 weeks to prototype, 4 weeks to polish.**

## Biggest risks (ordered)

1. **Accuracy.** Hitting 95% on one writer before shipping. Packaging is easy; the model work is hard.
2. **ONNX export for TrOCR.** Encoder-decoder exports are finicky. May need HuggingFace `optimum` library. Solvable, but could cost a week if it fights us.
3. **Inference speed on older hardware.** 5 min/page is tolerable; 20 min/page is not. Test on a 2018 MacBook Air or equivalent before committing to CPU.
4. **Credit-code leakage.** If codes are too short, bruteforce is possible. Use enough HMAC bits (64+). Include issue-date so stolen codes can be revoked.
5. **Customer support volume.** Phone top-ups, broken drives, "I forgot my code." Budget ~30 min/week/customer in support time.

## What we explicitly defer

- Multi-user accounts on one drive (everyone gets their own drive)
- Real-time/streaming OCR (batch only)
- Mobile app (desktop only for v1)
- Cloud sync option (buyers specifically want *no* cloud — keep it that way)
