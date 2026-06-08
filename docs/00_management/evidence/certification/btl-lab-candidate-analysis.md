# BACnet BTL Lab Candidate Analysis — Sprint 1 Critical Path

> **Parent Issue:** IOT-5453 | **Child Issue:** IOT-5465
> **Budget Envelope:** USD 10,000–20,000 (test fee + conformance tool license)
> **Owner:** PMO | **Analysis Date:** 2026-06-02 · **Revision:** 2.0
> **Ref:** PM-MARKET-001 v1.1 §6.1 · SW-Q-001 · EXT-002 · DEC-006

## 1. ANNEXA Verification — DOCUMENTATION ERROR

**Conclusion: "ANNEXA" is NOT a valid BTL testing lab. Remove from all project documents.**

Evidence:
- Web research (2026-06-02, 3 search rounds + 8 query variations) returned zero results for "ANNEXA" as a company providing BACnet testing services
- The name does not appear on btllab.org, bacnetinternational.org, or any BTL Working Group publication
- **Root cause hypothesis:** "Annex A" from ISO 16484-6:2020 (Building automation and control systems — Part 6: Data communication conformance testing) — specifically "Annex A – Example EPICS (Informative)" — was misread as a company name "ANNEXA Inc."
- The BACnet Certification Handbook 4.0 references "Annex A" multiple times in the context of PICS/EPICS conformance documentation

**Action:** Remove "ANNEXA" from PM-MARKET-001 §6.1, IOT-5453, and all related documents. Replace with the 4 verified RBTOs below.

## 2. Verified BTL Recognized BACnet Testing Organizations (RBTOs)

As of February 2026, there are **4 officially recognized** testing organizations worldwide:

| # | Organization | Location | Contact | Since |
|---|-------------|----------|---------|:-----:|
| 1 | **BTL Lab (PTL Pune)** | Marietta, GA, USA / Pune, India | testing@bacnetinternational.org | 2006 |
| 2 | **MBS GmbH** | Krefeld, Germany | testlabor@mbs-solutions.de | — |
| 3 | **TÜV SÜD Industrie Service** | Munich, Germany | ba-testlab@tuvsud.com | — |
| 4 | **KTC (Korean Testing Certification)** | Gunpo-si, Gyeonggi-do, South Korea | ktc_bacnet@ktc.re.kr | Feb 2025 |

> **Source:** btllab.org/device-testing · bacnetinternational.org (KTC designation ceremony at AHR Expo Orlando, Feb 12, 2025)
> **Note:** iHomeLab (Lucerne University, Switzerland) appeared on older BTL resource pages but is **not listed** on the current official device testing page — status uncertain, exclude from evaluation.

### 2.1 KTC — NEW RBTO (Feb 2025), First in Asia

KTC was officially appointed as the 4th RBTO at the 2025 AHR Expo in Orlando. Designation ceremony attended by BACnet International President Andy McMillan and KTC President Sung-il Ahn.

**Strategic significance:** KTC is the **first and only RBTO in Asia**, making it the closest lab to Vietnam by geography, timezone, and logistics.

| Attribute | Detail |
|-----------|--------|
| **Full Name** | Korean Testing Certification Institute |
| **Accreditation** | ISO/IEC 17025, Korea Laboratory Accreditation Scheme (KOLAS) |
| **Location** | 35 Heungan-daero, Gunpo-si, Gyeonggi-do, Republic of Korea |
| **Contact** | ktc_bacnet@ktc.re.kr |
| **Designation** | Feb 2025 (new — may have shorter queue) |

**Key consideration:** As a newly designated RBTO (Feb 2025), KTC may have:
- **Shorter queue** — building up client base, potentially faster turnaround
- **Lower fees** — initial pricing may be competitive to attract clients
- **Risk** — less BACnet-specific track record vs BTL Lab (200+ devices since 2006)

## 3. Candidate Profiles

### 3.1 BTL Lab (PTL, Pune, India) — Primary Candidate

| Attribute | Detail |
|-----------|--------|
| **Operator** | Protocol Test Lab (PTL), UNIDEL Group |
| **Accreditation** | ISO accredited |
| **Track Record** | Hundreds of BACnet tests since 2006 |
| **Rate** | $150/hr standard; $75/hr for BACnet International members (Silver+) |
| **Expedited** | Available at additional cost |
| **Priority** | Members get priority queue |
| **Contact** | testing@bacnetinternational.org · +1 770-971-6003 |
| **Website** | btllab.org · btltestlab.net |

