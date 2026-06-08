# Bench Measurement Execution Plan — Clock Harmonics + GND Continuity

> **Plan ID:** IOT-5933  
> **Author:** TechLead  
> **Status:** Awaiting human HW engineer  
> **Equipment needed:** Spectrum analyzer 9 kHz–1 GHz, near-field H-loop probe, multimeter (continuity/Ω), microscope 10×–100×  
> **DUT:** MK-DDC-24 carrier board v1.0 + Radxa CM3 2GB, production FW, 24VAC/VDC supply

---

## 1. Work Summary

Two measurement groups on a single DUT session:

| Group | Items | Est. Time | Equipment |
|-------|-------|-----------|-----------|
| Clock harmonics scan | 6 hotspots, ~18 peak readings | 45–60 min | Spectrum analyzer + H-loop probe |
| GND continuity check | 4 checks (multimeter + microscope) | 30–45 min | Multimeter + microscope |

**Total estimated bench time:** ~1.5–2 hours

---

## 2. Prerequisites

- [ ] Spectrum analyzer available (9 kHz–1 GHz, RBW 120 kHz CISPR)
- [ ] Near-field H-loop probe set available (~2 mm tip)
- [ ] Multimeter with continuity mode and Ω measurement
- [ ] Microscope 10×–100× available
- [ ] DUT powered and configured per pre-compliance-report.md §3.2
- [ ] BACnet link active, all I/O running

---

## 3. Clock Harmonics Scan Procedure

**Protocol:** `docs/00_management/evidence/emc/clock-harmonics/README.md`

### 3.1 Measurement Steps

1. Power DUT with all I/O active, BACnet link up (§3.2 config).
2. Connect H-loop probe to spectrum analyzer.
3. Set analyzer: 9 kHz–500 MHz span, RBW 120 kHz, max hold, peak detector.
4. For each hotspot (see table below): place probe ~2 mm from target, run max-hold 10 s, capture screenshot with cursor on fundamental + harmonic peaks.
5. Record peak amplitudes in pre-compliance-report.md §4.3 table.

### 3.2 Hotspot Map

| ID | Hotspot | Freq | Source | Probe Location | Expected Evidence File |
|----|---------|------|--------|----------------|----------------------|
| HS-CM3 | CM3 system clock | 64 MHz (PLL est.) | Radxa CM3 BGA | 2 mm above BGA center | `docs/00_management/evidence/emc/clock-harmonics/<date>_clock_CM3-fullscan_500MHz-span.png` |
| HS-Y2 | MCU HSE crystal | 8.000 MHz | Y2 (ABM8-8.000MHZ) | Directly above Y2 package | `docs/00_management/evidence/emc/clock-harmonics/<date>_clock_Y2-fundamental_8MHz-peak.png` |
| HS-Y3 | ADC ref crystal | 4.096 MHz | Y3 (CSTCE4M00G15L99-R0) | Directly above Y3 | `docs/00_management/evidence/emc/clock-harmonics/<date>_clock_Y3-ADC_4-096MHz-peak.png` |
| HS-SPI3 | SPI3 bus | ~16 MHz | SPI3 traces (CM3→carrier) | Over SPI3 via group near CM3 edge | `docs/00_management/evidence/emc/clock-harmonics/<date>_clock_SPI3-harmonics_16MHz-series.png` |
| HS-RGMII | RGMII interface | 100 MHz | CM3 GMAC→RJ-45 traces | Over RGMII trace group | `docs/00_management/evidence/emc/clock-harmonics/<date>_clock_RGMII_100MHz-annotated.png` |
| HS-DCDC | DC/DC switching | ~300 kHz | L4 inductor + switching node | 2 mm above L4 | `docs/00_management/evidence/emc/clock-harmonics/<date>_clock_DCDC_300kHz-switching.png` |

### 3.3 Results Table to Fill

File: `docs/00_management/evidence/emc/pre-compliance-report.md` §4.3

| Frequency | Amplitude (dBµV) | Limit | Pass/Fail | Notes |
|-----------|-----------------|-------|-----------|-------|
| 8 MHz (fund) | ⬜ | N/A (near-field) | ⬜ | Near Y2 |
| 16 MHz (H2) | ⬜ | N/A | ⬜ | |
| 32 MHz (H4) | ⬜ | N/A | ⬜ | |
| 64 MHz (H8) | ⬜ | N/A | ⬜ | Near CM3 BGA |
| 100 MHz | ⬜ | N/A | ⬜ | Near RGMII |
| 4.096 MHz | ⬜ | N/A | ⬜ | Near Y3/ADC |

### 3.4 Pass Criteria (§4.4)

- All spurs < reference threshold (CISPR 11 Class A)
- No unexpected harmonics at non-clock frequencies
- Harmonic amplitude drops ≥20 dB from fundamental at 5th harmonic+

---

## 4. GND Continuity Check Procedure

**Protocol:** `docs/00_management/evidence/emc/gnd-continuity/README.md`

