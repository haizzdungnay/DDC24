# ADR-006: Rev A Engineering UI = Form/JSON Import (wiresheet canvas deferred to Rev B)

- Date: 2026-06-08
- Owner: Solution Architect
- Status: Accepted
- Related: ADR-004 (component runtime), ADR-007 (web stack)
- Supersedes: FBD drag-drop scope in `SW_WEBIDE_DESIGN_MK-DDC-24_VI.md` and
  `KX-DDC24-UX-WEBIDE-001_VI.md` — both **removed 2026-06-08** (see git history)

## Context

The existing WebIDE design (`SW_WEBIDE_DESIGN`, section 3) ships **FBD drag-drop +
ST editor** as Rev A engineering surface. A live drag-drop wiresheet with data
binding is one of the heaviest sub-projects in the system and competes directly
with the runtime engine for the fixed 90-day budget.

The owner has set a **hard 90-day deadline** for the first milestone, with scope as
the adjustable variable, and chosen **form/JSON** as the Rev A engineering surface.

## Decision

Rev A (Rev A.0, "demo-grade") exposes the engineering surface as:

1. **Form-based configuration** for IO channels, Modbus devices/points, BACnet
   object mapping, and per-component parameters.
2. **`graph.json` import/export** as the authoritative way to define the component
   graph (schema in `design/interfaces/GRAPH_SCHEMA`).
3. **No wiresheet/canvas** in Rev A. The drag-drop component canvas (React Flow) and
   user composite components move to **Rev B**.
4. Validator runs on the imported/edited graph at deploy time (4 core safety checks,
   see `spec/REVA_SCOPE_ROADMAP`).
5. Commissioning (per-point test + report export) and backup/restore stay in Rev A.

This keeps the engineering web small enough to fit the 90-day milestone while still
proving the full control + protocol + commissioning loop (product definition §22).

## Rejected alternatives

1. **Minimal canvas in Rev A.** Rejected: even a reduced wiresheet with live binding
   is months of frontend work and would force cutting protocol or commissioning scope.
2. **Keep FBD drag-drop (existing design).** Rejected: tied to the IEC 61131-3 model
   dropped in ADR-004 and exceeds the 90-day budget.

## Consequences

- `SW_WEBIDE_DESIGN` is rewritten as a form/JSON engineering web (no FBD), targeting
  Go backend (ADR-007); old file marked SUPERSEDED.
- `UX-WEBIDE` reworked to form/JSON workflow: configure → import graph → validate →
  commission → deploy.
- Wiresheet canvas + composite components captured as explicit Rev B scope in
  `spec/REVA_SCOPE_ROADMAP`.

## Risks

- `R1` Form/JSON is less marketable in demos than a canvas; mitigated by positioning
  Rev A as the engineering-core proof and Rev B as the UX layer.
- `R2` Hand-edited `graph.json` raises validation importance; the 4 safety checks are
  mandatory, not optional.

## Open questions

- Whether a read-only graph *visualizer* (non-editing) is cheap enough to include in
  Rev A for commissioning clarity — to be scoped in `UX-WEBIDE` rewrite.
