# Đánh giá component spec và legacy cho Programming Rev A

| Thuộc tính | Giá trị |
|---|---|
| ID | `DES-PROG-ASSESS-001` |
| Phiên bản | 1.1 |
| Trạng thái | `CONTROLLED ASSESSMENT / IN REVIEW` |
| Ngày | 2026-08-09 |

## Mục lục

1. Ma trận assessment
2. Ceiling/scope v2.2
3. Quy tắc dùng candidate
4. Thuật ngữ
5. Lịch sử và phê duyệt

## 1. Ma trận assessment

| Nguồn/component | Có thể tái sử dụng | Gap so với Rev A v2.2 | Không được claim |
|---|---|---|---|
| ST subset | Parser/semantic/diagnostic/type foundation | User FB chỉ cục bộ; Product types/library còn OD | Full ST Product approved |
| Typed IR/artifact | Version/ABI/sections/hash/source-map | Full Point binding, FBD, target lifecycle | Production path complete; trusted-origin signature IN |
| Scheduler | Task/program separation, fault/activation hooks | Rev A một Task; cycle 1/5/30; base step/watchdog/overrun chưa reconcile | Limit 8/16/32 hoặc multi-task approved |
| Process image/resolver | Typed values/quality/priority | `program_value/actual_value/...`, anti-windup/hold-last/IOP evidence | Bumpless/arbitration productized |
| Graph runtime | AS-BUILT production + migration experience | Phải cutover fail closed; không dual-run | FBD hoặc Programming runtime |
| Modbus RTU | Bus→Device→Point/ACK/LKG | Discriminated binding/type/quality contract | Full Programming mapping complete |
| Legacy FBD/canvas ideas | Block/connection concepts | Rev A structured editor, keyboard path | Free-form wiresheet Rev A |

## 2. Ceiling/scope v2.2

- ST giữ subset/limit candidate tới khi `OD-PROG-002, OD-PROG-003, OD-PROG-005` đóng.
- FBD ceiling proposal `<=256` block/`<=512` connection chưa là PASS/capacity authority.
- Rev A có một Task; component limit 8 Task/16 Program mỗi Task/32 tổng OUT.
- RETAIN IN ở proposal nhưng policy restart/wear/compatibility còn mở.
- BACS Library nâng cao, full functional/as-built export và trusted-origin signature OUT.

## 3. Quy tắc dùng candidate

Candidate chỉ được chọn sau khi trace requirement, ADR/decision, interface và
scenario. Không sửa raw snapshot. Mâu thuẫn watchdog scheduler/base-step nằm ở
`CONF-PROG-015`, không được giải bằng cách chọn ngầm một spec.

## 4. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 5. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Audit assessment ban đầu. |
| 1.1 | 2026-08-09 | Reconcile ST/FBD/một Task/RETAIN/bundle/signature theo v2.2. |

Sign-off: Runtime Architecture `PENDING`; Product `PENDING`; Verification `PENDING`.
