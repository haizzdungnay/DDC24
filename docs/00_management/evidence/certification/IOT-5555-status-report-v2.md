# IOT-5555 — CR/QCVN Technical Documentation: Status Report v2

> **From:** TechLead · **Date:** 2026-06-04  
> **To:** PMO (for IOT-5459 CR/QCVN lab application preparation)

---

## Executive Summary

14/15 technical design documents required for the CR/QCVN dossier have been created as evidence files. The document readiness has improved from 23% (June 2) to **58% (77% excluding HW physical test items)**.

### Status per Section

| Section | Scope | Ready | Needs Fix | HW Physical | Readiness |
|---------|-------|:-----:|:---------:|:-----------:|:---------:|
| B. Technical | 10 items | 9 | 1 (B4) | — | 90% |
| C. Safety | 6 items | 4 | 1 (C3) | 1 (C5) | 67% |
| D. EMC | 5 items | 2 | 2 (D1/D2) | 1 (D3) | 40% |

---

## Document Inventory

### Section B — Technical Product Documents

| # | Document | File Path | Status | Review |
|---|----------|-----------|:------:|:------:|
| B1 | Data Sheet | (existing) | ✅ Done | — |
| B2 | System Block Diagram | `cr-qcvn-B2-system-block-diagram.md` | ✅ Rev 1.1 | MS/TP refs cleaned (04/06) |
| B3 | Schematic (KiCad) | `hardware-design/kicad/` (10 hierarchical sheets) | ✅ Done | — |
| B4 | PCB Layout | `hardware-design/kicad/MK-DDC-24-Carrier.kicad_pcb` | ⚠️ Needs fix | IOT-5560: K4 relay missing + routing/DRC |
| B5 | Wiring Diagram | (existing, in DS) | ✅ Done | — |
| B6 | Mechanical Drawing | `cr-qcvn-B6-mechanical-drawing.md` | ✅ Done | — |
| B7 | BOM | `hardware-design/06_bom/` | ✅ Done | — |
| B8 | Critical Components List | `cr-qcvn-B8-critical-components-list.md` | ✅ Done | — |
| B9 | Product Label | `cr-qcvn-B9-product-label.md` | ✅ Done | — |
| B10 | Installation Manual | (existing) | ✅ Done | — |

### Section C — Safety Documents (QCVN 4)

| # | Document | File Path | Status | Review |
|---|----------|-----------|:------:|:------:|
| C1 | Safety Risk Assessment | `cr-qcvn-C1-safety-risk-assessment.md` | ✅ QA approved | IOT-5567 |
| C2 | Creepage/Clearance | `cr-qcvn-C2-creepage-clearance.md` | ✅ QA approved | IOT-5567 |
| C3 | Fuse/OCP Specs | `cr-qcvn-C3-fuse-ocp.md` | ✅ Rev 1.1 (fixed 04/06) | Power budget corrected: ≈187mA@24V=4.5W, margin 10.7× |
| C4 | Isolation Transformer | `cr-qcvn-C4-isolation-transformer.md` | ✅ QA approved | IOT-5567 |
| C5 | Safety Pre-test Report | N/A (physical test) | ❌ HW only | Requires physical measurement. May be N/A for SELV device |
| C6 | Relay Specs | `cr-qcvn-C6-relay-specs.md` | ✅ QA approved | IOT-5567 |

### Section D — EMC Documents (QCVN 9)

| # | Document | File Path | Status | Review |
|---|----------|-----------|:------:|:------:|
| D1 | EMC Risk Assessment | `cr-qcvn-D1-emc-risk-assessment.md` | ✅ Rev 1.1 (fixed 04/06) | RS-485 refs corrected to Modbus RTU per ARCH-R010 |
| D2 | EMC Test Plan | `cr-qcvn-D2-emc-test-plan.md` | ✅ Rev 1.1 (fixed 04/06) | RS-485 refs corrected to Modbus RTU per ARCH-R010 |
| D3 | EMC Pre-compliance Report | N/A (physical test) | ❌ HW only | Near-field probe + spectrum analyzer scan |
| D4 | EMI Filter Specs | `cr-qcvn-D4-emi-filter.md` | ✅ TechLead approved | — |
| D5 | Grounding Scheme | `cr-qcvn-D5-grounding-scheme.md` | ✅ TechLead approved | — |

> **Evidence path prefix:** `docs/00_management/evidence/certification/`

---

