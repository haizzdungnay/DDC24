# ADR-001: ADC AVDD/VREF Noise Measurement Contract for EMC Pre-compliance Evidence

- Date: 2026-06-03
- Owner: Solution Architect
- Issue: IOT-5891 (`[HW-EMC-PHYS-03] Architecture/measurement contract for ADC AVDD noise evidence`)
- Parent: IOT-5875
- Status: Accepted

## Context

`docs/00_management/evidence/emc/pre-compliance-report.md` section 10 requires physical evidence for `24VAC/DC Supply Noise on ADC`, but current draft mixes `AVDD` and `VREF` terminology and does not define capture modes tightly enough for repeatable execution.

Verified source paths used for this decision:

- `docs/00_management/evidence/emc/pre-compliance-report.md`
- `hardware-design/07_emc_thermal/EMC_THERMAL_NOTES.md`
- `hardware-design/02_carrier_board/CB_SCHEMATIC_NOTES.md`
- `hardware-design/03_io_subsystem/IO_UI_CIRCUIT.md`
- `docs/00_management/evidence/emc/qa-emc-verification-checklist.md`

Key inconsistency to resolve before execution:

- `IO_UI_CIRCUIT.md` defines ADS131M08 `AVDD` as 3.3V analog supply.
- `pre-compliance-report.md` section 10.2 currently labels `AVDD` as `REF3025 (2.5V reference)`, which is architecturally `VREF`, not `AVDD`.

## Decision

For EMC pre-compliance evidence, treat `AVDD` and `VREF` as separate measurement nodes and require two capture classes per supply mode.

### Measurement objective

Demonstrate whether noise entering through `24VAC` rectification or `24VDC` input propagates onto ADC-supporting rails strongly enough to threaten ADS131M08 stability or violate report acceptance criteria.

### Stakeholders / operators

- Solution Architect: owns measurement contract and evidence schema
- Tech Lead / HW execution owner: owns bench execution and report population
- QAReviewer: owns evidence verification against contract
- CTO domain: owns escalation if node identity or acceptance thresholds conflict with system safety/quality goals

### Runtime / bench environment

- DUT: `MK-DDC-24` carrier board + Radxa CM3, nominal assembled state
- Supply mode A: `24VAC` via isolation transformer into production power input path
- Supply mode B: `24VDC` from linear PSU or battery; do not use SMPS for comparison baseline
- DUT operating state: powered and in representative active load condition; if full I/O stimulation is unavailable, execution owner must state actual load state in evidence comment

### Architecture boundary and data flow

Normal power path under test:

`24VAC/VDC input -> bridge rectifier / input protection -> LM2596 +5V -> AP2114H +3.3V -> ADS131M08 AVDD rail + REF3025 VREF -> ADS131M08 conversion stability`

Out of scope for this issue:

- Firmware filtering changes
- Hardware remediation design (`pi-filter`, ferrite, capacitor ECO)
- Formal lab acceptance

### Measurement nodes

Required nodes to capture and report:

1. `24V_rectified` — post-bridge bulk DC node
2. `+5V_LM2596`
3. `+3V3_AP2114H`
4. `AVDD_ADC_3V3` — ADS131M08 analog supply pin or nearest local decoupling node
5. `VREF_ADC_2V5` — REF3025 output / ADC reference node

Node naming above is normative for issue comments, screenshot filenames, and table interpretation.

### Capture classes

For each supply mode (`24VAC`, `24VDC`), collect both classes below:

1. `LF_ripple`
   - Purpose: capture 50/60Hz rectifier ripple and low-frequency rail movement
   - Coupling: DC
   - Timebase start point: `5 ms/div` or slower if needed to show full ripple envelope
   - Metrics: `Noise p-p`, `Noise RMS`

2. `HF_noise_fft`
   - Purpose: capture switching / coupling noise relevant to ADC rail cleanliness
   - Coupling: AC or math-removed DC offset
   - Timebase start point: `10 us/div`
   - Bandwidth limit: `20 MHz` ON for p-p / RMS summary
   - FFT span: `0-500 kHz`
   - Metrics: `Noise p-p`, `Noise RMS`, `Dominant Freq`

### Channel allocation

Because standard bench scope may have only 4 channels, execution may use multiple captures. Minimum required capture grouping:

