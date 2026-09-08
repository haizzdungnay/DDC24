# PGM-02 — Programs (ST/FBD) — FE Handoff

> **REFERENCE LỊCH SỬ.** Bản hiện hành là
> [`PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md`](PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md)
> cùng bốn PNG PGM-02 trong manifest. Không dùng file này làm authority riêng.

**Route:** `/eng/programming/programs`<br>
**Authority trực quan:** [`assets/PGM-02_programs.png`](assets/PGM-02_programs.png) theo `AUTH-UX-PROG-2026-09-08-01`<br>
**Primary goal:** Production-grade engineering workspace for creating/editing Programs, ST/FBD logic, diagnostics, references and online monitoring.

## 1. Mandatory desktop layout

```text
POU Tree 220–260 | Editor/Canvas flex | Inspector 280–320
---------------------------------------------------------
Problems | Runtime | Search | Cross Reference
```

Rules:
- **one POU tree only**.
- editor/canvas fills remaining viewport height.
- Inspector collapses when no useful context.
- no full-width POU block above the editor.
- no page scroll required to reach the source editor at 1280×750.

## 2. POU Tree

Groups:
- Programs
- Function Blocks
- Functions

Each node can expose:
- name
- ST/FBD
- dirty marker
- diagnostic count/severity
- runtime state when applicable

Actions:
`New | Rename | Duplicate | Delete | Search`

Delete referenced object requires confirmation and reference summary.

## 3. ST Editor requirements

Required:
- line number
- syntax highlight
- current-line highlight
- bracket matching
- auto-indent
- undo/redo
- find/replace
- autocomplete
- go-to-definition
- find references
- inline diagnostics
- Problems jump-to-source
- format
- dirty state
- read-only Active view
- Online Monitor live-value overlay

Toolbar:
`Save | Undo | Redo | Find | Check | Compare | Online Monitor | More`

Invariant:
`Edit ≠ Save ≠ Check ≠ Commission ≠ Running`

No `Save & Run`.

## 4. FBD canvas requirements

FBD SHALL NOT render as a vertical form/card list.

Required:
- pan / zoom
- grid + snap
- draggable blocks
- typed ports
- port-to-port connections
- deterministic wire routing
- incompatible-wire rejection
- connection delete
- multi-select
- copy/paste
- undo/redo
- align/distribute
- block palette search
- fit-to-view
- diagnostics on block/wire
- live values on ports in Online Monitor
- keyboard path for create/select/delete/connect operations

Reuse existing FBD model/command layer when domain behavior is already valid; rendering should not reimplement business semantics.

## 5. Inspector

Context-sensitive.

### Program
`Name | Language | Cycle | Enable | Advanced execution`

Normal UI does not expose CPU/core/thread.

### Variable
`Name | Type | Scope | Initial value | Mapping | Live value | References`

### FBD block
`Instance | Block type | Parameters | Retained | I/O`

### Connection
`Source | Destination | Datatype | Live value | Quality`

## 6. Bottom panel

Tabs:
- Problems
- Runtime
- Search
- Cross Reference

### Problems
Fields:
`severity | location | object | message | code`

Click → jump to exact ST range or FBD node/wire.

### Cross Reference
At minimum:
- Declaration
- Read by
- Written by
- Used in
- Point mapping
- Runtime value

## 7. Compare

Supported UX:
- Draft ↔ Active
- Draft ↔ LKG
- Revision ↔ Revision

ST: side-by-side textual diff.  
FBD: node/edge/parameter visual diff.

Compare must never modify either revision.

## 8. Online Monitor

- Explicit ON/OFF mode.
- Read-only values.
- ST: inline/current-value decoration.
- FBD: values on ports/wires.
- stale/unknown quality shown explicitly.
- Online Monitor must never create implicit Force/Write behavior.

## 9. Suggested FE state model

```ts
type ProgramWorkspaceState = {
  selectedPouId?: string;
  editorMode: "ST"|"FBD";
  draftDirty: boolean;
  saveState: "idle"|"saving"|"saved"|"error";
  checkState: "idle"|"checking"|"pass"|"fail";
  onlineMonitor: "off"|"connecting"|"live"|"stale"|"error";
  inspectorOpen: boolean;
  bottomPanel: "problems"|"runtime"|"search"|"references"|null;
};
```

## 10. Error/recovery rules

- Save failure keeps local buffer and dirty state.
- Check failure opens/focuses Problems but does not alter Active.
- Core offline does not destroy unsaved local buffer.
- Commission is not performed from hidden editor side effects.
- Active view is read-only.
- Unsupported syntax returns stable diagnostic; UI must not crash.

## 11. Keyboard

Minimum:
`Ctrl/Cmd+S`, `Ctrl/Cmd+F`, `Ctrl/Cmd+H`, `Ctrl/Cmd+Z/Y`,
`F8`, `Shift+F8`, `F12`, `Shift+F12`, `Ctrl/Cmd+P`.

No single-key shortcut for Commission.

## 12. Responsive

`<768 px`: source is read-only; no ST/FBD edit.  
Tablet: POU Tree and Inspector may become collapsible drawers.

## 13. Acceptance criteria

- `AC-PGM02-01` exactly one POU tree.
- `AC-PGM02-02` editor visible without page scroll at 1280×750.
- `AC-PGM02-03` Save does not change Active.
- `AC-PGM02-04` Check failure leaves Active running.
- `AC-PGM02-05` Problems jump to source/node.
- `AC-PGM02-06` FBD is real node-edge canvas.
- `AC-PGM02-07` online values never imply write/force.
- `AC-PGM02-08` inspector collapses when not useful.
- `AC-PGM02-09` mobile editing is blocked but read-only works.
