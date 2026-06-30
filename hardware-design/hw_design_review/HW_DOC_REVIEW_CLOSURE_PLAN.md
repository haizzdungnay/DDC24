# Hardware Documentation Review Closure Plan — MK-DDC-24

> **Document:** HW-REVIEW-CLOSURE-01 | Rev 0.3 | 2026-06-30
> **Owner:** HW Lead (technical decisions), FW Lead (IOP/pinout), QA (evidence), PM (scope/waivers)
> **Source reports:** OpenClaw `hardware-doc-review` snapshots at 05:03, 05:49, 07:19, and 08:04 CEST on 2026-06-30
> **Current gate:** **RED — PCB layout/fabrication release is blocked**

---

## 1. Purpose and closure rule

This file is the durable, in-repository register used to close the external review reports. Update it in the same change that fixes an issue; do not mark an issue closed from narrative intent alone.

Allowed status values:

| Status | Meaning |
|---|---|
| `OPEN` | No sufficient correction exists. |
| `IN_PROGRESS` | Correction is being made; acceptance evidence is incomplete. |
| `BLOCKED_HW` | Documentation is corrected to expose the risk, but a schematic, calculation, prototype result, or approval is still required. |
| `CLOSED_DOC` | The documentation defect is corrected and verified by repository checks. |
| `CLOSED_EVIDENCE` | Required engineering evidence exists and is linked. |
| `REJECTED` | Review item is not a defect; rationale and evidence are recorded. |

`CLOSED_DOC` is not sufficient for a power, protection, thermal, EMC, or manufacturing release blocker. Those issues require `CLOSED_EVIDENCE` or a signed waiver recorded here.

Current verified status (2026-06-30 09:50 CEST):

| Total | Closed documentation | Rejected with rationale | Blocked on HW/evidence |
|---:|---:|---:|---:|
| 41 | 28 | 2 | 11 |

The 11 blocked rows are `001`, `002`, `003`, `005`, `010`, `011`, `012`, `014`, `017`, `024`, and `025`. The register is clean of ambiguous `OPEN`/`IN_PROGRESS` states, but the product release gate remains RED.

---

## 2. Report normalization

The 05:03 report is the canonical register (`HW-DOC-001` through `HW-DOC-039`). Later reports reused identifiers and described old findings as new findings, so they are aliases rather than additional issue counts.

| Later report ID | Canonical issue | Disposition |
|---|---|---|
| Interim `HW-DOC-040` (industrial boost converter) | `HW-DOC-005` | Same design gap. |
| Interim `HW-DOC-041` (LDO thermal calculation) | `HW-DOC-002` | Same blocker/evidence gap. |
| 08:04 `HW-DOC-040` (+5V capacity) | `HW-DOC-001` | Reopened canonical blocker. |
| 08:04 `HW-DOC-041` (AMS1117 thermal) | `HW-DOC-002` | Reopened canonical blocker. |
| 08:04 `HW-DOC-042` (8 UI + 8 DI) | `HW-DOC-029` | Same consistency issue. |
| 08:04 `HW-DOC-043` (IOP timing) | `HW-DOC-006`, `HW-DOC-030` | One root cause with two original rows. |
| 08:04 `HW-DOC-044` (manufacturing blocked) | `HW-DOC-017` | Same release blocker. |
| 08:04 `HW-DOC-045` (reserved pin ambiguity) | `HW-DOC-045` | New clarification issue retained separately. |
| 08:04 `HW-DOC-046` (README diagram) | `HW-DOC-018` | Same completeness issue. |
| 08:04 `HW-DOC-047` (old DI sheet name) | `HW-DOC-047` | New verification row; current source already uses optional sheet 10. |

Canonical total: **41 actionable rows** — 39 original rows plus the genuinely new `045` and `047`. Aliases are not double-counted.

Follow-up QA expanded the closure evidence for `HW-DOC-029` and `HW-DOC-030` across canonical product/spec, implementation, HMI/manual, and certification-preparation documents. This is a broader verification of the same root causes, not a new external-review issue ID.

---

## 3. Execution plan

