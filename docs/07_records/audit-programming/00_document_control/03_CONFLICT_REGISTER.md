# Đăng ký mâu thuẫn Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `CONFREG-PROG-001` |
| Phiên bản | 2.0 |
| Trạng thái | `CONTROLLED / IN REVIEW` |
| Ngày đối chiếu | 2026-08-09 |

## Mục lục

1. Quy ước
2. Conflict Register
3. Điều bị chặn
4. Thuật ngữ
5. Lịch sử
6. Phê duyệt

## 1. Quy ước

- `RESOLVED-AUDIT`: bộ tài liệu có cách đọc duy nhất; lịch sử vẫn giữ nguyên.
- `OPEN-DESIGN`: requirement/hướng đề xuất đã rõ nhưng quyết định thiết kế chưa duyệt.
- `OPEN-UPSTREAM`: nguồn ngoài bộ còn phải đồng bộ.
- `SUPERSEDED`: giá trị cũ đã bị authority mới hơn thay.

Không tự chọn cách hiểu cho dòng `OPEN-*`; phải trỏ tới Open Decision.

## 2. Conflict Register

| ID | Mâu thuẫn | Cách đọc/đề xuất trong bộ thiết kế | Trạng thái / blocker |
|---|---|---|---|
| CONF-PROG-001 | Audit snapshot và living design từng nằm cùng bản chất | Từ 2026-08-09, 00..07 là living design; 08/09 vẫn record/archive | RESOLVED-AUDIT |
| CONF-PROG-002 | FBD Rev A bị lẫn graph 28-node legacy | FBD Rev A là structured typed editor; graph chỉ chạy trong `GRAPH_ONLY`; cutover phải `GRAPH_ONLY/PROGRAM_ONLY/DUAL_INVALID`, không dual-run | OPEN-DESIGN — `OD-PROG-006, OD-PROG-013, OD-PROG-014` |
| CONF-PROG-003 | Product chỉ `1/5/30 s`, component nhận `50..60000 ms` bội 50 | Boundary Product/UX/runtime chỉ nhận `1/5/30 s`; internal base step tách Task period, chưa chốt implementation | OPEN-DESIGN — `OD-PROG-004, OD-PROG-012` |
| CONF-PROG-004 | Draft/component cũ gán process/path riêng | Giữ kiến trúc ba process; tên/path cũ chỉ historical | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-005 | ADR-024 vừa Accepted vừa còn chữ Proposed | Dùng entry Accepted 2026-08-05; ghi chú cũ là stale | RESOLVED-AUDIT / OPEN-UPSTREAM |
| CONF-PROG-006 | Modbus RTU 1 hay 2 bus vật lý | Một bus theo ADR-024; giữ `bus_id` mở rộng | SUPERSEDED / OPEN-UPSTREAM |
| CONF-PROG-007 | Capacity Modbus Point 64 hay `>=256` | Dùng `>=256` theo ADR-024; 64 là lịch sử | SUPERSEDED |
| CONF-PROG-008 | OD-PROG-007, OD-PROG-008 vẫn nói chờ ADR-024 | Phần ADR-024 là quyết định phụ thuộc; contract/evidence còn PARTIAL | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-009 | ST/Scheduler/IR component ghi Active nhưng Programming Design chưa có | Active chỉ trong component cũ; không nâng thành design approval | RESOLVED-AUDIT |
| CONF-PROG-010 | Limit 8 Task/16 Program mỗi Task/32 tổng bị hiểu là Product capacity | Các số 8/16/32 và multi-task là **OUT Rev A**; Rev A có một Task; capacity khác chưa chốt | OPEN-DESIGN — `OD-PROG-003, OD-PROG-004` |
| CONF-PROG-011 | RETAIN component tồn tại nhưng restart policy chưa chốt | RETAIN IN Rev A ở mức proposal; policy/evidence còn mở | OPEN-DESIGN — `OD-PROG-009, OD-PROG-010` |
| CONF-PROG-012 | API graph/Modbus cũ bị hiểu là Programming API | Interface chỉ khóa nghĩa/authority; URL/schema chưa approved | RESOLVED-AUDIT / OPEN-DESIGN |
| CONF-PROG-013 | Host test bị dùng để claim production | Host test chỉ supporting; `VR` vẫn 0/13 PASS | RESOLVED-AUDIT |
| CONF-PROG-014 | “Theo chuẩn ISO/IEC” bị hiểu là chứng nhận | Chỉ dùng aligned/informed; edition/năm `UNVERIFIED` | RESOLVED-AUDIT |
| CONF-PROG-015 | Scheduler spec dùng công thức watchdog theo Task lớn nhất, proposal dùng base step độc lập Task period | Candidate normative là base-step model và công thức `WatchdogSec >= 2 × max_base_step_period + WCET_step_target + 1 s`, nhưng không được implement/chốt unit trước quyết định | **OPEN-DESIGN — `OD-PROG-012, OD-PROG-013, OD-PROG-014`** |
| CONF-PROG-016 | 41 `PRG-*` và 24 `UX-REQ-*` bổ sung/làm mạnh baseline Active ở Core Library, structured FBD, một Task, bundle, arbitration, cutover, watchdog và UX | Giữ toàn bộ là `PROPOSED`; chỉ nhập baseline sau Product/Architecture/UX/Verification sign-off và cập nhật từng requirement/VR | **OPEN-UPSTREAM / OPEN-DESIGN — `OD-PROG-002..015` theo từng hàng trace** |

## 3. Điều bị chặn

Không được phê duyệt Programming Design, khóa URL/schema/DB, chốt capacity/WCET,
đổi systemd/runtime config hoặc chuyển production gate sang GREEN tới khi các OD
tương ứng đóng và Verification có evidence. `CONF-PROG-015` là R3-03 đã được
ghi nhận nhưng **chưa resolved**.

## 4. Thuật ngữ

Xem [Data Dictionary](02_TERMS_AND_DATA_DICTIONARY.md).

## 5. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Đăng ký 14 conflict của audit baseline. |
| 2.0 | 2026-08-09 | Cập nhật CONF-PROG-002, CONF-PROG-003, CONF-PROG-010 theo v2.2; thêm CONF-PROG-015 để đóng R3-03 ở tầng merge và CONF-PROG-016 để giữ ranh giới amendment. |

## 6. Phê duyệt

| Vai trò | Quyết định |
|---|---|
| Product Owner | `PENDING` |
| Software/Runtime Architect | `PENDING` |
| Controls/Safety Reviewer | `PENDING` |
| Verification Lead | `PENDING` |
