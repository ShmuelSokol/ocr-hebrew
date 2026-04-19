# Decisions

Rolling log of decisions that shape the product. Each entry: what we chose, the date, why, and what would make us reverse it.

Newest at the top.

---

## 2026-04-19 — Pool training data across users, fine-tune per user on top

**Decided**: one shared pooled base model trained on all users' corrections; per-user fine-tune forks on top for customers who need >85% accuracy.

**Alternatives considered**:
- Separate model per user from scratch — rejected, too data-starved per user
- One shared model forever — rejected, can't hit 95% on individual writers

**Why**: TrOCR base has no Hebrew. Pooling amortizes the cost of teaching it Hebrew across all customers. Per-user fine-tune captures personal quirks that account for the last 10–15% of accuracy.

**Would reverse if**: a single writer's corrections consistently regress pooled-base performance (cross-contamination). In that case, fork them onto their own base rather than the shared pool.

See: [model-strategy.md](model-strategy.md)

---

## 2026-04-19 — Offline thumb-drive product as commercial SKU

**Decided**: the paid product is an offline appliance (thumb drive + desktop app), not a hosted SaaS.

**Alternatives considered**:
- Hosted SaaS — rejected, target customers distrust cloud for sensitive texts
- Hybrid (self-host server + cloud training) — rejected, too much install complexity for target buyer

**Why**: target customers (scholars, archivists, yeshivas) have a strong privacy preference and already pay for offline services (manual typists). "Your writings never leave your office" is a real sales lever.

**Would reverse if**: after 5+ paying customers, >80% indicate they'd prefer hosted. No signal of this yet.

See: [offline-product-spec.md](offline-product-spec.md)

---

## 2026-04-19 — Price per letter, not per word or per page

**Decided**: ₪0.05 per letter for usage credits.

**Alternatives considered**:
- Per word — simpler, but breaks from market convention
- Per page — even simpler, but hides cost variance
- Per minute of app use — rejected, users hate vague billing

**Why**: the existing manual typist market already bills per letter. Customers understand this unit. Switching units invites suspicion. Per-letter also naturally scales cost with OCR effort (long abbreviations cost more).

**Would reverse if**: customers complain that per-letter accounting feels opaque. Low probability given current market norms.

See: [pricing.md](pricing.md)

---

## 2026-04-19 — Setup fee is tiered flat, not hourly

**Decided**: three fixed tiers ($500 / $1,500 / $4,000+) anchored on target accuracy.

**Alternatives considered**:
- Hourly — rejected, customers can't budget, and we're penalized for getting faster
- Purely usage-based (no setup fee) — rejected, upfront model curation is real labor

**Why**: target buyers want predictable total cost and commit via a deposit upfront. Tiers let us discriminate on value (85% hobbyist vs 95% archival).

**Would reverse if**: setup takes 5× longer than estimated and tiers are systematically unprofitable. Monitor on first pilot.

---

## 2026-04-19 — Offline credit top-up via phone call + signed code

**Decided**: customer calls support number, pays by phone, receives a 12-char HMAC-signed code they type into the offline app.

**Alternatives considered**:
- Online activation — rejected, breaks the "fully offline" promise
- Hardware dongle — rejected, too much shipped hardware and failure modes for v1
- Prepay large bundles, ship all credits on drive — rejected, no top-up path without drive roundtrip

**Why**: preserves offline guarantee while allowing incremental revenue. Phone call also catches support needs (broken drives, lost codes) that would otherwise go to email.

**Would reverse if**: call volume overwhelms our support capacity. Could add a signed-by-email option as a fallback that still avoids "internet at the user's machine."

---

## 2026-04-19 — Trust-the-market license enforcement (no DRM) for v1

**Decided**: no copy protection beyond keeping the model file as one unsigned asset. Trust buyers not to pirate.

**Alternatives considered**:
- Machine fingerprint lock — rejected for v1, adds friction
- Hardware dongle — rejected, doubles ship complexity

**Why**: target market is religious/scholarly and unusually honest. Chasing pirates in a ~2,000-customer niche likely costs more than the lost revenue.

**Would reverse if**: we observe actual cloning (same model file on multiple machine IDs reporting in during retraining). Upgrade path is machine fingerprint lock first, dongle only if fingerprint is beaten.

---

## 2026-03-xx — Use Tauri (not Electron) for offline app shell

**Decided**: Tauri for the desktop wrapper.

**Why**: ~10MB installer vs Electron's ~100MB. Target customers often on older hardware with limited disk. Tauri reuses our existing React/Next.js UI code.

**Would reverse if**: Tauri's webview on old Windows versions doesn't render our UI correctly. Test before committing.
