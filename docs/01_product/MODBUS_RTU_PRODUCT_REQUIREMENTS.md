# Modbus RTU — Product Requirements DDC-24 Rev A

**ID:** PROD-MBRTU-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Ngày:** 2026-08-04
**Chủ quản đề xuất:** Product Owner + System Engineering / Fieldbus
**Decision package:** ADR-024 — `Proposed`
**Trace ngược:** [PRODUCT.md](PRODUCT.md) `SYS-REQ-004`, ADR-023
**Trace xuôi:** [REQUIREMENTS.md §Modbus RTU](../02_requirements/REQUIREMENTS.md),
[MODBUS_RTU_TRACEABILITY_MATRIX](../07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md)

> Tài liệu này quy định **sản phẩm phải làm gì** cho Modbus RTU. Nó không phải
> Design, không phải Implementation Plan và không chứng minh source hiện tại đã
> đáp ứng. Trạng thái `In Review` nghĩa là chưa có authority; xem
> [MODBUS_RTU_OPEN_DECISIONS](../00_governance/MODBUS_RTU_OPEN_DECISIONS.md).

## 1. Phạm vi

**Trong phạm vi:** Modbus RTU master trên RS485-1 và RS485-2; Modbus RTU Device;
Modbus RTU Point; đọc, ghi, giám sát và diagnostics; ánh xạ Point vào Point
Database của DDC-24; phân quyền Viewer/Operator/Engineer/Admin.

**Ngoài phạm vi tài liệu này:** Modbus TCP, BACnet/IP, Programming ST/FBD,
Modbus slave northbound, BACnet MS/TP, và mọi thay đổi source.

Modbus TCP và BACnet/IP vẫn là capability giao tiếp product-wide theo
`SYS-REQ-004`; chúng không được gộp vào bất kỳ requirement nào bên dưới.

## 2. Vai trò người dùng

Baseline RBAC hiện hành theo ADR-021 chỉ có **ba** vai trò backend:
`viewer`, `operator`, `admin`. Nhiệm vụ yêu cầu bốn vai trò
(Viewer/Operator/Engineer/Admin). Ánh xạ đề xuất và rủi ro được ghi tại
`OD-MBRTU-009`; cho tới khi quyết định, bảng dưới dùng **vai trò nghiệp vụ** và
ghi rõ vai trò kỹ thuật hiện hành.

| Vai trò nghiệp vụ | Vai trò kỹ thuật hiện hành | Được làm gì với Modbus RTU |
|---|---|---|
| Viewer | `viewer` | xem Device, Point, value/quality/timestamp và diagnostics |
| Operator | `operator` | thêm quyền test read (commissioning read) có TTL/rate limit |
| Engineer | **chưa tồn tại** — hiện gộp vào `admin` | CRUD Device/Point, import/export, apply/rollback cấu hình |
| Admin | `admin` | toàn quyền Engineer + test write register + quản trị người dùng |

Không vai trò nào được cấp raw arbitrary-function-code hoặc mở cổng serial trực tiếp.

## 3. Product Capability

| ID | Capability | Ghi chú phạm vi |
|---|---|---|
| PC-MBRTU-01 | DDC là Modbus RTU **master** trên hai bus logic RS485-1 và RS485-2 | không hỗ trợ slave northbound |
| PC-MBRTU-02 | Quản lý vòng đời Modbus RTU Device (xem/thêm/sửa/xoá/enable/disable) | |
| PC-MBRTU-03 | Quản lý vòng đời Modbus RTU Point kèm import/export | |
| PC-MBRTU-04 | Ánh xạ Modbus RTU Point vào Point Database DDC-24 | dùng namespace tag/point ID chung |
| PC-MBRTU-05 | Giám sát value/quality/timestamp/communication status theo thời gian thực | |
| PC-MBRTU-06 | Commissioning: test connection, test read, test write có xác nhận và audit | |
| PC-MBRTU-07 | Diagnostics bus/device/point: timeout, retry, CRC, exception, latency, overrun | |
| PC-MBRTU-08 | Xử lý sự cố: device offline, reconnect, cấu hình sai, mất bus | |
| PC-MBRTU-09 | Cấu hình có revision, apply atomic và rollback last-known-good | |
| PC-MBRTU-10 | Phân quyền và audit cho mọi mutation/write | |

## 4. Product Requirement