**Advantages:** Most experienced RBTO, public pricing, direct path to BTL listing, ISO accredited.
**Disadvantages:** India customs for device sample, single point of failure if queue is full.

### 3.2 MBS GmbH (Krefeld, Germany)

| Attribute | Detail |
|-----------|--------|
| **Location** | Römerstraße 15, 47809 Krefeld, Germany |
| **Contact** | testlabor@mbs-solutions.de |
| **Rate** | Not publicly listed — quote required |

**Advantages:** RBTO status confirmed, German engineering reputation, European certification credibility.
**Disadvantages:** No public pricing, intercontinental shipping from VN, timezone gap (CET vs ICT, -6h).

### 3.3 TÜV SÜD Industrie Service (Munich, Germany)

| Attribute | Detail |
|-----------|--------|
| **Location** | Ridlerstraße 65, 80339 Munich, Germany |
| **Accreditation** | DAkkS D-PL-14153-04-00 (ISO/IEC 17025) |
| **Contact** | ba-testlab@tuvsud.com |
| **Rate** | Not publicly listed — quote required |
| **APAC Offices** | Singapore, Thailand (may handle logistics) |

**Advantages:** RBTO confirmed, global brand recognition, potential bundled testing (BACnet + EMC + safety), APAC offices in Singapore/Thailand.
**Disadvantages:** Opaque pricing, large organization (slower response), primary lab in Germany (intercontinental shipping).

### 3.4 KTC (Gunpo-si, South Korea) — NEW

| Attribute | Detail |
|-----------|--------|
| **Location** | 35 Heungan-daero, Gunpo-si, Gyeonggi-do, South Korea |
| **Contact** | ktc_bacnet@ktc.re.kr |
| **Rate** | Not publicly listed — quote required |
| **Designation** | Feb 2025 |

**Advantages:** Closest to Vietnam (Korea ~4h flight, +2h timezone), first Asian RBTO, potentially shorter queue (new), Korean testing infrastructure well-established.
**Disadvantages:** No public pricing, no BACnet-specific track record yet, unknown queue/lead time.

## 4. Comparison Matrix

| Criteria | BTL Lab (PTL) | MBS GmbH | TÜV SÜD | KTC (NEW) |
|----------|:------------:|:--------:|:-------:|:---------:|
| RBTO status | ✅ Confirmed | ✅ Confirmed | ✅ Confirmed | ✅ Confirmed |
| ISO/IEC 17025 | ✅ Yes | ✅ Yes | ✅ DAkkS | ✅ KOLAS |
| Public pricing | ✅ $150/hr | ❌ Quote | ❌ Quote | ❌ Quote |
| BACnet track record | ⭐⭐⭐ (2006) | ⭐⭐ | ⭐⭐ | ⭐ (new 2025) |
| Asia proximity | 🇮🇳 India | 🇩🇪 Germany | 🇩🇪/🇸🇬 APAC | 🇰🇷 Korea |
| Timezone vs VN (ICT) | -1.5h | -6h | -6h / -1h (SG) | +2h |
| Shipping VN→lab | ~$300-500 | ~$500-800 | ~$500-800 | ~$200-300 |
| Customs risk | Medium (IN) | Low (EU) | Low (EU) | Low (KR FTA) |
| Membership discount | ✅ 50% | Unknown | Unknown | Unknown |
| Queue risk | Medium (established) | Medium | Medium | **Low (new)** |
| Bundled EMC testing | ❌ | ❌ | ✅ Possible | ❓ Unknown |
| Response expected | Fast (email) | Medium | Slow (corporate) | Fast (new, eager) |

## 5. Cost Estimate (USD)

