# ADR-020: Mekong-Owned IEC 61131-3-Aligned Program Runtime (ST + FBD, Rev A.0)

- Date: 2026-07-23
- Owner: Phạm Đình Chương — Project Engineering Owner / CTO
- Status: Accepted
- Supersedes: ADR-004 (`docs/adr/ADR-004-component-based-runtime.md`) — component-graph-only
  Rev A engine with IEC 61131-3/FBD/ST explicitly deferred to Rev B/Rev C
- Amends: `docs/00_governance/DECISIONS.md` line "MQTT cloud agent, OTA A/B, IEC 61131-3,
  wiresheet canvas, BACnet MS/TP và BTL certification không thuộc baseline Rev A.0." — IEC
  61131-3-aligned Program Runtime (ST + FBD subset) is now IN baseline Rev A.0; the other
  items in that sentence (MQTT cloud agent, OTA A/B, BACnet MS/TP, BTL certification)
  remain excluded.
- Decision record source: `KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md`
  (Q0–Q9, CTO answers 2026-07-23)
- Related: `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` (corrective design, revised to
  match this ADR), `KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md` (superseded gap
  assessment — recommendation reversed by this ADR, kept for audit trail, not deleted)

## Context

ADR-004 (2026-06-08) chose a component-based graph runtime for Rev A.0 and explicitly
deferred IEC 61131-3 (FBD/ST), scripted components and the full wiresheet IDE to
Rev B/Rev C, rejecting "keep IEC under the hood, rebrand as component-based" as an
alternative.

On 2026-07-22 a corrective design draft (`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`
v0.2) proposed reversing this — mandating a full four-language (ST/LD/FBD/SFC) IEC
61131-3:2025 PSE and runtime inside Rev A.0 — citing an unreferenced "management
corrective directive." The same day, an independent gap assessment
(`KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md`) reached the opposite conclusion:
keep Rev A component-based, do not claim IEC conformity, defer IEC to Rev C. A document
review (`KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`, finding DOC-REV-001)
flagged this as an unresolved governance conflict — a design document cannot be its own
authority for a scope-changing directive — and raised it to the CTO as decision request
`KX-DDC24-DECISION-REQUEST-IEC61131-PROGRAM-SOM-FW-001` (Q0–Q9).

The CTO answered directly on 2026-07-23 (see decision record above). This ADR is the
traceable record that DOC-REV-001 requires.

## Decision

1. **Mekong owns the Program Runtime.** MK-DDC-24 will not adopt a third-party
   commercial or open-source IEC 61131-3 runtime/compiler as its product foundation.
   Mekong owns the compiler, IR, runtime, and Program Schema outright — because the
   controller is simultaneously a DDC controller and a web server, programmed/configured/
   monitored through the browser, and the Program Runtime must integrate directly with
   Mekong-owned I/O Manager, Virtual Variable, Tag Mapping, Alarm, Trend, Scheduler,
   Permission and Audit subsystems without third-party license/API/roadmap dependency.
2. **Rev A.0 scope is a bounded MVP, not full IEC 61131-3.** Rev A.0 ships **Structured
   Text (ST)** and **Function Block Diagram (FBD)** only. **Ladder Diagram (LD) and
   Sequential Function Chart (SFC) are explicitly out of the Rev A.0 release gate** —
   the IR/Program Schema must be extensible to them later, but they are not built now.
3. **Architecture:** `libmkddc_iec` (versioned compiler/semantic core) →
   `mkddc-program-service` (backend: project/build/artifact/deployment/runtime state,
   exposed to Web IDE via API) → `mkddc-program-core` (deterministic typed-IR runtime
   interpreter). The runtime never executes source ST or JSON graph directly, only
   validated, compiled, versioned artifacts. The CLI is a short-lived tool for test/CI/
   recovery, not the primary authoring surface — the Web IDE is.
4. **The existing 28-node component graph (`services/core/graph_runtime.cpp`) is
   retained only as a legacy importer / migration source for vendor function blocks**
   (`MKDDC_*` namespace). It must never be relabeled as IEC FBD; programs must go
   through a versioned importer/translator into typed IR before running on the new
   runtime.
5. **No online change in Rev A.0.** Edit draft → validate → build immutable artifact →
   deploy → atomic activation at a safe task boundary → rollback → audit. No in-place
   mutation of a running artifact.
