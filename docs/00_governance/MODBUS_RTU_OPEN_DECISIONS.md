# Modbus RTU — Open Decisions

**ID:** OD-MBRTU-SET-001
**Trạng thái:** Active (danh mục vấn đề mở, không phải Design)
**Ngày:** 2026-08-04
**Chủ quản:** Project Engineering
**Đọc cùng:** [ADR-024](DECISIONS.md), [DDD-SW-MBRTU-POINT-001 §18](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)

> Tài liệu này liệt kê **quyết định còn thiếu authority**. Nó không tự quyết định
> thay Product/CTO. Không được coi khuyến nghị ở đây là quyết định đã duyệt.
> Tập `DR-MBRTU-001..009` trong review proposal ngày 2026-08-03 vẫn `OPEN` và
> được ánh xạ vào tập `OD-MBRTU-*` bên dưới.

## 1. Bảng quyết định

| ID | Vấn đề | Ảnh hưởng nếu chưa quyết | Owner cần ký | Khuyến nghị kỹ thuật | Liên quan | Trạng thái |
|---|---|---|---|---|---|---|
| OD-MBRTU-001 | **Hai bus RS485 hay một?** Product baseline ghi `2 × Modbus RTU`; `HW_SPEC` mới mô tả một UART4, một transceiver, một connector A/B/GND và một switch termination SW8; source có một `ModbusMaster`. | Toàn bộ thiết kế Bus, capacity, scheduler, UI chọn bus và `VR-MBRTU-001` treo. Người dùng có thể cấu hình Point trên bus không tồn tại. | Product + HW + Platform | Giữ hai bus trong Product và **bắt HW chứng minh hai đường production**; nếu HW không làm được, đổi Product xuống một bus qua decision chính thức. Không đóng gate bằng USB-RS485. | DR-MBRTU-001; `PROD-MBRTU-001` §6 | **OPEN — P0** |
| OD-MBRTU-002 | **Serial format thuộc Bus hay Device?** | FE/BE/data model không thống nhất; hiện BE lưu ở Device và ép "mọi device enabled phải giống nhau". | System + Fieldbus | Đặt ở Bus, Device kế thừa read-only; giữ field trên response Device để không vỡ UI. | DR-MBRTU-002; data model §4 | **OPEN — P0** |
| OD-MBRTU-003 | **Có hỗ trợ `bit_index` (trích bit trong register) không?** | Thiếu thì không map được thanh ghi trạng thái dạng bit-field, rất phổ biến ở VFD/meter. Có thì phải mở rộng codec, luật overlap và profile schema. | Product + Fieldbus | Hỗ trợ ở Rev A: chi phí thấp, giá trị thực tế cao; luật overlap đã được định nghĩa ở data model §5.5. | data model §5.2 | **OPEN — P1** |
| OD-MBRTU-004 | **Có cho phép alias (hai Point cùng register, khác tag)?** | Chưa quyết ⇒ validator phải reject cứng, có thể chặn use case hợp lệ (một register dùng cho hai mục đích hiển thị). | Fieldbus + Product | Rev A **không** hỗ trợ alias; reject overlap. Mở ở Rev B nếu có nhu cầu thật. | data model §5.5 | **OPEN — P2** |
| OD-MBRTU-005 | **Mức ưu tiên của commissioning write so với logic điều khiển.** | Không rõ ⇒ ghi thử có thể bị logic ghi đè ngay chu kỳ sau, hoặc ngược lại ghi thử chiếm quyền quá lâu. | Controls + Safety + Product | Commissioning write dùng mức `manual` có TTL ngắn (ví dụ 60 s) rồi tự nhả; hiển thị rõ TTL trên UI. | FW design §8.1 | **OPEN — P0** |
| OD-MBRTU-006 | **Ngưỡng tải bus (70 % reject / 50 % warning) và cách tính `t_turnaround`.** | Số hiện là PROPOSED, chưa đo. Đặt sai ⇒ hoặc chặn cấu hình hợp lệ, hoặc cho qua cấu hình trượt deadline. | Performance + QA + Fieldbus | Giữ 70/50 làm giá trị khởi điểm, **bắt buộc** đo lại trên phần cứng thật ở `TC-MBRTU-H-15` rồi chốt. | BE design §5 | **OPEN — P1** |
| OD-MBRTU-007 | **Chu kỳ refresh FE và giới hạn write rate.** | Refresh quá dày làm tăng tải BE/core; quá thưa làm commissioning khó. Write rate không giới hạn là rủi ro an toàn. | Product + BE + UX | Refresh mặc định 5 s (2/5/15/tắt); write test 2 req/phút/người dùng; read test 5 req/phút. Đo lại khi có target evidence. | UX §6, BE design §6 | **OPEN — P1** |
| OD-MBRTU-008 | **Có cho phép reset counter diagnostics từ UI không?** | Chưa quyết ⇒ counter chỉ reset khi restart, khó dùng khi commissioning lặp. Nếu cho phép thì mất tính liên tục của bằng chứng. | QA + Ops + Product | **Không** cho reset; thay vào đó hiển thị `producer_boot_id` + `counters_since` và cho phép FE tính delta theo mốc người dùng chọn. | UX §6.2 | **OPEN — P2** |
| OD-MBRTU-009 | **Mô hình bốn vai trò (Viewer/Operator/Engineer/Admin) vs ba vai trò hiện hành (ADR-021).** | Đề bài yêu cầu bốn; hệ thống có ba. Hiện `Engineer` bị gộp vào `admin`, và FE khoá cả trang Modbus ở `admin` nên Viewer **không giám sát được** — trái `PR-MBRTU-001`. | Product + Security | Bước 1 (làm ngay được): hạ route FE xuống `viewer` cho các trang đọc, giữ mutation ở `admin`. Bước 2: quyết định có thêm vai trò `engineer` vào ADR-021 hay không. | ADR-021; UX §1.1, §7 | **OPEN — P0** |
| OD-MBRTU-010 | **Tên field: `read_write` hay `access_mode`.** | Ba lớp đang dùng tên khác nhau; đổi tên là breaking change API. | API + FE + Fieldbus | Dùng `access_mode` cho contract v2, giữ `read_write` là alias deprecated trong một vòng version, rồi bỏ. | interface spec §7.1 | **OPEN — P1** |
| OD-MBRTU-011 | **Capacity 64 Point là ràng buộc vĩnh viễn hay tạm thời?** | `KX_N_EXT = 64` là hằng số ABI. Nâng lên là ABI change và tăng RAM/thời gian scan. | Product + Performance | Giữ 64 ở Rev A; nếu Product cần cao hơn thì phải có sizing, đo memory/timing và contract version mới — **không** truncate im lặng. | FW design §11 | **OPEN — P1** |
| OD-MBRTU-012 | **Định dạng import/export chuẩn: CSV, JSON hay cả hai.** | Chưa quyết ⇒ khách hàng/đối tác không có định dạng trao đổi ổn định. | Product + BE | CSV cho Point (dễ dùng Excel tại hiện trường) + JSON cho toàn bộ cấu hình (round-trip đầy đủ). Cả hai đều đi qua candidate. | data model §8 | **OPEN — P2** |
| OD-MBRTU-013 | **Xoá Device có Point: chặn hay cascade có xác nhận.** | Hiện chặn cứng. Với device nhiều Point, người dùng phải xoá thủ công từng Point. | Product + UX | Giữ chặn mặc định, bổ sung `cascade=true` tường minh kèm hộp thoại liệt kê Point. | API spec §1 | **OPEN — P2** |
| OD-MBRTU-014 | **Modbus RTU Point có được expose ra BACnet không, và nếu có thì object type/instance do ai cấp.** | Profile hiện có `expose_bacnet`/`bacnet_object_type`/`bacnet_instance` nhưng BE không sinh các field này ⇒ tính năng tồn tại trong iobus mà không có đường cấu hình. | Product + Fieldbus + BACnet | Rev A: **không** expose qua đường Modbus profile; nếu cần thì đi qua cấu hình BACnet object riêng để tránh hai nguồn cấp instance. | `device_profile.hpp`; `persistence.go BuildProfile` | **OPEN — P1** |
| OD-MBRTU-015 | **Thay ABI `kx_ext_point_t` v1 → snapshot v2: chiến lược triển khai.** | Đây là ABI change đồng bộ ba binary. Không có kế hoạch ⇒ nguy cơ deploy lệch làm mất dữ liệu Point. | Core + Fieldbus + Web + DevOps | Magic mới + `schema_version`, reject mismatch có thông điệp rõ, deploy đồng bộ trong một package, và test negative mismatch bắt buộc. | DR-MBRTU-005; interface spec §5.3 | **OPEN — P0** |

