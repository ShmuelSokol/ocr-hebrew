# ksavyad wiki

Short pages. Updated as things change. If a fact here disagrees with the code, the code wins and this page is stale — fix it.

## Product

- [Product vision](product-vision.md) — what we're building, why, for whom
- [Target customer](target-customer.md) — who actually pays
- [Pricing (internal)](pricing.md) — the reasoning behind the numbers
- [Pricing one-pager](pricing-one-pager.md) — customer-facing sales sheet
- [Offline product spec](offline-product-spec.md) — the thumb drive SKU

## Engineering

- [Safety & data protection](safety.md) — rules after the 2026-04-19 wipe, backups, health-check, runbook
- [Operations runbook](operations.md) — Mac Mini TrOCR + tunnel, Railway, Supabase, common breakages
- [Supabase project migration](migration/README.md) — plan to isolate each app into its own Supabase project (resolved)
- [Tier 2/3/4 roadmap](tier-2-3-4-plan.md) — what's next after Tier 1 commerce
- [Model strategy](model-strategy.md) — pooled base + per-user fine-tune, why
- [Data quality](data-quality.md) — dedup, conflicts, what actually hurts accuracy
- [OCR pipeline](ocr-pipeline.md) — end-to-end, Azure + DocTR + TrOCR
- [Deployment](deployment.md) — how web ships, how offline ships

## Process

- [Roadmap](roadmap.md) — priority order, what's blocked on what
- [Decisions](decisions.md) — rolling log: what we decided and why

---

**Conventions for this wiki**

- Every page ≤ 1 screen if possible. Link out instead of padding.
- Lead with the conclusion. Reasoning goes below.
- Numbers with units (₪0.05/letter, not "low"). Dates absolute (2026-04-19, not "last week").
- When in doubt, delete. Stale docs are worse than missing docs.
