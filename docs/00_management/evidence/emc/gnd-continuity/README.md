# GND Continuity & Plane Integrity — Evidence Package

> **Part of:** IOT-5920 | Pre-compliance EMC Report §5  
> **Equipment:** Multimeter (continuity mode); microscope (10×–100×)  
> **DUT:** MK-DDC-24 carrier board v1.0 + Radxa CM3 2GB  
> **Operator:** TBD — human HW engineer  
> **Date of measurement:** TBD

## Scope

Per CTO/ADR-002 boundary. Perform only mandatory GND checks listed below.

## Mandatory GND Checks

| ID | Check | Method | Acceptance | Evidence |
|----|-------|--------|------------|----------|
| GND-L2 | GND plane continuity (L2) | Multimeter continuity test: probe multiple points on L2 copper pour → verify < 0.5 Ω between any two GND points | < 0.5 Ω between any two GND points | Photo of multimeter reading + probe placement |
| GND-VIA | Via stitching density | Microscope inspection: count vias in 1 cm² grid centered on RF-zone hotspots (SPI3, RGMII, DC/DC) | ≥ 5 vias per cm² near RF zones | Microscope photo with grid overlay |
| GND-SLOT | No slot under high-speed traces | Microscope inspection of L2 under RGMII and SPI3 trace groups | No GND plane slot or cut crossing trace return path | Microscope photo annotated with trace + slot location |
| GND-YCAP | Y-cap soldered + GND connection | Visual inspection + continuity: verify Y-cap (10 nF/1 kV, signal GND → chassis GND) is present and soldered | Y-cap present, both pads well-soldered, signal GND ↔ chassis GND continuity | Photo of Y-cap + multimeter continuity reading |

## Measurement Procedure

### GND-L2 — Plane Continuity

1. Set multimeter to continuity mode (Ω).
2. Identify multiple GND test points: screw terminal GND, RJ-45 shield GND, mounting hole, test pad if available.
3. Probe each pair of points; record resistance.
4. If any pair > 0.5 Ω, flag with photo.
5. **Evidence:** At least one photo showing probe placement + multimeter reading.

### GND-VIA — Via Stitching Density

1. Place PCB under microscope at 10×–50×.
2. Identify RF-zone regions: near SPI3 via group, near RGMII traces, near DC/DC inductor L4.
3. Count vias within a 1 cm² grid centered on each zone.
4. **Accept:** ≥ 5 vias/cm².
5. **Evidence:** Microscope photo with visible vias + count annotation.

### GND-SLOT — No Slot Under High-Speed Traces

1. Place PCB under microscope at 20×–100×.
2. Inspect L2 directly under RGMII trace group (CM3 → RJ-45).
3. Inspect L2 directly under SPI3 trace group.
4. **Accept:** Continuous GND copper — no slot, cut, or gap crossing the return path.
5. **Evidence:** Annotated microscope photo showing traces + intact GND plane below.

### GND-YCAP — Y-Cap Verification

1. Visual: Locate Y-cap (10 nF/1 kV, reference designation to be confirmed from PCB).
2. Continuity: Multimeter between signal GND pad of Y-cap and chassis GND pad of Y-cap (should read low Ω / beep).
3. **Evidence:** Photo of Y-cap location + multimeter continuity reading.

## Evidence Filename Conventions

| Check | Pattern | Example |
|-------|---------|---------|
| GND continuity measurement | `YYYYMMDD_gnd_continuity_location_note.ext` | `20260603_gnd_continuity_L2-probe-1_0-2ohm.png` |
| Via density | `YYYYMMDD_gnd_viadensity_zone_note.ext` | `20260603_gnd_viadensity_SPI3_8-vias-per-cm2.png` |
| Slot check | `YYYYMMDD_gnd_slotcheck_trace_note.ext` | `20260603_gnd_slotcheck_RGMII_no-slot.png` |
| Y-cap | `YYYYMMDD_gnd_ycap_note.ext` | `20260603_gnd_ycap_soldered-continuity.png` |

## Results

| ID | Check | Result | Confidence | Evidence File |
|----|-------|--------|------------|---------------|
| GND-L2 | L2 continuity | ⬜ Pass / ⬜ Fail | ⬜ High / ⬜ Medium / ⬜ Low | ⬜ |
| GND-VIA | Via density ≥ 5/cm² | ⬜ Pass / ⬜ Fail | ⬜ High / ⬜ Medium / ⬜ Low | ⬜ |
| GND-SLOT | No slot under traces | ⬜ Pass / ⬜ Fail | ⬜ High / ⬜ Medium / ⬜ Low | ⬜ |
| GND-YCAP | Y-cap soldered + continuity | ⬜ Pass / ⬜ Fail | ⬜ High / ⬜ Medium / ⬜ Low | ⬜ |

**Overall verdict:** ⬜ Pass / ⬜ Fail / ⬜ Needs rework

## Security Note

- No credentials/secrets in screenshots, filenames, or notes.
- No proprietary layout files in evidence photos — only physical board photos.