## 2. Ánh xạ `DR-MBRTU-*` → `OD-MBRTU-*`

| DR (2026-08-03) | OD tương ứng | Ghi chú |
|---|---|---|
| DR-MBRTU-001 hai bus | OD-MBRTU-001 | không đổi nội dung |
| DR-MBRTU-002 tách Bus khỏi Device | OD-MBRTU-002 | |
| DR-MBRTU-003 address zero-based | **đã hợp nhất vào requirement** `IF-REQ-MBRTU-004` (Active) | không còn là open decision; chỉ chờ source conform |
| DR-MBRTU-004 quality/timestamp | **đã hợp nhất vào** `SWR-REQ-MBRTU-005` (Active); mở rộng `CONFIG_ERROR` là mới | phần mở rộng nằm ở OD-MBRTU-016 dưới đây |
| DR-MBRTU-005 typed IPC v2 | OD-MBRTU-015 | |
| DR-MBRTU-006 atomic apply có ACK | **đã hợp nhất vào** `SWR-REQ-MBRTU-007` (Active) | chờ implementation |
| DR-MBRTU-007 write result/readback | **đã hợp nhất vào** `SWR-REQ-MBRTU-006` (Active); ưu tiên commissioning là mới | phần mới ở OD-MBRTU-005 |
| DR-MBRTU-008 capacity | OD-MBRTU-011 | |
| DR-MBRTU-009 RBAC commissioning | OD-MBRTU-009 | mở rộng thành câu hỏi 4 vai trò |

