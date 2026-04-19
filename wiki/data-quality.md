# Data quality

## Why this page exists

The single biggest regression in earlier training runs was **conflicting labels** — the same or near-identical word crop showing up with two different text labels, pulling the model in two directions. Not overfitting, not model architecture, not hyperparameters. Just dirty labels.

## Current state (2026-04-19)

- **Total examples**: ~2,185 clean after dedup (down from ~2.5k)
- **Pipeline**: `download_data.py` → `dedup_data.py` → `validate_data.py` → `train.py`
- **Latest CER**: ~33%

## What `dedup_data.py` already handles

Perceptual hash (16×16 pixel phash) groups near-identical images. When two examples hash-match but have different labels, the script picks one to keep via score:

```
+100 if text ≠ "?"
+10  if source = "corrected"
+5   if source = "confirmed"
+2   if text contains ׳ or ״
```

Higher score wins. Everything else is deleted.

This catches the common case: same image cropped slightly differently, where one label is better than the other.

## Known gaps

### Gap 1 — Near-duplicates that escape phash

If the bounding box shifted by >5 pixels, the two crops may phash to different hashes and *both* survive with conflicting labels. Model trains on both → confusion.

**Fix**: in `validate_data.py`, for every pair of examples with identical text, flag them if their phash Hamming distance is < N (tune N). Conversely, for every pair with distance < N but different text, flag for manual review.

### Gap 2 — Label typos slip past dedup

Two *identical* images labeled `למד` and `לםד` both survive dedup if both are marked "corrected." The scoring function tie-breaks arbitrarily.

**Fix**: When examples phash-match and both are "corrected" but labels disagree, do not auto-pick. Add to a `needs_human_review.json` file. Block training on the affected IDs until resolved.

### Gap 3 — Full-line crops leaking into word data

Training data should be word-level crops only. Full-line images (width > 400 px or aspect ratio > 6) confuse TrOCR, which expects single words. This is called out in `web/CLAUDE.md` but not enforced anywhere in the pipeline.

**Fix**: In `dedup_data.py` or `validate_data.py`, auto-reject any image with:
- width > 400 px, OR
- aspect ratio > 6:1

Log rejected count. Show on `/training/review` page so the user can confirm the crop was bad vs. a valid very-long word.

### Gap 4 — Single-correction examples treated as ground truth

Right now a single user correction becomes a training label. If the user mis-typed, we train on garbage.

**Fix (proposed)**: require ≥2 corrections that agree before marking an example as training-eligible. Or show the word crop again for re-confirmation after N days. Tradeoff: slower data accumulation.

## Concrete TODO for next training run

- [ ] Add full-line filter to `dedup_data.py` (width/aspect cutoffs)
- [ ] Add `(text, phash)` collision detection to `validate_data.py` → writes `needs_human_review.json`
- [ ] Add UI on `/training/review` to resolve flagged conflicts inline
- [ ] Block `train.py` from running if `needs_human_review.json` has unresolved entries (unless `--force`)
- [ ] Re-run full pipeline, measure CER delta

Expected impact: not huge on raw CER (2,185 is small), but should unlock steeper gains as volume grows.

## What we do *not* need to fix yet

- Heavy augmentation on the training side
- Synthetic data generation
- Curriculum learning / hard-example mining

These are premature until label quality is clean. Garbage labels + clever training = clever garbage.

## Operational rule

**Do not ship a model to a customer without running dedup + validate + review on the delta since the last training run.** Automate this as a single `make retrain` target so it's not optional.