| Wave | Scope | Exit condition | Gate |
|---|---|---|---|
| P0-A | `001`, `002`, `003`, `005`, `012`, `014`, `017` | Unsafe claims removed; owner decisions and required evidence are explicit. | Layout remains blocked until evidence closes `001`, `002`, `003`, `014`, `017`. |
| P0-B | `006`, `007`, `008`, `009`, `018`, `019`, `029`, `030`, `042/043/046/047` aliases | One I/O architecture and one IOP timing contract across active review-scope docs. | Must pass repository consistency searches. |
| P1-A | `010`, `011`, `013`, `015`, `020`–`028`, `031`, `032`, `034`–`038`, `045` | Each document has objective requirements, test points, and ownership. | Schematic review checklist must reference every open evidence item. |
| P1-B | Missing documents: power tree, grounding, RS-485, connector map | Controlled draft exists with release acceptance criteria. | Draft can close a missing-document defect, not a hardware evidence gate. |
| Final | Re-run checks and inspect KiCad/manufacturing evidence | Every row is `CLOSED_*`, `REJECTED`, or explicitly `BLOCKED_HW` with owner/evidence/dependency. | RED can change only after P0 hardware evidence is approved. |

---

## 4. Canonical issue register

| ID | Sev. | Summary | Current status | Closure evidence / next action |
|---|---|---|---|---|
| HW-DOC-001 | BLOCKER | +5V load exceeds 3 A design | `BLOCKED_HW` | Recalculate every downstream load at +5V input; select/freeze converter with at least 20% continuous-current margin; attach schematic, datasheet, thermal result. |
| HW-DOC-002 | BLOCKER | AMS1117-3.3 thermal limit | `BLOCKED_HW` | Remove AMS1117 as released solution; freeze regulator; show worst-case junction temperature and efficiency. |
| HW-DOC-003 | HIGH | Input TVS/regulator surge coordination | `BLOCKED_HW` | Define input transient target, TVS clamp at selected pulse current, regulator abs max margin, fuse/bridge stress, and test result. |
| HW-DOC-004 | HIGH | Through-hole bridge size/manufacturability | `REJECTED` | THT versus SMD is a documented HW/MFG trade-off, not a defect by itself; electrical/thermal/assembly evidence controls selection. |
| HW-DOC-005 | HIGH | Prototype-grade +15 V boost choice | `BLOCKED_HW` | Replace module-class MT3608/SX1308 release claim with qualified converter requirements and final part evidence. |
| HW-DOC-006 | HIGH | IOP poll timing inconsistent | `CLOSED_DOC` | Hardware, SRS/FW/SW design, implementation guides, risk register and bring-up now distinguish 1ms acquisition, 2ms/500Hz GET_IO, and slower application updates. The v1 interface/freeze docs are explicitly `Superseded`. |
| HW-DOC-007 | HIGH | SOM revision metadata duplicated | `CLOSED_DOC` | SOM spec now has one ordered history and Rev 1.3 header/footer. |
| HW-DOC-008 | HIGH | SOM section 2.3 duplicated | `CLOSED_DOC` | Connector section renumbered to 2.4. |
| HW-DOC-009 | HIGH | DO document revision mismatch | `CLOSED_DOC` | DO header/footer/history agree on Rev 1.3. |
| HW-DOC-010 | HIGH | DO terminal surge/ESD protection absent | `BLOCKED_HW` | Define which contact-side protection is on-board versus installation-provided; schematic/BOM and test evidence required. |
| HW-DOC-011 | HIGH | DO inductive-load suppression incomplete | `BLOCKED_HW` | Define RC snubber/MOV/diode policy by AC/DC load; optional population and external responsibility must be explicit. |
| HW-DOC-012 | HIGH | 4–20 mA compliance margin too small | `BLOCKED_HW` | Freeze 500 ohm max load or higher AO rail/output topology; verify at low rail/high temperature/full scale. |
| HW-DOC-013 | HIGH | Relay bulk capacitor described as 100 uF ceramic | `CLOSED_DOC` | DO circuit now requires 100uF electrolytic/polymer bulk plus 100nF X7R local decoupling. |
| HW-DOC-014 | HIGH | EMC immunity levels incomplete | `BLOCKED_HW` | Add port-by-port ESD/EFT/surge target matrix and pre-compliance evidence links. |
| HW-DOC-015 | HIGH | Mechanical service/thermal details incomplete | `CLOSED_DOC` | Mechanical Rev 1.2 defines controlled debug access, cable/strain relief and objective enclosure thermal validation. |
| HW-DOC-016 | HIGH | Alleged PA15 debug/timer conflict | `REJECTED` | Current debug contract is two-wire SWD on PA13/PA14; PA15 is ADC2 CS. Verify AF selection in CubeMX before release. |
| HW-DOC-017 | HIGH | Manufacturing package unavailable | `BLOCKED_HW` | KiCad sources, Gerber, drill, BOM, CPL, stencil, drawings, DRC/ERC, hashes, and approvals required. |
| HW-DOC-018 | MEDIUM | README architecture diagram incomplete | `CLOSED_DOC` | README Rev 1.4 shows power, 16 UI, AO, DO, RS-485, Ethernet/USB, MCU, and SOM. |
| HW-DOC-019 | MEDIUM | README reading order misses power/EMC | `CLOSED_DOC` | Reading order now includes power, grounding, RS-485, EMC, manufacturing, and closure gates. |
| HW-DOC-020 | MEDIUM | AO/DO test points missing | `CLOSED_DOC` | CB block and bring-up map TP46-49 to AO and TP50-53 to DO drive. |
| HW-DOC-021 | MEDIUM | AO/DO naming rules incomplete | `CLOSED_DOC` | Schematic notes Rev 1.4 define AO, DAC, relay, feedback/contact, and RS-485 nets. |
| HW-DOC-022 | MEDIUM | HSE crystal requirements absent | `CLOSED_DOC` | MCU spec Rev 1.4 defines 8MHz, tolerance, CL calculation, placement and measurement. |
| HW-DOC-023 | MEDIUM | AO/DO protocol commands absent | `CLOSED_DOC` | IOP protocol Rev 2.1 mirrors shared-header opcodes, lengths, payloads and ACK/NACK behavior. |
| HW-DOC-024 | MEDIUM | Main BOM incomplete | `BLOCKED_HW` | Add controlled preliminary rows, then replace them with annotated KiCad BOM export. |
| HW-DOC-025 | MEDIUM | Critical-part second sources incomplete | `BLOCKED_HW` | Approved alternates need electrical/package/firmware equivalence and sourcing sign-off. |
| HW-DOC-026 | MEDIUM | Bring-up omits firmware/version check | `CLOSED_DOC` | Bring-up Rev 1.2 records IOP, MCU FW, status, and capability map before I/O tests. |
| HW-DOC-027 | MEDIUM | Bring-up lacks TP-to-measurement map | `CLOSED_DOC` | Bring-up Rev 1.2 maps TP1-53 to nets, instruments, and expected use. |
| HW-DOC-028 | MEDIUM | AO linearity test has too few points | `CLOSED_DOC` | Bring-up now requires 5 voltage points and 6 current points across 0/250/500-ohm loads on all channels. |
| HW-DOC-029 | MEDIUM | SYS-ARCH still says 8 UI + 8 DI | `CLOSED_DOC` | ADR-010, Canonical Decisions, Product Definition, Rev A Scope, HW/PRD/SRS/DS, SYS-ARCH, pinout, HMI/manual and certification-prep documents define 16 UI + 4 AO + 4 DO; industrial DI is optional capability only. |
| HW-DOC-030 | MEDIUM | ADC publish wording conflicts with poll timing | `CLOSED_DOC` | Active hardware/product/spec/implementation docs distinguish 1ms acquisition, 2ms poll/response, and application-level update rates; the harness checks stale 10ms publish/GET_IO wording. |
| HW-DOC-031 | LOW | Thermal monitoring points incomplete | `CLOSED_DOC` | Bring-up and EMC Rev 1.4 cover all converters, ADC/DAC/AO, UI buffers/mux, input protection and relay circuits. |
| HW-DOC-032 | LOW | CM3 peripheral current note incomplete | `CLOSED_DOC` | SOM Rev 1.3 requires carrier regulation/load switch and budget review above the 200mA rail allocation. |
| HW-DOC-033 | LOW | UI document formatting inconsistent | `CLOSED_DOC` | Rev 2.4 fixes table-breaking unescaped absolute-value pipes and normalizes protection terminology without changing the approved architecture. |
| HW-DOC-034 | LOW | UI zero test has no numeric threshold | `CLOSED_DOC` | UI test Rev 1.1 defines <=8,389 raw counts and <=10mV after zero calibration. |
| HW-DOC-035 | LOW | NTC test resistor accuracy unspecified | `CLOSED_DOC` | UI test Rev 1.1 requires calibrated <=0.1%, <=25ppm/C resistance and traceability fields. |
| HW-DOC-036 | LOW | Serial number format absent | `CLOSED_DOC` | MFG Rev 1.2 defines `MK24-YYWW-NNNN-RR`, uniqueness, label payload, and rework traceability. |
| HW-DOC-037 | LOW | RS-485 checklist missing | `CLOSED_DOC` | RS-485 controlled draft and schematic checklist cover transceiver, isolation/power, bias, termination, protection, ground/shield, routing, and tests. |
| HW-DOC-038 | LOW | Archived DI file lacks direct replacement link | `CLOSED_DOC` | Archive notice links current UI design and optional isolated-DI sheet rule. |
| HW-DOC-039 | LOW | Progress tracker stale | `CLOSED_DOC` | `PROGRESS.md` links this register and records the 2026-06-30 closure batch. |
| HW-DOC-045 | MEDIUM | Retired/reserved MCU pins ambiguous | `CLOSED_DOC` | MCU spec and pinout master mark retired pins NC/reserved and require a controlled cross-file change for reuse. |
| HW-DOC-047 | LOW | Obsolete `06_DI_INPUT` sheet remains | `CLOSED_DOC` | Current schematic-notes source uses `10_DI_ISOLATED_OPTION`; no active `06_DI_INPUT` entry remains. |