| ID | Yêu cầu sản phẩm | Nguồn / ràng buộc |
|---|---|---|
| PR-MBRTU-001 | Sản phẩm phải cho phép người dùng nhìn thấy toàn bộ Modbus RTU Device đang cấu hình cùng trạng thái Online/Offline/Disabled/Config Error mà không cần công cụ ngoài. | PC-MBRTU-02, PC-MBRTU-05 |
| PR-MBRTU-002 | Người dùng có quyền phải cấu hình được bus (RS485-1/RS485-2), baud rate, data bit, parity, stop bit và slave ID bằng Web UI, không sửa file thủ công trên thiết bị. | PC-MBRTU-02 |
| PR-MBRTU-003 | Sản phẩm phải cho phép test kết nối tới một Device trước khi đưa vào vận hành, và kết quả test phải là kết quả giao tiếp thật, không phải suy diễn từ file cấu hình. | PC-MBRTU-06 |
| PR-MBRTU-004 | Người dùng có quyền phải tạo/sửa/xoá Modbus RTU Point và import/export danh sách Point ở định dạng trao đổi được. | PC-MBRTU-03 |
| PR-MBRTU-005 | Sản phẩm phải cho phép đọc thử và ghi thử một register để commissioning, với xác nhận trước khi ghi và audit sau khi ghi. | PC-MBRTU-06 |
| PR-MBRTU-006 | Modbus RTU Point phải xuất hiện trong Point Database của DDC-24 như một Point hạng nhất, dùng chung không gian tên tag và Point ID với Local Physical I/O và Virtual Point. | PC-MBRTU-04 |
| PR-MBRTU-007 | Người dùng phải theo dõi được value, quality, timestamp và communication status của từng Point; giá trị cũ hoặc mặc định không được trình bày như dữ liệu mới hợp lệ. | PC-MBRTU-05 |
| PR-MBRTU-008 | Sản phẩm phải hiển thị diagnostics đủ để phân biệt lỗi dây, lỗi tham số serial, lỗi địa chỉ slave, lỗi register và quá tải bus. | PC-MBRTU-07 |
| PR-MBRTU-009 | Device offline phải tự thử lại theo chính sách đã công bố và tự phục hồi khi bus tốt trở lại, không cần thao tác tay. | PC-MBRTU-08 |
| PR-MBRTU-010 | Cấu hình sai phải bị từ chối trước khi ảnh hưởng runtime; hệ thống đang chạy không được rơi vào trạng thái áp dụng một nửa. | PC-MBRTU-09 |
| PR-MBRTU-011 | Lỗi Modbus RTU ở mọi mức không được làm dừng core controller, IOP hoặc bus RS485 còn lại. | PC-MBRTU-08 |
| PR-MBRTU-012 | Quyền sửa cấu hình và quyền ghi register phải tách nhau; mọi hành động thay đổi phải truy được ai làm, lúc nào, trên Point nào, giá trị cũ và mới. | PC-MBRTU-10 |

## 5. Use Case

Ký hiệu vai trò: `V` Viewer, `O` Operator, `E` Engineer, `A` Admin.

