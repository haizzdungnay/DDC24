# Modbus RTU — Product Requirements DDC-24 Rev A

**ID:** PROD-MBRTU-001
**Phiên bản:** 0.2
**Trạng thái:** Active (Phê duyệt 2026-08-05 theo Tờ trình `DDC24-MBRTU-REQ-APPROVE-2026-08-05`)
**Ngày:** 2026-08-05
**Chủ quản đề xuất:** Product Owner + System Engineering / Fieldbus
**Decision package:** ADR-024 — `Accepted` (2026-08-05)
**Quyết định đã ký áp dụng vào bản này:** Đ-01, Đ-04, Đ-06, Đ-07
([biên bản PM/CTO 2026-08-04](../07_records/reviews/MODBUS_RTU_APPROVAL_RECORD_2026-08-04.md))
**Trace ngược:** [PRODUCT.md](PRODUCT.md) `SYS-REQ-004`, ADR-023
**Trace xuôi:** [REQUIREMENTS.md §Modbus RTU](../02_requirements/REQUIREMENTS.md),
[MODBUS_RTU_TRACEABILITY_MATRIX](../07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md)

> Tài liệu này quy định **sản phẩm phải làm gì** cho Modbus RTU. Nó không phải
> Design, không phải Implementation Plan và không chứng minh source hiện tại đã
> đáp ứng. Trạng thái `In Review` nghĩa là chưa có authority; xem
> [MODBUS_RTU_OPEN_DECISIONS](../00_governance/MODBUS_RTU_OPEN_DECISIONS.md).

## 1. Phạm vi

**Trong phạm vi:** Modbus RTU master trên bus RS485 của DDC-24; Modbus RTU Device;
Modbus RTU Point; đọc, ghi, giám sát và diagnostics; ánh xạ Point vào Point
Database của DDC-24; phân quyền Viewer/Operator/Admin.

> **Số bus ở Rev A = 1 (quyết định Đ-01, 2026-08-04).** Bản 0.1 của tài liệu này
> mô tả hai bus `RS485-1`/`RS485-2` theo `PRODUCT.md` khi đó; khảo sát device tree
> trên board production Foxlinx chỉ tìm thấy hai UART enable — `ttyS2` đã dành cho
> MCU IOP và `ttyS5` còn rảnh — nên chỉ chạy được **một** Modbus master. Yêu cầu
> đầu bài của nhiệm vụ đồng bộ ngày 2026-08-05 vẫn ghi "RS485-1 và RS485-2"; đó là
> phạm vi *kiến trúc*, không phải cam kết sản phẩm Rev A. Xử lý: giữ nguyên khái
> niệm `bus_id` trong mô hình dữ liệu và contract để mở cổng thứ hai không phải đổi
> ABI lần nữa, nhưng **Rev A chỉ hiện thực và chỉ nghiệm thu một instance**. Mọi
> phát biểu "hai bus" trong tài liệu này đã được viết lại; phần bị thay thế ghi ở
> Revision history.

**Ngoài phạm vi tài liệu này:** Modbus TCP, BACnet/IP, Programming ST/FBD,
Modbus slave northbound, BACnet MS/TP, và mọi thay đổi source.

Modbus TCP và BACnet/IP vẫn là capability giao tiếp product-wide theo
`SYS-REQ-004`; chúng không được gộp vào bất kỳ requirement nào bên dưới.

## 2. Vai trò người dùng

**Quyết định Đ-04 (PM/CTO 2026-08-04): Rev A giữ đúng ba vai trò của ADR-021 —
`viewer`, `operator`, `admin`. KHÔNG thêm vai trò `engineer`.** Đề bài yêu cầu bốn
vai trò; khác biệt duy nhất là quyền cấu hình và quyền ghi register **cùng thuộc
Admin** thay vì tách Engineer/Admin. `OD-MBRTU-009` **CLOSED**.

| Vai trò | Được làm gì với Modbus RTU |
|---|---|
| `viewer` | xem Device, Point, value/quality/timestamp, diagnostics và overview |
| `operator` | thêm: test connection và đọc thử register (commissioning read) có rate limit |
| `admin` | thêm: CRUD Device/Point, enable/disable, import/export, apply/rollback cấu hình, **ghi thử register** |

Ma trận đầy đủ (nguồn: biên bản phê duyệt §3.3):

| Hành động | Viewer | Operator | Admin |
|---|:--:|:--:|:--:|
| Xem Device/Point/diagnostics | ✔ | ✔ | ✔ |
| Test kết nối | ✖ | ✔ | ✔ |
| Đọc thử register | ✖ | ✔ | ✔ |
| Thêm/sửa/xoá Device, Point | ✖ | ✖ | ✔ |
| Enable/Disable Device | ✖ | ✖ | ✔ |
| Import/Export | ✖ | ✖ | ✔ |
| Apply/Rollback cấu hình | ✖ | ✖ | ✔ |
| Ghi thử register | ✖ | ✖ | ✔ |

