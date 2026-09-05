# PGM-03 — Points & Mapping — FE Handoff

> **SUPERSEDED cho route và bố cục trực quan từ 2026-09-06.** Nội dung nghiệp
> vụ và `AC-PGM03-*` bên dưới được giữ làm đầu vào migration. Authority hiện
> hành là [`UX-WEB-PROG-001` §2/§3.3](../PROGRAMMING_UI_UX_DESIGN.md#2-information-architecture),
> issue `#554..#558` và asset SVG chuẩn nêu dưới đây. Không dùng bố cục hai pane
> hoặc ảnh PNG cũ làm acceptance authority.

**Route canonical:** `/eng/programming/projects/:id/mapping`

**Reference chuẩn:** [`PGM-03_MAPPING_SIGNALS_DESKTOP.svg`](../assets/programming/PGM-03_MAPPING_SIGNALS_DESKTOP.svg)

**Reference cũ:** `assets/PGM-03_mapping.png` — chỉ để truy xuất lịch sử, không có authority
**Primary goal:** Map logical Program variables to canonical controller/network points quickly and safely, with live value and quality visible.

## 1. Layout

Ba vùng chuẩn:

- variable/signal consumer;
- point catalog/filter;
- binding/output-owner inspector.

Toolbar, row density, split ratio và responsive state theo asset chuẩn và
`UX-WEB-PROG-001`; issue `#556` sở hữu việc triển khai bố cục.

The page should feel like a mapping workspace, not a generic CRUD table.

## 2. Variable row

Required:
`Variable | Type | Direction | Mapping | Live Value | Quality`

Explicit statuses:
- mapped
- unmapped
- incompatible
- stale/offline source

## 3. Point row

Required:
`Point | Description | Source | Type | Value | Unit | Quality | Writable`

Source may be physical I/O, virtual point, Modbus/BACnet/etc. only when backend supplies it.

Do not invent `%IX/%QX` addresses when backend model does not provide them.

## 4. Mapping actions

Primary flow:
1. select variable
2. compatible points are ranked/highlighted
3. select point
4. review
5. assign

Drag/drop may exist as shortcut but is not the only path.

### Suggestion ranking
If backend/FE provides suggestions, rank using available metadata:
1. direction
2. datatype
3. unit
4. naming similarity
5. same source/device context

Suggestion is advisory only; never auto-commit.

## 5. Validation rules to surface

- datatype mismatch
- direction mismatch
- writable output → read-only point
- missing/deleted point
- exclusive duplicate binding
- unit policy warning
- point offline/stale warning according to policy

FE displays backend validation result; it must not silently override authority.

## 6. Mapping Inspector / Drawer

Selected binding:
- logical variable
- canonical point
- source/device
- datatype
- direction
- unit
- current live value
- quality
- writable
- optional scale/invert/fallback only if contract supports them

## 7. Empty/error states

### No variables
Explain that the Program has no mappable I/O variables.

### Variables but none mapped
Show count + `Start Mapping`.

### Point catalogue unavailable
Persistent error; do not show empty as if there are zero points.

### Live stream lost
Keep mapping identity, mark value `Stale/Offline`.

## 8. Suggested FE view model

```ts
type MappingVM = {
  variables: Array<{
    id:string; name:string; type:string; direction:"IN"|"OUT"|"IN_OUT";
    binding?: { pointId:string; pointName:string };
    value?: unknown; quality?: string;
  }>;
  points: Array<{
    id:string; name:string; description?:string; source?:string;
    type:string; direction?:string; unit?:string;
    writable?:boolean; value?:unknown; quality?:string; updatedAt?:string;
  }>;
};
```

## 9. Permissions

viewer/operator:
- view mapping
- live values/quality
- no assign/remove

admin:
- assign/remove/change
- Check after changes

## 10. Acceptance criteria

- `AC-PGM03-01` unmapped variable is obvious without relying on color alone.
- `AC-PGM03-02` mapping can be completed with mouse **or keyboard/click flow**.
- `AC-PGM03-03` output→read-only mapping is rejected/blocked.
- `AC-PGM03-04` stale point never renders as healthy zero.
- `AC-PGM03-05` assigned mapping list reflects authoritative state after mutation.
- `AC-PGM03-06` quality uses semantic GOOD/WARN/FAULT/UNKNOWN styling.
- `AC-PGM03-07` no invented point/address model.

## 11. FE tasks

- Split workspace + synchronized selection.
- Compatibility/suggestion presentation.
- Mapping mutation state and authoritative re-fetch.
- Assigned mapping summary.
- Live value/quality subscription.
- Deep-link from variable to PGM-02 source.
- E2E: successful map, incompatible map, offline catalogue, permission denied.

## 12. Ánh xạ acceptance hiện hành

Các AC này không tự chứng minh implementation đã đạt. Test hiện có chỉ là bằng
chứng HOST hỗ trợ; các issue mở ở cột cuối là gate phải đóng.

| AC cũ | Requirement/use case authority | Test/source hiện có | Trạng thái và gate |
|---|---|---|---|
| `AC-PGM03-01` | `UX-REQ-020/022`, `UJ-PROG-05` | `MappingWorkbench.test.tsx` | As-Built một phần; `#558` phải khóa trạng thái không phụ thuộc màu |
| `AC-PGM03-02` | `UX-REQ-022`, `UJ-PROG-05` | `MappingTab.test.tsx`, `MappingWorkbench.test.tsx` | Target; `#555` phải có mutation keyboard/click và read-back |
| `AC-PGM03-03` | `UX-REQ-006`, `UJ-PROG-05` | `mappingViewModel.test.ts`, `MappingTab.test.tsx` | Target; `#554` phải chứng minh server preview/write/check cùng luật |
| `AC-PGM03-04` | `UX-REQ-005/020`, `UJ-PROG-05` | `mappingViewModel.test.ts` | As-Built một phần; `#558` phải giữ unknown/stale fail-closed |
| `AC-PGM03-05` | `UX-REQ-006/020`, `UJ-PROG-05` | `MappingTab.test.tsx` | Target; `#555` phải refetch authoritative state sau mutation |
| `AC-PGM03-06` | `UX-REQ-020/022`, `UJ-PROG-05` | `pointSourceLabels.test.ts`, `MappingWorkbench.test.tsx` | As-Built một phần; `#558` phải khóa copy/icon/focus/a11y |
| `AC-PGM03-07` | `UX-REQ-006`, `UJ-PROG-05` | `mappingViewModel.test.ts` | Target; `#554` phải khóa canonical identity và không dựng address |

## 13. Gate và điều kiện mở khóa

| Issue | Owner | Ảnh hưởng khi còn mở | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `#554` | BE + FE + Compiler | Mutation không có một authority fail-closed | Preview/write/Check parity | OpenAPI ổn định, test positive/negative/fault cùng mã lỗi |
| `#555` | FE + BE | Người dùng chưa thể map/remove an toàn | Phụ thuộc `#554` | Mutation ETag/idempotency, read-back và E2E permission/conflict |
| `#556` | UX + FE | Bố cục ba vùng chưa đạt asset chuẩn | Visual/responsive | Bằng chứng desktop/mobile/tablet đủ state và không tràn |
| `#557` | BE + Compiler + FE | Published Signal chưa có source authority | Typed read model | Provenance/freshness/consumer và Check diagnostic cùng contract |
| `#558` | FE + QA | Row/toolbar/focus/a11y chưa đạt | Phụ thuộc `#555`, phối hợp `#556` | Interaction test, keyboard/focus và a11y evidence PASS |