| ID | Use case | Vai trò tối thiểu | Kết quả mong đợi | Trace |
|---|---|---|---|---|
| UC-MBRTU-001 | Xem danh sách Modbus RTU Device | V | bảng Device kèm bus, slave ID, tham số serial và trạng thái | PR-MBRTU-001 |
| UC-MBRTU-002 | Thêm Device | E | Device được validate, ghi vào candidate và apply thành công hoặc bị từ chối có lý do | PR-MBRTU-002, PR-MBRTU-010 |
| UC-MBRTU-003 | Sửa Device | E | thay đổi có hiệu lực sau apply; `device_id` không đổi | PR-MBRTU-002 |
| UC-MBRTU-004 | Xoá Device | E | chỉ xoá được khi đã xử lý Point thuộc Device; có xác nhận | PR-MBRTU-004 |
| UC-MBRTU-005 | Enable/Disable Device | E | Device disabled không chiếm băng thông bus và không sinh alarm comm | PR-MBRTU-001 |
| UC-MBRTU-006 | Chọn RS485-1 hoặc RS485-2 | E | Device gắn đúng bus; hai bus độc lập | PR-MBRTU-002 |
| UC-MBRTU-007 | Cấu hình baud/data bit/parity/stop bit/slave ID | E | tham số hợp lệ, nhất quán trên một bus, slave ID unique trong bus | PR-MBRTU-002 |
| UC-MBRTU-008 | Test kết nối Device | O | kết quả reachable/unreachable kèm lý do và thời gian đáp ứng thật | PR-MBRTU-003 |
| UC-MBRTU-009 | Tạo/sửa/xoá Modbus RTU Point | E | Point hợp lệ về register/type/endian/scale; overlap bị từ chối | PR-MBRTU-004 |
| UC-MBRTU-010 | Import/export Point | E | round-trip không mất field; import chỉ vào candidate và dùng chung validator | PR-MBRTU-004 |
| UC-MBRTU-011 | Đọc thử register | O | giá trị raw và engineering hiện tại, không thay đổi cấu hình | PR-MBRTU-005 |
| UC-MBRTU-012 | Ghi thử register | A | có xác nhận hai bước, kết quả có thẩm quyền, audit đầy đủ | PR-MBRTU-005, PR-MBRTU-012 |
| UC-MBRTU-013 | Map Modbus Point vào Point Database | E | tag unique toàn hệ, kiểu dữ liệu tương thích, mapping không hợp lệ không lưu được | PR-MBRTU-006 |
| UC-MBRTU-014 | Theo dõi value/quality/timestamp/communication status | V | dữ liệu từ authority runtime, phân biệt GOOD/STALE/OFFLINE/BAD/CONFIG_ERROR | PR-MBRTU-007 |
| UC-MBRTU-015 | Xem timeout/retry/CRC error/polling diagnostics | V | counter và lý do đủ để khoanh vùng lỗi | PR-MBRTU-008 |
| UC-MBRTU-016 | Xử lý Device offline và reconnect | V/E | trạng thái chuyển đúng và tự phục hồi; người dùng thấy thời điểm mất/khôi phục | PR-MBRTU-009 |
| UC-MBRTU-017 | Xử lý cấu hình sai | E | trạng thái Config Error rõ ràng, chỉ đúng field sai, runtime cũ không bị hỏng | PR-MBRTU-010 |
| UC-MBRTU-018 | Phân quyền theo bốn vai trò | A | Viewer/Operator không thực hiện được hành động ngoài quyền, cả trên UI lẫn API | PR-MBRTU-012 |

### 5.1 Luồng chính UC-MBRTU-012 (ghi thử register)

1. Người dùng vai trò Admin chọn Point `read_write` đang có quality GOOD.
2. UI hiển thị giá trị hiện tại, giá trị đề xuất, đơn vị và giới hạn min/max.
3. Người dùng xác nhận bằng hộp thoại nêu rõ Device, Point, register và giá trị.
4. Hệ thống gửi write request có `request_id` và deadline.
5. Hệ thống trả `accepted/applied/rejected/timeout` kèm exception code nếu có.
6. Nếu Point đọc được, hệ thống readback và hiển thị giá trị sau ghi.
7. Audit ghi actor, thời gian, Device, Point, giá trị cũ, giá trị mới và kết quả.

Trường hợp ngoại lệ bắt buộc phải xử lý: Point read-only, quality không GOOD,
giá trị ngoài min/max, revision cấu hình đã đổi giữa bước 2 và 4, device offline,
timeout, queue đầy, và mất phiên đăng nhập giữa chừng.

## 6. Ràng buộc sản phẩm

| Ràng buộc | Giá trị | Trạng thái bằng chứng |
|---|---|---|
| Số bus RS485 | 2 (RS485-1, RS485-2) | **XUNG ĐỘT** — hồ sơ HW kiểm soát mới mô tả một đường UART4 và một connector; xem `OD-MBRTU-001` |
| Vai trò Modbus | master duy nhất | Active theo ARCH-R010 |
| Chống nhiều nguồn ghi | mọi lệnh ghi output nội bộ phải qua core arbitration | Active theo ADR-012/priority model |
| Không dừng control | lỗi fieldbus không dừng core/IOP | `PR-MBRTU-011`, cần bằng chứng target |

## 7. Gate sản phẩm

```text
MODBUS_RTU_PRODUCT_SCOPE_DEFINED   = YES
MODBUS_RTU_USE_CASES_DEFINED       = YES
MODBUS_RTU_PRODUCT_APPROVED        = NO   (chờ ADR-024 Accepted + OD-MBRTU-001)
MODBUS_RTU_PRODUCT_IMPLEMENTED     = NO
```

`MODBUS_RTU_PRODUCT_APPROVED` chỉ đổi thành `YES` khi Product Owner ký duyệt
tài liệu này, `OD-MBRTU-001` (hai bus hay một bus) được quyết định, và
`OD-MBRTU-009` (mô hình bốn vai trò) được chốt.

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo Product Requirement và use case Modbus RTU tách khỏi Programming |
