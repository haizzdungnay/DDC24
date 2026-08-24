# PGM-02A — ST Editor Workspace — FE Handoff v2.2

**Parent:** `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md`  
**Route:** `/eng/programming/programs`  
**POU language:** `ST`  
**Visual reference:** `assets/PGM-02A_ST_editor_reference.png`

## 1. Product goal

Make ST usable by a controls engineer who knows control logic but should not have to memorize every library call, instance syntax or navigation command.

ST page must combine:

`POU Explorer + code editor + Quick Library + Inspector + Problems/Watch/Trace/References`

without turning into a generic web form.

## 2. Desktop target

```text
┌ POU Explorer ┬ ST Editor ─────────────────────┬ Quick Library ┬ Inspector ┐
│              │ tabs + editor toolbar          │               │           │
│              │ source code                    │               │           │
├──────────────┴────────────────────────────────┴───────────────┴───────────┤
│ Problems | Watch | Trace | Search | Cross Reference                       │
└────────────────────────────────────────────────────────────────────────────┘
```

At 1280–1439 px, Quick Library and Inspector share one right dock.

## 3. ST toolbar

EDIT:
`Save | Undo | Redo | Find | Format | Check | Compare | SIMULATE | LIVE | More`

SIMULATE:
`Pause/Run | Step | Reset | Speed | Stop Simulation | Watch | Trace`

LIVE:
`LIVE Active r15 | Pause Refresh | Watch | Trace | Return to Draft`

Commission does not become a hidden editor action.

## 4. ST editor minimum capability

Required:
- line numbers
- syntax highlighting
- current line
- bracket matching
- auto-indent
- undo/redo
- find/replace
- autocomplete
- type-aware completion when compiler metadata supports it
- hover symbol/type/signature
- go-to-definition
- find references
- inline diagnostics
- jump from Problems
- formatting
- dirty state
- read-only Active source
- simulation value overlay
- live runtime overlay

Unsupported syntax must produce stable diagnostics; editor must not crash.

## 5. Quick Library behavior — ST specific

### 5.1 Card content

Each item shows:
- name
- FUNCTION / FUNCTION_BLOCK
- short description
- concise signature
- category
- stateful marker
- source: Core / Project / User
- favorite action

Examples:

`PID — FB — SP REAL, PV REAL → OUT REAL`  
`TON — FB — IN BOOL, PT TIME → Q BOOL, ET TIME`  
`LIMIT — FUNCTION — MIN REAL, IN REAL, MAX REAL → REAL`

### 5.2 Insert FUNCTION

For stateless functions such as `LIMIT`:

1. click library item;
2. insert call template at cursor;
3. select first editable placeholder;
4. whole insertion is one Undo transaction.

Example:

```st
valve_cmd := LIMIT(
    MN := 0.0,
    IN := pid_out,
    MX := 100.0
);
```

Names must follow actual compiler/library signature, not guessed UI aliases.

### 5.3 Insert FUNCTION_BLOCK

For stateful FB such as `TON` or `PID`:

If compatible instance exists:
- user may select existing instance.

If no instance exists:
- open lightweight `Create Instance` popover:
  - suggested name
  - scope
  - retained only when the block/runtime supports it
- on confirm:
  1. add declaration;
  2. insert call;
  3. perform as one logical undoable command if architecture allows.

This is the key UX improvement: user chooses **what control block they need**, not memorizes declaration + invocation syntax.

### 5.4 Context-aware ranking

Deterministic ranking is allowed using:
- selected symbol datatype;
- expected call context;
- recent/favorites;
- category.

Do not present speculative AI-generated blocks as authoritative library content.

### 5.5 More blocks

`+ More blocks…` opens PGM-04 and returns to current POU/cursor context if routing architecture supports it.

## 6. EDIT mode behavior

- source = Draft.
- Admin can edit.
- viewer/operator read-only.
- Quick Library active.
- Save changes Draft only.
- Check produces Draft diagnostics.
- Compare may open Draft↔Active or Draft↔LKG.

If Core goes offline while editing:
- keep local buffer;
- clearly mark server save/check capability unavailable;
- never discard edits automatically.

## 7. SIMULATE mode — ST

Banner:

`● SIMULATION — Draft r17 — NO REAL OUTPUT`

Simulation controls:
`Run | Pause | Step 1 Cycle | Reset | Speed`

Right dock defaults to `Simulation I/O`.

### Simulation I/O table

`Variable/Point | Value | Unit | Quality/Source | Edit`

Only approved virtual inputs are editable.

Output/watch variables are read-only.

### ST value overlay

Examples:
- inline end-of-line value annotation;
- hover values;
- pinned variables in Watch.

Do not rewrite source text with runtime values.

### Dirty source rule

If Draft is dirty:
- simulation start is blocked by explicit prompt:
  `Save Draft before simulation`.
- no silent autosave.
- no simulation from stale revision without telling user.

## 8. LIVE mode — ST

Banner:

`● LIVE — Active r15 — DDC-24-01 ONLINE — READ ONLY`

Rules:
- source switches to Active revision.
- editor becomes read-only.
- Quick Library hidden/disabled.
- live values displayed from controller.
- stale/offline values explicitly marked.
- no source patch.
- no implicit Force/Write.

If user clicks `Edit Draft`:
- exit LIVE;
- return to Draft source;
- live overlay removed.

## 9. Inspector — ST

When cursor/selection is on symbol:
- symbol name
- type
- scope
- declaration
- mapping
- simulation/live value
- references

When cursor is on library call:
- function/FB signature
- documentation
- instance info
- parameters
- Used In / references

## 10. Bottom Workbench — ST

Problems:
- exact line/column
- severity
- human message
- stable code

Cross Reference:
- declaration
- reads
- writes
- mapped point
- used by
- runtime value according mode

Watch:
- mode-aware value source:
  - Simulation → simulated runtime
  - Live → controller runtime

Trace:
- only when capability exists.

## 11. Suggested components

```text
STEditorWorkspace
├── STEditorToolbar
├── STCodeEditor
├── STDiagnosticsAdapter
├── STLibraryInsertionAdapter
├── STRuntimeDecorationLayer
└── STCursorContextAdapter
```

Quick Library itself remains shared.

## 12. Acceptance criteria — ST

- `AC-ST-001` Quick Library inserts a FUNCTION call in ≤2 actions after search.
- `AC-ST-002` inserting stateful FB can create/select instance without manual declaration memorization.
- `AC-ST-003` library insertion is undoable as one logical operation.
- `AC-ST-004` Save never changes Active.
- `AC-ST-005` Check diagnostics jump to exact source range.
- `AC-ST-006` SIMULATE uses Draft only and shows `NO REAL OUTPUT`.
- `AC-ST-007` LIVE displays Active source, never mismatched Draft.
- `AC-ST-008` LIVE is read-only and cannot write/force.
- `AC-ST-009` stale live data is visually distinct from valid data.
- `AC-ST-010` unsupported compiler construct does not crash editor.
- `AC-ST-011` viewer/operator cannot mutate source through keyboard or paste.
