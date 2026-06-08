# Clock Harmonics Scan — Evidence Package

> **Part of:** IOT-5920 | Pre-compliance EMC Report §4  
> **Equipment:** Spectrum analyzer 9 kHz–1 GHz, RBW 120 kHz (CISPR); near-field H-loop probe, ~2 mm spacing  
> **DUT:** MK-DDC-24 carrier board v1.0 + Radxa CM3 2GB, production FW, 24VAC/VDC supply  
> **Operator:** TBD — human HW engineer  
> **Date of measurement:** TBD

## Scope

Per CTO/ADR-002 boundary. Probe only mandatory hotspots listed below. Near-field scan is comparative only, NOT chamber-equivalent.

## Mandatory Hotspots

| ID | Hotspot | Frequency | Source | Probe Location |
|----|---------|-----------|--------|----------------|
| HS-CM3 | CM3 system clock | 64 MHz (PLL, est.) | Radxa CM3 BGA | Probe 2 mm above CM3 BGA center |
| HS-Y2 | MCU HSE crystal | 8.000 MHz | Y2 (ABM8-8.000MHZ) | Probe directly above Y2 package |
| HS-Y3 | ADC reference crystal | 4.096 MHz | Y3 (CSTCE4M00G15L99-R0) | Probe directly above Y3 package |
| HS-SPI3 | SPI3 bus | ~16 MHz (est.) | SPI3 traces (CM3 to carrier) | Probe over SPI3 via group near CM3 edge |
| HS-RGMII | RGMII interface | 100 MHz (est.) | CM3 GMAC → RJ-45 traces | Probe over RGMII trace group |
| HS-DCDC | DC/DC switching | ~300 kHz (LM2596HVS) | L4 inductor + switching node | Probe 2 mm above L4 + switching node |

## Measurement Procedure

1. DUT power ON, all I/O active, BACnet link up (same config as §3.2 of pre-compliance report).
2. Connect H-loop probe to spectrum analyzer.
3. Set spectrum analyzer: 9 kHz – 500 MHz span, RBW 120 kHz, max hold, peak detector.
4. For each hotspot:
   - Place probe ~2 mm from the target, hold stable.
   - Run max-hold scan for 10 s.
   - Capture screenshot with cursor annotation: mark fundamental and harmonic peaks.
   - Record peak amplitudes in the results table below.
5. Store each screenshot/export with filename pattern: `YYYYMMDD_topic_hotspot_note.ext`
   - Example: `20260603_clock_Y2-fundamental_peak-annotated.png`

## Evidence Filename Conventions

| Content | Pattern | Example |
|---------|---------|---------|
| Full spectrum scan at CM3 | `YYYYMMDD_clock_CM3-fullscan_note.ext` | `20260603_clock_CM3-fullscan_500MHz-span.png` |
| Y2 crystal fundamental | `YYYYMMDD_clock_Y2-fundamental_note.ext` | `20260603_clock_Y2-fundamental_8MHz-peak.png` |
| Y3/ADC crystal | `YYYYMMDD_clock_Y3-ADC_note.ext` | `20260603_clock_Y3-ADC_4-096MHz-peak.png` |
| SPI3 harmonics | `YYYYMMDD_clock_SPI3-harmonics_note.ext` | `20260603_clock_SPI3-harmonics_16MHz-series.png` |
| RGMII 100 MHz | `YYYYMMDD_clock_RGMII_note.ext` | `20260603_clock_RGMII_100MHz-annotated.png` |
| DC/DC switching | `YYYYMMDD_clock_DCDC_note.ext` | `20260603_clock_DCDC_300kHz-switching.png` |

## Results

| Hotspot | Freq | Peak Amplitude (dBµV) | Notes |
|---------|------|----------------------|-------|
| HS-CM3 | 64 MHz | ⬜ | |
| HS-CM3 | 128 MHz (H2) | ⬜ | |
| HS-CM3 | 192 MHz (H3) | ⬜ | |
| HS-Y2 | 8 MHz (fund) | ⬜ | |
| HS-Y2 | 16 MHz (H2) | ⬜ | |
| HS-Y2 | 32 MHz (H4) | ⬜ | |
| HS-Y2 | 64 MHz (H8) | ⬜ | |
| HS-Y3 | 4.096 MHz | ⬜ | |
| HS-Y3 | 8.192 MHz (H2) | ⬜ | |
| HS-Y3 | 12.288 MHz (H3) | ⬜ | |
| HS-SPI3 | ~16 MHz | ⬜ | |
| HS-SPI3 | harmonics | ⬜ | List dominant peaks |
| HS-RGMII | 100 MHz | ⬜ | |
| HS-RGMII | 200 MHz (H2) | ⬜ | |
| HS-RGMII | 300 MHz (H3) | ⬜ | |
| HS-DCDC | ~300 kHz (fund) | ⬜ | |
| HS-DCDC | harmonics | ⬜ | List dominant peaks |

## Acceptance Criteria (from §4.4)

- All spurs < reference threshold (TBD, typical −10 dB below CISPR 11 Class A limit with antenna factor)
- No unexpected harmonics at non-clock frequencies
- Harmonic amplitude drops ≥ 20 dB from fundamental at 5th harmonic and above

## Security Note

- No credentials/secrets in screenshots, filenames, or notes.
- Do not capture screen areas showing login prompts, passwords, or network credentials.
