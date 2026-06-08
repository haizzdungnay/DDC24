# Hướng dẫn Sử dụng — MK-DDC-24

> **Tài liệu:** KX-DDC24-USER-001_VI  
> **Sản phẩm:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm  
> **Phiên bản:** 1.0 | 2026-06-02  
> **Mục đích:** Hướng dẫn vận hành, cấu hình và bảo trì — phục vụ hồ sơ CR Mark / QCVN (mục E4)

> ⚠️ **RECONCILE (2026-06-08).** Rev A cấu hình bằng **component-based graph** qua web
> **form + import `graph.json`** (không phải IEC 61131-3 FBD/ST, không Web IDE FBD).
> Nguồn-chuẩn: [PRODUCT_DEFINITION](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md), [ADR-004](../adr/ADR-004-component-based-runtime.md)/[006](../adr/ADR-006-rev-a-ui-form-json.md).

---

## 1. Giới thiệu

MK-DDC-24 là bộ điều khiển DDC 24 điểm cho HVAC (FCU, VAV, AHU nhỏ). Thiết bị chạy
Debian Linux trên SOM quad-core, cấu hình điều khiển bằng **component-based graph** —
kỹ sư gán/nối component và nạp cấu hình qua web (form + `graph.json`), không cần viết
firmware. (IEC 61131-3 FBD/ST là tầm nhìn Rev C, không thuộc Rev A.)

**Kênh kết nối chính:**
- **Northbound (lên BMS/cloud):** BACnet/IP, MQTT, REST API — qua Ethernet/WiFi.
- **Southbound (xuống thiết bị phụ):** Modbus RTU master trên RS-485.

---

## 2. Giao diện Người dùng

### 2.1 Màn hình HMI TFT 2.4"

Thiết bị có màn hình TFT màu 240×320 với 6 nút điều hướng (UP/DOWN/LEFT/RIGHT/ENTER/ESC).

**Màn hình chính (Dashboard):**
- 3 gauge vòng tròn hiển thị giá trị AI quan trọng.
- Network status (IP, BACnet connected).
- Uptime và fault indicator.

**Menu chính:**
| Mục | Nội dung |
|-----|----------|
| Dashboard | Gauge tổng quan |
| I/O Status | Giá trị thực 8 UI + 8 DI + 4 AO + 4 DO |
| Network Info | IP, BACnet status, MQTT status |
| Alarm List | ≥ 10 alarm gần nhất (timestamp + severity) |
| System Info | FW version, uptime, CPU temp, RAM % |

**Screen saver:** Màn hình tự giảm độ sáng sau 5 phút không nhấn nút. Nhấn bất kỳ nút nào để
đánh thức.

### 2.2 Web UI (cấu hình form/JSON)

Truy cập qua trình duyệt web (Chrome/Edge/Firefox):

- **LAN commissioning:** `http://<ip>:8080`
- **Production (hardened):** `https://<ip>:8443` (TLS 1.3)

**Tính năng Web UI:**
- Cấu hình component graph qua **form** + import/export `graph.json` (không FBD/ST).
- Cấu hình UI type per kênh (NTC/PT100/0-10V/4-20mA/dry contact).
- Force I/O (ghi tạm AO/DO để test — tự động expire sau 10 phút).
- Export point list → Excel/CSV.
- Cấu hình BACnet Device ID, IP tĩnh/DHCP.
- Cấu hình Modbus RTU master (poll thiết bị phụ + device profile).
- Trend log: interval, object list, download CSV.
- Audit log: tất cả action (login, config change, force I/O).

