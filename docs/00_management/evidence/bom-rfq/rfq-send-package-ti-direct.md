# RFQ Send Package — TI Direct Account Setup + Quote Request

> **Reference:** IOT-5495 (original), IOT-5614 (execution)
> **Prepared:** 2026-06-02 by ProcurementOps
> **Updated:** 2026-06-02 by SupplyChainOps — corrected APAC contact, added market pricing, CEO-ready email draft
> **Status:** Blocked on IOT-5568 (company credentials) — CEO can send email RFQ to tiasia@ti.com as immediate action

## TI Direct Account Registration

### Portal: https://www.ti.com/myti/

**Correct myTI company account creation URL:** https://www.ti.com/myti/docs/createCompanyAccount (requires myTI personal account login first — redirects to OAuth2)

**Registration is a TWO-STEP process:**

**Step 1 — myTI Personal Account:**
- Requires: company-domain email (e.g., name@kinexus.vn)
- Registration at: https://www.ti.com/login/ (click "Create account")

**Step 2 — myTI Company Account:**
- Requires: company name, website, company description
- After approval: checkout profile needs tax ID, bank account, shipping/billing address

**Required information for full business account:**
| Field | Value | Status |
|-------|-------|--------|
| Company Legal Name | KINEXUS Technologies | 🟡 Need exact legal name from business registration |
| Business Type | Engineering / Manufacturing | 🟢 Known |
| Country | Vietnam | 🟢 Known |
| Tax ID / MST | [Pending from IOT-5568] | 🔴 Blocked |
| Business Registration # | [Pending from IOT-5568] | 🔴 Blocked |
| Company Email Domain | @kinexus.vn (or official domain) | 🔴 Need confirmation |
| Company Website | [Pending] | 🔴 Need confirmation |
| Contact Name | [CEO to fill] | 🔴 Need input |
| Phone | [CEO to fill] | 🔴 Need input |
| Bank Name + Account # | [CEO/Finance to provide] | 🔴 For invoicing/checkout |

**Registration process (estimated):**
1. Register myTI personal account with @kinexus.vn email
2. Visit myTI → "Create company account"
3. Fill company profile, tax ID, business registration
4. TI may request business registration scan / tax certificate for verification
5. Account activated within 1-5 business days

**Blocker:** Company business registration + tax ID + corporate email domain not yet digitized/accessible in repo. Tracked by IOT-5568 (CTO triage).

---

## RFQ Email — CEO-Ready Draft (Send to tiasia@ti.com)

**To:** tiasia@ti.com
**From:** CEO corporate email (@kinexus.vn or official domain)
**Subject:** RFQ: ADS131M08 + DAC8554 Volume Pricing — KINEXUS Technologies, Vietnam

```
Dear TI APAC Sales Team,

KINEXUS Technologies is an engineering company in Vietnam developing an
industrial DDC (Direct Digital Control) controller for commercial building
HVAC/BMS applications in Southeast Asia.

We are requesting volume pricing for the following TI components:

1. ADS131M08IPBSR — 8-ch, 24-bit Delta-Sigma ADC
   Package: TSSOP-32
   Quantity tiers: 100 / 500 / 1,000 / 5,000 units annually
   Target unit price: ≤ $5.50/unit @ qty 500+

2. DAC8554IPWR — 4-ch, 16-bit, Low-Power, Voltage Output DAC
   Package: TSSOP-16
   Quantity tiers: 100 / 500 / 1,000 / 5,000 units annually
   Target unit price: ≤ $4.00/unit @ qty 500+

Please provide for each part at each quantity tier:
- Unit pricing (FOB or EXW, USD)
- Current lead time (weeks) and MOQ
- Estimated lead time for recurring orders
- Quote validity period and payment terms
- Any available stock or upcoming PCN/EOL/obsolescence notices

Additionally, we are interested in setting up a TI myTI business account
for KINEXUS Technologies. Please advise on the registration process for
Vietnamese companies, including required documents (tax ID, business
registration certificate, etc.).

Company: KINEXUS Technologies — Vietnamese engineering company, industrial
IoT and building automation. Product launch target Q4 2026.

If a direct sales contact for Vietnam is more appropriate, please redirect
this inquiry. NDA available if required.

Best regards,
[CEO — KINEXUS Technologies]
[CEO to fill: full name, title, phone number, corporate email]
```

