# Use Cases — HMI TFT Local (MK-DDC-24)

> **Document ID:** KX-DDC24-UC-HMI-001-VI · **Rev** 2.2 | 2026-06-30
> **Trạng thái:** Draft — chờ owner review trước Rev B implementation
> **Owner:** SW Lead / UX Lead
> **Trace:** `HMI-001..022`, `SW-HMI-001..008`
> **Phụ thuộc:** [SW_HMI_DESIGN Rev 2.1](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md) · [KX-DDC24-UX-HMI-001](KX-DDC24-UX-HMI-001_VI.md) · [SRS §12](../01_specs/SRS_MK-DDC-24_VI.md)

---

## 1. Nguyên tắc thiết kế HMI Local

HMI Local của MK-DDC-24 là màn tại tủ điện để kỹ sư automation, kỹ sư commissioning và kỹ thuật viên bảo trì kiểm tra nhanh tình trạng bộ điều khiển.

HMI Local không phải:

- màn BMS đầy đủ;
- màn SCADA;
- màn energy dashboard;
- màn ứng dụng phòng;
- màn debug phần mềm nhúng.

Không được hardcode các tên như:

- Room Temp;
- Room RH;
- AHU;
- Pump;
- Fan;
- Power;
- Energy.

Các tên point vận hành chỉ được lấy từ `point database / project config`. Nếu chưa có cấu hình project thì chỉ hiển thị mã kỹ thuật như `UI1`, `UI2`, `DI1`, `AO1`, `DO1`.

---

## 2. Actors & Môi trường

| Actor | Mô tả | Thiết bị |
|-------|-------|---------|
| **Kỹ thuật viên (KTV)** | Vận hành / bảo trì thiết bị tại tủ điện. Không nhất thiết có laptop. Có thể đeo găng tay bảo hộ. | Touch + 6 nút |
| **Kỹ sư commissioning (KS)** | Lắp đặt, cấu hình, kiểm định lần đầu. Thường có laptop cùng mạng. | Touch + 6 nút + Web UI |
| **Service Engineer** | Cấu hình kỹ thuật, reload/reboot, backup/restore. Phải có quyền Service. | Touch + 6 nút + PIN hoặc service switch |

## 3. Input Methods (2 cách điều khiển song song)

| Hành động | Touch (primary) | 6 nút cứng (fallback — gloved hand) |
|-----------|----------------|--------------------------------------|
| Chuyển page | Vuốt trái / phải | LEFT / RIGHT |
| Cuộn danh sách | Vuốt lên / xuống | UP / DOWN |
| Chọn item | Tap vào row | UP/DOWN focus → ENTER |
| Xác nhận | Tap + hold 3s (nút đỏ) | ENTER giữ 3s |
| Huỷ / Thoát | Tap [X] hoặc vuốt ra | ESC |
| Wake screen saver | Chạm bất kỳ | Nhấn bất kỳ nút |

---

## 4. Tổng quan 6 Page

| STT | Page | Mục đích | Hiển thị chính | Thao tác |
|----:|------|---------|--------------|---------|
| 1 | **Home / Controller Health** | Xem nhanh DDC có bình thường không | Alarm, CPU/RAM/temp/storage, I/O health, communication, config | Chỉ xem, tap block để mở page liên quan |
| 2 | **I/O Monitor** | Xem chi tiết 24 I/O | UI/DI/AO/DO, value, unit, quality, age | Xem, cuộn, lọc BAD/STALE |
| 3 | **Alarm / Event** | Xem lỗi, sự kiện, ACK | Active/Unacked/Cleared, code, point, message | ACK nếu có quyền |
| 4 | **Communication** | Xem mạng và fieldbus | Ethernet, IP, BACnet, Modbus RTU/TCP | Xem; chỉnh sửa chỉ qua Service mode hoặc Web UI |
| 5 | **System / Diagnostics** | Xem kỹ thuật hệ thống | FW, uptime, CPU/RAM chi tiết, process/service, watchdog, log | Xem log, xem trạng thái service |
| 6 | **Service / Config** | Cấu hình kỹ thuật có khóa quyền | profile, point DB, safe state, reload/reboot | Reload config, reboot, backup/restore — có quyền mới thao tác |

**Page order:** Home → I/O Monitor → Alarm/Event → Communication → System/Diagnostics → Service/Config → Home (vòng)

---

## 5. Precondition chung

- `kinexus-hmid` đang chạy, DRM display init thành công (`/dev/dri/card0`).
- `mkddc-iobus` và `mkddc-core` đang chạy, SHM đang được ghi.
- Module KD024QVFIA073-02-C021B: màn hình sáng, CTP FT5436 (I2C 0x38) đã init.

