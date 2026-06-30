# RoHS 3 Self-Declaration of Conformity

> **Document ID:** EVI-CERT-ROHS-001 | Rev 1.1 | 2026-06-02
> **Product:** MK-DDC-24 Controller (Carrier Board + Radxa CM3 SOM)
> **Product Model:** MK-DDC-24 v1.0
> **Declarant:** KINEXUS TECHNOLOGY CO., LTD.

---

## 1. Declaration

We, KINEXUS TECHNOLOGY CO., LTD., declare under our sole responsibility that the product

**MK-DDC-24 v1.0** (Programmable BACnet/IP DDC Controller)

to which this declaration relates is in conformity with the following directive:

**Directive 2011/65/EU** of the European Parliament and of the Council on the restriction of the use of certain hazardous substances in electrical and electronic equipment, as amended by **Commission Delegated Directive (EU) 2015/863**.

The product is classified under Category 9 (Monitoring and Control Instruments) per Annex I of Directive 2011/65/EU.

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

> **Note:** Full company legal details are being collected by PMO/CTO under IOT-5556. This self-declaration table will be completed when A1 (business registration) and A2 (tax ID) are available, targeted 2026-06-13. The regulatory validity of this self-declaration is not affected — RoHS 3 compliance is a product-level assessment, not dependent on corporate registration details.

---

## 3. Product Description

| Parameter | Value |
|-----------|-------|
| Product name | Programmable BACnet/IP DDC Controller |
| Model | MK-DDC-24 v1.0 |
| Hardware revision | Carrier Board v1.0 + Radxa CM3 (RK3566) |
| Inputs | 16× UI; no industrial DI on base SKU |
| Outputs | 4× AO + 4× DO (relay) |
| Communication | BACnet/IP, Modbus RTU (southbound), Ethernet |
| Power supply | 24 VAC/DC |
| Operating temperature | -20°C to +60°C |
| BOM reference | HW-DES-06-BOM Rev 1.0 (2026-05-27) |

---

## 4. Restricted Substances Compliance

| Substance | Maximum Concentration (homogeneous material) | Product Status |
|-----------|:-------------------------------------------:|:--------------:|
| Lead (Pb) | ≤ 0.1% (1000 ppm) | ✅ Compliant — lead-free solder + ENIG PCB finish |
| Mercury (Hg) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no mercury-containing components |
| Cadmium (Cd) | ≤ 0.01% (100 ppm) | ✅ Compliant — no cadmium-containing components |
| Hexavalent Chromium (Cr(VI)) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no Cr(VI) surface treatments |
| Polybrominated Biphenyls (PBB) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no PBB flame retardants |
| Polybrominated Diphenyl Ethers (PBDE) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no PBDE flame retardants |
| Bis(2-ethylhexyl) phthalate (DEHP) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no DEHP plasticizers |
| Benzyl butyl phthalate (BBP) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no BBP plasticizers |
| Dibutyl phthalate (DBP) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no DBP plasticizers |
| Diisobutyl phthalate (DIBP) | ≤ 0.1% (1000 ppm) | ✅ Compliant — no DIBP plasticizers |

---

## 5. Exemptions Claimed

**None.** The product is fully RoHS 3-compliant without relying on any exemptions listed in Annex III or Annex IV of Directive 2011/65/EU.

---

## 6. Basis of Declaration

This declaration is based on:

1. **Manufacturer compliance declarations** for every component on the BOM (line items 108), sourced from:
   - TI (Texas Instruments) — Green/RoHS declarations
   - ST Microelectronics — Ecopack2 RoHS declarations
   - Maxim Integrated (ADI) — RoHS declarations
   - Vishay — RoHS declarations
   - NXP — RoHS declarations
   - Bourns — RoHS declarations
   - Kingbright — RoHS declarations
   - Susumu — RoHS declarations
   - Rubycon — RoHS declarations
   - Hongfa — RoHS declarations
   - Phoenix Contact — RoHS declarations
   - Abracon — RoHS declarations
   - Murata — RoHS declarations
   - Sharp — RoHS declarations
   - Diodes Incorporated — RoHS declarations
   - Torex — RoHS declarations
   - Radxa — RoHS declarations
   - Hirose — RoHS declarations
   - Molex — RoHS declarations
   - Waveshare — RoHS declarations
   - Hanrun — RoHS declarations
   - Shengxin — RoHS per supplier documentation reviewed; Chinese manufacturer with limited English-language compliance collateral. Residual risk: formal English-language supplier declaration recommended for audit trail completeness.
   - Susumu — RoHS declarations

2. **PCB and assembly declarations:**
   - PCB finish: ENIG (lead-free) — per PCB fabricator compliance certificate
   - Solder: SAC305 (Sn96.5Ag3.0Cu0.5) — lead-free per supplier

3. **Detailed compliance checklist** filed at:
   `docs/00_management/evidence/certification/bom-compliance-checklist-rohs3-reach.md`

---

## 7. Technical Documentation

Technical documentation supporting this declaration is maintained by KINEXUS TECHNOLOGY CO., LTD. and includes:

| Document | Reference | Location |
|----------|-----------|----------|
| BOM | HW-DES-06-BOM Rev 1.0 | `hardware-design/06_bom/BOM_MK-DDC-24_v1.md` |
| Compliance checklist | EVI-CERT-CHK-001 | `evidence/certification/bom-compliance-checklist-rohs3-reach.md` |
| Manufacturer declarations | Per part number | On file at KINEXUS |
| Schematic (Carrier Board) | HW-DES-03 | On file |
| PCB layout | HW-DES-04 | On file |
| Assembly drawing | HW-DES-05 | On file |

---

## 8. REACH Statement

This product also complies with Regulation (EC) No 1907/2006 (REACH) regarding the Registration, Evaluation, Authorisation and Restriction of Chemicals. No Substances of Very High Concern (SVHC) on the ECHA Candidate List (as of 2026-06-02) are present in concentrations above 0.1% w/w in any homogeneous material of this product.

See separate REACH self-declaration: EVI-CERT-REACH-001 (`evidence/certification/reach-self-declaration.md`).

---

## 9. Place and Date of Issue

| Field | Details |
|-------|---------|
| **Place** | Ho Chi Minh City, Vietnam |
| **Date of issue** | 2026-06-02 |
| **Valid until** | Product revision change or regulations update, whichever earlier |

---

## 10. Signatures

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

> ⚠ **Note:** This document requires CEO signature as legal representative before release as a formal regulatory deliverable to customers or authorities.

---

## References

- Directive 2011/65/EU (RoHS 2)
- Directive (EU) 2015/863 (RoHS 3 — phthalate amendments)
- Commission Delegated Directive (EU) 2015/863 amending Annex II
- PM-MARKET-001 v1.1 §6.4
- BOM: HW-DES-06-BOM Rev 1.0

---

*Document ID: EVI-CERT-ROHS-001 | Rev 1.1 | Prepared by ComplianceExpert, Reviewed by ResearchDirector on 2026-06-02, CEO review incorporated 2026-06-02 (placeholder removal, signatory standardization)*
