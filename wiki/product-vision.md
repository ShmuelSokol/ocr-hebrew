# Product vision

## What

Convert handwritten Hebrew notes (Talmud study notes, family records, archival documents) into clean digital text, with the transcription labor shifted from a human typist (~₪40/page) to an AI model the user reviews in ~5% of the time.

## Two SKUs

1. **ksavyad.com (web)** — cloud app, OCR via Azure or our DocTR+TrOCR pipeline. Primary use today: collect training data, demonstrate the pipeline, onboard paying customers.
2. **Offline appliance (thumb drive)** — the actual commercial product. Fully offline, per-user model trained to ≥95% accuracy, shipped on a USB stick. See [offline product spec](offline-product-spec.md).

## Why this exists

- Hebrew handwriting OCR is **underserved**. Azure's `prebuilt-read` with `locale=he` handles print fairly well and cursive poorly. Google Vision is similar. No off-the-shelf model hits the accuracy a scholar needs.
- Scholars already pay ~₪40/page to human typists. That market exists, has known price points, and customers are **already educated** on per-letter/per-page billing.
- The customer profile (yeshivas, archivists, sofrim) is **privacy-sensitive**. "Your rabbi's notes never touch the internet" is a real sales line, not a throwaway feature.

## What this is *not*

- Not a general Hebrew OCR API. We are not competing with Azure on the printed-text case.
- Not a consumer product. Not trying to do receipt scanning, forms, or multi-language.
- Not a real-time service. Batch + review is the workflow; we don't need <1s latency.

## How we win

Three compounding edges:

1. **Per-writer fine-tuning**. A model trained on *one* person's handwriting beats a general model by a wide margin. No cloud OCR does this.
2. **Correction loop baked into the UI**. Every correction is training data. The system gets better while the user works.
3. **Trust via offline delivery**. Religious/scholarly buyers pay a premium for "no internet required."

## How we lose

- Accuracy plateau. If per-writer fine-tuning stalls at 85% instead of climbing to 95%, the product is worse than hiring a typist. This is the **real risk**, not packaging.
- Data quality. Conflicting/noisy training labels have already wasted one training run. See [data quality](data-quality.md).
- Hardware costs. If inference on a customer's 8-year-old laptop takes 10 minutes per page, the product feels broken. Need to measure this.

## Current state (2026-04-19)

- Web app live at ksavyad.com
- ~2,185 clean training examples, pooled across writers → ~33% CER
- TrOCR-small fine-tuned, DocTR fine-tuned for word detection
- No paying customers yet. No offline product yet.
