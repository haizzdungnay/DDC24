# KX-DDC24 Programming — FE Handoff Package v2.2

**Status:** TARGET FE HANDOFF — AUTHORIZED FOR IMPLEMENTATION BY `AUTH-PROG-2026-08-24-05`; NOT AS-BUILT / NOT RUNTIME EVIDENCE<br>
**Formal PGM-02 Detailed Design authority:** [PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md](../../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md)<br>
**Product:** MK-DDC-24 Generic DDC/BACS Controller  
**Programming languages Rev A:** ST + FBD  
**Primary pages:** PGM-01..PGM-06  
**Primary user journey:** `Overview → Programs → Mapping → Check & Commission → Runtime`  
**Library:** supporting workspace, accessible throughout engineering flow.

## 1. Source baseline

Package này ghi nhận hướng thiết kế Target và đã được Owner + System Architect
exact-pin tại Candidate `413a043748dce3b44d2c5076412de761760ba17a` để triển
khai tuần tự `R1 EDIT → R2 LIVE → R3 SIMULATE`. Nó không tự chứng minh năng lực
As-Built/runtime, Test Result, target/HIL hoặc release.

- A Program is a user-facing independent control unit.
- Normal users do not manage CPU core/thread/task directly.
- `Save Draft ≠ Check ≠ Commission ≠ Active ≠ Running`.
- Draft and Active are always visually separated.
- Failed Check/Commission never removes the valid Active/LKG runtime.
- ST and FBD are first-class editor modes.
- Point mapping uses canonical controller points; missing/stale data never becomes valid zero.
- Commission remains fail-closed and must verify authoritative runtime read-back.
- UUID/raw internal IDs are available through technical details, not primary UI.
- Mobile `<768 px`: monitoring/read-only; ST/FBD editing is not supported.

## 2. Canonical navigation

| Page | Route | Name |
|---|---|---|
| PGM-01 | `/eng/programming` | Overview |
| PGM-02 | `/eng/programming/programs` | Programs |
| PGM-03 | `/eng/programming/mapping` | Points & Mapping |
| PGM-04 | `/eng/programming/library` | Control Library |
| PGM-05 | `/eng/programming/commission` | Check & Commission |
| PGM-06 | `/eng/programming/runtime` | Runtime & Diagnostics |

Existing canonical routes and deep links SHALL be preserved.

## 3. Shared shell contract

Desktop:

```text
┌ Feature Rail 220 ┬ Context Strip / Toolbar ────────────────────────────┐
│                  ├ Main workspace ───────────────────────┬ Inspector  │
│                  │                                      │ 280–320px  │
│                  ├ Bottom panel, when applicable ───────┴─────────────┤
└──────────────────┴─────────────────────────────────────────────────────┘
```

### Context Strip
Target height: **36–40 px**, sticky.

Required visible fields:
- Project/controller friendly name.
- Draft revision + dirty/check state.
- Active revision + runtime state.
- Core/controller connection.
- Number of running programs or relevant health summary.

Raw IDs are hidden by default and exposed from **Details** popover with Copy action.

### Shared semantic states
`good | warning | fault | unknown | stale | disabled | reconciling`

Rules:
- Color is never the only signal.
- `unknown/stale/offline` must be explicit.
- FE must not manufacture missing values.
- Server/runtime state is authoritative.
- No optimistic update of Active/Commission success.

## 4. Shared RBAC

| Capability | viewer | operator | admin |
|---|:---:|:---:|:---:|
| View programming/runtime | ✓ | ✓ | ✓ |
| Read source | ✓ | ✓ | ✓ |
| Online monitor | ✓ | ✓ | ✓ |
| Edit ST/FBD | ✕ | ✕ | ✓ |
| Edit mapping/library/project config | ✕ | ✕ | ✓ |
| Check | ✕ | ✕ | ✓ |
| Commission/restore/reset retained | ✕ | ✕ | ✓ |

Server is the authority. FE permission gating is convenience only.

## 5. Shared FE rules

1. Do not hardcode undocumented endpoints.
2. Consume typed generated clients/contracts when available.
3. Separate FE state at minimum into:
   - Draft state
   - Validation/check state
   - Commission state
   - Runtime state
   - Online monitor state
4. Mutation success must use response body / re-fetch authoritative state.
5. Timeout is **UNKNOWN/RECONCILING**, never inferred success.
6. Every page must implement: Loading, Empty, Normal, Error, Offline, Permission denied.
7. Engineering actions are keyboard reachable.
8. One route = one `<h1>`.
9. Shared error pattern: human message first, technical code second.
10. The visual reference images in `/assets` are layout references, not pixel-perfect screenshots to copy blindly.

## 6. Delivery Definition of Done

Each page is DONE only when:
- FE unit tests pass.
- route-level E2E pass.
- keyboard navigation works.
- responsive behavior verified at 1280×750 and 390 px.
- light/dark contrast tests pass.
- error/empty/offline states are implemented.
- permission matrix is tested.
- no regression to Draft/Active semantics.

## 7. PGM-02 leadership review package

- [PGM-02 Programs Workspace v2.2](PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md)
- [PGM-02A ST Editor v2.2](PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md)
- [PGM-02B FBD Editor v2.2](PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md)
- [Quick Library / SIMULATE / LIVE Target contract v2.2](PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md)
- [Visual combined desktop + mobile read-only](assets/PGM-02_ST_FBD_combined_reference.svg)
- [Visual ST Editor và required states](assets/PGM-02A_ST_editor_reference.svg)
- [Visual FBD Editor và required states](assets/PGM-02B_FBD_editor_reference.svg)
- [Rà soát kiến trúc và khoảng trống PGM-02 ST/FBD](reviews/PGM02_ST_FBD_REDESIGN_IMPLEMENTATION_REVIEW.md)
- [Kế hoạch triển khai đề xuất PGM-02 ST/FBD](reviews/PGM02_ST_FBD_IMPLEMENTATION_PLAN.md)

Ngày 2026-08-24, Product Owner/CTO + System Architect ban hành
`AUTH-PROG-2026-08-24-05`, hoàn tất `PGM02-V22-WP-00`, mở quyền implementation
cho cả ba increment và giữ Simulation v1 admin-only. Plan59 vẫn là scheduler duy
nhất: chỉ `T59-802` READY, task sau đợi predecessor. `RELEASE_READY` giữ NO-GO.
