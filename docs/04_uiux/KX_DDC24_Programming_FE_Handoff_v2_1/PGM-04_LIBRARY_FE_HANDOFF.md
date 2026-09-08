# PGM-04 — Control Library — FE Handoff

**Route canonical:** `/eng/programming/projects/:projectId/library`<br>
**Authority trực quan:** [`assets/PGM-04_library.png`](assets/PGM-04_library.png) + [`assets/pgm04-visual-spec.html`](assets/pgm04-visual-spec.html) theo `AUTH-UX-PROG-2026-09-08-01`<br>
**Giới hạn bằng chứng:** Target visual; không phải As-Built/runtime evidence.<br>
**Primary goal:** Find, understand, reuse and manage control blocks without manually opening source just to know block interface or usage.

## 1. Information architecture

Tabs:
- Core Library
- Project Library
- User Library chỉ là future visual affordance; ẩn/disabled cho tới khi Product,
  domain và API có authority. Rev A chỉ có `SYSTEM` (`Core`) và `PROJECT`.

Filters:
`Category | Type | Search | Filter`

Main:
- block/function cards in dense grid/list

Right Inspector:
`Details | Parameters | Used In | Versions/Documentation` as supported.

Create/Edit is opened on demand from button/drawer; form must not remain permanently open.

## 2. Block card content

Required:
- name
- FUNCTION / FUNCTION_BLOCK
- category
- version
- concise I/O signature
- short description
- source library
- usage count (`Used in N Programs`)
- deprecated/compatibility marker if supplied

Example signature:
`IN: SP REAL, PV REAL → OUT: CV REAL`

## 3. Inspector

### Details
- type
- category
- source
- version
- description

### Interface / Parameters
- inputs
- outputs
- parameters
- datatype
- optional/required/default only if authoritative metadata exists

### Used In
- list Programs/POUs
- click → PGM-02 exact reference

### Versions
- version
- status
- change summary
- compatibility/deprecated state if available

## 4. Insert/open behavior

When PGM-04 is opened standalone:
- `Preview/Open` is always allowed if permitted to view.
- `Insert Block` requires an active compatible editor context; otherwise ask user to select/open a target POU.

Do not silently create a POU or mutate draft.

## 5. Create block flow

Admin only.

Drawer/wizard:
1. metadata
2. interface
3. implementation
4. validation/check
5. save/publish to Project/User library

Core Library is read-only.

## 6. Version safety

- Existing Program references must not silently move to incompatible versions.
- Version change is explicit and appears in Draft change/Commission impact.
- Deprecated blocks remain readable and show migration guidance if supplied.

## 7. Search

Search should cover:
- block name
- category
- description
- I/O names/types
- tags if contract has tags

Keep filter/search state when returning from details.

## 8. Empty/error states

- no search result → clear filters action
- project/user library empty → Create Block for admin
- library service unavailable → error, not empty
- block detail unavailable → keep list usable

## 9. Accessibility/keyboard

- arrow/tab navigation through cards/list
- Enter opens selected block
- Inspector focus does not trap
- Create drawer validates with field-level messages

## 10. Acceptance criteria

- `AC-PGM04-01` block signature visible before opening detail.
- `AC-PGM04-02` usage count and Used In are navigable.
- `AC-PGM04-03` create form is on-demand, not always visible.
- `AC-PGM04-04` Core library cannot be edited.
- `AC-PGM04-05` no silent incompatible library version upgrade.
- `AC-PGM04-06` standalone Insert requires explicit target context.
