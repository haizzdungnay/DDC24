# Bộ tài liệu thiết kế Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| Package ID | `AUD-PROG-001` |
| Phiên bản | 2.0 |
| Bản chất | `CONTROLLED DESIGN DOCUMENTATION SET` |
| Trạng thái thiết kế | `IN REVIEW — NOT APPROVED` |
| Product authority | `PROD-PROG-001` ngoài bộ vẫn Active |
| Evidence | `VR 0/13 PASS`; G0..G7 `RED/NOT STARTED` |
| Ngày chuyển đổi | 2026-08-09 |

## Mục lục

1. Mục đích và cách đọc đúng
2. Trạng thái thật
3. Bản đồ thư mục
4. Cách đọc theo vai trò
5. Câu hỏi thường gặp
6. Quy tắc authority/trace/evidence
7. Vị trí và archive
8. Thuật ngữ
9. Lịch sử và phê duyệt

## 1. Mục đích và cách đọc đúng

Bộ này là living design set cho Programming Rev A: phạm vi, requirement,
architecture, control semantics, interface, verification và trace hai chiều.
Nó thay **bản chất quản trị** của audit package cũ nhưng không thay Product
authority, không phê duyệt proposal v2.2 và không làm implementation complete.

Đọc theo chuỗi:

```text
Product authority
→ Feature/Requirement Active + Proposed
→ Architecture/Design/Interface candidate
→ VS catalog
→ VR
→ Evidence
```

## 2. Trạng thái thật

| Trục | Trạng thái |
|---|---|
| Product authority | `PROD-PROG-001` Active; v2.2 chỉ amendment `IN REVIEW` |
| Open Decision | OD-PROG-001..015 đều OPEN/PARTIAL; không mục nào CLOSED |
| Design | `NOT APPROVED`; sign-off bắt buộc đều PENDING |
| Verification | VR-PROG-001..013 đều RED; production evidence **0/13** |
| Gate | G0..G7 đều `RED / NOT STARTED` |
| Runtime AS-BUILT | Graph production; Programming `st_sched = nullptr` tại record 2026-08-08 |
| Readiness | `NO-GO` production |

## 3. Bản đồ thư mục

| Thư mục | Trả lời |
|---|---|
| `00_document_control/` | Authority, term, conflict, OD, register, manifest là gì? |
| `01_product/` | Rev A làm/không làm gì; feature nào phân rã capability? |
| `02_requirements/` | Requirement nào Active, requirement nào Proposed? |
| `03_architecture/` | AS-BUILT/target boundary; base-step/cutover/isolation thế nào? |
| `04_design/` | Control semantics và constraint candidate là gì? |
| `05_interfaces/` | Dữ liệu/authority/error code có nghĩa gì? |
| `06_verification/` | VS nào chạy, map VR nào, cần board/HIL hay không? |
| `07_traceability/` | Chuỗi forward/reverse có khép kín không? |
| `08_records/` | Quyết định/refactor/audit lịch sử ở thời điểm nào? |
| `09_archive/` | Raw snapshot bất biến để điều tra lịch sử. |

## 4. Cách đọc theo vai trò

| Vai trò | Thứ tự đọc |
|---|---|
| PM/Product | Document Control → Product Spec → Feature Catalog → OD/Conflict → Trace |
| Kiến trúc | System Context → Runtime Architecture → Design Status → Interface |
| FE/UX | Proposed Requirements phần UX → UX proposal → IFSPEC → VS/Trace |
| BE | Product lifecycle → Proposed Requirements → IFSPEC/Error → Runtime Architecture |
| FW-SOM/Controls | Runtime Architecture → Control Semantics → Cyclic/Cutover/Arbitration FSP → HIL scenarios |
| QA/Verification | Verification Spec → Scenario Catalog → Trace → record evidence |

## 5. Câu hỏi thường gặp

| Câu hỏi | Đọc file |
|---|---|
| Product Spec nào có authority? | `00_document_control/00_DOCUMENT_CONTROL.md` + `01_product/00_PROGRAMMING_PRODUCT_SPEC.md` |
| Rev A có mấy Task/FBD dạng gì? | Feature Catalog + FSP-PROG-004, FSP-PROG-005 |
| `program_value` khác `actual_value` thế nào? | `04_design/02_CONTROL_SEMANTICS.md` |
| Graph và Programming cutover ra sao? | `03_architecture/01_PROGRAMMING_RUNTIME_ARCHITECTURE.md` + FSP-PROG-011 |
| Watchdog/Task 30 s có được chốt chưa? | `CONF-PROG-015` + `OD-PROG-012, OD-PROG-013, OD-PROG-014` |
| Bundle thay controller chứa gì? | FSP-PROG-010 + IFSPEC §6 |
| Mã lỗi authority ở đâu? | `05_interfaces/01_ERROR_CODE_CATALOG.md` |
| Test nào bắt buộc board/HIL? | `06_verification/01_VERIFICATION_SCENARIOS.md` §3 |
| Evidence hiện có bao nhiêu? | Verification Spec: 0/13, RED |

## 6. Quy tắc authority, trace và evidence

- Một chủ đề một owner; nơi khác chỉ trỏ sang.
- 41 `PRG-*` + 24 `UX-REQ-*` là `PROPOSED`; baseline 19 requirement không đổi.
- `VS-PROG-001..030` là scenario catalog duy nhất.
- IFSPEC sở hữu `PRG-ERR-*`; mã cũ `PRG-MAP-003/004` deprecated.
- Trace/document/source/host test không tự chuyển VR sang PASS.
- Standards chỉ “aligned/informed”; edition/năm `UNVERIFIED` tới evidence record.

## 7. Vị trí và archive

Đường dẫn hiện tại được giữ để bảo toàn link. Đích `docs/02_design/programming/`
chỉ di chuyển sau PM/CTO approval/`OD-PROG-015` và full link migration. `09_archive`
bất biến; 33 raw payload đã được checksum, không chỉnh để khớp giả định 34.

## 8. Thuật ngữ

Xem [Data Dictionary](00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 9. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | README controlled audit baseline. |
| 2.0 | 2026-08-09 | Viết lại cho controlled design set, role map/FAQ/status thật. |

Sign-off: Product `PENDING`; Architecture `PENDING`; Controls/Safety `PENDING`; UX `PENDING`; Verification `PENDING`.
