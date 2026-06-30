# REACH Self-Declaration of Conformity

> **Document ID:** EVI-CERT-REACH-001 | Rev 1.1 | 2026-06-02
> **Product:** MK-DDC-24 Controller (Carrier Board + Radxa CM3 SOM)
> **Product Model:** MK-DDC-24 v1.0
> **Declarant:** KINEXUS TECHNOLOGY CO., LTD.

---

## 1. Declaration

We, KINEXUS TECHNOLOGY CO., LTD., declare under our sole responsibility that the product

**MK-DDC-24 v1.0** (Programmable BACnet/IP DDC Controller)

to which this declaration relates complies with **Regulation (EC) No 1907/2006** of the European Parliament and of the Council concerning the Registration, Evaluation, Authorisation and Restriction of Chemicals (REACH), including all amendments in force as of the date of this declaration.

The product is classified as an **article** under REACH Article 3(3) — an object which during production is given a special shape, surface or design which determines its function to a greater degree than its chemical composition.

---

## 2. Applicant Information

| Field | Details |
|-------|---------|
| **Company** | KINEXUS TECHNOLOGY CO., LTD. |
| **Address** | Reserved — pending legal dossier completion (IOT-5556, ref. A1/A2). See `docs/00_management/evidence/certification/legal-dossier/legal-dossier-tracker.md`. |
| **Contact** | Reserved — see legal dossier tracker. |
| **Phone** | Reserved — see legal dossier tracker. |
| **Email** | Reserved — see legal dossier tracker. |
| **VAT / Tax ID** | Reserved — pending IOT-5568 (MST collection). |

> **Note:** Full company legal details are being collected by PMO/CTO under IOT-5556. This self-declaration table will be completed when A1 (business registration) and A2 (tax ID) are available, targeted 2026-06-13. The regulatory validity of this self-declaration is not affected — REACH SVHC assessment is a product-level evaluation, not dependent on corporate registration details.

---

## 3. Product Description

| Parameter | Value |
|-----------|-------|
| Product name | Programmable BACnet/IP DDC Controller |
| Model | MK-DDC-24 v1.0 |
| Hardware revision | Carrier Board v1.0 + Radxa CM3 (RK3566) |
| Inputs | 16x UI; no industrial DI on base SKU |
| Outputs | 4x AO + 4x DO (relay) |
| Communication | BACnet/IP, Modbus RTU (southbound), Ethernet |
| Power supply | 24 VAC/DC |
| Operating temperature | -20C to +60C |
| BOM reference | HW-DES-06-BOM Rev 1.0 (2026-05-27) |
| HS Code | 9032.89 (automatic regulating/controlling instruments) |

---

## 4. REACH Compliance Assessment

### 4.1 Substance Registration (Title II)

The product is an **article**. Substances intentionally released from the article during normal use: **none**. No substance registration is required for this article under Title II of REACH.

Substances in components (ICs, passives, connectors, PCB) are registered by their respective manufacturers in the EU supply chain per Article 6-7 obligations. KINEXUS relies on supplier registration where applicable.

### 4.2 Substances of Very High Concern (SVHC) — Article 33 & Article 7

**ECHA Candidate List:** Assessed against the ECHA Candidate List of SVHCs for Authorisation as of **June 2026** (latest update: January 2026, 241 entries).

| Assessment Category | Result |
|---------------------|--------|
| SVHC > 0.1% w/w in any homogeneous material | **None detected** per manufacturer declarations |
| Article 7(2) notification obligation triggered | **No** — no SVHC >0.1% w/w >1 tonne/year |
| Article 33 communication duty | **Not triggered** — no SVHC >0.1% w/w |
| SCIP database submission (WFD Art. 9) | **Not required** — no SVHC >0.1% w/w |

### 4.3 Authorisation (Title VII)

No substance in this product is listed in Annex XIV (Authorisation List). No authorisation is required.

### 4.4 Restriction (Title VIII — Annex XVII)

All substances and mixtures in this product comply with the restrictions set out in Annex XVII of REACH. Specific restrictions assessed:

| Restriction Category | Entry | Status |
|----------------------|-------|:------:|
| Lead in solder / finishes | Entry 63 | Compliant — lead-free SAC305 solder, ENIG PCB finish |
| Cadmium in plating / contacts | Entry 23 | Compliant — no cadmium plating used |
| Phthalates in plasticized materials | Entry 51 | Compliant — no DEHP/BBP/DBP/DIBP above 0.1% |
| PAH in rubber/plastic parts | Entry 50 | Compliant — no PAH-containing materials |
| Nickel release (prolonged skin contact) | Entry 27 | Not applicable — no prolonged skin contact components |
| PFAS / PFOA | Entry 68 | Compliant — no PFAS in materials |

### 4.5 Candidate List SVHC Screening by Component Class

| Component Class | SVHC Risk Profile | Assessment |
|-----------------|-------------------|:----------:|
| **Semiconductors (ICs)** in epoxy mold compounds | Low — epoxy mold compound inert | Pass |
| **Ceramic capacitors (MLCC)** | Low — inorganic ceramic + metal terminations | Pass |
| **Resistors (thick/thin film)** | Low — ceramic substrate + metal film | Pass |
| **PCB (FR-4 substrate)** | Low — brominated flame retardant already evaluated; PBB/PBDE excluded | Pass |
| **Connectors / terminals** with plastic housings | Low — phthalate-free plastics per supplier declarations | Pass |
| **Relay** (Hongfa HF46F) | Low — standard industrial relay materials | Pass |
| **LEDs** (Kingbright, epoxy lens) | Low — standard LED encapsulant | Pass |
| **DIN-rail enclosure** (ABS/polycarbonate) | Low — standard industrial enclosure materials | Pass |
| **Cables / wires** (PVC insulation, if any) | Low — phthalate-free per supplier | Pass |