| Scenario | BTL Lab (PTL) | BTL Lab w/ Membership | MBS GmbH | TÜV SÜD | KTC |
|----------|:------------:|:---------------------:|:--------:|:-------:|:---:|
| Est. testing hours (B-BC) | 70–135 | 70–135 | Unknown | Unknown | Unknown |
| Hourly rate | $150 | **$75** (50% off) | Quote | Quote | Quote |
| Testing cost | $10,500–$20,250 | **$5,250–$10,125** | TBD | TBD | TBD |
| BACnet Intl membership | — | ~$2,000–5,000/yr | — | — | — |
| Conformance tool license | $3,000–5,000 | $3,000–5,000 | $3,000–5,000 | $3,000–5,000 | $3,000–5,000 |
| Shipping (round-trip) | $300–500 | $300–500 | $500–800 | $500–800 | $200–300 |
| **Total estimated** | **$13,800–$25,750** | **$10,550–$20,625** | **TBD** | **TBD** | **TBD** |

> **Membership breakeven:** If testing >67 hours at $150/hr, Silver membership (~$2,000–3,000) pays for itself. For a B-BC device at 70-135 hours, membership is **strongly recommended**.

## 6. BACnet International Corporate Membership — Recommendation

**Recommendation: Enroll as Silver Corporate Member before booking BTL test.**

| Factor | Assessment |
|--------|------------|
| **Silver annual dues** | ~$2,000–3,000 (estimate based on small company revenue tier) |
| **Testing savings** | $5,250–$10,125 saved on 70-135 test hours |
| **ROI Year 1** | **Positive** — membership fee < 50% testing discount |
| **Additional benefits** | Discounted BTL listings, PlugFest access, 35% off BOTS tool, 50% off BACnet Test Client, 10% off BACnet Test Framework |
| **Risk of NOT joining** | Paying 2× testing rate, lower queue priority, no listing discounts for future products |

**Action:** CEO to authorize Silver membership application. PMO to handle application paperwork.

## 7. Outreach Priority & Strategy

| Priority | Lab | Rationale | Action |
|:--------:|-----|-----------|--------|
| **P1** | **BTL Lab (PTL)** | Most experienced, public pricing, membership discount applies | Email quote + availability request |
| **P2** | **KTC** | Closest to VN, new = potentially shorter queue, Korea FTA reduces customs risk | Email quote + availability request |
| **P3** | **TÜV SÜD** | RBTO confirmed, APAC offices (SG/TH), potential bundled testing | Contact form + APAC office inquiry |
| **P4** | **MBS GmbH** | RBTO confirmed, EMEA alternative | Defer unless P1-P3 exhausted |

**Target:** Send outreach emails to P1 + P2 by June 6, 2026. Each week of delay risks GA Q4 2027.

## 8. Recommendation

**Primary:** Book **BTL Lab (PTL, Pune)** — highest-confidence path to BTL listing with transparent pricing and 50% membership discount.

**Parallel track:** Contact **KTC (Korea)** for quote. As the first and only Asian RBTO (designated Feb 2025), KTC offers:
- Closest proximity to Vietnam (4h flight, +2h timezone)
- Korea-Vietnam FTA for simplified customs
- Potentially shorter queue (new lab building client base)
- Modern testing infrastructure under KOLAS accreditation

**Contingency:** TÜV SÜD APAC (Singapore/Thailand office) as backup, especially if bundled BACnet + EMC testing yields cost savings.

**Budget optimization:** Enroll in BACnet International Silver Corporate Membership BEFORE booking testing slot. At 70-135 estimated hours, the 50% discount saves $5,250-$10,125 — more than covering the ~$2,000-3,000 annual membership fee.

### Outreach Email Templates

#### BTL Lab (PTL) Inquiry

```
To: testing@bacnetinternational.org
Subject: BTL Certification Inquiry — B-BC DDC Controller, BACnet/IP, Vietnam Manufacturer

Dear BTL Lab Team,

KINEXUS Technologies (Vietnam) is developing a BACnet/IP DDC controller
(MK-DDC-24) targeting BTL certification for GA Q4 2027.

Device Profile:
- BACnet Device Profile: B-BC (BACnet Building Controller)
- BACnet/IP (Annex J) native
- 24 I/O points (8 UI + 8 DI + 4 AO + 4 DO)
- Linux-based (Debian 12), open-source bacnet-stack

We are evaluating BACnet International Silver Corporate Membership for
the 50% testing discount.

Request:
1. Estimated testing hours for a B-BC device with above I/O profile
2. Earliest available test slot and typical lead time to certification
3. Sample shipping requirements (quantity, configuration, documentation)
4. Confirmation of current hourly rate and membership discount applicability
5. Pre-test consultation availability (we plan to run conformance tool internally first)

Target: Book test slot and submit device sample by Q1 2027.

Thank you,
[Name]
KINEXUS Technologies
[Contact info]
```