**Hệ quả cho `PR-MBRTU-012`** ("quyền sửa cấu hình và quyền ghi register phải tách
nhau"): ở Rev A hai quyền này **không tách** — Đ-04 đã chấp nhận rủi ro đó một cách
tường minh. Yêu cầu tách vẫn còn hiệu lực về mặt sản phẩm và được hoãn sang bản có
vai trò Engineer; theo dõi tại `OD-MBRTU-009R` (§7).

Không vai trò nào được cấp raw arbitrary-function-code hoặc mở cổng serial trực tiếp.

## 3. Product Capability

| ID | Capability | Ghi chú phạm vi |
|---|---|---|
| PC-MBRTU-01 | DDC là Modbus RTU **master** trên **02 bus RS485 vật lý**: RS485-1 (`/dev/rs485-1` → `ttyS5`) và RS485-2 (`/dev/rs485-2` → `ttyS1`, UART1 M1 Header P16). | Không hỗ trợ slave northbound |
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
| PR-MBRTU-002 | Người dùng có quyền phải cấu hình được bus, baud rate, data bit, parity, stop bit và slave ID bằng Web UI, không sửa file thủ công trên thiết bị. Ở Rev A chỉ có một bus nên trường bus hiển thị **read-only**; UI không được cho chọn cổng không tồn tại trên phần cứng. | PC-MBRTU-02, Đ-01 |
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

Ký hiệu vai trò: `V` Viewer, `O` Operator, `A` Admin. Vai trò `E` Engineer của bản
0.1 đã được **gộp vào `A`** theo Đ-04.

| ID | Use case | Vai trò tối thiểu | Kết quả mong đợi | Trace |
|---|---|---|---|---|
| UC-MBRTU-001 | Xem danh sách Modbus RTU Device | V | bảng Device kèm bus, slave ID, tham số serial và trạng thái | PR-MBRTU-001 |
| UC-MBRTU-002 | Thêm Device | A | Device được validate, ghi vào candidate và apply thành công hoặc bị từ chối có lý do | PR-MBRTU-002, PR-MBRTU-010 |
| UC-MBRTU-003 | Sửa Device | A | thay đổi có hiệu lực sau apply; `device_id` không đổi | PR-MBRTU-002 |
| UC-MBRTU-004 | Xoá Device | A | chỉ xoá được khi đã xử lý Point thuộc Device; có xác nhận | PR-MBRTU-004 |
| UC-MBRTU-005 | Enable/Disable Device | A | Device disabled không chiếm băng thông bus và không sinh alarm comm | PR-MBRTU-001 |
| UC-MBRTU-006 | Gắn Device vào bus RS485 | A | Device gắn đúng bus tồn tại. **Rev A:** chỉ một bus khả dụng nên trường này read-only, hệ thống tự gán; UI không được liệt kê bus không có capability | PR-MBRTU-002, Đ-01 |
| UC-MBRTU-007 | Cấu hình baud/data bit/parity/stop bit/slave ID | A | tham số hợp lệ, nhất quán trên một bus, slave ID unique trong bus | PR-MBRTU-002 |
| UC-MBRTU-008 | Test kết nối Device | O | kết quả reachable/unreachable kèm lý do và thời gian đáp ứng thật | PR-MBRTU-003 |
| UC-MBRTU-009 | Tạo/sửa/xoá Modbus RTU Point | A | Point hợp lệ về register/type/endian/scale; overlap bị từ chối | PR-MBRTU-004 |
| UC-MBRTU-010 | Import/export Point | A | round-trip không mất field; import chỉ vào candidate và dùng chung validator. **Bắt buộc ở Rev A** (Đ-06): import CSV, export CSV **và** JSON | PR-MBRTU-004, Đ-06 |
| UC-MBRTU-011 | Đọc thử register | O | giá trị raw và engineering hiện tại, không thay đổi cấu hình | PR-MBRTU-005 |
| UC-MBRTU-012 | Ghi thử register | A | có xác nhận hai bước, kết quả có thẩm quyền, audit đầy đủ | PR-MBRTU-005, PR-MBRTU-012 |
| UC-MBRTU-013 | Map Modbus Point vào Point Database | A | tag unique toàn hệ, kiểu dữ liệu tương thích, mapping không hợp lệ không lưu được | PR-MBRTU-006 |
| UC-MBRTU-014 | Theo dõi value/quality/timestamp/communication status | V | dữ liệu từ authority runtime, phân biệt GOOD/STALE/OFFLINE/BAD/CONFIG_ERROR | PR-MBRTU-007 |
| UC-MBRTU-015 | Xem timeout/retry/CRC error/polling diagnostics | V | counter và lý do đủ để khoanh vùng lỗi | PR-MBRTU-008 |
| UC-MBRTU-016 | Xử lý Device offline và reconnect | V/A | trạng thái chuyển đúng và tự phục hồi; người dùng thấy thời điểm mất/khôi phục | PR-MBRTU-009 |
| UC-MBRTU-017 | Xử lý cấu hình sai | A | trạng thái Config Error rõ ràng, chỉ đúng field sai, runtime cũ không bị hỏng | PR-MBRTU-010 |
| UC-MBRTU-018 | Phân quyền theo ba vai trò (Đ-04) | A | Viewer/Operator không thực hiện được hành động ngoài quyền, cả trên UI lẫn API | PR-MBRTU-012 |

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
| Số bus RS485 | **1** ở Rev A | **ĐÓNG** bằng Đ-01 (2026-08-04). `PRODUCT.md` và `SYS-REQ-MBRTU-001` đã khớp. Bằng chứng phần cứng: khảo sát device tree Foxlinx (chỉ `ttyS2` + `ttyS5` enable). `OD-MBRTU-001` CLOSED |
| Số Modbus RTU Point tối đa | **≥ 256** (Đ-07, nâng từ 64) | `PROPOSED` — chưa đo. Phải đo lại kích thước datagram và thời gian copy snapshot trên target khi nâng `KX_N_EXT`. As-Built hiện vẫn chặn ở 64 |
| Cơ chế điều hướng RS-485 | chưa xác định | **CÒN MỞ** — `G-D`/Đ-02 giao Hardware Lead; source chưa gọi `modbus_rtu_set_serial_mode()` |
| Vai trò Modbus | master duy nhất | Active theo ARCH-R010 |
| Chống nhiều nguồn ghi | mọi lệnh ghi output nội bộ phải qua core arbitration | Active theo ADR-012/priority model |
| Không dừng control | lỗi fieldbus không dừng core/IOP | `PR-MBRTU-011`, cần bằng chứng target |
| Cấu hình Modbus trong giờ vận hành | **CẤM** tới khi Track B xong | Đ-11, hiệu lực ngay. Lý do: mỗi CRUD hiện restart `mkddc-iobus` (D-09) |

## 7. Gate sản phẩm

```text
MODBUS_RTU_PRODUCT_SCOPE_DEFINED   = YES
MODBUS_RTU_USE_CASES_DEFINED       = YES
MODBUS_RTU_PRODUCT_APPROVED        = NO   (chờ ADR-024 Accepted)
MODBUS_RTU_PRODUCT_IMPLEMENTED     = NO   (Track A xong phần code, chưa nghiệm thu board)
```

`OD-MBRTU-001` và `OD-MBRTU-009` — hai điều kiện của bản 0.1 — đã được đóng bằng
Đ-01 và Đ-04. Điều kiện còn lại để `MODBUS_RTU_PRODUCT_APPROVED = YES`: Product
Owner ký duyệt tài liệu này và ADR-024 chuyển `Proposed → Accepted`.

Yêu cầu sản phẩm **chưa** được đáp ứng ở Rev A và được theo dõi tường minh:

| Mã | Yêu cầu chưa đáp ứng | Vì sao | Theo dõi tại |
|---|---|---|---|
| `OD-MBRTU-009R` | `PR-MBRTU-012` đòi tách quyền cấu hình khỏi quyền ghi register | Đ-04 chốt ba vai trò; cả hai quyền thuộc Admin | `OD-MBRTU-SET-001` |
| — | `PR-MBRTU-003`/`005` (test connection, đọc/ghi thử) | chưa có endpoint; là Track B `MBR-B108`/`B208` | Plan 49 §4 |
| — | `PR-MBRTU-004` phần import/export | chưa có endpoint; Track B `MBR-B209` | Plan 49 §4 |
| — | `PR-MBRTU-010` phần "không áp dụng một nửa" | apply hiện là restart iobus, không phải transaction có ACK | D-09, `MBR-B204`/`B212` |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo Product Requirement và use case Modbus RTU tách khỏi Programming |
| 0.2 | 2026-08-05 | In Review | Áp dụng quyết định đã ký. **Thay thế:** (a) phạm vi "hai bus RS485-1/RS485-2" → một bus ở Rev A, giữ `bus_id` (Đ-01); (b) mô hình bốn vai trò có Engineer → ba vai trò, Engineer gộp vào Admin (Đ-04); (c) `PC-MBRTU-01`, `PR-MBRTU-002`, `UC-MBRTU-006`, `UC-MBRTU-018` viết lại theo (a)(b); (d) `UC-MBRTU-010` ghi rõ import CSV + export CSV/JSON là bắt buộc (Đ-06); (e) §6 thêm ràng buộc 256 Point (Đ-07), điều hướng RS-485 còn mở (Đ-02) và cấm sửa cấu hình trong giờ vận hành (Đ-11); (f) §7 liệt kê tường minh bốn yêu cầu sản phẩm chưa đáp ứng ở Rev A |