- Group A: `24V_rectified`, `+5V_LM2596`, `+3V3_AP2114H`, `AVDD_ADC_3V3`
- Group B: `+3V3_AP2114H`, `AVDD_ADC_3V3`, `VREF_ADC_2V5`, optional quiet reference or trigger/helper channel

If only one ADC-supporting node can be captured at highest quality in a pass, `VREF_ADC_2V5` is still mandatory and must be captured in separate evidence.

### Probe / interface contract

- Passive probe `10x` minimum
- Use spring ground or equivalent short return; long flying ground lead invalidates high-frequency evidence
- Probe point must be at IC pin or nearest local decoupling capacitor pad, not remote rail header
- Read-only measurement only; no injected disturbance in this issue
- Timestamp source: oscilloscope timestamp if available, otherwise operator log timestamp in issue comment

### Units, scaling, quality flags

- Time-domain amplitude: `mV p-p`, `mV RMS`
- FFT dominant component: `kHz` or `MHz`, amplitude per scope export convention
- Supply mode and capture class must appear in every evidence filename
- Invalid / degraded evidence must be flagged explicitly as one of:
  - `invalid_probe_ground`
  - `invalid_supply_source`
  - `invalid_load_state_unknown`
  - `invalid_ambient_noise_unchecked`
  - `partial_node_access`

### Evidence file contract

Store artifacts under:

`docs/00_management/evidence/emc/adc-noise/`

Filename pattern:

`YYYYMMDD_<supply-mode>_<capture-class>_<node-or-group>.<ext>`

Examples:

- `20260603_24VAC_LF_ripple_groupA.png`
- `20260603_24VAC_HF_noise_fft_VREF_ADC_2V5.png`
- `20260603_24VDC_HF_noise_fft_AVDD_ADC_3V3.csv`

### Report sections that downstream owner must update

- `docs/00_management/evidence/emc/pre-compliance-report.md` section `10.1`: procedure wording and capture grouping
- same file section `10.2`: rail identity for `AVDD` and `VREF`
- same file section `10.3`: measurement result rows for `AVDD_ADC_3V3` and `VREF_ADC_2V5`
- same file section `10.4`: `24VAC` vs `24VDC` comparison using same DUT load state
- same file section `11.1` and `11.3`: final verdict row once evidence exists

## Rejected alternatives

1. Keep current report wording where `AVDD = REF3025 (2.5V)`
   - Rejected because it collapses analog supply and reference rail into one label, making evidence ambiguous and likely non-repeatable.

2. Measure only `AVDD` and skip `VREF`
   - Rejected because report already claims `ADC VREF` acceptance and REF3025 is direct noise-sensitive dependency for conversion accuracy.

3. Use one capture mode (`10 us/div`, AC-coupled) for all conclusions
   - Rejected because it hides low-frequency ripple differences between `24VAC` and `24VDC`.

## Consequences

**Positive:**
- Measurement scope is explicitly bounded — prevents scope creep into formal EMC lab.
- Evidence file paths and naming are pre-defined — QA can verify without ambiguity.

**Negative / Trade-offs:**
- Requires physical bench session with HW execution owner (cannot be done by AI agent alone).
- Adds coordination overhead for CTO to assign a human HW engineer.

See also: **Acceptance criteria** section below for concrete pass/fail criteria.

## Risks

- `R1` Terminology drift: executor may keep calling `REF3025` node `AVDD` from old report wording, causing bad evidence-to-table mapping.
- `R2` Probe placement risk: remote measurement point can under-report local ADC pin noise.
- `R3` Supply baseline risk: SMPS bench source on `24VDC` mode can corrupt comparison and make `24VAC` vs `24VDC` conclusion unusable.

## Assumptions

- ADS131M08 analog supply node is accessible either at U3 `AVDD` pin or nearest decoupling capacitor pad.
- REF3025 output node is physically probeable without destructive rework.
- Tech Lead/HW owner has oscilloscope with FFT support and ability to export screenshots.

## Open questions

- Exact refdes / pad names for nearest probe-safe decoupling nodes should be confirmed by HW execution owner before bench work starts.
- If DUT cannot be run in representative active-load condition, CTO domain must accept reduced-load evidence as provisional only.

## Acceptance criteria for this architecture contract

- `pre-compliance-report.md` no longer conflates `AVDD` and `VREF`
- Downstream executor can identify required nodes, capture classes, evidence path, and invalid conditions without re-asking architecture intent
- QA can verify evidence against explicit node names and file naming contract