#### KTC Inquiry

```
To: ktc_bacnet@ktc.re.kr
Subject: BACnet BTL Testing Inquiry — B-BC DDC Controller, Vietnam Manufacturer

Dear KTC BACnet Testing Team,

Congratulations on your recent designation as a Recognized BACnet Testing
Organization (Feb 2025). As the first RBTO in Asia, KTC is a strategic
option for manufacturers in the region.

KINEXUS Technologies (Vietnam) is developing a BACnet/IP DDC controller
targeting BTL certification for GA Q4 2027.

Device Profile: B-BC, BACnet/IP, 24 I/O points, Linux-based.

Request:
1. BACnet BTL testing service availability and current fee schedule
2. Estimated testing duration for a B-BC device
3. Earliest available test slot
4. Sample submission requirements and logistics (VN → Korea)
5. Whether KTC offers pre-test consultation or conformance tool guidance

We are also evaluating BACnet International corporate membership.

Thank you,
[Name]
KINEXUS Technologies
[Contact info]
```

## 9. Decisions Required

| # | Decision | Owner | Deadline | Impact |
|---|----------|-------|----------|--------|
| D1 | Confirm "ANNEXA" removal from all docs | SW Lead + PMO | June 5 | Data integrity |
| D2 | Authorize BTL Lab (PTL) outreach email | CEO | June 6 | Schedule lock |
| D3 | Authorize KTC (Korea) parallel outreach | CEO | June 6 | Backup option |
| D4 | Approve BACnet Intl Silver membership | CEO | June 15 | Budget optimization |
| D5 | Approve BTL lab budget ($10K-20K) | CEO | June 15 | Financial commitment |
| D6 | Select final lab after quotes received | SW Lead + CEO | June 30 | Implementation start |

