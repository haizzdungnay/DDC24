# Thiết kế semantics điều khiển Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `DES-PROG-002` |
| Phiên bản | 0.1 |
| Trạng thái | `PROPOSED NORMATIVE / IN REVIEW — DESIGN NOT APPROVED` |
| Nguồn thiết kế | Product v2.2 §12.4/13/14.3/14.4/16.7; UX v2.2 §19.4 |
| Blocker | OD-PROG-002, OD-PROG-007, OD-PROG-009, OD-PROG-011, OD-PROG-012, OD-PROG-013, OD-PROG-014, OD-PROG-015 |

## Mục lục

1. Ranh giới authority
2. Resolver sáu mức và data model
3. Anti-windup hai chế độ
4. Hold-last mức 5
5. IOP safe timeout 200 ms
6. Overrun và plant safe-state
7. Ma trận type × Point × direction
8. Allowlist Point
9. Bundle source-only
10. Acceptance
11. Thuật ngữ
12. Lịch sử và phê duyệt

## 1. Ranh giới authority

Tài liệu này sở hữu semantics điều khiển candidate của Programming. Product/
UX/Feature chỉ trỏ sang đây, không định nghĩa lại. `IFSPEC-PROG-001` sở hữu tên
field/error; runtime architecture sở hữu base-step/cutover/resource isolation.

## 2. Resolver sáu mức và data model

Program đóng góp `Local logic` ở mức 5:

```text
1 Fire/Safety → 2 Local manual → 3 BACnet → 4 Schedule
→ 5 Local logic (Program) → 6 Default
```

Mỗi output binding phải có:

| Field | Nghĩa |
|---|---|
| `program_value` | Đóng góp mức 5 trước resolver. |
| `actual_value` | Giá trị hiệu lực sau resolver/interlock/giới hạn cuối. |
| `overridden_by` | Nguồn đang thắng mức 1–4 khi Program không có hiệu lực. |
| `effective_priority` | Priority của nguồn đang quyết định `actual_value`. |

`written_value` bị loại vì mơ hồ; không được dùng nếu không định danh rõ nguồn/trục.

## 3. Anti-windup hai chế độ

| Chế độ | Điều kiện | Hành vi bắt buộc |
|---|---|---|
| Mức 5 thắng nhưng bị clamp/saturation/rate-limit | Giới hạn nằm cùng đường lệnh mức 5 | PI/PID back-calculate theo chênh lệch trước/sau giới hạn cùng đường. |
| Mức 5 thua arbitration | Mức 1–4 đang quyết định `actual_value` | Freeze/hold integrator; cấm track/seed/back-calculate từ `actual_value` ngoại lai. |

Nguồn ưu tiên nhả quyền là transition policy riêng của resolver. Không claim
bumpless khi nhả nếu ramp/re-entry policy chưa có HIL evidence.

## 4. Hold-last mức 5

1. Ngay trước Activation/Restore, runtime phải chụp `previous_program_value` của
   Revision Active cho từng binding; `actual_value` chỉ để quan sát.
2. Revision mới chỉ phát mức 5 sau cycle đầu hoàn tất không fault; first
   `program_value` phải bằng `previous_program_value` trong độ phân giải binding.
3. Stateful block chỉ phục hồi state tương thích của cùng logic mức 5; nếu mức
   1–4 thắng thì integrator freeze, không seed actual.
4. Binding mới/state không tương thích phải yêu cầu initial/transition policy
   được duyệt; cấm âm thầm dùng actual, zero hoặc safe default.

Ví dụ chuẩn: Local manual giữ van 62%, Program đang là 41%. Revision mới phải
commit mức 5 đầu tiên 41%; `actual_value` vẫn 62%; integrator freeze. Không được
commit 62% vào Program. Khi override nhả, resolver transition policy xử lý riêng.

## 5. IOP safe timeout 200 ms

MCU tự ép AO/DO về safe nếu mất poll `IOP_SAFE_TIMEOUT_MS = 200 ms`, độc lập SOM.
Activation/Restore không được dừng/restart `mkddc-iobus`. Điều kiện:

- `max_iop_poll_gap <200 ms` bắt buộc;
- mục tiêu acceptance có margin `<=100 ms`;
- không có MCU safe-timeout transition trong Commission/Restore;
- không đạt thì Commission phải bị chặn và không claim bumpless.

## 6. Overrun và plant safe-state

Overrun là fault mức Task. Ba overrun liên tiếp phải fault/degrade đúng Task và
giữ last valid mức 5 hoặc fail policy binding đã duyệt. Nó không đủ để kích
plant safe-state. Toàn hệ chỉ safe khi SafetyManager xác nhận điều kiện độc lập
đã phê duyệt như mất I/O freshness, interlock hoặc không hoàn tất base step.
Compiler/Check phải cách ly tài nguyên theo ARCH-PROG-002.

## 7. Ma trận IEC type × Point kind × direction

| Category/kind | Identity | Direction hợp lệ | IEC type hợp lệ | Ceiling proposal/authority phụ thuộc | Lỗi |
|---|---|---|---|---:|---|
| `LOCAL/UI` | `UI-NN` hoặc Point Catalog ID | read | `REAL`/type Point Catalog | Theo SKU | PRG-ERR-MAP-003/004 |
| `LOCAL/AO` | `AO-NN` | read/write | `REAL` | 4 | PRG-ERR-MAP-003/004 |
| `LOCAL/DO` | `DO-NN` | read/write | `BOOL` | 4 | PRG-ERR-MAP-003/004 |
| `VP/AV` | canonical VP ID | read/write nếu writable | `REAL` | 32 | PRG-ERR-MAP-003/004 |
| `VP/BV` | canonical VP ID | read/write nếu writable | `BOOL` | 16 | PRG-ERR-MAP-003/004 |
| `VP/MSV` | canonical VP ID | read/write nếu writable | bounded `ENUM/uINT` | 8 | PRG-ERR-MAP-003/004 |
| `MB-RTU/EXT` | `{device_id, point_id}` | theo Point config | `BOOL`, integer hoặc `REAL` theo typed contract | `<=256` binding/Program proposal | PRG-ERR-MAP-003/004 |

`DI` không hard-code nếu SKU không có; Local Point lấy từ Point Catalog. `EXT`
chỉ là runtime kind cho Modbus RTU, không cấp phép TCP/BACnet. Ceiling Product
chưa approved vẫn theo `OD-PROG-002, OD-PROG-003, OD-PROG-007`.

## 8. Allowlist Point

Chỉ Local Physical I/O, Virtual Point, Modbus RTU Point được author/import/map/
load. Modbus TCP và BACnet/IP phải bị từ chối tại UI, API/import, validator và
loader. RTU identity phải là `{device_id, point_id}`, không ID phẳng `MB-042`.

## 9. Bundle source-only

Bundle chỉ chứa source ST/FBD, mapping, một Task, Core Library version, Revision
metadata, manifest và integrity hash. Import phải reject artifact, Typed IR,
native binary, build cache/trust material, build lại controller đích, tạo Draft
và không auto-activate. Chi tiết contract thuộc IFSPEC/FSP-PROG-010.

## 10. Acceptance

Board/HIL bắt buộc: `VS-PROG-010`, `013`, `014`, `017`, `020`, `021`. Evidence
hiện tại `MISSING / VR RED`; các số proposal không phải As-Built PASS.

## 11. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 12. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo authority candidate cho semantics resolver/hold-last/IOP/overrun/mapping/bundle. |

Sign-off: Runtime Architect `PENDING`; Controls/Safety Reviewer `PENDING`; Product `PENDING`; I/O Owner `PENDING`; Verification `PENDING`.
