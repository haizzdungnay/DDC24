# ADR-002: Clock Harmonics Scan and GND Continuity Boundary Contract for EMC Physical Evidence

- Date: 2026-06-03
- Owner: Solution Architect
- Issue: IOT-5895 (`[HW-EMC-PHYS-01] Define measurement boundary and evidence contract`)
- Parent: IOT-5873
- Status: Accepted

## Context

`IOT-5873` requires physical EMC evidence for clock-harmonics hotspots and GND return-path integrity before `docs/00_management/evidence/emc/pre-compliance-report.md` can be updated credibly. Current scope names candidate probe areas, but it does not yet lock:

- mandatory measurement hotspots versus optional investigation-only points
- exact evidence paths and filename contract
- exact report sections downstream owner must populate
- omission rules so executor does not widen scope ad hoc

Verified source paths used for this decision:

- `docs/00_management/evidence/emc/pre-compliance-report.md`
- `docs/00_management/evidence/emc/README.md`
- `hardware-design/07_emc_thermal/EMC_THERMAL_NOTES.md`
- `hardware-design/02_carrier_board/CB_SCHEMATIC_NOTES.md`
- `hardware-design/03_io_subsystem/IO_UI_CIRCUIT.md`
- `hardware-design/kicad/MK-DDC-24-Carrier.kicad_pcb`

Key physical references confirmed from PCB/docs:

- `Y2` = MCU crystal `8 MHz`
- `Y3` = ADC crystal `4.096 MHz`
- `U3` = `ADS131M08`
- `U28` = `LM2596HVS-5.0`
- `J2` = `HR911105A`
- `TP6` = `SPI3_CLK`
- GND plane design target = `L2` / `In1.Cu`

## Decision

Use fixed physical measurement boundary below for `IOT-5873` execution and `IOT-5896` report updates. Executor may not add or remove mandatory points without written superseding architecture note.

### Objective

Produce repeatable physical evidence for two questions only:

1. Which mandatory clock-related hotspots show strongest near-field peaks at target rows `4.096 / 8 / 16 / 32 / 64 / 100 MHz` and nearby harmonics up to `500 MHz`?
2. Does assembled hardware preserve intended GND return-path integrity from design rules: `L2` continuity, no slot under critical paths, sufficient via stitching, and fitted `Y-cap` return path?

### Stakeholders / operators

- Solution Architect: owns boundary contract and evidence schema
- Tech Lead / HW execution owner: owns bench execution, capture quality, report population
- QAReviewer: owns evidence-to-contract verification
- CTO: escalation owner for scope change, unsafe ambiguity, or evidence insufficiency

### Runtime / bench environment

- DUT: assembled `MK-DDC-24` carrier board with `Radxa CM3`
- DUT state: powered, representative active load, BACnet link up if available
- Instrument set: spectrum analyzer `9 kHz-1 GHz`, near-field `H-loop` probe, multimeter continuity mode, microscope or macro camera
- This contract is pre-compliance only. Not equivalent to chamber acceptance.

### Measurement boundary

Mandatory hotspots and acceptance mapping:

| Hotspot ID | Physical point | Why in scope | Normative report row |
|---|---|---|---|
| `HS-CM3` | `CM3 BGA` keepout perimeter / module edge | Highest digital density; candidate `64/100 MHz` hotspot | `64 MHz`, `100 MHz` |
| `HS-Y2` | `Y2` crystal body and immediate load-cap loop | Confirms MCU `8 MHz` source and harmonics | `8 MHz`, `16 MHz`, `32 MHz` |
| `HS-Y3` | `Y3` crystal body and `U3 CLKIN` vicinity | Confirms ADC `4.096 MHz` source | `4.096 MHz` |
| `HS-SPI3` | `TP6 SPI3_CLK` and short trace segment near `U3` | Checks digital coupling into ADC area | nearest target row observed; note in evidence |
| `HS-RGMII` | `RGMII` bundle between `CM3` and `J2` | High-speed Ethernet edge hotspot | `100 MHz` row mandatory; note lower fundamentals separately if seen |
| `HS-DCDC` | `U28 LM2596` switch node / inductor vicinity | Typical broadband switching radiator | nearest target row observed; note in evidence |

### Omitted or rejected points

Not mandatory for this issue:

1. `Y1` / `32.768 kHz RTC`
   - Omitted because issue acceptance names rows from `4.096 MHz` upward and near-field scan ceiling is `500 MHz`; RTC source is not material to required report table unless anomalous spur appears.

2. Full-trace sweep of every SPI/RGMII segment
   - Rejected because architecture goal is hotspot comparison, not exhaustive EMI mapping. Use one representative accessible segment per bus unless anomaly demands a focused follow-up issue.

3. Absolute radiated conversion to CISPR chamber limit
   - Rejected because available method is comparative near-field scan, not chamber-equivalent compliance proof.

### Scan method contract

- Probe type: near-field `H-loop`
- Probe spacing: nominal `~2 mm` from hotspot
- Frequency span: `0-500 MHz`
- Sweep goal: find strongest local peak around target bins `4.096 / 8 / 16 / 32 / 64 / 100 MHz` and note unexpected strong off-bin peaks
- Read semantics: read-only capture; no injected disturbance
- Evidence requirement: at least one screenshot/export per mandatory hotspot group with cursor or annotation showing dominant peak
- Timestamp source: analyzer timestamp if available, else operator log timestamp in issue comment/report note
- Units: analyzer-native amplitude units must remain unmodified in screenshot and be copied verbatim into notes

