# PGM-02 — Programs Workspace — FE Refactor / Redesign Handoff v2.2

**Document ID:** `KX-DDC24-FE-HANDOFF-PGM02-002`  
**Status:** `APPROVED TARGET FOR IMPLEMENTATION — AUTH-PROG-2026-08-24-05`<br>
**Evidence class:** `TARGET DESIGN — NOT AS-BUILT / NOT RUNTIME EVIDENCE`<br>
**Route:** `/eng/programming/programs`  
**Editor variants:** `PGM-02A ST` + `PGM-02B FBD`  
**Visual reference:** [PGM-02 ST/FBD combined Target](assets/PGM-02_ST_FBD_annotated_reference.png)<br>
**Visual authority:** `AUTH-UX-PROG-2026-09-08-01`; dùng thêm [Programs composition](assets/PGM-02_programs.png), không dùng bộ SVG Programming đã loại.<br>
**Target contract supplement:** [PGM-02 Quick Library / SIMULATE / LIVE v2.2](PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md)<br>
**Formal Detailed Design authority:** [PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md](../../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md)
**Exact Candidate pin:** `413a043748dce3b44d2c5076412de761760ba17a`; thực thi theo Plan59 `R1 → R2 → R3`; chưa phải As-Built/release evidence.

## 1. Purpose

PGM-02 is the central engineering workspace. FE shall refactor/redesign it into two first-class editor experiences:

- **PGM-02A — ST Editor Workspace**
- **PGM-02B — FBD Editor Workspace**

They share the same Program shell, POU Explorer, revision context, operating modes, diagnostics, Quick Library, Inspector and bottom workbench. ST and FBD differ only in the main editing surface and editor-specific interactions.

This handoff updates the previous PGM-02 handoff by adding:

1. **Quick Library** next to the editor for fast programming.
2. Three explicit engineering modes: **EDIT / SIMULATE / LIVE**.
3. Separate ST and FBD implementation contracts.
4. Clear FE boundaries for refactor versus runtime/backend capability.
5. Acceptance criteria and refactor sequence.

## 2. Non-negotiable product semantics

The redesign SHALL preserve:

- `Draft ≠ Active ≠ Runtime`.
- `Edit ≠ Save ≠ Check ≠ Commission ≠ Running`.
- Save Draft SHALL NOT modify Active runtime.
- Check failure SHALL NOT stop or replace a healthy Active revision.
- Live values are runtime read-back, never inferred from `desiredEnabled`.
- Missing/stale/offline data SHALL be `Unknown / Stale / —`, never fabricated zero.
- LIVE is read-only in Rev A.0; no online code patch.
- Simulation SHALL have **no physical output authority**.
- UUID/raw IDs are not primary UI.
- Normal users do not manage CPU core/thread/scheduler.
- One POU tree only.
- FBD remains a real node-edge canvas, not a form/card list.
- Existing FBD domain model/commands should be preserved when valid.

## 3. Canonical route and editor identity

Do **not** add two new primary routes.

Canonical route remains:

`/eng/programming/programs`

The selected POU determines editor surface:

- ST POU → `PGM-02A`
- FBD POU → `PGM-02B`

Deep-link state may preserve selected Program/POU and mode, but FE shall not break existing canonical route/deep-link behavior.

## 4. Shared desktop layout

### ≥1440 px

```text
┌ POU Explorer ┬ Main Editor / Canvas ┬ Quick Library ┬ Inspector ┐
│ 220–250 px   │ flex, dominant       │ 240–280 px    │ 280–320px│
├──────────────┴──────────────────────┴───────────────┴───────────┤
│ Problems | Watch | Trace | Search | Cross Reference             │
└──────────────────────────────────────────────────────────────────┘
```

### 1280–1439 px

Quick Library and Inspector share one right dock:

```text
POU Explorer | Main Editor / Canvas | Right Dock 300px
                                      [Quick Library | Inspector]
-----------------------------------------------------------------
Bottom Workbench
```

### <1024 px

POU Explorer, Quick Library and Inspector become collapsible drawers. The main editing surface remains dominant.

### <768 px

Read-only source/canvas only. No ST/FBD editing.

