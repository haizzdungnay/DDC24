# Bill of Materials - MK-DDC-24 Carrier Board v1.0

> **Document:** HW-DES-06-BOM | Rev 1.2 | 2026-06-23
> **Status:** Draft for schematic release after UI Rev A architecture review
> **UI detail BOM:** `BOM-UI-16CH.md`

---

## 1. Summary

| Group | Estimate (USD) | Notes |
|-------|---------------:|-------|
| Radxa CM3 SOM | 30.00 | 2GB/8GB baseline |
| STM32G0B1RBT6 MCU | 2.30 | Realtime I/O controller |
| Universal Input 16CH | TBD | See `BOM-UI-16CH.md`; revised for per-channel mode latch and 49.9R shunts |
| AO 4CH | TBD | DAC8554 + output front-end |
| DO relay 4CH | TBD | Relay + ULN2003 driver |
| RS-485 + isolation | TBD | MAX13487E + ADUM1201 class |
| Power supply | TBD | 24VAC/DC input to 5V/3.3V/1.8V rails |
| PCB/enclosure/assembly | TBD | Update after schematic and placement freeze |

Cost in previous Rev 1.1 is no longer controlled because UI architecture changed from shared SEL to per-channel mode latch and added op-amp buffers/protection calculations.

---

## 2. Controlled BOM Sections

| Section | File / table | Status |
|---------|--------------|--------|
| UI 16CH | `BOM-UI-16CH.md` | Updated Rev A architecture |
| MCU/SOM/Power/AO/DO/Comms | This file, to be regenerated from KiCad after schematic freeze | Pending detailed re-export |
| Optional isolated DI | Separate BOM section required if SKU needs industrial DI | Not covered by UI dry contact |

---

## 3. Universal Input Delta from Rev 1.1

| Item | Rev 1.1 | Rev 1.2 decision |
|------|---------|------------------|
| Mode select | Shared SEL[2:0] | Per-channel mode latch, 48 outputs |
| 4-20mA shunt | 62R | **49.9R 0.1% 25ppm/C** |
| 0-10V path | Divider only / unclear loading | Divider + RC + RRIO buffer |
| NTC reference | Assumed 3.3V stable | Precision or measured/ratiometric Vexc |
| RTD | PT100/PT1000 claimed | Removed from Rev A UI |
| Dry contact | Replaced DI | Auxiliary only, no isolation claim |
| TMUX placement | Could be read as field-facing | Low-voltage conditioned nodes only |

---

## 4. Removed / Archived DI BOM

The previous PC817 DI subsystem is not part of the 16 UI analog BOM. If industrial digital inputs are required, create a separate isolated-DI sheet and BOM with opto/digital isolator, 24V wet-contact compatibility, creepage/clearance, EMC, and test evidence.

Do not use UI auxiliary dry contact to claim full DI compatibility.

---

## 5. Release Requirements

- [ ] KiCad schematic is updated to UI Rev A before BOM export.
- [ ] `BOM-UI-16CH.md` RefDes and values match schematic.
- [ ] 49.9R shunts replace all 62R UI shunts.
- [ ] Op-amp buffers and mode latch devices are included.
- [ ] Protection PTC/fusible/TVS ratings have current/power calculations.
- [ ] RTD parts are DNI/not populated unless a separate RTD module is approved.
- [ ] Optional isolated DI, if needed, has its own BOM and is not hidden inside UI.

---

## Revision History

| Rev | Date | Changes |
|-----|------|---------|
| 1.0 | 2026-05-27 | Initial BOM |
| 1.1 | 2026-06-23 | DI to UI migration |
| 1.2 | 2026-06-23 | UI architecture review: 49.9R shunts, per-channel mode latch, buffers, RTD removed from Rev A |

---

**Document ID:** HW-DES-06-BOM | Rev 1.2 | 2026-06-23