---

## 6. Use Cases

### UC-LOCAL-001 — Kiểm tra nhanh trạng thái DDC

| Mục | Nội dung |
|----|---------|
| Page | Home / Controller Health |
| Actor | KTV / Automation Engineer |
| Trigger | Đầu ca, sau khi mở tủ, sau khi reboot |
| Goal | Biết DDC có bình thường không trong dưới 30 giây |
| Main flow | Mở Home → đọc RUNNING/FAULT → kiểm tra Alarm (Active/Unacked/Critical) → kiểm tra Controller Health (CPU/RAM/temp/storage) → kiểm tra I/O Health (OK/BAD/STALE từng nhóm) → kiểm tra Communication (Ethernet/BACnet/Modbus) → kiểm tra Config |
| Alternate A1 | Alarm Active > 0 → chuyển Alarm/Event |
| Alternate A2 | CPU/RAM/temp/storage warning → chuyển System/Diagnostics |
| Alternate A3 | I/O BAD/STALE → chuyển I/O Monitor với filter |
| Alternate A4 | BACnet/Modbus lỗi → chuyển Communication |
| Acceptance | Người vận hành biết rõ DDC bình thường hay cần xử lý tiếp trong ≤ 30s |

---

### UC-LOCAL-002 — Điều hướng giữa các page

| Mục | Nội dung |
|----|---------|
| Page | Tất cả page |
| Actor | KTV / Automation Engineer / Service Engineer |
| Trigger | Cần xem thông tin chi tiết |
| Goal | Di chuyển nhanh giữa 6 page |
| Main flow (touch) | Vuốt trái/phải đổi page; tap tab nhảy trực tiếp; UP/DOWN cuộn; ENTER chọn; ESC thoát |
| Main flow (nút) | LEFT/RIGHT đổi page; UP/DOWN cuộn; ENTER chọn; ESC thoát |
| Alternate | Nếu màn đang sleep, thao tác đầu chỉ wake màn — không navigate |
| Acceptance | Người dùng vào đúng page cần xem trong tối đa 2 thao tác |

---

### UC-LOCAL-003 — Kiểm tra tài nguyên controller

| Mục | Nội dung |
|----|---------|
| Page | Home, System / Diagnostics |
| Actor | Automation Engineer |
| Trigger | Nghi controller chạy chậm, nóng, đầy bộ nhớ, treo bất thường |
| Goal | Biết CPU/RAM/storage/temp có bình thường không |
| Main flow | Xem Home → nếu Health NORMAL không cần mở sâu → nếu WARNING/FAULT thì mở System/Diagnostics → đọc CPU/RAM/storage/temp chi tiết → ghi nhận nguyên nhân |
| Alternate A1 | Temp > ngưỡng → hiện cảnh báo nhiệt |
| Alternate A2 | Storage gần đầy → yêu cầu kiểm tra log/history |
| Alternate A3 | RAM cao → kiểm tra process trong System/Diagnostics |
| Acceptance | Xác định được controller bình thường hay có dấu hiệu quá tải |

---

### UC-LOCAL-004 — Kiểm tra tổng quan I/O

| Mục | Nội dung |
|----|---------|
| Page | Home |
| Actor | KTV / Automation Engineer |
| Trigger | Kiểm tra đầu ca hoặc sau khi đấu nối |
| Goal | Biết nhóm UI/DI/AO/DO có lỗi không |
| Main flow | Xem I/O Health trên Home → kiểm tra số OK/BAD/STALE từng nhóm → nếu tất cả 0 BAD/STALE thì I/O tổng thể OK |
| Alternate | Có BAD/STALE → mở I/O Monitor với filter BAD/STALE |
| Acceptance | Biết nhóm I/O nào đang có lỗi |

---

### UC-LOCAL-005 — Kiểm tra chi tiết 24 I/O

| Mục | Nội dung |
|----|---------|
| Page | I/O Monitor |
| Actor | Automation Engineer / Commissioning Engineer |
| Trigger | Vừa đấu dây, cần kiểm tra sensor/DI/AO/DO |
| Goal | Xác nhận từng point đọc đúng, chất lượng tốt |
| Main flow | Mở I/O Monitor → chọn page hoặc filter → đọc point / name / value / unit / quality / age → so sánh với tín hiệu thực tế → ghi nhận GOOD/BAD |
| Alternate A1 | UI BAD → kiểm tra sensor/dây/signal type |
| Alternate A2 | DI không đổi → kiểm tra tiếp điểm/pull-up |
| Alternate A3 | AO sai → kiểm tra scale/output mode |
| Alternate A4 | DO sai → kiểm tra relay/feedback |
| Acceptance | Từng kênh I/O có trạng thái rõ ràng: GOOD hoặc cần xử lý |

