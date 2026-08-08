# Programming Open Decisions — DDC-24 Rev A

**ID:** PROG-OD-001
**Trạng thái:** Active — danh sách quyết định mở
**Chủ quản:** Product / System Engineering
**Cập nhật:** 2026-08-03
**Product Spec:** [PROD-PROG-001](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md)

## Quy tắc sử dụng

Tài liệu này chỉ ghi vấn đề chưa có quyết định được phê duyệt. Nó không phải
Design và không phải Implementation Plan. Một mục chỉ được đóng khi có owner,
quyết định, lý do, ảnh hưởng requirement/verification và liên kết ADR hoặc hồ
sơ phê duyệt. Không được tự lấy hành vi của prototype hoặc host unit test làm
quyết định sản phẩm.

## Quyết định đang mở

| ID | Vấn đề cần quyết định | Ảnh hưởng trước Programming Design | Owner đề xuất | Trạng thái |
|---|---|---|---|---|
| OD-PROG-001 | Role nào được xem, sửa Project, tạo Revision, Deployment, Activation và Rollback; cách ánh xạ vào baseline `viewer/operator/admin` hiện hành. | Chặn ma trận quyền và acceptance security. | Product + Security | OPEN |
| OD-PROG-002 | Tập data type chính thức cho Variable/Point ST và FBD, quy tắc conversion, overflow và giá trị khởi tạo. | Chặn type system và I/O Mapping contract. | Product + Runtime | OPEN |
| OD-PROG-003 | Capacity sản phẩm: số Project, Program, Revision, Point, Variable và kích thước logic tối đa. | Chặn sizing, persistence và performance acceptance. | Product | OPEN |
| OD-PROG-004 | Một Project được có bao nhiêu Program active; cycle time áp dụng theo Program hay task; thứ tự chạy khi có nhiều Program cùng cycle. | Chặn scheduling requirement chi tiết. | Product + Runtime | OPEN |
| OD-PROG-005 | Thư viện function/function block tối thiểu của ST và FBD, semantics dùng chung và chính sách versioning. | Chặn phạm vi ngôn ngữ có thể kiểm thử. | Product + Controls | OPEN |
| OD-PROG-006 | Trải nghiệm authoring FBD, quy tắc kết nối block và format trao đổi Project/Program. | Chặn interaction và persistence Design; không thay đổi việc FBD thuộc Product Spec. | Product + UX | OPEN |
| OD-PROG-007 | Thuộc tính bắt buộc của Local Physical I/O, Virtual Point và Modbus RTU Point: type, unit, quality, timestamp, direction và quyền ghi. Proposal phần Modbus: `DDD-SW-MBRTU-POINT-001` §5/8/9. | Chặn schema/contract I/O Mapping. Proposal không tự đóng phần Local/Virtual hoặc I/O Mapping. | Product + I/O | OPEN — có proposal chờ ADR-024 |
| OD-PROG-008 | Chi tiết Modbus RTU Point: function code, endian/word order, polling, timeout, stale quality, retry và xử lý lỗi thiết bị. Proposal đầy đủ: `DDD-SW-MBRTU-POINT-001`. | Chặn fieldbus contract và negative test; còn P0 two-port/HIL. | Product + Fieldbus | OPEN — có proposal chờ ADR-024 |
| OD-PROG-009 | Chính sách RETAIN cho warm restart, cold restart, power cycle, Revision change, kiểu dữ liệu không tương thích và giới hạn ghi bền vững. | Chặn persistence/recovery Design và acceptance. | Product + Runtime | OPEN |
| OD-PROG-010 | Số Revision được giữ, điều kiện compatibility, quyền và điều kiện cho Deployment/Activation/Rollback, kể cả power loss giữa giao dịch. | Chặn lifecycle state machine và recovery acceptance. | Product + System | OPEN |
| OD-PROG-011 | Online Monitor refresh rate, độ sâu trace, retention, timestamp/quality và chính sách write/force tách biệt. | Chặn monitor contract; Online Monitor mặc định chỉ quan sát. | Product + UX | OPEN |
| OD-PROG-012 | Budget thực thi/WCET/overrun cho ba cycle time và hành vi khi Program lỗi, treo hoặc vượt budget. | Chặn performance/fault acceptance; không biến DDC-24 thành safety PLC. | Product + Runtime | OPEN |
| OD-PROG-013 | Quan hệ migration của component graph 28-node As-Built với Project/Program Rev A, gồm các node Modbus TCP/BACnet ngoài scope. | Chặn compatibility strategy; các node cũ không tự trở thành Product Capability. | Product + Architecture | OPEN |
| OD-PROG-014 | Quy tắc đồng tồn tại và chuyển đổi với dữ liệu/config cũ trên thiết bị đã triển khai. | Chặn upgrade/rollback compatibility. | Product + Operations | OPEN |
| OD-PROG-015 | Hồ sơ Product approval và tiêu chí đóng readiness gate sau khi source foundation được sửa và target evidence có sẵn. | Chặn tuyên bố sẵn sàng bước Programming Design theo workflow đã duyệt. | Product + QA | OPEN |

### Ánh xạ decision request của Modbus RTU Point proposal

Không tạo decision list song song. Các request `DR-MBRTU-*` trong
`DDD-SW-MBRTU-POINT-001` được quản lý bởi open decision hiện hữu như sau; tất cả
vẫn `OPEN` cho tới khi ADR-024 được Accepted và hồ sơ phụ thuộc được đồng bộ:

| Decision request | Open decision chủ quản |
|---|---|
| DR-MBRTU-001..007 | OD-PROG-007, OD-PROG-008 và OD-PROG-014; riêng xung đột hai production RS485 path còn là evidence/readiness của OD-PROG-015 |
| DR-MBRTU-008 | OD-PROG-003 và OD-PROG-008 |
| DR-MBRTU-009 | OD-PROG-001 |

## Điều kiện chuyển trạng thái

- `OPEN`: chưa có quyết định đủ thẩm quyền.
- `DECIDED`: đã có quyết định và liên kết ADR/approval, nhưng tài liệu phụ thuộc
  chưa đồng bộ.
- `CLOSED`: decision, requirement, verification và traceability đã đồng bộ.

Tại thời điểm 2026-08-03, tất cả mục trên là `OPEN`; không được lấp khoảng trống
bằng giả định thiết kế.