## Remaining Gaps

### 1. ~~QA findings to fix~~ ✅ All fixed (04/06)

| Issue | Fix Applied | Document |
|-------|-------------|----------|
| **C3** | Power budget corrected: 375mA→≈187mA@24V, margin 5.3×→10.7× | Rev 1.1 |
| **D1/D2/B2** | RS-485 references: "BACnet MS/TP" → "Modbus RTU" per ARCH-R010 | Rev 1.1 |

### 2. B4 PCB Layout fix (DeveloperTeam — ongoing via IOT-5560)

| Issue | Status | Action |
|-------|:------:|--------|
| **B4** K4 relay missing from PCB layout | ⚠️ Pending | DeveloperTeam fix in IOT-5560 |
| **B4** Routing DRC violations | ⚠️ Pending | Verify after relay fix |

### 3. HW physical testing (requires human engineer)

| Item | Required Equipment | Lab Readiness |
|------|-------------------|:------------:|
| **C5** Safety pre-compliance | Dielectric strength tester, insulation resistance meter | TBD |
| **D3** EMC pre-compliance | Spectrum analyzer, LISN, near-field probe set | RFQ sent to TUV Rheinland VN (IOT-5902) |

### 3. Admin/PMO items (not in TechLead scope)

| Item | Owner | Status |
|------|-------|:------:|
| A1 Business Registration + Tax Code | KINEXUS Admin | Not started |
| A2 Tax Code | KINEXUS Admin | Not started |
| A3 ISO 9001 Certificate | KINEXUS QA | Not started |
| A4 Lab Application Form | PMO | Placeholder ready, awaiting lab template |
| A5 Authorization Letter | PMO | Draft template ready |

---

## Recommendation

**For documents:** 14/15 docs created + all 3 QA findings fixed (C3, D1, D2, B2 → Rev 1.1). Only B4 PCB layout remains with DeveloperTeam via IOT-5560.

**For physical tests (C5, D3):** Cannot be produced by AI agents. Recommend CTO assign a human HW engineer to execute per the procedures already documented.

**Next review gate:** After B4 is resolved, TechLead final review → QA re-verify → PMO assembles final package for lab submission.

---

## Appendix: File Manifest

```
docs/00_management/evidence/certification/
├── cr-qcvn-document-checklist.md       ← Master checklist (updated v2.0)
├── cr-qcvn-B2-system-block-diagram.md  ← System block diagram
├── cr-qcvn-B6-mechanical-drawing.md    ← Mechanical dimensions
├── cr-qcvn-B8-critical-components-list.md ← Critical components with safety certs
├── cr-qcvn-B9-product-label.md         ← Product label with CR Mark
├── cr-qcvn-C1-safety-risk-assessment.md ← Safety risk (IEC 60730-1 Annex H)
├── cr-qcvn-C2-creepage-clearance.md    ← Creepage/clearance assessment
├── cr-qcvn-C3-fuse-ocp.md             ← Fuse/OCP specs (NEEDS FIX)
├── cr-qcvn-C4-isolation-transformer.md ← Isolation transformer requirements
├── cr-qcvn-C6-relay-specs.md          ← Relay specifications
├── cr-qcvn-D1-emc-risk-assessment.md  ← EMC risk assessment (NEEDS FIX)
├── cr-qcvn-D2-emc-test-plan.md        ← EMC test plan IEC 61326-1 (NEEDS FIX)
├── cr-qcvn-D4-emi-filter.md           ← EMI filter component specs
└── cr-qcvn-D5-grounding-scheme.md     ← Grounding scheme
```

```
hardware-design/kicad/
├── MK-DDC-24-Carrier.kicad_sch        ← Schematic (flat)
├── MK-DDC-24-Carrier.kicad_pcb        ← PCB layout (B4 — pending fix)
├── MK-DDC-24/                         ← Hierarchical sheets (10 sheets)
│   ├── sheet_01_top.kicad_sch
│   ├── sheet_02_cm3.kicad_sch
│   ├── sheet_03_mcu.kicad_sch
│   ├── sheet_04_power.kicad_sch
│   ├── sheet_05_ui.kicad_sch
│   ├── sheet_06_di.kicad_sch
│   ├── sheet_07_ao.kicad_sch
│   ├── sheet_08_do.kicad_sch
│   ├── sheet_09_comm.kicad_sch
│   └── sheet_10_peripheral.kicad_sch
└── ...
```