## 5. Shared context/status strip

Sticky, target `36–40 px`.

Required:

`Project AHU_01 · Draft r17 ● Modified · Active r15 ● Running · DDC-24-01 ● Online`

When `Draft != Active`, both stay visible at all times.

Technical Details popover:
- Draft ID
- Active ID
- LKG
- controller/core details
- copy actions

## 6. Engineering mode switch

Visible on both ST and FBD pages:

`[ EDIT ] [ SIMULATE ] [ LIVE ]`

### 6.1 EDIT

Target:
- Draft revision.
- Writable for authorized Admin.
- Quick Library enabled.
- Save / Check / Compare available.
- No runtime execution is implied.

### 6.2 SIMULATE — NEW PRODUCT TARGET

Target:
- **Draft** program in isolated sandbox runtime.
- Virtual/simulated inputs.
- No physical outputs.
- Runtime overlays sourced only from simulation session.
- Minimum controls: `Run | Pause | Step 1 Cycle | Reset`.
- Virtual-time speed selector `1× / 10× / 60×` only when runtime capability exists.
- Watch and Trace may consume simulation signals.
- If Draft is dirty, FE SHALL NOT silently simulate a different source version. Default behavior:
  1. show `Draft has unsaved changes`;
  2. require explicit `Save Draft` before starting simulation;
  3. then create/run simulation from the saved Draft snapshot.

**Capability boundary:** FE must not generate fake simulation values. If simulation service/runtime is unavailable, hide behind capability flag or show `Simulation unavailable on this controller/runtime`.

### 6.3 LIVE

Target:
- **Active revision only**.
- Read-only.
- Real controller runtime values.
- ST inline value decorations / FBD port and block overlays.
- Stale/offline quality explicit.
- Quick Library is hidden/disabled because LIVE is not editing.
- `Return to Draft` is explicit.

If Draft differs from Active, FE must not overlay Active runtime values on Draft source and pretend they correspond. LIVE opens Active source/canvas.

## 7. Quick Library — shared product requirement

Quick Library is a **fast-use subset** of Control Library; it does not replace PGM-04.

Goals:
- user does not need to memorize block names or syntax;
- insert common functions/FBs in 1–2 interactions;
- search by name, description and approved localized alias;
- show enough signature information before insertion.

Sections:
- `Recent`
- `Favorites`
- `Common`
- `HVAC`
- `Logic`
- `Math`
- `Timer`
- `Counter`
- `Signal`
- `Project`

Minimum core entries:
`PID/PI, TON, TOF, TP, R_TRIG, F_TRIG, CTU/CTD, LIMIT, SCALE, MIN/MAX, Deadband/Hysteresis, Compare, Logic`.

Quick Library data SHALL reuse the same authoritative library metadata/domain as PGM-04. Do not create a second hard-coded library catalog in the editor.

Bottom action:
`+ More blocks…` → opens PGM-04 Control Library while preserving return context.

## 8. Quick Library responsiveness

- ≥1440: pinned panel allowed.
- 1280–1439: Quick Library tab in shared right dock.
- <1280: drawer/popover.
- User can pin/unpin.
- Search focus shortcut recommended: `Ctrl/Cmd+L` only if not conflicting with browser/product shortcuts; otherwise use a product-specific configurable shortcut.

## 9. Shared Inspector

Context-sensitive.

Program:
`Name | Language | Cycle | Enable | Description | Advanced Execution`

Variable:
`Name | Type | Scope | Mapping | Live/Sim value | References`

ST symbol/call:
`Definition | Type | Signature | Documentation | References`

FBD block:
`Instance | Type | Parameters | Retained | I/O | Live/Sim values`

Connection:
`Source | Destination | Type | Quality/value`

Inspector SHALL NOT permanently consume 300 px for two fields; collapse when no useful context.

## 10. Bottom Workbench

Tabs:
- Problems
- Watch
- Trace
- Search
- Cross Reference

Mode-dependent behavior:

