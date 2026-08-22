# PGM-01 — Overview — FE Handoff

**Route:** `/eng/programming`  
**Reference:** `assets/PGM-01_overview.png`  
**Primary goal:** In ≤5 seconds, the engineer knows system health, Draft vs Active, which Programs run, what blocks progress, and the next action.

## 1. Page composition

1. Shared Context Strip.
2. `SystemHealthHero`
3. `DraftActiveCompareCard`
4. `NeedsAttentionCard`
5. `ProgramsSummaryTable`
6. `QuickActions`

Desktop layout:
- top summary: 3 cards in one row.
- programs table: full width.
- quick actions: full width, low visual priority.
- main content should fit comfortably at 1280×750 without forcing important content below first viewport.

## 2. Visible information

### System Health
- controller/core connectivity
- runtime state
- safe-state/fault state when available
- last authoritative update timestamp

### Draft vs Active
- Draft revision
- Dirty / Checked / Check failed
- Active revision
- Running/Stopped/Fault
- change count only if backend provides authoritative change summary
- `Compare` action

### Needs Attention
Sorted by severity:
1. blocking/fault
2. warning
3. info

Each item needs:
`severity + human message + target entity + deep-link`

### Programs table
Columns:
`Program | Language | Cycle | Runtime State | Last Exec | Health`

Do not expose CPU/core in Overview.

## 3. Primary action logic

Exactly one visually primary CTA:

| State | Primary CTA |
|---|---|
| Draft dirty | Continue Editing |
| Check failed | Fix Check Errors |
| Draft checked, Active differs | Review Changes |
| Ready to commission | Commission |
| No pending change | Open Runtime |

FE derives CTA only from explicit server states, never from local guesses.

## 4. Interactions

- Click Program → open PGM-02 with selected POU.
- Click Attention item → deep-link to Programs/Mapping/Commission/Runtime.
- Compare → open revision compare surface/drawer.
- Details → raw revision IDs and technical state.
- Refresh is secondary and must preserve current context.

## 5. Required FE view model

```ts
type ProgrammingOverviewVM = {
  projectName: string;
  draft: { revision: string; dirty: boolean; checkState: string };
  active: { revision: string | null; runtimeState: string };
  core: { state: string; updatedAt?: string };
  safeState?: string;
  programs: Array<{
    id: string; name: string; language: "ST"|"FBD";
    cycleMs?: number; state: string; health: string;
    lastExecAt?: string;
  }>;
  attention: Array<{
    id: string; severity: "fault"|"warning"|"info";
    message: string; entityType?: string; entityId?: string;
    targetRoute?: string;
  }>;
};
```

This is a **view-model suggestion**, not API contract.

## 6. State handling

- **Loading:** skeleton matching final card/table geometry.
- **No project/program:** explain and show `Create Program` only to permitted user.
- **Core offline:** persistent banner; editing may remain available, Commission disabled.
- **Runtime unavailable:** show `Unknown`, not zero or `Stopped`.
- **Draft==Active:** collapse compare card to “No pending commissioned changes”.
- **Permission denied:** keep read-only information visible; hide/disable mutation CTA with explanation.

## 7. Responsive

`<768 px`:
- cards stack.
- program table converts to compact rows/cards.
- max 4 bottom-nav destinations: Overview / Runtime / Check / More.
- no horizontal UUID content.

## 8. Acceptance criteria

- `AC-PGM01-01` UUID not visible in default view.
- `AC-PGM01-02` Draft and Active both visible when different.
- `AC-PGM01-03` attention item deep-links to the owning page.
- `AC-PGM01-04` no missing runtime data rendered as numeric zero.
- `AC-PGM01-05` one and only one primary CTA.
- `AC-PGM01-06` viewer/operator cannot mutate through UI or keyboard shortcuts.

## 9. FE implementation tasks

- Build route container + data orchestration.
- Create/extend shared Context Strip.
- Implement health/attention/program summary components.
- Implement CTA resolver as pure tested function.
- Add empty/offline/error/permission states.
- Add E2E for Draft≠Active, Core offline, attention deep-link.
