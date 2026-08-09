# Record chuyển audit package thành bộ tài liệu thiết kế Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-PROG-REFACTOR-002` |
| Ngày | 2026-08-09 |
| Trạng thái | `RECORD / COMPLETED DOCUMENT REFACTOR` |
| Product/Design approval | Không; vẫn PENDING |
| Production readiness | `RED / NO-GO`, evidence 0/13 |

## Mục lục

1. Quyết định
2. Nguồn và authority
3. File thêm
4. File sửa
5. File giữ nguyên
6. R3-01..03
7. Việc cố tình không làm
8. Kiểm tra và sai lệch inventory
9. Thuật ngữ
10. Lịch sử và xác nhận

## 1. Quyết định

`AUD-PROG-001` đổi từ audit snapshot sang controlled living design set. Product
authority `PROD-PROG-001` vẫn Active và không bị supersede; v2.2 chỉ amendment
input. Đường dẫn hiện tại được giữ vì chưa có PM/CTO approval cho move; kế hoạch
move có điều kiện nằm trong Document Control.

## 2. Nguồn và authority

Chỉ Product v2.2 và UX v2.2 cung cấp nội dung thiết kế. Record phản biện,
PROD/REQ Active và ADR dùng để kiểm quyền/conflict. Không dùng source ngoài hai
proposal để phát minh target design; AS-BUILT chỉ được ghi đúng như proposal/record.

## 3. File thêm

| File | Lý do |
|---|---|
| `01_product/features/FSP-PROG-010_REPLACEMENT_BUNDLE.md` | Feature source-only replacement. |
| `01_product/features/FSP-PROG-011_GRAPH_PROGRAMMING_CUTOVER.md` | Feature cutover fail closed. |
| `01_product/features/FSP-PROG-012_ARBITRATION_TRANSPARENCY.md` | Feature mức 5/bumpless/override transparency. |
| `02_requirements/01_PROPOSED_REQUIREMENTS_V22.md` | 41 PRG + 24 UX-REQ PROPOSED. |
| `03_architecture/01_PROGRAMMING_RUNTIME_ARCHITECTURE.md` | Base step/cutover/resource isolation. |
| `04_design/02_CONTROL_SEMANTICS.md` | Resolver/anti-windup/hold-last/IOP/overrun/mapping/bundle. |
| `05_interfaces/01_ERROR_CODE_CATALOG.md` | Authority `PRG-ERR-*`. |
| `06_verification/01_VERIFICATION_SCENARIOS.md` | Catalog VS duy nhất, map VR/UC/target. |
| `08_records/REFACTOR_TO_DESIGN_SET_2026-08-09.md` | Record phiên chuyển đổi. |

## 4. File sửa

- `README.md`: mục đích, role map, FAQ, status thật.
- `00_document_control/00..04`: đổi bản chất, register, dictionary, conflict,
  proposed answer; giữ OD state.
- `01_product/00..01` và FSP-001..009: controlled overlay v2.2, scope mới,
  verification/sign-off.
- `02_requirements/00`: giữ baseline Active, thêm VR/evidence/red relation.
- `03_architecture/00`: sửa AS-BUILT graph/st_sched và authority boundaries.
- `04_design/00..01`: design input/constraint và component scope v2.2.
- `05_interfaces/00`: nghĩa dữ liệu/lifecycle/arbitration/concurrency/bundle.
- `06_verification/00`: giữ 13 VR RED, thêm G0..G7 và trỏ catalog duy nhất.
- `07_traceability/00`: `TRACE-PROG-001`, 41/24/30 ID và reverse trace.
- Hai proposal v2.2: R3-01/R3-02 và chuyển scenario authority về catalog controlled.
- `CHANGELOG.md`, Document Manifest: ghi/reflection phiên thay đổi.

## 5. File giữ nguyên

Năm record cũ trong `08_records/` được giữ nguyên vì là historical record:
Implementation Status, Legacy Design Assessment, phản biện v2, Reorganization
Report và Requirements Inventory. `SOURCE_MANIFEST.sha256` cùng toàn bộ
`09_archive/` không đổi để bảo toàn chuỗi audit.

## 6. R3-01..R3-03

| ID | Cách đóng |
|---|---|
| R3-01 | Proposal Product §12.4 và UX §11.6 đổi `PRG-MAP-003/004` thành `PRG-ERR-MAP-003/004`; IFSPEC catalog sở hữu, mã cũ deprecated. |
| R3-02 | Product §33 liệt kê riêng đủ R2-01..14, gồm 02/03/04/05/07. |
| R3-03 | Thêm `CONF-PROG-015 = OPEN-DESIGN`, blocker OD-012/013/014; không tự resolve. |

## 7. Việc cố tình không làm

| Việc | Lý do | Điều kiện mở khóa |
|---|---|---|
| Không thay/supersede `PROD-PROG-001` | Proposal/sign-off còn PENDING | OD-PROG-015 + biên bản Supersedes hai chiều |
| Không di chuyển sang `docs/02_design/programming/` | Chưa có PM/CTO approval, link impact rộng | Approval + kế hoạch/link checker |
| Không đóng OD/approve Design | Governance cấm | ADR/biên bản đủ owner/date/impact |
| Không đổi VR/Gate khỏi RED | Không có production evidence | Board/HIL/E2E record được review |
| Không khóa URL/JSON/DB schema | Interface decision chưa đóng | OD + Interface review |
| Không sửa code/config/systemd | Ngoài phạm vi prompt | Nhiệm vụ implementation riêng sau approval |
| Không sửa archive | Bất biến | Không có điều kiện trong refactor này |

## 8. Kiểm tra và sai lệch inventory

Prompt giả định 34 file trong `raw-source-snapshots/`; thực đo có 33 payload,
khớp `SOURCE_MANIFEST.sha256`. Toàn `09_archive/` có 35 file gồm index/metadata.
Record ghi đúng số thật và không tạo/sửa file archive để ép số.

Kết quả kiểm tra tĩnh sau refactor:

| Kiểm tra | Kết quả thực đo |
|---|---:|
| Namespace authority/proposal | PC 12; PR 14; FSP 12; layer REQ 19; PRG 41; UX-REQ 24; VS 30; VR 13; OD 15; CONF 16; PRG-ERR 6 |
| Forward/reverse ID thiếu trong `TRACE-PROG-001` | 0 |
| Va chạm requirement ID với error code | 0 |
| Liên kết Markdown nội bộ gãy | 0/links trong 40 Markdown ngoài archive |
| Block bảng Markdown lệch cột | 0 |
| `SOURCE_MANIFEST.sha256` | 33/33 OK |
| `DOCUMENT_MANIFEST.sha256` | 39/39 OK sau lần tạo cuối |
| File thay đổi trong `09_archive/` | 0 |
| `git diff --check` | Sạch |

Governance scan: 15 OD giữ OPEN/PARTIAL, 13 VR giữ RED, 8 gate G0..G7 giữ
`RED/NOT STARTED`; mọi controlled design document còn sign-off `PENDING`.

## 9. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 10. Lịch sử và xác nhận

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-09 | Record lần refactor controlled design set. |

Xác nhận tài liệu: Document Control `PENDING`; Product `PENDING`; Architecture `PENDING`; Verification `PENDING`.