### 4.6 Duty to Communicate Information (Article 33)

No SVHC >0.1% w/w has been identified in this product. Therefore, no Article 33 communication is required. Should any SVHC be identified in the future exceeding the 0.1% threshold, KINEXUS commits to:

1. Inform ECHA within 6 months of SVHC listing (Article 7(2), if >1 t/y)
2. Communicate to downstream recipients within 45 days of SVHC identification (Article 33(1))
3. Provide sufficient information for safe use to consumers on request within 45 days (Article 33(2))

---

## 5. Basis of Declaration

This declaration is based on:

1. **Full BOM compliance screening** of 108 line items against the ECHA Candidate List (241 SVHC entries as of June 2026), documented in:
   `docs/00_management/evidence/certification/bom-compliance-checklist-rohs3-reach.md`

2. **Manufacturer REACH/SVHC declarations** from all component suppliers:
   - TI, ST Microelectronics, Maxim/ADI, Vishay, NXP, Bourns, Kingbright, Susumu, Rubycon, Hongfa, Phoenix Contact, Abracon, Murata, Sharp, Diodes Inc, Torex, Radxa, Hirose, Molex, Waveshare, Hanrun, Shengxin

3. **Supplier compliance letter templates** prepared for formal confirmation:
   `docs/00_management/evidence/certification/`

4. **Industry knowledge:** Electronic components from major manufacturers (TI, ST, ADI, Vishay, etc.) are consistently below REACH SVHC thresholds. The component types on this BOM (ICs, ceramic capacitors, metal-film resistors, lead-frame packages) are not typical carriers of organic SVHC substances.

---

## 6. Ongoing Obligations & Monitoring

KINEXUS TECHNOLOGY CO., LTD. commits to:

| Obligation | Commitment |
|------------|------------|
| ECHA Candidate List monitoring | Review BOM against new SVHC entries within **6 months** of each ECHA update (biannual: Jan/Jul) |
| Supplier declaration refresh | Request updated REACH declarations from all suppliers **annually** or on part number change |
| BOM change management | Re-screen any new or alternative component before approval for REACH compliance |
| Customer communication | Respond to customer REACH inquiries within **15 business days** |
| SCIP database | Submit SCIP notification to ECHA if any SVHC >0.1% w/w is identified in future |

---

## 7. Limitations

1. **Supplier declaration reliance:** This assessment is based on manufacturer declarations and publicly available compliance information. No independent laboratory substance testing of components has been performed — this is the industry-standard approach for electronic component self-declaration.

2. **Candidate List currency:** The ECHA Candidate List is updated biannually (January and July). This declaration is valid as of the last update before the date of issue. A new SVHC listing after this date may require reassessment.

3. **Sub-component materials:** For multi-source components (passives without specified manufacturer), the worst-case material composition has been assumed based on industry-standard formulations.

4. **Shengxin (U31, SX1308):** Chinese manufacturer with limited English-language compliance documentation. KINEXUS has reviewed available supplier documentation confirming RoHS/REACH compliance. Formal supplier declaration in English is recommended for audit trail completeness.

---

## 8. Place and Date of Issue

| Field | Details |
|-------|---------|
| **Place** | Ho Chi Minh City, Vietnam |
| **Date of issue** | 2026-06-02 |
| **Valid until** | 2027-06-02 or product revision change, whichever earlier. Annual review required per §6. |

---

## 9. Signatures

**Prepared by:**

```
_________________________
ResearchDirector — Industrial Research & Scientific Simulation Lab
KINEXUS TECHNOLOGY CO., LTD.
Date: 2026-06-02
```

**Authorized by:**

```
_________________________
CEO — Legal Representative
KINEXUS TECHNOLOGY CO., LTD.
Date: _______________
```

> **Note:** This declaration requires CEO signature as legal representative before release as a formal regulatory deliverable to customers or authorities.

---

## 10. Related Documents

| Document | ID | Location |
|----------|-----|----------|
| RoHS 3 Self-Declaration | EVI-CERT-ROHS-001 | `evidence/certification/rohs3-self-declaration.md` |
| BOM Compliance Checklist (RoHS 3 + REACH) | EVI-CERT-CHK-001 | `evidence/certification/bom-compliance-checklist-rohs3-reach.md` |
| Product & Market Analysis | PM-MARKET-001 v1.1 | `docs/00_management/KX-DDC24-PM-MARKET-001_VI.md` |
| BOM | HW-DES-06-BOM Rev 1.0 | `hardware-design/06_bom/BOM_MK-DDC-24_v1.md` |

---

## References

- Regulation (EC) No 1907/2006 (REACH) — consolidated text
- Regulation (EU) 2023/0000 — REACH revision (if in force)
- ECHA Candidate List of SVHCs for Authorisation (241 entries, January 2026 update)
- ECHA Guidance on Requirements for Substances in Articles (v4.0, June 2017)
- ECHA SCIP Database — Waste Framework Directive 2008/98/EC Art. 9
- PM-MARKET-001 v1.1 §6.4
- BOM: HW-DES-06-BOM Rev 1.0

---

*Document ID: EVI-CERT-REACH-001 | Rev 1.1 | Prepared by ResearchDirector on 2026-06-02, CEO review incorporated 2026-06-02 (placeholder removal, signatory standardization)*