| ID | Vấn đề | Owner | Khuyến nghị | Trạng thái |
|---|---|---|---|---|
| OD-MBRTU-016 | Có thêm `CONFIG_ERROR` vào tập quality (thành 5 trạng thái) không, hay giữ 4 và phân biệt bằng `quality_reason`? | Product + Core + Fieldbus | Thêm `CONFIG_ERROR` vào quality: người vận hành cần phân biệt "thiết bị trả sai" với "cấu hình sai" ngay trên bảng Point, không phải mở tooltip. | **OPEN — P1** |

## 3. Quyết định thiếu authority ngoài phạm vi Modbus nhưng chặn Modbus

| ID | Vấn đề | Nguồn |
|---|---|---|
| OD-MBRTU-EXT-01 | Không có owner được chỉ định tên cho Fieldbus Lead, QA/HIL Lead và HW/Platform Lead ⇒ không ai ký được `OD-MBRTU-001` và các gate HIL. | Audit as-built §9.4 |
| OD-MBRTU-EXT-02 | Không có phòng lab/thiết bị RS485 và slave thật được cấp cho dự án ⇒ `VR-MBRTU-011` không thể chạy dù thiết kế xong. | Audit as-built §7 |
| OD-MBRTU-EXT-03 | ADR-022 (CI/CD deployment provenance) còn `Proposed` ⇒ `VR-MBRTU-012` không có cơ chế đóng. | DECISIONS.md |

## 4. Quy tắc đóng quyết định

1. Mỗi `OD-MBRTU-*` chỉ được đóng bằng một mục trong [DECISIONS.md](DECISIONS.md)
   hoặc một ADR mới, có ngày và người ký.
2. Đóng quyết định phải cập nhật trong cùng thay đổi: tài liệu design liên quan,
   `REQUIREMENTS.md` nếu đổi nghĩa vụ, `VERIFICATION.md` nếu đổi gate,
   [MODBUS_RTU_TRACEABILITY_MATRIX](../07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md)
   và `CHANGELOG.md`.
3. Không xoá dòng đã đóng: đổi `Trạng thái` thành `CLOSED <ngày> — <link decision>`
   và giữ nguyên nội dung để bảo toàn lịch sử.
4. Trao đổi miệng, chat hoặc "đã thống nhất trong họp" **không** đóng được quyết định.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Tạo danh mục 16 open decision Modbus RTU + 3 blocker ngoài phạm vi; ánh xạ DR-MBRTU-001..009 |