---

### UC-LOCAL-006 — Lọc các point lỗi

| Mục | Nội dung |
|----|---------|
| Page | I/O Monitor |
| Actor | Automation Engineer |
| Trigger | Home báo có BAD/STALE I/O |
| Goal | Tìm nhanh point lỗi |
| Main flow | Mở I/O Monitor → chọn filter BAD/STALE → danh sách chỉ hiển thị point lỗi → đọc point/channel/source/quality/age |
| Alternate | Không còn lỗi → hiển thị "No BAD/STALE points" |
| Acceptance | Tìm được point lỗi trong dưới 10 giây |

---

### UC-LOCAL-007 — Xem alarm đang active

| Mục | Nội dung |
|----|---------|
| Page | Alarm / Event |
| Actor | KTV / Automation Engineer |
| Trigger | Home báo Active Alarm > 0 hoặc đèn alarm sáng |
| Goal | Biết lỗi gì đang xảy ra |
| Main flow | Mở Alarm/Event → xem summary Active/Unacked/Critical → đọc alarm mới nhất → xem code, severity, point, message, state |
| Alternate A1 | Alarm liên quan I/O → mở I/O Monitor |
| Alternate A2 | Alarm liên quan Modbus/BACnet → mở Communication |
| Alternate A3 | Alarm hệ thống → mở System/Diagnostics |
| Acceptance | Biết lỗi thuộc nhóm nào và cần xử lý ở đâu |

---

### UC-LOCAL-008 — ACK alarm

| Mục | Nội dung |
|----|---------|
| Page | Alarm / Event |
| Actor | KTV có quyền / Automation Engineer |
| Trigger | Có alarm cần xác nhận |
| Goal | Xác nhận đã biết alarm |
| Main flow | Chọn alarm ACTIVE_UNACK hoặc CLEARED_UNACK → bấm ACK → xác nhận → trạng thái chuyển sang ACTIVE_ACK hoặc CLEARED_ACK |
| Alternate A1 | Không có quyền → hiện "Permission required" |
| Alternate A2 | Alarm INFO không cần ACK → không hiện nút ACK |
| Acceptance | ACK không làm mất active alarm; chỉ đổi trạng thái xác nhận. Active: N không giảm về 0 khi alarm vẫn đang active |

---

### UC-LOCAL-009 — Kiểm tra Ethernet/IP

| Mục | Nội dung |
|----|---------|
| Page | Communication |
| Actor | Automation Engineer / BMS Engineer |
| Trigger | BMS không thấy controller hoặc cần kiểm tra IP |
| Goal | Biết IP/MAC/Gateway/Link có đúng không |
| Main flow | Mở Communication → xem Ethernet Link → đọc IP/Mask/Gateway/MAC → so sánh với nhãn tủ hoặc bản vẽ mạng |
| Alternate A1 | Link Down → kiểm tra cáp/switch |
| Alternate A2 | IP sai → kiểm tra DHCP/static config, sửa qua Web UI hoặc Service mode |
| Alternate A3 | Gateway sai → sửa qua Web UI hoặc Service mode |
| Acceptance | Xác định được tình trạng Ethernet/IP |

---

### UC-LOCAL-010 — Kiểm tra BACnet/Modbus

| Mục | Nội dung |
|----|---------|
| Page | Communication |
| Actor | Automation Engineer / BMS Engineer |
| Trigger | BMS báo mất điểm, Modbus timeout, thiết bị fieldbus không phản hồi |
| Goal | Biết BACnet/Modbus có hoạt động không |
| Main flow | Mở Communication → xem BACnet status, Device ID, Last Request → xem Modbus RTU/TCP status, slave count, timeout count |
| Alternate A1 | BACnet Duplicate ID → đổi Device ID |
| Alternate A2 | Modbus Timeout → kiểm tra slave address/baudrate/dây RS485/termination |
| Alternate A3 | No Traffic → kiểm tra BMS/master, không nói "kết nối" vì BACnet/IP là UDP |
| Acceptance | Xác định được lỗi thuộc BACnet, Modbus hay network vật lý |

---

### UC-LOCAL-011 — Xem diagnostics hệ thống

