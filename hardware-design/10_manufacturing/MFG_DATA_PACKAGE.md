# Manufacturing Data Package - MK-DDC-24

> **Document:** HW-MFG-01 | Rev 1.1 | 2026-06-23  
> **Status:** BLOCKED - not ready for fabrication after UI Rev A architecture review  
> **Reason:** UI schematic/BOM/placement changed and must be regenerated from KiCad

---

## 1. Manufacturing Release Status

This package is intentionally blocked. The previous package was created from the first DI-to-UI migration and contained assumptions that are no longer valid for Rev A:

- Shared UI mode select.
- Possible field-facing TMUX placement.
- 62R current shunt assumptions.
- REF200/RTD-related UI assumptions.
- Missing per-channel mode latch and op-amp buffer additions.
- Old document revisions.

Do not release Gerber, pick-and-place, stencil, assembly drawings, or vendor fabrication package from this document until the Rev A UI schematic is complete and reviewed.

---

## 2. Required Source Documents Before Release

| Document | Required state |
|----------|----------------|
| `03_io_subsystem/IO_UI_CIRCUIT.md` | Rev 2.2 or later |
| `02_carrier_board/CB_BLOCK_DIAGRAM.md` | Rev 1.3 or later |
| `02_carrier_board/CB_SCHEMATIC_NOTES.md` | Rev 1.3 or later |
| `05_mcu_io/MCU_STM32G0_SPEC.md` | Rev 1.3 or later |
| `06_bom/BOM-UI-16CH.md` | Rev 1.0 or later |
| `kicad/PCB_PLACEMENT_GUIDE.md` | Rev 1.3 or later |
| `hw_design_review/SCHEMATIC_REVIEW_CHECKLIST.md` | Rev 1.2 or later, signed |
| `09_hw_bringup/HW-TEST-UI-16CH.md` | Rev 1.0 or later, QA approved |
| `hw_design_review/HW-RISK-UI-16CH.md` | Release blockers closed or waived |

---

## 3. Regeneration Checklist

- [ ] KiCad hierarchy updated to remove/rename old DI sheet or move it to optional isolated-DI SKU.
- [ ] UI sheet shows terminal -> protection -> mode front-end -> low-voltage mux/buffer -> ADS.
- [ ] BOM export contains 49.9R shunts, mode latch parts, op-amp buffers, and correct protection parts.
- [ ] Pick-and-place generated from the final annotated schematic.
- [ ] Assembly drawing shows polarity and protection components near UI terminals.
- [ ] DRC/ERC pass after layout.
- [ ] Manufacturing files include a note that PT100/PT1000 are not populated/supported in Rev A UI.
- [ ] Vendor package reviewed by HW Lead and QA.

---

## 4. Release Approval

| Role | Approval needed |
|------|-----------------|
| HW Lead | Schematic/layout/BOM match Rev A UI architecture |
| FW Lead | Mode latch and IOP frame assumptions match firmware plan |
| QA Lead | Test plan and production test coverage approved |
| PM | Product claims match Rev A limitations |

---

**Document ID:** HW-MFG-01 | Rev 1.1 | 2026-06-23
