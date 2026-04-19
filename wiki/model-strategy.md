# Model strategy

## Summary

**One pooled base model + per-user fine-tune.** Not a fresh model per user. Not one shared model forever.

## Why pooled base

The pretrained TrOCR checkpoint saw zero Hebrew in training. Our job is to teach it the script. A single user's 500 corrections cannot teach a model what Hebrew is — they can only refine a model that already knows Hebrew.

Pooling everyone's corrections:
- Amortizes the "teach it Hebrew" cost across all customers
- Gives every new user a model that works on day one at some baseline (~60–70% accuracy)
- Lets the base improve monotonically as more customers are onboarded

## Why per-user fine-tune on top

Handwriting is personal. One writer's ל is another writer's ן. Two quirks matter:

1. **Letter shapes** — a pooled model averages over everyone's shapes. A per-user model learns *this* person's shapes.
2. **Vocabulary** — a yeshiva student writes different words than a family historian. Biasing the model toward the user's actual vocabulary reduces error on ambiguous strokes.

Per-user fine-tuning is what gets us from ~70% to ≥95%. Pooled alone tops out somewhere below that, probably around 85% once we have ~10k total examples.

## Staging

1. **Day zero for a new user**: use pooled base directly. Accuracy ~65–75% depending on how close their hand is to what we've seen.
2. **After ~500 corrections from that user**: fork pooled model, fine-tune on their corrections only for 1–3 epochs. Expect 80–85%.
3. **After ~2,000 corrections**: retrain from pooled base with heavier weighting on user data. Expect 90–92%.
4. **After ~5k–10k corrections**: dedicated model for the user, lightly regularized toward pooled base. Expect ≥95%.

## Tradeoffs

- **Storage per user**: a fine-tuned TrOCR-small checkpoint is ~240 MB fp32 / ~60 MB quantized. At 1000 customers that's 60–240 GB of models we retain. Manageable, but plan for it.
- **Cross-user regression**: if pooled base improves, all user models should ideally re-fork from the new base. Automate this — for every new pooled release, reprocess each user's corrections against the new base in the background. Never ship a user a model worse than their last.
- **Cold start vs privacy**: to bootstrap a new user's model with pooled data, we use corrections from other users. These are word crops + labels, not full pages — still, disclose this in the privacy policy. If a customer objects, we can offer a "clean base" (off-the-shelf TrOCR with no Hebrew training) at a steep accuracy cost.

## When to fork a user onto their *own* base

Signal that per-user specialization is not enough:
- After 2k+ corrections, accuracy plateau at <88% (three consecutive retraining cycles)
- Correction patterns show the writer uses a script substantively different from our pooled corpus (Rashi, Sephardi, Yiddish-inflected)

In that case: treat that writer's data as its own pool. Fine-tune from *base* TrOCR, not from our Hebrew-pooled model. Slower to bootstrap, better ceiling.

## When to move to a larger base model

Current: TrOCR-small. Ceiling estimated at ~92–95% for per-user models, likely hitting it at ~5–10k corrections.

Switch to **TrOCR-base** if:
- A paying Archival customer has delivered 5k+ corrections and we can't get past 90%
- Inference speed on target hardware is still <5 min/page after quantization (room in the budget)

TrOCR-base is ~3× bigger (~780 MB fp32) and 2–3× slower. Only worth it when small tops out.

## What we do NOT do

- **Federated learning across users without their consent.** We pool corrections with disclosure; we don't run training on the customer's machine against their will.
- **Train in the browser/client.** Training stays on our infrastructure. Customers correct; we train; we ship checkpoints.
- **Model cards per writer.** We don't publish or share individual-writer models. Each model is for one customer.
