# ADR-004: Component-Based Runtime Engine (drop IEC 61131-3 from Rev A)

- Date: 2026-06-08
- Owner: Solution Architect
- Status: Accepted
- Supersedes: control-engine paradigm in `SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md` (DEC-001) — that file was **removed 2026-06-08**; replaced by `SW_RUNTIME_EXECUTION_MODEL` + `SW_COMPONENT_LIBRARY` (see git history for the old content)
- Canonical reference: `spec/PRODUCT_DEFINITION_MK-DDC-24_VI.md` (to be created in Phase 1)

## Context

The current design set (dated 2026-05-30) specifies the control engine as
`kinexus-plc`, an **IEC 61131-3** soft-PLC executing FBD/ST programs on a 100 ms
scan (`SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md`, sections 1–3; file removed 2026-06-08, see git history).

The agreed product definition ("Chốt tổng thể dự án DDC", sections 7, 18, 20, 24)
explicitly rejects this framing:

- "Không PLC IDE clone", "không IEC 61131-3 IDE"
- Core engineering model is **component-based**: core components + user composite
  components on a wiresheet, validated, deployed to a runtime graph.
- IEC 61131-3 / scripted components are listed under **Rev C** scope, not Rev A.

This is a paradigm difference (function-block programming language vs. a graph of
typed components), not a wording change. It must be recorded before any document
is rewritten.

## Decision

The MK-DDC-24 control engine is a **component-based graph runtime** for Rev A.

1. Unit of engineering is a **typed component** (e.g. `AI_Input`, `Scale`, `PID`,
   `Compare_GT`, `OnDelay`, `Modbus_RTU_Read`) wired input→output into a graph.
2. The deployable artifact is **`graph.json`** (schema: ADR + `design/interfaces/GRAPH_SCHEMA`),
   not `.kxp` FBD/ST programs.
3. The runtime executes the graph on a configurable scan cycle, **default 1 s**
   (fast IO 100 ms/500 ms is out of Rev A scope — see ADR-005).
4. Execution ordering, stateful-node semantics, snapshot/recovery and stale/fallback
   handling are specified in `design/software/SW_RUNTIME_EXECUTION_MODEL` (Phase 1).
5. **IEC 61131-3 (FBD/ST), scripted/sandboxed components, and the full wiresheet
   IDE are deferred to Rev B/Rev C.** Rev A ships a fixed library of ~15 core
   components configured via form/JSON import (see ADR-006).

The internal data model (image-of-IO read→compute→write, BACnet object table,
SHM to the IO processor) carries over from the existing design; only the
*programming paradigm and language* change.

## Rejected alternatives

1. **Keep IEC 61131-3 FBD/ST under the hood, rebrand as "component-based".**
   Rejected: contradicts the product philosophy, retains the heavy compiler/IR
   toolchain Rev A does not need, and creates technical debt the docs would have
   to hide rather than describe.
2. **Use OpenPLC / MATIEC (ST→C transpile).** Rejected for Rev A: GPL licensing
   review burden for a commercial product and an engineering model the product
   explicitly does not want to expose.
3. **Defer the decision (keep DEC-001 open).** Rejected: every downstream doc
   (arch, requirements, web, manuals) traces to this choice; leaving it open
   blocks the entire documentation reconciliation.

## Consequences

- `SW_PLC_ENGINE_DESIGN` is rewritten into a runtime-engine design (graph executor),
  not a 61131-3 runtime. The old file is marked SUPERSEDED, not deleted (cert trail).
- New docs required: `GRAPH_SCHEMA`, `SW_RUNTIME_EXECUTION_MODEL`, `SW_COMPONENT_LIBRARY`.
- Requirements traces `PLC-001..023` / `IDE-001..034` are re-mapped to component/graph
  requirements in `spec/SW_REQUIREMENTS`.
- C++17 implementation language for the engine is unchanged.

## Risks

- `R1` Existing code/headers (`shared/kinexus_shm.h`, BACnet stack integration) assume
  PLC variable space; the graph engine must reuse the SHM contract or migrate it.
- `R2` Certification/test artifacts referencing "PLC" must be reconciled to avoid
  traceability gaps.

## Open questions

- Exact reuse boundary between the old `PlcVarSpace`/retain mechanism and the new
  graph node-state/snapshot model — to be resolved in `SW_RUNTIME_EXECUTION_MODEL`.