| Mục | Nội dung |
|----|---------|
| Page | System / Diagnostics |
| Actor | Automation Engineer / Service Engineer |
| Trigger | Controller có dấu hiệu bất thường |
| Goal | Xem thông tin kỹ thuật để chẩn đoán |
| Main flow | Mở System/Diagnostics → xem FW, uptime, boot reason → xem CPU/RAM/storage/temp → xem process/service → xem watchdog/log |
| Alternate A1 | Process chết → chuyển Service/Config để restart service nếu có quyền |
| Alternate A2 | Watchdog reset → ghi nhận boot reason |
| Alternate A3 | Log có lỗi → lưu mã lỗi để escalate |
| Acceptance | Có đủ thông tin để quyết định reboot, reload, sửa config hoặc escalate |

---

### UC-LOCAL-012 — Vào Service Mode

| Mục | Nội dung |
|----|---------|
| Page | Service / Config |
| Actor | Service Engineer / Commissioning Engineer |
| Trigger | Cần reload config, reboot, backup/restore hoặc kiểm tra profile |
| Goal | Truy cập thao tác kỹ thuật có kiểm soát |
| Main flow | Mở Service/Config → nhập Service PIN hoặc bật service switch → hệ thống unlock → hiển thị action được phép |
| Alternate A1 | PIN sai → giữ locked |
| Alternate A2 | Service switch OFF → chỉ xem |
| Alternate A3 | User không đủ quyền → không cho thao tác nguy hiểm |
| Acceptance | Chỉ người có quyền mới thao tác được config/reboot/reload |

---

### UC-LOCAL-013 — Reload cấu hình

| Mục | Nội dung |
|----|---------|
| Page | Service / Config |
| Actor | Service Engineer |
| Trigger | Cập nhật point database, fieldbus config hoặc profile |
| Goal | Nạp lại cấu hình mà không reboot toàn hệ thống nếu có thể |
| Main flow | Unlock Service Mode → chọn Reload Config → hệ thống kiểm tra checksum → nếu hợp lệ thì reload → cập nhật Config Rev trên Home |
| Alternate A1 | Checksum lỗi → từ chối reload |
| Alternate A2 | Config thiếu point bắt buộc → báo CONFIG_ERROR |
| Alternate A3 | Reload thất bại → giữ config cũ, không áp dụng config mới |
| Acceptance | Config mới được nạp an toàn hoặc rollback về config cũ |

---

### UC-LOCAL-014 — Reboot controller an toàn

| Mục | Nội dung |
|----|---------|
| Page | Service / Config |
| Actor | Service Engineer |
| Trigger | Sau update firmware, lỗi hệ thống cần reboot |
| Goal | Reboot có kiểm soát và áp dụng safe state đúng cấu hình |
| Main flow | Unlock Service Mode → chọn Reboot System → hệ thống hiển thị cảnh báo → giữ xác nhận 3 giây → áp dụng safe state theo từng point config → reboot |
| Alternate A1 | Người dùng thả tay trước 3 giây → hủy |
| Alternate A2 | Không có quyền → không cho reboot |
| Alternate A3 | Safe state config lỗi → chặn reboot, yêu cầu xác nhận cấp cao |
| Constraint | Reboot không được hardcode DO OFF/AO 4mA; safe state phải theo từng point config (`safe_state` field trong point database) |
| Acceptance | Reboot chỉ xảy ra khi đủ quyền; safe state áp dụng per-point trước khi tắt |

---

## 7. Alarm State Model

ACK không được hiểu là hết lỗi. ACK chỉ là "đã biết lỗi". Lỗi chỉ hết khi điều kiện lỗi không còn active.

| State | Ý nghĩa |
|-------|---------|
| `ACTIVE_UNACK` | Lỗi đang tồn tại, chưa xác nhận |
| `ACTIVE_ACK` | Lỗi đang tồn tại, đã xác nhận |
| `CLEARED_UNACK` | Lỗi đã hết, nhưng chưa xác nhận lịch sử |
| `CLEARED_ACK` | Lỗi đã hết và đã xác nhận |

Bộ đếm trên Home/Dashboard hiển thị `Active: N | Unacked: M` — không giảm về 0 khi alarm vẫn ACTIVE dù đã ACK.

---

## 8. Communication Status Model

BACnet/IP là giao thức UDP — không có khái niệm "kết nối" (session). Không dùng chữ "Đang kết nối" hay "Connected". Dùng trạng thái kỹ thuật rõ ràng:

