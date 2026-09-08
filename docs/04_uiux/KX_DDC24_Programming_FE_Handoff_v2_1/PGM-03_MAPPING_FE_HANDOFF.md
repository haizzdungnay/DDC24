# PGM-03 — Points & Mapping — FE Handoff

> **AUTHORITY TRỰC QUAN từ 2026-09-08.** Theo quyết định trực tiếp của chủ sở
> hữu sản phẩm, bố cục và thứ bậc thông tin của màn hình này lấy từ ảnh
> [`assets/PGM-03_mapping.png`](assets/PGM-03_mapping.png). Bộ SVG Programming
> song song trước đây đã bị loại vì không đúng thiết kế mong muốn. Nội dung
> nghiệp vụ, safety, contract và `AC-PGM03-*` trong hồ sơ này cùng
> [`UX-WEB-PROG-001`](../PROGRAMMING_UI_UX_DESIGN.md) tiếp tục là ràng buộc;
> ảnh không phải bằng chứng As-Built/runtime.

**Route canonical:** `/eng/programming/projects/:id/mapping`

**Reference chuẩn:** [`assets/PGM-03_mapping.png`](assets/PGM-03_mapping.png)

**Quyết định thay thế:** `AUTH-UX-PROG-2026-09-08-01`; issue `#556` đóng
`NOT_PLANNED` vì xuất phát từ bố cục SVG không còn hợp lệ.
**Primary goal:** Map logical Program variables to canonical controller/network points quickly and safely, with live value and quality visible.

## 1. Layout

Bố cục desktop chuẩn là **hai vùng trên + một bảng toàn chiều rộng phía dưới**:

1. `Program Variables` ở nửa trên bên trái;
2. `Available Points` ở nửa trên bên phải;
3. `Assigned Mappings` chạy toàn chiều rộng bên dưới hai vùng trên.

Feature rail, context strip, tiêu đề `PGM-03 Points & Mapping`, toolbar và status
bar phải giữ đúng thứ bậc của ảnh chuẩn. Inspector chi tiết binding/output owner
chỉ mở theo selection bằng drawer/panel theo ngữ cảnh; không được chiếm một cột
thứ ba thường trực và làm biến dạng bố cục `2 + 1`. Published Signal vẫn phải
truy cập được bằng tab/action theo ngữ cảnh nhưng không thay bảng Assigned
Mappings. Row density, split ratio và responsive state được chốt trong bước
triển khai/browser review từ chính ảnh chuẩn và các quy tắc a11y của
`UX-WEB-PROG-001`.

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
| `#557` | BE + Compiler + FE | Published Signal chưa có source authority | Typed read model | Provenance/freshness/consumer và Check diagnostic cùng contract |
| `#558` | FE + QA | Row/toolbar/focus/a11y chưa đạt | Phụ thuộc `#555`; visual theo authority mới | Interaction test, keyboard/focus và a11y evidence PASS trên bố cục `2 + 1` |

`#556` không còn là gate: issue đã đóng `NOT_PLANNED` ngày 2026-09-08 vì yêu
cầu bố cục ba cột dựa trên asset sai. Nếu cần triển khai visual parity mới, task
phải dẫn `AUTH-UX-PROG-2026-09-08-01` và ảnh `PGM-03_mapping.png`, không khôi
phục asset SVG đã loại.
