# PGM-02B — FBD Editor Workspace — FE Handoff v2.2

**Parent:** `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md`  
**Evidence class:** `TARGET DESIGN — NOT AS-BUILT / NOT RUNTIME EVIDENCE`<br>
**Route:** `/eng/programming/programs`  
**POU language:** `FBD`  
**Visual reference:** [PGM-02B FBD Editor Target](assets/PGM-02B_FBD_editor_reference.svg)<br>
**Target contract supplement:** [PGM-02 Quick Library / SIMULATE / LIVE v2.2](PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md)<br>
**Formal Detailed Design authority:** [PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md](../../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md)

## 1. Product goal

FBD must be a real engineering canvas where a user can build control logic quickly from reusable blocks without memorizing the entire Control Library.

The primary interaction is:

`Find block → place block → connect typed ports → configure → Check → Simulate/Live review`

## 2. Desktop target

```text
┌ POU Explorer ┬ FBD Canvas ────────────────────┬ Quick Library ┬ Inspector ┐
│              │ toolbar / canvas               │               │           │
│              │ node-edge logic                │               │           │
├──────────────┴────────────────────────────────┴───────────────┴───────────┤
│ Problems | Watch | Trace | Search | Cross Reference                       │
└────────────────────────────────────────────────────────────────────────────┘
```

At 1280–1439 px, Quick Library and Inspector share the right dock.

## 3. FBD canvas minimum capability

Required:
- pan
- zoom
- fit-to-view
- grid
- snap
- block drag
- typed ports
- typed connections
- deterministic connection validation
- visible wires not hidden under blocks
- connection delete
- multi-select
- copy/paste
- undo/redo
- align/distribute
- keyboard selection/delete
- minimap for large diagrams
- diagnostic markers on nodes/wires
- simulation/live overlays

Do not add decorative wire animation. Use value badges/highlights only where informative.

## 4. Quick Library behavior — FBD specific

### 4.1 Sections

- Recent
- Favorites
- Common
- HVAC
- Logic
- Math
- Timer
- Counter
- Signal
- Project
- Variables / I/O
- Constants

### 4.2 Block card

Show:
- block name
- FUNCTION/FB
- concise I/O signature
- short description
- stateful marker
- source library
- favorite

### 4.3 Place block

Two supported paths:

**Drag & drop**
- drag card to canvas.

**Click to place**
- select card;
- preview ghost follows pointer or places at canvas center/next free location;
- Esc cancels.

Keyboard path must exist.

### 4.4 Smart insertion from selected port

When a port/wire endpoint is selected:
- Quick Library may filter/rank blocks with compatible datatype/direction.
- If the inserted block has one unambiguous compatible port, FE may offer `Insert and connect`.
- Never auto-connect ambiguous ports without confirmation.

This is deterministic type assistance, not AI inference.

### 4.5 INPUT / OUTPUT / CONSTANT nodes

Quick Library must include fast creation for:
- Program variable input/reference
- Program output/reference
- Constant

If a variable is selected from a picker:
- create corresponding node;
- preserve canonical variable identity;
- do not create hidden point mapping automatically.

### 4.6 Full library

`+ More blocks…` opens PGM-04, preserving return context when possible.

## 5. Block creation and model boundary

All canvas mutations should go through existing/approved FBD commands/domain:

- AddBlock
- MoveBlock
- SetParameter
- Connect
- Disconnect
- Delete
- MultiMove
- etc.

FE render layer SHALL NOT create a second shadow FBD model.

Library insertion is an adapter that creates valid domain commands.

## 6. EDIT mode — FBD

- canvas = Draft.
- Quick Library active.
- Inspector editable by Admin.
- invalid wire blocked immediately.
- Check diagnostics visible on canvas + Problems.

Changes remain Draft until Commission.

## 7. SIMULATE mode — FBD

Banner:

`● SIMULATION — Draft r17 — NO REAL OUTPUT`

Canvas becomes runtime review surface for simulation session.

Required overlays:
- input values on variable nodes
- output values on block ports
- output values on output nodes
- state badges for timers/counters/FBs when available
- quality/source distinction

Simulation controls:
`Run | Pause | Step 1 Cycle | Reset | Speed`

Right dock defaults to `Simulation I/O`; Inspector remains available as a tab.

Do not continuously animate every wire. Prefer:
- selected path values;
- changed values;
- status badges;
- optional subtle active-state emphasis.

### Dirty Draft rule

Simulation requires explicit saved Draft snapshot. Do not silently run old graph while presenting it as current.

## 8. LIVE mode — FBD

Banner:

`● LIVE — Active r15 — DDC-24-01 ONLINE — READ ONLY`

Rules:
- canvas loads Active revision topology.
- all edit handles disabled.
- Quick Library disabled/hidden.
- controller values overlay on nodes/ports/wires.
- stale/offline explicit.
- no Force/Write through canvas.
- `Return to Draft` exits LIVE.

If Active topology differs from Draft, do not show Draft graph with Active values.

## 9. Inspector — FBD

Block selected:
- instance name
- type
- description
- parameters
- retained
- inputs/outputs
- simulation/live values according mode
- references

Port selected:
- datatype
- direction
- current value/quality
- connected endpoint

Wire selected:
- source
- destination
- datatype
- value/quality
- disconnect action in EDIT only

## 10. Diagnostics

Examples:
- incompatible datatype
- invalid fan-in
- required input unconnected
- cycle/topology rule violation
- missing block/library dependency
- invalid parameter

Diagnostics appear:
1. marker on block/wire;
2. Problems panel;
3. click Problems → focus/select canvas entity.

## 11. Online/Simulation performance

Runtime overlays must not trigger full-canvas React re-render for every value update.

Recommended:
- separate overlay/value layer;
- keyed value store;
- throttle visual updates where appropriate;
- preserve authoritative timestamps/quality.

The canvas model/topology should not mutate when only runtime values change.

## 12. Suggested components

```text
FBDCanvasWorkspace
├── FBDToolbar
├── FBDViewport
├── FBDNodeRenderer
├── FBDWireRenderer
├── FBDSelectionController
├── FBDLibraryInsertionAdapter
├── FBDDiagnosticsLayer
└── FBDRuntimeOverlayLayer
```

Quick Library and Inspector remain shared shell components.

## 13. Acceptance criteria — FBD

- `AC-FBD-001` FBD is a true node-edge canvas.
- `AC-FBD-002` block can be found and placed from Quick Library without memorizing name taxonomy.
- `AC-FBD-003` selected-port insertion filters compatible blocks.
- `AC-FBD-004` ambiguous auto-connect never occurs without user confirmation.
- `AC-FBD-005` Quick Library insertion creates valid domain commands and is undoable.
- `AC-FBD-006` invalid typed connection is blocked immediately.
- `AC-FBD-007` Problems jump to exact block/wire.
- `AC-FBD-008` SIMULATE displays Draft runtime with no physical outputs.
- `AC-FBD-009` LIVE loads Active topology and is read-only.
- `AC-FBD-010` Active runtime values are never painted onto mismatched Draft topology.
- `AC-FBD-011` runtime value refresh does not mutate FBD topology/model.
- `AC-FBD-012` minimap is available for diagrams above configured size threshold.