| Tab | EDIT | SIMULATE | LIVE |
|---|---|---|---|
| Problems | Draft diagnostics | Draft + sim runtime diagnostics | Active runtime diagnostics |
| Watch | optional static symbol list | simulation values | live values |
| Trace | disabled unless supported | simulation trace | controller trace |
| Search | editable Draft source | Draft source | Active read-only source |
| Cross Reference | Draft | Draft | Active |

## 11. FE shared state model

```ts
type ProgramWorkspaceMode = "edit" | "simulate" | "live";
type EditorKind = "st" | "fbd";

type ProgramWorkspaceState = {
  selectedPouId?: string;
  editorKind: EditorKind;
  mode: ProgramWorkspaceMode;

  draftRevision?: string;
  activeRevision?: string;
  draftDirty: boolean;

  saveState: "idle" | "saving" | "saved" | "error";
  checkState: "idle" | "checking" | "pass" | "fail";

  simulation: {
    capability: "unknown" | "unsupported" | "supported";
    state: "idle" | "starting" | "running" | "paused" | "stopped" | "error";
    speed?: 1 | 10 | 60;
    sessionId?: string;
  };

  live: {
    state: "off" | "connecting" | "live" | "stale" | "offline" | "error";
  };

  rightDock: "quick-library" | "inspector" | "simulation-io" | null;
  bottomPanel: "problems" | "watch" | "trace" | "search" | "references" | null;
};
```

This is a FE view-state recommendation, **not an API contract**.

## 12. Component boundary recommendation

```text
ProgramWorkspacePage
├── ProgramContextStrip
├── PouExplorer
├── ProgramModeSwitch
├── ProgramEditorHost
│   ├── STEditorWorkspace
│   └── FBDCanvasWorkspace
├── EngineeringRightDock
│   ├── QuickLibrary
│   ├── ContextInspector
│   └── SimulationInputsPanel
└── BottomWorkbench
    ├── ProblemsPanel
    ├── WatchPanel
    ├── TracePanel
    ├── SearchPanel
    └── CrossReferencePanel
```

Do not make ST and FBD duplicate the entire shell.

## 13. Capability flags

At minimum FE must tolerate:

```ts
type ProgrammingCapabilities = {
  st: boolean;
  fbd: boolean;
  onlineMonitor: boolean;
  simulation: boolean;
  simulationStep?: boolean;
  simulationVirtualTime?: boolean;
  trace?: boolean;
  crossReference?: boolean;
};
```

Capability must come from authoritative product/runtime contract when available. FE shall not expose buttons for nonexistent backend capability.

## 14. Refactor sequence

### RF-0 — Safety net
- snapshot existing route/e2e behavior;
- lock Draft/Active tests;
- lock FBD model/command tests.

### RF-1 — Extract shared shell
- one POU Explorer;
- Context Strip;
- Right Dock;
- Bottom Workbench.

### RF-2 — Mode state
- introduce EDIT/SIMULATE/LIVE state machine;
- no backend fake behavior.

### RF-3 — Quick Library domain + dock
- share library metadata with PGM-04;
- search/recent/favorite;
- editor insertion adapters.

### RF-4 — ST redesign
Follow `PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md`.

### RF-5 — FBD redesign
Follow `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md`.

### RF-6 — Simulation integration
- virtual inputs;
- lifecycle;
- step/reset/speed according capability.

### RF-7 — Live integration
- Active source;
- runtime overlays;
- stale/offline handling.

### RF-8 — E2E + visual regression
- desktop 1280/1440;
- mobile read-only;
- permission;
- offline;
- mode transitions.

## 15. Shared acceptance gates

- `AC-PGM02-001` exactly one POU Explorer.
- `AC-PGM02-002` main editor/canvas visible without page scroll at 1280×750.
- `AC-PGM02-003` Draft and Active never visually conflated.
- `AC-PGM02-004` Quick Library inserts only into Draft/EDIT.
- `AC-PGM02-005` Simulation can never write physical outputs.
- `AC-PGM02-006` LIVE always reads Active and is read-only.
- `AC-PGM02-007` Active values are never overlaid on mismatched Draft source.
- `AC-PGM02-008` unsupported simulation is not faked.
- `AC-PGM02-009` Save/Check do not change Active.
- `AC-PGM02-010` mobile ST/FBD is read-only.
