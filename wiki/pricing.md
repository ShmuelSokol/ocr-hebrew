# Pricing (internal)

## Summary

- **Setup fee**: tiered flat ($500 / $1,500 / $4,000+), not hourly.
- **Usage**: prepaid credits, denominated in **letters** (not words, not pages).
- **Rate**: ₪0.05/letter (~half the manual typist rate of ~₪0.10/letter).
- **Free credits on purchase**: 20,000 letters (~50 pages, meaningful trial).
- **Retraining**: ₪300–500 per cycle, volume discount for bundles.
- **Top-up**: phone call → signed offline code → credits added.

## Why per letter

The customer already pays per letter for manual transcription. Switching units invites suspicion ("are they hiding something?"). Per-letter also has the right shape:

- Short common words (אם, לא, של) cost little → feels fair
- Long abbreviations with gershayim cost more → matches real OCR effort
- Lets us price-discriminate later (premium accuracy tier at higher rate)

## Setup fee tiers

Hourly billing is the wrong shape: customers can't budget, and we're penalized for getting faster. Instead, tiered packages anchored on target accuracy:

| Tier | Target accuracy | What's delivered | Price anchor |
|---|---|---|---|
| **Starter** | 85% | Pooled base model + ~500 user corrections, 1 retraining pass | **$500** |
| **Professional** | 92% | + ~2,000 corrections, 2 retraining cycles | **$1,500** |
| **Archival** | 95% | + 5–10k corrections, unlimited retraining × 6 mo | **from $4,000** |

"From" pricing on Archival because writer variance is high. Don't quote Archival firmly until after a paid Starter pilot on that writer.

## Usage rate

| Service | ₪/letter | ₪/page (400 letters) | vs manual |
|---|---|---|---|
| Manual typist (market) | 0.10 | 40 | baseline |
| ksavyad (aggressive) | 0.04 | 16 | –60% |
| **ksavyad (default)** | **0.05** | **20** | **–50%** |
| ksavyad (premium tier) | 0.06 | 24 | –40% |

Half the price of manual, with privacy and speed as the upsell.

## Free credits

**20,000 letters (~50 pages)** on every new setup. Meaningful enough that the customer gets real value before their first top-up; small enough that it doesn't eat a month of revenue. Lands at ~₪1,000 of gifted value on every $500 Starter — generous but sane.

## Retraining fee

Each retraining cycle = ~1–2 hours of engineer time (load new corrections, run `train.py`, validate, burn drive, ship back).

- **₪300–500 per cycle** covers labor + margin
- **3-pack for ₪750** encourages frequent small cycles over hoarding corrections
- Archival tier bundles unlimited cycles for 6 months — creates lock-in

## Top-up mechanics (offline-safe)

Because users have no internet:

1. User calls our support number
2. Pays by phone (card, bank transfer, or cash-at-local-handler)
3. Gets a **12-character signed code** (read out or SMS'd)
4. Types code into app → app verifies HMAC signature against baked-in public key → credits added

Code payload: `user_id | credits_amount | issue_date | HMAC(secret, above)`.
Can't forge without our signing key. Verifiable offline.

Prefer human-answered phones over IVR for this market. They want a person.

## Piracy / license enforcement

Three options, simplest first:

1. **Trust the market** — religious/scholarly buyers are unusually honest. Ship this. Revisit only if abuse is observed.
2. **Machine fingerprint lock** — on first run app binds to one machine's hardware ID. User calls to unlock if they reinstall. Moderate friction.
3. **Hardware dongle** — model decrypts only with dongle plugged in. Strongest, but doubles the shipped hardware and the failure modes.

**Default: #1.** Re-evaluate if we see cloning.

## Optional upsells

- **Formatted export**: plain text free, Word/PDF with RTL + footnotes +₪0.01/letter, searchable PDF +₪0.02/letter
- **Priority retraining** (48h turnaround vs 2-week normal): +50% on cycle fee
- **Second machine license**: 30% of original setup fee
- **On-site setup visit** (for institutions): flat ₪3,000 + travel

## What to pin down before first sale

1. Actual cost of one **paid pilot** to hit 95% on a new writer — run it end to end, measure engineer hours.
2. Page volume per month for a realistic user — determines whether credits are a significant revenue line or just a trial mechanic.
3. Willingness-to-pay check with 3 real prospects at these prices. Willingness-to-pay is not willingness-to-estimate; get actual commitments.