| Status | Ý nghĩa |
|--------|---------|
| `OK` | Hoạt động bình thường, có traffic |
| `DISABLED` | Đã tắt trong cấu hình |
| `NO_TRAFFIC` | Không có traffic trong khoảng thời gian cấu hình |
| `TIMEOUT` | Có timeout Modbus slave |
| `CONFIG_ERROR` | Sai cấu hình |
| `DUPLICATE_ID` | Trùng BACnet Device ID |
| `LINK_DOWN` | Ethernet mất link |

Hiển thị thêm `Last Request: Xs ago` cho BACnet/IP.

---

## 9. Ma trận Page × Use Case

| UC | Home | I/O Monitor | Alarm/Event | Communication | System/Diagnostics | Service/Config |
|----|-----:|------------:|------------:|--------------:|-------------------:|---------------:|
| UC-LOCAL-001 Kiểm tra nhanh DDC | x | | | | | |
| UC-LOCAL-002 Điều hướng | x | x | x | x | x | x |
| UC-LOCAL-003 Kiểm tra tài nguyên | x | | | | x | |
| UC-LOCAL-004 Kiểm tra tổng quan I/O | x | | | | | |
| UC-LOCAL-005 Kiểm tra chi tiết I/O | | x | | | | |
| UC-LOCAL-006 Lọc point lỗi | | x | | | | |
| UC-LOCAL-007 Xem alarm active | x | | x | | | |
| UC-LOCAL-008 ACK alarm | | | x | | | |
| UC-LOCAL-009 Kiểm tra Ethernet/IP | | | | x | | |
| UC-LOCAL-010 Kiểm tra BACnet/Modbus | | | | x | | |
| UC-LOCAL-011 Xem diagnostics | | | | | x | |
| UC-LOCAL-012 Vào Service Mode | | | | | | x |
| UC-LOCAL-013 Reload cấu hình | | | | | | x |
| UC-LOCAL-014 Reboot an toàn | | | | | x | x |

---

## 10. Acceptance Criteria tổng

| Nhóm | Tiêu chí nghiệm thu |
|------|-------------------|
| Home | Không có Room/Power/Energy hardcode; không có service nội bộ (IOP/core/HMI process); hiển thị controller health đủ nhóm |
| I/O | Hiển thị đủ base SKU 24 I/O (16 UI + 4 AO + 4 DO); optional DI chỉ hiện khi capability map xác nhận; mỗi point có value/unit/quality/age |
| Alarm | ACK không xóa lỗi active; có 4-state model; Active count không về 0 khi alarm vẫn tồn tại |
| Communication | Hiển thị Ethernet/BACnet/Modbus bằng trạng thái kỹ thuật rõ ràng; không dùng "Đang kết nối" cho BACnet/UDP |
| Diagnostics | Có FW, uptime, CPU/RAM/storage/temp, service/process, watchdog, log |
| Service | Có khóa quyền (PIN hoặc service switch); reload/reboot/safe state không cho thao tác tự do |
| Safety | Safe state theo từng point config; không hardcode toàn hệ thống |
| Config | Mọi tên point, unit, scale, alarm, safe state lấy từ config — không hardcode tên ứng dụng |

---

## 11. Behaviors không phải UC (non-functional)

| Behavior | Tham chiếu |
|----------|-----------|
| Screen saver dim sau 5 phút idle | SW_HMI_DESIGN §9 |
| I/O FAULT banner tự động overlay | SW_HMI_DESIGN §6.5 |
| Data refresh tự động ≤ 1s | SW_HMI_DESIGN §4, HMI-006 |
| Đổi ngôn ngữ qua SIGHUP | SW_HMI_DESIGN §10 |
| Hiển thị data age — STALE khi age > ngưỡng cấu hình | SW_HMI_DESIGN §4 |

---

## Revision History

| Rev | Ngày | Người | Thay đổi |
|-----|------|-------|---------|
| 1.0 | 2026-06-26 | SW Lead | Phát hành đầu — 7 UC (bị bãi bỏ: dựa SPI/ILI9341, không có touch, UC screen saver không hợp lệ) |
| 2.0 | 2026-06-26 | SW Lead | Viết lại: dual-input (CTP touch + 6 nút), 6 UC thực tế, alarm 4-state, loại bỏ screen saver UC |
| 2.1 | 2026-06-26 | SW Lead | Viết lại hoàn toàn: 6 page + 14 UC, nguyên tắc no-hardcode, alarm 4-state model chuẩn, BACnet status kỹ thuật, safe state per-point, service PIN/switch, data age mandatory, bỏ arc gauge và Power/Energy mặc định |
| 2.2 | 2026-06-30 | SW Lead/QA | Aligned I/O Monitor inventory to ADR-010 base SKU. |