---

## 5. Mandatory P0 evidence package

| Gate | Required artifact | Owner | Status |
|---|---|---|---|
| PWR-5V | Worst-case rail spreadsheet, selected regulator design, loss/temperature calculation, load-step capture | HW Lead | Missing |
| PWR-3V3 | Selected regulator, junction-temperature calculation at max ambient, startup/load-step capture | HW Lead | Missing |
| PWR-SURGE | Input protection coordination calculation and IEC 61000-4-5 pre-compliance record | HW/Compliance | Missing |
| AO-COMP | 4–20 mA compliance sweep at min input/max load/max ambient | HW/QA | Missing |
| EMC | Port-by-port ESD/EFT/surge test report with setup/photos/results | Compliance/QA | Missing |
| MFG | KiCad source + fabrication outputs + DRC/ERC + controlled BOM/CPL + approvals + hashes | HW/MFG/QA | Missing |

No prose-only update can change these rows to `CLOSED_EVIDENCE`.

---

## 6. Progress log

| Time (CEST) | Change | Result |
|---|---|---|
| 2026-06-30 08:35 | Normalized four report snapshots; detected reused IDs and false “resolved” labels. | Canonical register created; gate remains RED. |
| 2026-06-30 08:35 | Compared current repo against baseline report. | `HW-DOC-016` rejected with pin-contract rationale; `HW-DOC-047` verified already closed; all other states recorded above. |
| 2026-06-30 08:45 | Completed consistency/test/document-completeness batch. | 27 rows moved to `CLOSED_DOC`; 2 review rows have evidence-backed `REJECTED` dispositions; power/protection/AO/manufacturing rows remain blocked for hardware evidence. |
| 2026-06-30 08:47 | Ran `check_hw_doc_closure.py`, `git diff --check`, and independent power arithmetic. | 16/16 checks pass; no whitespace errors; rectified max 40.729V, +5V upper bound 4.513A, required rating at 85% utilization 5.309A. |
| 2026-06-30 08:52 | Final documentation verification. | 35 Markdown files parsed with 0 failures; table column check 0 errors; local links and revision metadata pass. |
| 2026-06-30 09:50 | Expanded reconciliation to canonical specs, FW/SW design, implementation, HMI/manual and certification-prep artifacts; marked IOP v1 sources superseded. | Harness expanded to 18/18 pass; all 257 Markdown files have balanced fences; 88 changed Markdown files have 665 table blocks with 0 column errors; changed-file local links and `git diff --check` pass. |

---

## 7. Revision history

| Rev | Date | Change |
|---|---|---|
| 0.2 | 2026-06-30 | Normalized external review rows and recorded the first documentation-closure batch. |
| 0.3 | 2026-06-30 | Expanded ADR-010 reconciliation across product/spec/implementation/HMI/certification documents and strengthened regression checks. |

---

## 8. Verification commands

Run from the repository root after every closure batch:

```bash
python3 hardware-design/hw_design_review/check_hw_doc_closure.py

rg -n '8× UI, 8× DI|8 UI \+ 8 DI' \
  hardware-design docs/00_management/KX-DDC24-SYS-ARCH-001_VI.md

rg -n '500 ?Hz|2 ?ms|100 ?Hz|10 ?ms' \
  hardware-design/05_mcu_io \
  docs/00_management/KX-DDC24-SYS-ARCH-001_VI.md

rg -n 'AMS1117|MT3608|SX1308|P6KE33A|BLOCKED|TBD' hardware-design

git diff --check
```

Search hits in revision history, archived references, or explicitly blocked requirements are allowed only when the surrounding text makes their non-current status unambiguous.
