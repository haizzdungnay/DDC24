# IO Subsystem - Digital Input Circuit (Archived)

> **Document:** HW-DES-03-DI | Rev 1.2 | 2026-06-23
> **Status:** ARCHIVED reference design
> **Important:** UI auxiliary dry-contact mode does **not** replace industrial isolated DI
> **Current base Rev A input design:** [`IO_UI_CIRCUIT.md`](IO_UI_CIRCUIT.md). Optional isolated DI must use the `10_DI_ISOLATED_OPTION` sheet rule in [`CB_SCHEMATIC_NOTES.md`](../02_carrier_board/CB_SCHEMATIC_NOTES.md).

---

## 1. Archive Notice

This document preserves the previous 8-channel opto-isolated Digital Input concept for reference only. It is not part of the current 16 UI analog Rev A schematic unless a product SKU explicitly adds a separate isolated-DI sheet/module.

Current Rev A position:

- Universal Input dry-contact mode is auxiliary and for clean potential-free contacts only.
- It is not isolated.
- It is not rated for 24V wet contacts unless a dedicated compatible circuit is added.
- It must not be sold or documented as a full replacement for industrial DI.

If the product needs industrial DI, create or restore a separate isolated-DI design with its own BOM, protection, EMC evidence, and test plan.

---

## 2. Historical 8DI Reference Design

The archived design used:

- 8x optocoupler inputs such as PC817 or equivalent.
- 24VDC wet-contact compatible input network.
- Current limiting, reverse protection, TVS/ESD protection, and logic-side pull-up.
- MCU GPIO PB4-PB11 in the old pinout.

This pinout is not active in HW-DES-05-MCU Rev 1.3.

---

## 3. Reuse Conditions

Before this DI design can be reused:

- [ ] Allocate a separate schematic sheet such as `10_DI_ISOLATED_OPTION`.
- [ ] Revalidate optocoupler or digital isolator part availability and ratings.
- [ ] Recalculate current limit, TVS, thermal, creepage, and clearance.
- [ ] Assign MCU pins or an IO expander without conflicting with UI mode latch/ADC pins.
- [ ] Add DI-specific tests for 24V wet contact, reverse polarity, ESD/EFT, debounce, and isolation.

---

## Revision History

| Rev | Date | Change |
|-----|------|--------|
| 1.0 | 2026-05-27 | Initial 8-channel opto-isolated DI design |
| 1.1 | 2026-06-23 | Archived during first DI-to-UI migration |
| 1.2 | 2026-06-23 | Corrected archive note: UI dry contact is auxiliary only and does not replace isolated DI |

---

**Document ID:** HW-DES-03-DI | Rev 1.2 | 2026-06-23
