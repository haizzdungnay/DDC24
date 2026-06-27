# ADR-003: EMC Pre-compliance Measurement Boundary and Readiness Contract

- Date: 2026-06-03
- Owner: Solution Architect
- Issue: IOT-5905 (`Validate EMC pre-compliance measurement boundary for IOT-5901`)
- Parent: IOT-5901
- Status: Accepted

## Context

`IOT-5901` coordinates bench execution for EMC pre-compliance work under `IOT-5480`, but current issue text and `docs/00_management/evidence/emc/pre-compliance-report.md` do not yet state one fixed execution boundary for:

- exact measurement families included in pre-compliance bench day
- minimum equipment set that makes schedule technically valid
- operator/runtime conditions required for evidence reuse in downstream report sections
- missing prerequisites that must block scheduling instead of being discovered at bench time

Existing documents already define partial contracts:

- `docs/adr/ADR-001-adc-avdd-noise-measurement-contract.md` locks ADC supply-noise measurement nodes and evidence paths
- `docs/adr/ADR-002-clock-harmonics-gnd-boundary-contract.md` locks clock-harmonics and GND-continuity boundary
- `docs/00_management/evidence/emc/esd/iot-5888-esd-4kv-contact-procedure.md` locks ESD contact procedure

What was missing is one architecture contract that says what `IOT-5901` must coordinate as one valid pre-compliance session and what conditions make that coordination invalid.

Verified source paths used for this decision:

- `docs/00_management/evidence/emc/pre-compliance-report.md`
- `docs/00_management/evidence/emc/qa-emc-verification-checklist.md`
- `docs/00_management/evidence/emc/esd/iot-5888-esd-4kv-contact-procedure.md`
- `docs/00_management/evidence/emc/adc-noise/README.md`
- `docs/adr/ADR-001-adc-avdd-noise-measurement-contract.md`
- `docs/adr/ADR-002-clock-harmonics-gnd-boundary-contract.md`

## Decision

Approve `IOT-5901` measurement boundary only for three mandatory measurement families below. Scheduling is valid only if all minimum equipment/runtime prerequisites in this ADR are named and available.

### Objective

Produce repeatable pre-compliance evidence for report sections that are still physically pending, without widening scope into formal chamber work or unrelated safety/certification tasks.

### Stakeholders / operators

- Solution Architect: owns boundary/readiness contract
- Human HW Engineer: owns bench execution and safe instrument handling
- QAReviewer: owns evidence-to-checklist verification
- CTO: escalation owner for missing operator, missing DUT, unsafe test ambiguity, or scope change

### Runtime / bench environment

- DUT: assembled `MK-DDC-24` carrier board with `Radxa CM3`
- DUT firmware: production FW only, not special lab FW
- DUT operating state: BACnet link active, representative I/O load active during all captures
- Power modes: separate `24VAC` run and `24VDC` run where procedure requires comparison
- This is in-house pre-compliance evidence. Not chamber-equivalent proof and not site acceptance.

### Included measurement boundary

`IOT-5901` may coordinate only these work packages for pre-compliance bench execution:

| Family ID | Measurement family | Primary output | Governing source |
|---|---|---|---|
| `MC-CLK-GND` | Clock harmonics scan + GND continuity physical verification | `pre-compliance-report.md` `§4`, `§5`, `§11.1` | `docs/adr/ADR-002-clock-harmonics-gnd-boundary-contract.md` |
| `MC-ESD-4KV` | `4 kV` contact ESD pre-compliance at named terminals/ports | `pre-compliance-report.md` `§8`, `§11.1` | `docs/00_management/evidence/emc/esd/iot-5888-esd-4kv-contact-procedure.md` |
| `MC-ADC-NOISE` | `24VAC` vs `24VDC` ADC `AVDD/VREF` supply-noise measurement | `pre-compliance-report.md` `§10`, `§11.1`, `§11.3` | `docs/adr/ADR-001-adc-avdd-noise-measurement-contract.md` |

### Out of scope

Not part of `IOT-5901` scheduling boundary:

1. Formal EMC chamber work, CISPR-converted pass/fail, or accredited lab witness tests
2. Conducted-emissions LISN campaign for certification purposes
3. Radiated immunity, EFT, surge, conducted RF, magnetic field, or IEC 61010 safety testing
4. Lab booking, RFQ negotiation, or evidence fabrication without physical execution

## Minimum equipment contract

### Required by measurement family

| Family ID | Mandatory equipment/runtime items |
|---|---|
| `MC-CLK-GND` | Spectrum analyzer `>= 1 GHz`, near-field `H-loop` probe set, multimeter continuity mode, macro camera or microscope, DUT, representative I/O load, BACnet link if available |
| `MC-ESD-4KV` | ESD gun with contact mode `>= 4 kV`, ground reference plane connected to `PE`, DUT, load simulator on all named terminals, BACnet client, multimeter, camera |
| `MC-ADC-NOISE` | Oscilloscope `>= 200 MHz`, `10x` passive probes with spring ground, DUT, load simulator, isolation transformer for `24VAC`, clean `24VDC` source (`linear PSU` or battery), BACnet link active |

### Sufficiency ruling on current `IOT-5905` scope list

Current list in `IOT-5905` is **not sufficient by itself**. It names:

