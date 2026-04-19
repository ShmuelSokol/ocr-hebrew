# OCR pipeline

End-to-end walkthrough of what happens when a user uploads a page.

## Two engines, same output schema

The editor lets the user pick either engine per file. Both produce the same `OCRResult → OCRLine → OCRWord` hierarchy, so the editor UI and training export work uniformly.

## Engine 1: Azure Document Intelligence (default, cloud)

```
page image
  ↓ POST to Azure prebuilt-read (locale=he)
Azure response (polygons + text + confidence)
  ↓ group words into lines (match word polygons to line polygons by y-overlap)
  ↓ sort RTL within each line
OCRLine[] with OCRWord[]
  ↓ dictionary post-processing (low-confidence words matched to verified training labels by edit distance)
persisted to Postgres
  ↓ (background, async, if TrOCR server reachable)
    for each word: crop image → POST to /predict → save to OCRWord.modelText
```

**When to use**: default for new users and for any page that doesn't need in-house model training. Zero setup, no local server required.

**Costs**: Azure charges per page. Track `TokenUsage`.

## Engine 2: In-house DocTR + TrOCR (free, requires local server)

```
page image
  ↓ POST to trocr.ksavyad.com/detect (DocTR db_resnet50)
word-level bounding boxes, grouped into lines, sorted RTL
  ↓ for each word: crop → POST to /predict (TrOCR fine-tuned)
text + confidence
  ↓ same OCRLine/OCRWord schema as Azure
persisted to Postgres
```

**When to use**: our own training/correction loop. No per-page cost.

**Benchmark (as of last run)**: DocTR word detection F1 = 87.4% vs Azure boxes across 6 diverse pages / 2,215 words. Good but not parity.

## Shared downstream

Regardless of engine:

1. Editor renders word crops in reading order, user scans/corrects.
2. Each correction writes:
   - `OCRWord.correctedText` on the word
   - A new `TrainingExample` row with the word crop image in Supabase Storage
   - An update to the user's `HandwritingProfile` for dictionary post-processing
3. Training examples flow into the next fine-tuning run.

## Auxiliary: detection / deskew / enhance

Before OCR:

- **Auto-enhance** — EXIF rotation, contrast normalization, sharpening (all `sharp`, in-process)
- **Deskew** — `detectSkew` JS implementation (was OpenCV on the server; moved to client-side for simplicity)
- **Progress UI** — "Straightening & enhancing image..." shown to user before OCR starts

## Storage model

- **Full-page images**: Supabase Storage bucket `uploads`, keyed by `fileId`
- **Word crops**: Supabase Storage bucket `uploads` under `training/` prefix, keyed by `TrainingExample.id`
- **OCR results**: Postgres, hierarchical (`OCRResult → OCRLine → OCRWord`)

Offline product replaces Supabase Storage with local filesystem and Postgres with SQLite. The logical model doesn't change.

## Key files

| File | Responsibility |
|---|---|
| `src/lib/ocr.ts` | Azure + DocTR entry points, line grouping, RTL sort, skew detection |
| `src/app/api/files/[fileId]/ocr/route.ts` | Orchestrates OCR run, chooses engine, persists |
| `src/app/api/files/[fileId]/trocr/route.ts` | Re-runs TrOCR inference on existing word crops |
| `training/serve.py` | FastAPI: `/detect` (DocTR), `/predict` (TrOCR), `/predict_batch`, `/health` |
| `src/app/editor/[fileId]/page.tsx` | The correction UI |

See `web/CLAUDE.md` for full file map.