---

## TI Vietnam / SEA Regional Contacts (Verified 2026-06-02)

| Contact Point | Details | Status |
|---------------|---------|--------|
| **TI APAC Sales Email** | **tiasia@ti.com** (confirmed — not asia@ti.com) | ✅ Verified |
| **TI International Phone** | +86-21-23073444 (Shanghai APAC hub) | ✅ Verified |
| **TI China Toll-Free** | 800-820-8682 | ✅ Verified |
| **TI Vietnam-specific** | No dedicated Vietnam toll-free or office found | 🔴 Not listed |
| **TI Distributors covering Vietnam** | Arrow Electronics, Mouser, DigiKey, Avnet | 🟢 Known |

**Vietnam Note:** Vietnam is not listed with a dedicated toll-free number in TI's APAC contact directory. Vietnamese companies should route through:
1. tiasia@ti.com (primary — APAC sales desk)
2. TI authorized distributors (Arrow/Mouser/DigiKey/Avnet) for catalog purchases
3. TI China/HK team may cover Vietnam (Shanghai APAC hub: +86-21-23073444)

---

## Fallback Path: Distributor Quote (if TI direct = blocked)

If TI direct account cannot be established before procurement deadline:

### Current Market Pricing (Verified 2026-06-02)

| Source | Part | Product Status | Notes |
|--------|------|:-------------:|-------|
| TI.com | ADS131M08IPBSR | **ACTIVE** | Pricing hidden behind myTI login |
| TI.com | DAC8554IPWR | **ACTIVE** | Pricing hidden behind myTI login |
| Mouser.com | Both | — | Bot protection — manual check needed |
| DigiKey.com | Both | — | Bot protection — manual check needed |
| hqchip.com (China) | ADS131M08IPBSR | In stock | ¥44.56 (q1), ¥32.96 (q10), ¥28.25 (q100), ¥23.54 (q1000) RMB |

**Note:** hqchip.com pricing is China domestic market (likely includes VAT). Converted at ~7.27 CNY/USD:
- ADS131M08: ~$6.12 (q1), ~$4.53 (q10), ~$3.88 (q100), ~$3.23 (q1000)

These are BELOW BOM target of $5.50 at volume — but need to verify if these are legitimate TI-authorized channel or grey market.

### Fresh DigiKey Catalog Pricing (Web Search Verified, 2026-06-02)

**ADS131M08IPBSR (32-TQFP):**

| Qty | Unit Price (USD) |
|-----|:----------------:|
| 1   | $10.77           |
| 10  | $8.39            |
| 25  | $7.79            |
| 100 | $7.14            |
| 250 | $6.83            |
| 500 | $6.64            |
| 1000| ~$6.49 (est.)    |

- Stock: Low / OOS on some regional sites
- Lead time: 12 weeks
- Lifecycle: Active

**DAC8554IPWR (TSSOP-16):**

| Qty | Unit Price (USD) |
|-----|:----------------:|
| 1   | $14.21           |
| 10  | $11.21           |
| 25  | $10.47           |
| 100 | $9.64            |
| 250 | $9.25            |
| 500 | $9.02            |
| 1000| $8.82            |
| 2000| $8.11            |

- Stock: **45 units** (critically low)
- Lead time: ~6 weeks
- Lifecycle: Active

### BOM Target Gap Analysis

| Part | BOM Target Q500 | Catalog Q500 | Gap | TI Direct Discount Needed |
|------|:---------------:|:------------:|:---:|:-------------------------:|
| ADS131M08 | $5.50 | $6.64 | +21% | ~17% below catalog — **achievable** |
| DAC8554 | $4.00 | $9.02 | +125% | ~56% below catalog — **unlikely** |