6. **No certification claim in Rev A.0.** "PLCopen Certified," "IEC 61131-3 Certified,"
   and "Fully IEC 61131-3 compliant" are prohibited for Rev A.0. The only permitted
   self-description is: *"Mekong-owned deterministic DDC programming runtime designed
   with an IEC 61131-3-aligned program, type, task and function-block model."*
   Independent architecture review, language conformance testing for the published
   ST+FBD scope, deterministic timing test, fault containment test, artifact
   compatibility test, security/permission review and auditability review are required
   before commercial release; PLCopen/independent certification is deferred to a later
   revision once runtime and language scope are stable.
7. **Firmware/MCU remains an independent release blocker.** STM32 target/HIL evidence is
   not bundled into the Program Runtime release gate; both must close independently.
8. **Phased execution, no big-bang implementation.** Only **C0 — Architecture and
   Feasibility Baseline** is authorized to start now, as a bounded phase (see
   `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md`). C0 may build limited
   prototypes/spikes (ST parse→semantic→IR, FBD graph→IR, IR execution against a cycle
   budget, I/O image read/write, atomic artifact activation, basic trace) kept separate
   from production code. **C1–C10 production implementation may not start until C0 is
   reviewed and approved.**

## Rejected alternatives

1. **Adopt an external IEC 61131-3 runtime/compiler (commercial or open-source, e.g.
   OpenPLC/MATIEC-class tooling).** Rejected: creates license, roadmap, and API
   dependency on a third party that conflicts with the browser-integrated, single-device
   DDC+web-server architecture and Mekong's requirement to own lifecycle/licensing.
2. **Keep ADR-004 as-is (component-graph-only Rev A, IEC deferred to Rev C).** Rejected
   by explicit CTO directive 2026-07-23, overriding the independent gap assessment's
   recommendation for the reasons in Context above.
3. **Full four-language (ST/LD/FBD/SFC) IEC 61131-3:2025 PSE inside Rev A.0**, as
   proposed in `PROGRAM_SOM_FW_DRAFT_DESIGN` v0.2/0.3. Rejected as oversized for a single
   release without resourcing/sizing; narrowed to ST+FBD MVP, LD/SFC deferred (schema
   stays extensible).
4. **Immediately open C1–C10 production implementation.** Rejected: no effort/timeline/
   headcount/budget sizing exists yet (`KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`
   finding DOC-REV-006). C0 must produce that sizing before C1 opens.

## Consequences

- `ADR-004` status changes to `Superseded by ADR-020` in `docs/00_governance/DECISIONS.md`;
  its component-graph decision is narrowed to "legacy importer / vendor-FB source," not
  the Rev A programming paradigm.
- `docs/00_governance/DECISIONS.md` "Diễn giải bắt buộc" line excluding IEC 61131-3 from
  Rev A.0 baseline must be amended: IEC 61131-3-aligned (ST+FBD) Program Runtime is now
  IN baseline; MQTT cloud agent, OTA A/B, BACnet MS/TP, BTL certification remain OUT.
- `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` must be revised to the narrowed ST+FBD
  scope and the `mkddc-program-service`/`mkddc-program-core` architecture (tracked as a
  new revision in that document).
- Two new planning documents are required and downstream of this ADR:
  `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` and
  `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`.
- `docs/01_product/PRODUCT.md`, `docs/02_requirements/REQUIREMENTS.md`,
  `docs/04_design/SOFTWARE.md`, `docs/07_records/TRACEABILITY.md` still need their own
  change-control update (Product → Requirements → Decision → Design → Verification →
  Traceability chain) — this ADR authorizes that chain but does not itself edit those
  documents; see the conflict report for the specific lines each must reconcile.
- `KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md` is not deleted (audit trail) but its
  §8.1 recommendation is superseded by this ADR; a note has been added there pointing to
  this decision.

## Risks

- `R1` No effort/budget/headcount sizing exists yet for C1–C10; C0 is scoped specifically
  to close this gap before further commitment (tracked in the C0 plan).
- `R2` Building an owned compiler+runtime is a multi-quarter undertaking; scope creep
  back toward "full IEC 61131-3" (LD/SFC, online change, certification) inside Rev A.0
  must be actively resisted — this ADR is the reference for what Rev A.0 does NOT include.
- `R3` The legacy 28-node graph has at least one FE/Core contract gap already identified
  (`UI_Input` has no Core counterpart; see design doc review DOC-REV-005) that the
  importer/migration path in Decision §4 must account for.

## Open questions

- Exact ownership boundary between `mkddc-program-service` (backend) and
  `mkddc-program-core` (runtime) for artifact validation double-checking — to be resolved
  in C0.
- Whether the IR schema versioning scheme is shared with, or independent from, the
  existing SHM/IOP ABI versioning conventions (`ADR-014`) — to be resolved in C0.