### GND continuity boundary

Mandatory physical checks:

| Check ID | Boundary | Method | Pass rule |
|---|---|---|---|
| `GND-L2` | Global `L2` / `In1.Cu` plane continuity | PCB review + multimeter continuity at accessible GND references | continuous return path, no unintended open |
| `GND-VIA` | Stitching around `SPI`, `Ethernet`, `CM3` edge, `LM2596` thermal/return area | microscope / macro count | `>= 5 vias/cm` where rule claims stitching |
| `GND-SLOT` | Under `RGMII` and representative `SPI3` path | PCB visual review | no slot/cut under critical route |
| `GND-YCAP` | `24V power input` to chassis/signal return via `10nF/1kV Y-cap` | visual fit check | component present and soldered |

Continuity evidence is design-backed plus physical-backed. If continuity cannot be probed directly on buried plane, executor must state indirect method used and mark confidence as `visual+layout` or `meter+visual`.

### Evidence contract

Required repository path:

`docs/00_management/evidence/emc/clock-harmonics/`

Allowed supporting path for continuity photos:

`docs/00_management/evidence/emc/gnd-continuity/`

Filename pattern:

`YYYYMMDD_<topic>_<hotspot-or-check>_<mode-or-note>.<ext>`

Examples:

- `20260603_clock-harmonics_HS-Y2_scan.png`
- `20260603_clock-harmonics_HS-RGMII_scan.csv`
- `20260603_gnd-continuity_GND-VIA_eth-mcu-edge.jpg`
- `20260603_gnd-continuity_GND-YCAP_power-input.jpg`

Invalid or degraded evidence must be flagged explicitly with one or more tags:

- `invalid_probe_distance_unknown`
- `invalid_hotspot_not_accessible`
- `partial_scan_only`
- `continuity_indirect_only`
- `visual_count_estimate_only`

### Downstream report sections to update

Downstream owner must update exact sections below in `docs/00_management/evidence/emc/pre-compliance-report.md`:

- `§4.3 Measurement Results`
  - fill amplitude/result rows for `8`, `16`, `32`, `64`, `100`, `4.096 MHz`
- `§4.4 Pass/Fail Criteria (Pre-compliance)`
  - add verdict tied to captured hotspot evidence
- `§5.2 Physical Verification`
  - fill `GND plane continuity`, `via stitching density`, `no slot`, `Y-cap soldered`
- `§11.1 Verdict Summary`
  - propagate physical measurement verdicts for sections `4` and `5`

`§4.1 Measurement Procedure` and `§5.1/§5.2` wording may be aligned for traceability, but those edits are secondary to four mandatory result/verdict sections above.

### Validation method

Validation for this architecture contract is satisfied when:

1. Every mandatory hotspot/check above has at least one repo-verified evidence artifact or an explicit invalid/degraded tag with reason.
2. Report sections `§4.3`, `§4.4`, `§5.2`, `§11.1` are populated from those artifacts.
3. Executor comment links repo-relative evidence paths and states omitted points did not silently become part of scope.

## Rejected alternatives

1. Keep issue scope as free-form list only
   - Rejected because executor could widen scan scope and produce non-comparable evidence.

2. Add `Y1 RTC` as mandatory row
   - Rejected because it is outside named acceptance rows and would dilute bench time without clear EMC value for this issue.

3. Treat all observed peaks as report-table rows
   - Rejected because report needs stable comparison bins, not open-ended spectrum dump.

## Consequences

**Positive:**
- Clock harmonics and GND continuity measurement scope is explicit and bounded.
- Mandatory vs. optional hotspot distinction reduces wasted bench time.

**Negative / Trade-offs:**
- Requires physical HW bench access — blocked on human HW engineer assignment.
- Evidence photos/screenshots must be captured by executor and committed to repo.

See also: **Acceptance criteria** section below.

## Risks

- `R1` `RGMII` row ambiguity: docs mention `25 MHz` reference while report expects `100 MHz`. Mitigation: keep `100 MHz` as normative report row for hotspot reporting and note off-bin observations in evidence notes.
- `R2` Probe access risk near `CM3 BGA` or `LM2596` switch node may force indirect hotspot placement. Mitigation: require annotated screenshot/photo of actual probe location.
- `R3` Buried-plane continuity cannot be proven by one meter point alone. Mitigation: combine meter check with PCB/layout visual evidence and confidence tag.
- `R4` Missing explicit `Y-cap` refdes in current source set may slow physical confirmation. Mitigation: require photo of fitted part near `24V` input and escalate to CTO if assembly does not match design note.

## Assumptions

- Assembled DUT exposes enough physical access to inspect `Y2`, `Y3`, `TP6`, `RGMII` edge area, and `LM2596` region without rework.
- Tech Lead/HW owner can export analyzer screenshots and continuity photos into repo paths above.
- Existing report frequency rows remain fixed for this issue; no table redesign requested.

## Open questions

- Exact assembled-board refdes for `Y-cap` near power input should be confirmed by HW execution owner during evidence capture.
- If `RGMII` dominant hotspot lands at `25 MHz` rather than `100 MHz`, executor should note it explicitly and keep `100 MHz` row populated with nearest measured observation or `not-dominant` rationale.

## Acceptance criteria for this architecture contract

- Execution owner can capture only mandatory hotspots/checks without asking for wider boundary.
- QA can verify whether omitted points were intentionally out of scope.
- Report update targets and evidence directories are explicit and repo-verifiable.