### Price Trend vs 2025 Research

| Part | 2025 Q500 | Jun 2026 Q500 | Trend |
|------|:---------:|:-------------:|-------|
| ADS131M08 | ~$8.50 | $6.64 | ↓ ~22% favorable |
| DAC8554 | ~$6.00 | $9.02 | ↑ ~50% unfavorable (supply constraint?) |

⚠ **DAC8554 alert:** At $9.02 catalog Q500 (only 45 units in stock), even maximum TI direct discount (50%) yields ~$4.51 — still above the $4.00 BOM target. **CEO/CTO should review: (a) adjust BOM cost model for DAC8554, or (b) evaluate DAC8552 × 2 fallback.** ADS131M08 at $5.50 is achievable via TI direct.

### Distributor Reference Pricing (from PM-MARKET-001 research, 2025 data — STALE)

| Distributor | Part | Qty 1 | Qty 100 | Qty 500 | Qty 1000 |
|-------------|------|:-----:|:-------:|:-------:|:--------:|
| Mouser | ADS131M08 | ~$11.20 | ~$9.60 | ~$8.60 | ~$7.60 |
| Mouser | DAC8554 | ~$8.70 | ~$7.10 | ~$6.10 | ~$5.60 |
| DigiKey | ADS131M08 | ~$11.00 | ~$9.50 | ~$8.50 | ~$7.50 |
| DigiKey | DAC8554 | ~$8.50 | ~$7.00 | ~$6.00 | ~$5.50 |

⚠ Distributor pricing at qty 1000 is 30-50% above BOM target. **TI direct is the only path to meet ≤$5.50 / ≤$4.00 targets.**

### Recommended Parallel Action

While waiting for TI direct response (tiasia@ti.com), submit RFQ to Mouser and DigiKey for competitive quotes:
- Mouser: https://www.mouser.com/ — use "Request Quote" for volume pricing
- DigiKey: https://www.digikey.com/ — use "Request Quote" for volume pricing

---

## Evidence Capture Checklist (IOT-5614)

- [ ] TI myTI personal account registered — screenshot (Blocked: needs @kinexus.vn email confirmation)
- [ ] TI myTI company account created — screenshot (Blocked: needs tax ID + business reg from IOT-5568)
- [ ] **PRIMARY:** RFQ email sent to tiasia@ti.com from CEO corporate email — screenshot Sent folder
- [ ] FALLBACK: Mouser RFQ submitted — screenshot confirmation / reference #
- [ ] FALLBACK: DigiKey RFQ submitted — screenshot confirmation / reference #
- [ ] TI response received + quote saved
- [ ] Quote captured with all fields: date, source, quote reference, unit price per tier, lead time, MOQ, validity, currency, payment terms
- [ ] If blocked: blocker documented with exact cause + unblock owner/action in IOT-5614

---

## Timeline (Updated 2026-06-02)

| Step | Target | Owner | Status |
|------|--------|-------|--------|
| 1. Confirm company credentials (business reg + tax ID) | T+0 | CEO/Admin via IOT-5568 | 🔴 Blocked |
| 2. Confirm corporate email domain (@kinexus.vn) | T+0 | CEO | 🔴 Needed |
| 3. **CEO sends RFQ email to tiasia@ti.com** | **T+0** | **CEO** | 🟡 Ready — draft above |
| 4. Register TI myTI personal account | T+1 | CEO/Admin | 🔴 Depends on #2 |
| 5. Register TI myTI company account | T+2 | CEO/Admin | 🔴 Depends on #1, #4 |
| 6. Submit RFQ via myTI portal (if account ready) | T+3 | SupplyChainOps | 🔴 Depends on #5 |
| 7. Submit fallback RFQ to Mouser/DigiKey | T+3 | SupplyChainOps | 🟡 Parallel path |
| 8. Follow up if no TI response in 5 business days | T+7 | SupplyChainOps | ⏳ Pending |
| 9. Capture quote to IOT-5614 | Upon receipt | SupplyChainOps | ⏳ Pending |