- spectrum analyzer + near-field probe
- ESD gun at `4kV` contact
- oscilloscope + differential probe
- DUT
- power supplies

This list misses mandatory readiness items below:

1. `ground reference plane` for `MC-ESD-4KV`
2. `load simulator` for UI/DI/AO/DO exercised-state validation
3. `BACnet client` for post-discharge and live-runtime checks
4. `multimeter` and `camera/microscope` for physical verification evidence
5. `24VAC isolation transformer` and clean `24VDC` baseline source for `MC-ADC-NOISE`

### Differential probe ruling

`Differential probe` is **not mandatory** for current pre-compliance boundary unless HW execution owner proves safe node access requires it. Governing ADC-noise procedure uses `10x` passive probes with spring ground, not high-voltage differential capture, for current report sections.

## Runtime contract

All three measurement families share these mandatory runtime conditions:

- DUT must run production FW
- I/O must be exercised during measurement: UI sensor input active, DO cycling or fixed-state checks, AO known reference output
- BACnet communication must stay active as operator-visible health indicator
- Evidence must be stored under repo paths already defined by source procedures/ADRs
- Any degraded capture must carry explicit invalid/partial quality flag, not hidden in narrative text

## Scheduling validity gates

`IOT-5901` may be scheduled only when all gates below are true:

| Gate ID | Requirement | Owner |
|---|---|---|
| `RG-01` | Human HW Engineer assigned to execute bench work | CTO / HW management |
| `RG-02` | One assembled DUT with `Radxa CM3` and production FW available | HW execution owner |
| `RG-03` | Load simulator available for UI/DI/AO/DO exercised-state test | HW execution owner |
| `RG-04` | BACnet client tool available on test host | HW execution owner |
| `RG-05` | ESD ground reference plane available and bonded to `PE` | HW execution owner |
| `RG-06` | `24VAC` isolated source and clean `24VDC` baseline source confirmed | HW execution owner |
| `RG-07` | Evidence destinations and report sections known before session start | Solution Architect + QAReviewer |

If any gate above is false, schedule is architecturally invalid and should stay `blocked`.

## Missing prerequisites that must block scheduling

Current exact blockers for valid execution:

1. No named human HW bench owner yet
   - Unblock owner: CTO / HW management
   - Unblock action: assign operator to `IOT-5899` / `IOT-5901`

2. No verified availability of `ground reference plane`, `load simulator`, and `BACnet client` in one bench session
   - Unblock owner: HW execution owner
   - Unblock action: confirm instrument/runtime checklist against this ADR before date commit

3. No verified clean `24VDC` baseline source and `24VAC` isolation path for ADC-noise comparison
   - Unblock owner: HW execution owner
   - Unblock action: confirm source type and isolation arrangement before scheduling

## Acceptance mapping to existing report/checklist

This ADR approves `IOT-5901` only if resulting bench evidence can satisfy rows already pending in:

- `docs/00_management/evidence/emc/qa-emc-verification-checklist.md`
  - `EMC-29`
  - `EMC-36`
  - `EMC-38` to `EMC-41`
- `docs/00_management/evidence/emc/pre-compliance-report.md`
  - `§4.3`, `§4.4`
  - `§5.2`
  - `§8.3`
  - `§10.3`, `§10.4`
  - `§11.1`, `§11.3`

## Consequences

**Positive:**
- One unified readiness gate for all EMC pre-compliance sessions — no hidden prerequisites.
- Equipment list explicitly distinguishes mandatory vs. optional items.

**Negative / Trade-offs:**
- All measurement families (radiated, conducted, ESD, ADC noise, clock harmonics) require a live DUT session — cannot be delegated to AI agents.
- Blocked on CTO assigning human HW engineer and approving formal lab RFQ.

See also: **Acceptance criteria** section below.

## Risks

- `R1` Bench day scheduled with incomplete runtime accessories creates unusable evidence. Mitigation: treat missing `ground reference plane`, `load simulator`, or `BACnet client` as hard blockers.
- `R2` ADC-noise baseline taken from noisy SMPS invalidates `24VDC` comparison. Mitigation: require `linear PSU` or battery and state source explicitly.
- `R3` ESD data without exercised I/O or live BACnet misses operator-visible failures. Mitigation: runtime contract makes these mandatory.
- `R4` Differential-probe assumption may waste setup time or create false dependency. Mitigation: mark it optional unless HW owner identifies inaccessible floating node.

## Assumptions

- Existing ADRs and procedures remain controlling for per-measurement detail; this ADR only normalizes session boundary and readiness gates.
- One bench session may cover all families if equipment and operator time permit, but separate sessions are acceptable if runtime conditions remain equivalent.

## Open questions

- Exact BACnet client choice on bench host (`YABE`, `BACnet Explorer`, or equivalent) should be named by HW execution owner.
- Whether one shared fixture can exercise all UI/DI/AO/DO channels simultaneously should be confirmed by HW execution owner.

## Acceptance criteria for this architecture contract

- `IOT-5901` has one explicit approved measurement boundary and no hidden expansion into formal lab scope
- Minimum equipment list distinguishes mandatory versus optional items
- Missing prerequisites are named with exact owner/action
- Parent issue can reference this ADR directly when coordinating schedule and readiness