### 4.1 Measurement Steps

| ID | Check | Method | Acceptance | Expected Evidence File |
|----|-------|--------|------------|----------------------|
| GND-L2 | GND plane continuity (L2) | Multimeter continuity: probe multiple GND points, verify <0.5 Ω | <0.5 Ω between any two GND points | `docs/00_management/evidence/emc/gnd-continuity/<date>_gnd_continuity_L2-probe-1_0-2ohm.png` |
| GND-VIA | Via stitching density | Microscope: count vias in 1 cm² grid at SPI3, RGMII, DC/DC zones | ≥5 vias per cm² near RF zones | `docs/00_management/evidence/emc/gnd-continuity/<date>_gnd_viadensity_SPI3_8-vias-per-cm2.png` |
| GND-SLOT | No slot under high-speed traces | Microscope L2 under RGMII and SPI3 trace groups | No GND plane slot crossing return path | `docs/00_management/evidence/emc/gnd-continuity/<date>_gnd_slotcheck_RGMII_no-slot.png` |
| GND-YCAP | Y-cap soldered + GND connection | Visual + continuity: Y-cap 10 nF/1 kV signal GND→chassis GND | Both pads soldered, continuity OK | `docs/00_management/evidence/emc/gnd-continuity/<date>_gnd_ycap_soldered-continuity.png` |

### 4.2 Results Table to Fill

File: `docs/00_management/evidence/emc/pre-compliance-report.md` §5.2

| Check | Method | Result |
|-------|--------|--------|
| GND plane continuity (L2) | Visual + multimeter continuity | ⬜ |
| Via stitching density | Microscope ≥5 vias/cm near RF zones | ⬜ |
| Star ground single point | Multimeter GND loop check | ⬜ |
| No slot under high-speed traces | Visual L2 under RGMII, SPI | ⬜ |
| Chassis Y-cap soldered | Visual C? (10 nF/1 kV) | ⬜ |

---

## 5. Expected Evidence File Manifest

All paths relative to repo root `docs/00_management/evidence/emc/`.

### Clock Harmonics (6 files)

| # | Expected Path | Source |
|---|-------------|--------|
| 1 | `clock-harmonics/<date>_clock_CM3-fullscan_500MHz-span.png` | HS-CM3 |
| 2 | `clock-harmonics/<date>_clock_Y2-fundamental_8MHz-peak.png` | HS-Y2 |
| 3 | `clock-harmonics/<date>_clock_Y3-ADC_4-096MHz-peak.png` | HS-Y3 |
| 4 | `clock-harmonics/<date>_clock_SPI3-harmonics_16MHz-series.png` | HS-SPI3 |
| 5 | `clock-harmonics/<date>_clock_RGMII_100MHz-annotated.png` | HS-RGMII |
| 6 | `clock-harmonics/<date>_clock_DCDC_300kHz-switching.png` | HS-DCDC |

### GND Continuity (4 files)

| # | Expected Path | Source |
|---|-------------|--------|
| 1 | `gnd-continuity/<date>_gnd_continuity_L2-probe-1_0-2ohm.png` | GND-L2 |
| 2 | `gnd-continuity/<date>_gnd_viadensity_SPI3_8-vias-per-cm2.png` | GND-VIA |
| 3 | `gnd-continuity/<date>_gnd_slotcheck_RGMII_no-slot.png` | GND-SLOT |
| 4 | `gnd-continuity/<date>_gnd_ycap_soldered-continuity.png` | GND-YCAP |

---

## 6. Blocker Analysis

| Blocker | Type | Owner | Action Required |
|---------|------|-------|-----------------|
| No human HW engineer assigned | Resource | CTO | Assign HW engineer (or designate existing team member) to execute bench measurements |
| Test equipment availability | Resource | CTO/HW Engineer | Confirm spectrum analyzer + H-loop probe + multimeter + microscope available in-lab or procure |
| DUT availability | Resource | HW Engineer | Confirm MK-DDC-24 carrier board v1.0 + CM3 available, flashed with production FW |

## 7. Security Reminder

- No credentials/secrets in any screenshot, filename, or note
- Do not capture screen areas showing login prompts, passwords, or network credentials
- No proprietary layout files in evidence photos — physical board photos only
- Evidence directory is in the open-source repo — verify no sensitive metadata in images (EXIF stripping recommended)

---

## 8. Post-Execution QA Gate

Once evidence is captured and pre-compliance-report.md §4.3/§5.2 are filled:

1. Update evidence file paths in this plan document
2. Notify TechLead for evidence review ([IOT-5933](../../../../../../../../IOT/issues/IOT-5933))
3. QAReviewer audits evidence ([IOT-5934](../../../../../../../../IOT/issues/IOT-5934))
4. Docs & Release updates report/handover ([IOT-5935](../../../../../../../../IOT/issues/IOT-5935))

---

*Document generated 2026-06-03 by TechLead for IOT-5933*