### 2.3 REST API

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/v1/points` | Danh sách points + giá trị |
| `GET /api/v1/points/{id}` | Giá trị point + timestamp |
| `PUT /api/v1/points/{id}` | Ghi giá trị (auth required) |
| `GET /api/v1/system/status` | CPU, RAM, uptime, FW version |
| `POST /api/v1/ota/apply` | Trigger OTA update |

Xác thực: Bearer token JWT (exp 1 giờ). Rate limit: 100 req/s/IP.

---

## 3. Vận hành

### 3.1 Khởi động

1. Cấp nguồn 24 VAC/VDC.
2. Đèn PWR xanh sáng.
3. Trong ≤ 30 giây, đèn RUN nhấp nháy 1 Hz → hệ thống sẵn sàng.

### 3.2 Chế độ vận hành

| Chế độ | Mô tả | Đèn RUN |
|--------|-------|---------|
| Normal | Điều khiển tự động, kết nối BACnet/IP | Nhấp nháy 1 Hz |
| Standalone | Mất BACnet > 30s → giữ output cuối (cấu hình safe-state) | Nhấp nháy chậm |
| Commissioning | Đang cấu hình / force I/O qua Web UI | Nhấp nháy nhanh |
| Fault | Lỗi hệ thống | FAULT đỏ sáng |

### 3.3 Tắt / Khởi động lại

- **Qua HMI:** Menu → System Info → Restart → xác nhận ENTER.
- **Qua Web UI:** Dashboard → Restart.
- **Cấp nguồn lại:** Ngắt và cấp nguồn 24V (không dùng với thiết bị đang chạy).

---

## 4. Cấu hình

### 4.1 Cấu hình mạng

**Ethernet:**
1. Truy cập Web UI → Network Configuration.
2. Chọn DHCP hoặc Static IP.
3. Nếu Static: nhập IP, subnet mask, gateway, DNS.
4. Apply → thiết bị áp dụng không cần reboot (connection bị ngắt tạm).

### 4.2 Cấu hình BACnet

1. Web UI → BACnet Settings.
2. Nhập Device ID (1–4.194.302) và Device Name.
3. APDU mặc định: 1476 bytes.
4. Apply → service restart tự động.

### 4.3 Cấu hình Modbus RTU Master

1. Đấu dây RS-485 (xem Hướng dẫn Lắp đặt §3.4).
2. Web UI → Field Bus Configuration.
3. Thêm slave:
   - Địa chỉ (1–247)
   - Device profile (chọn từ thư viện hoặc tùy chỉnh)
   - Baud rate, parity.
4. Lưu → DDC tự động bắt đầu poll.

### 4.4 Cấu hình Trend Log

1. Web UI → Trend Log.
2. Chọn object cần log (AI, AO, AV, ...).
3. Interval: 1–60 phút.
4. Buffer: 1.000 records/log.
5. Download CSV khi cần.

---

## 5. Commissioning

### 5.1 Quy trình Commissioning

1. **Kết nối:** Laptop cùng mạng LAN với thiết bị → truy cập Web UI.
2. **Cấu hình UI type:** Kênh UI1–UI8 chọn loại cảm biến (tự động nhận dạng — chỉ cần xác nhận).
3. **Nạp graph:** import `graph.json` → validator (4 check an toàn) → deploy.
4. **Force I/O test:** Kiểm tra từng AO/DO → xác nhận actuator/relay hoạt động.
5. **BACnet discovery:** BMS gửi Who-Is → DDC trả I-Am.
6. **Validate trend:** Kích hoạt trend → kiểm tra dữ liệu sau 5 phút.

### 5.2 FAT/SAT Checklist

Sử dụng Web UI → FAT/SAT Checklist:
- Đánh dấu từng kênh I/O đã test → lưu timestamp + tên người test.
- Export báo cáo → in ký.

---

## 6. OTA Firmware Update

1. Admin upload firmware package (.deb signed) lên KINEXUS portal.
2. DDC download package qua HTTPS (TLS 1.3).
3. Flash vào partition B.
4. Reboot → U-Boot verify GPG → boot B.
5. Nếu boot thất bại 2 lần → rollback tự động về A.
6. Downtime khi reboot ≤ 60 giây.

Kiểm tra phiên bản sau OTA: HMI → System Info hoặc Web UI → Dashboard.

---

## 7. Bảo trì

### 7.1 Bảo trì định kỳ

| Tần suất | Nội dung |
|----------|----------|
| Hàng tuần | Kiểm tra đèn LED, alarm list |
| Hàng tháng | Download trend log, kiểm tra kết nối BACnet/MQTT |
| 6 tháng | Kiểm tra log dung lượng, xoay log nếu cần |
| 12 tháng | OTA firmware update lên phiên bản mới nhất |

### 7.2 Sao lưu & Phục hồi

- **Export cấu hình:** Web UI → Backup → download `graph.json` + config.
- **Import:** Web UI → Restore → upload `graph.json` + config.
- **Factory reset:** Sử dụng microSD recovery image (xem Phụ kiện trong DS).

---

## 8. Xử lý Sự cố Thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|------------|-------------|-------|
| Đèn PWR không sáng | Mất nguồn 24V | Kiểm tra nguồn, cầu chì, MCB |
| Đèn FAULT đỏ | Lỗi hệ thống | Xem fault code trên HMI → System Info |
| Mất kết nối BACnet | Ethernet lỗi, sai Device ID | Kiểm tra cáp, ping IP, kiểm tra Device ID |
| Không vào được Web UI | Sai IP, port blocked | Kiểm tra IP (xem trên HMI → Network Info) |
| UI đọc sai giá trị | Sai loại cảm biến | Kiểm tra UI type trong Web UI |
| Modbus mất kết nối slave | Lỗi dây RS-485, sai baud | Kiểm tra A/B, termination, baud rate |
| HMI không hiển thị | Lỗi service LVGL | Restart qua SSH (nếu được hỗ trợ) |

---

## 9. Thông số Kỹ thuật

| Thông số | Giá trị |
|----------|---------|
| Bộ xử lý | Rockchip RK3566, 4× Cortex-A55 @ 1.8 GHz |
| RAM | 2 GB LPDDR4 |
| Storage | 8 GB eMMC + microSD slot |
| OS | Debian 12 (Bookworm), kernel PREEMPT_RT |
| I/O | 8 UI + 8 DI + 4 AO + 4 DO |
| Nguồn | 24 VAC/VDC ±20%, < 8W |
| Kích thước | 150 × 90 × 55 mm |
| Trọng lượng | ~300 g |
| Nhiệt độ làm việc | 0°C đến +55°C |
| Nhiệt độ bảo quản | -40°C đến +85°C |
| Độ ẩm | 10–90% RH, không ngưng tụ |
| IP | IP20 |
| Lắp đặt | DIN-rail 35 mm hoặc mounting flange |

---

## 10. Liên hệ Hỗ trợ

**KINEXUS Technologies JSC**  
Lô I-3, Khu Công nghệ Cao, Quận 9, TP. Hồ Chí Minh

📧 support@KINEXUS-tech.vn  
📞 1900-xxxx (8h–17h, T2–T6)  
📘 Tài liệu online: [DS_MK-DDC-24_VI](../01_specs/DS_MK-DDC-24_VI.md)

---

**Document ID:** KX-DDC24-USER-001_VI  
**Revision:** 1.0 | 2026-06-02  
**Related docs:** [KX-DDC24-INSTALL-001_VI](KX-DDC24-INSTALL-001_VI.md) | [KX-DDC24-SWDESC-001_VI](KX-DDC24-SWDESC-001_VI.md)