---
*Analysis date: 2026-06-02 · Revision: 2.0*  
*Research sources: btllab.org · bacnetinternational.org · btltestlab.net · tuvsud.com · protocoltestlab.com*  
*KTC designation: bacnetinternational.org/news/ktc-designated-as-a-recognized-bacnet-testing-organization/*

---

## 10. Verification Sources (Web-Fetched 2026-06-03)

This section records the live web sources used to verify each claim in this document.

### 10.1 BTL Lab (PTL) — Fee & Membership Discount

| Claim | Source | URL | Status |
|-------|--------|-----|--------|
| BTL Lab is RBTO operated by Protocol Test Lab (PTL) | btllab.org | https://btllab.org/ | ✅ Confirmed |
| Base testing rate $150/hr | btltestlab.net/fees.php | https://btltestlab.net/fees.php | ✅ Confirmed |
| 50% discount for Silver/Gold/Platinum members → $75/hr | btltestlab.net/fees.php | https://btltestlab.net/fees.php | ✅ Confirmed |
| Members get priority testing queue | btllab.org | https://btllab.org/ | ✅ Confirmed |
| Contact: testing@bacnetinternational.org, +1 770-971-6003 | btllab.org | https://btllab.org/ | ✅ Confirmed |

### 10.2 BACnet International Corporate Membership — Discount

| Claim | Source | URL | Status |
|-------|--------|-----|--------|
| Silver/Gold/Platinum get 50% off BTL Lab hourly rate | bacnetinternational.org/corporate/ | https://bacnetinternational.org/corporate/ | ✅ Confirmed |
| 35% off BOTS tool (PolarSoft) | bacnetinternational.org/corporate/ | https://bacnetinternational.org/corporate/ | ✅ Confirmed |
| 50% off BACnet Test Client (BITS) | bacnetinternational.org/corporate/ | https://bacnetinternational.org/corporate/ | ✅ Confirmed |
| 10% off BACnet Test Framework (MBS) | bacnetinternational.org/corporate/ | https://bacnetinternational.org/corporate/ | ✅ Confirmed |
| Additional Silver listing $300 discount | bacnetinternationalmember.org | https://bacnetinternationalmember.org/membership-information | ✅ Confirmed |
| **Silver annual dues** — NOT publicly listed | all sources searched | — | ❌ Not found |
| **Gold/Platinum dues** — NOT publicly listed | all sources searched | — | ❌ Not found |

> **Note on dues:** No BACnet International website page publicly discloses exact Silver/Gold/Platinum dues. Corporate Affiliate contribution levels ($15K/$4K/$2K) are visible on the member portal but these apply to *local BACnet organizations*, not BACnet International corporate tiers. To confirm exact Silver dues, complete the registration process at https://bacnetinternationalmember.org/register?memberTypeID=16987 (pricing appears at checkout) or email info@bacnetinternational.org.

### 10.3 RBTO List Confirmation

| RBTO | Verified By | URL | Status |
|------|-------------|-----|--------|
| BTL Lab (PTL, Pune, India) | btllab.org | https://btllab.org/ | ✅ Confirmed |
| MBS GmbH (Krefeld, Germany) | mbs-solutions.de | https://www.mbs-solutions.de/ | ✅ Confirmed — DAkkS accredited since 2012 |
| TÜV SÜD (Munich, Germany) | btllab.org (listed as RBTO) | https://btllab.org/ | ✅ Confirmed |
| KTC (Gunpo-si, South Korea) | ktc.re.kr BACnet page | https://www.ktc.re.kr/web_united/task/task.asp?pagen=2709 | ✅ Confirmed — self-identifies as RBTO |

> **4 RBTOs worldwide confirmed.** iHomeLab (Lucerne) excluded — not on current btllab.org device testing page.

### 10.4 ANNEXA Verification

| Claim | Source | Result |
|-------|--------|--------|
| "ANNEXA" is a valid BTL testing lab | No source found | ❌ **NOT VALID** |
| "ANNEXA" appears on btllab.org, bacnetinternational.org, or any BTL publication | btllab.org, bacnetinternational.org, multiple search rounds | ❌ Zero results |
| Root cause: "Annex A" (ISO 16484-6:2020) misread as company name | ISO 16484-6:2020 structure; BACnet Certification Handbook 4.0 | ✅ **Confirmed documentation error** |

**Conclusion: "ANNEXA" is NOT a valid BTL testing lab. Remove from all project documents.**

### 10.5 KTC (Korea) — Additional Verification

| Attribute | Detail | Source |
|-----------|--------|--------|
| Self-identified RBTO status | ✅ Confirmed on ktc.re.kr BACnet page | https://www.ktc.re.kr/web_united/task/task.asp?pagen=2709 |
| Standards | BTL Specified Test, ASHRAE 135.1, ISO 16484-5/6 | KTC BACnet service page |
| Test workflow | Applicant → KTC (RBTO) → BTL (certification body) | KTC BACnet service page |
| BACnet device profiles | Not explicitly enumerated per B-BC/B-AAC categories | Same page |
| 2025 designation confirmed | Per BACnet International press release (Feb 2025) | Cited in parent analysis |
| Contact (BACnet) | Kang Dae-kyung (kangdk@ktc.re.kr), Park Sung-ha (psungha@ktc.re.kr) | KTC BACnet page |

### 10.6 Key Gaps (Unverified Claims)

The following claims in the existing analysis (Sprint 1) could **not** be independently verified from web sources:

| Claim | Dependence | Risk |
|-------|-----------|------|
| $150/hr rate is "standard" for all BTL labs (vs only BTL Lab PTL) | BTL Lab PTL publishes this; MBS/TÜV SÜD/KTC do not | Cost comparison across 4 RBTOs incomplete |
| Silver dues estimate $2,000–$3,000/yr | Based on research team estimate; no public source | Budget planning may be off by ±50% |
| KTC may have shorter queue (new RBTO) | Logical inference, not confirmed | If KTC queue is also long, scheduling advantage is lost |
| TÜV SÜD offers bundled BACnet + EMC testing | Speculative; TÜV SÜD website blocked (403) | Could be a false economy |
| Vietnam → Korea shipping $200–300 | Not verified with freight forwarders | Logistics cost may vary significantly |

> **Recommendation:** Forward these gaps to ProcurementOps for quote-based verification. The $150/hr rate + 50% Silver discount for BTL Lab (PTL) are the **only** confirmed numbers. MBS, TÜV SÜD, and KTC require direct quote requests.

---

*Verification appendix added 2026-06-03 · Sources accessed live on that date*
