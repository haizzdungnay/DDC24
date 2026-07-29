# SRS — MK-DDC-24 Software Requirements Specification

> **Phiên bản:** 2.3 | 2026-07-27
> **Trạng thái:** Draft — Ver 1
> **Tác giả:** KINEXUS Technologies — Software Team
> **Chuẩn tham chiếu:** IEC 62443-4-1, BACnet ASHRAE 135, IEC 61131-3-aligned (roadmap Rev A.0, ADR-020, đang C0 — không phải Rev C, nhưng cũng chưa release/certified)
> **Liên quan:** [DS](DS_MK-DDC-24_VI.md) | [PRD](PRD_MK-DDC-24_VI.md) | [HW_SPEC](HW_SPEC_MK-DDC-24_VI.md)

> ⚠️ **RECONCILE (2026-07-23, ADR-020 supersedes 2026-06-08 banner cũ).** Mô hình điều
> khiển **chạy thật hôm nay** là component-based graph ([ADR-004](../adr/ADR-004-component-based-runtime.md),
> nay legacy-importer theo [ADR-020](../adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md)).
> Engine/runtime hiện tại trace theo
> [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) (`RUN-*`). **Riêng mục 4 "Soft PLC Runtime" dưới đây (PLC-001..006) không còn là
> "tầm nhìn Rev C"** — đã trở thành roadmap Rev A.0 chính thức qua ADR-020: Mekong-owned
> Program Runtime, IEC 61131-3-aligned, scope **ST + FBD** (không LD/SFC, không online
> change, không certified/compliant), hiện ở giai đoạn C0 (chưa release). Nguồn-chuẩn
> sản phẩm: [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md).
> I/O/IOP baseline theo [ADR-010](../adr/ADR-010-iop-v2-poll-capability-map.md) và `shared/iop_protocol.h`.

---

## 1. Giới thiệu

### 1.1 Phạm vi

Tài liệu này định nghĩa các yêu cầu phần mềm cho **hệ thống firmware và application** của MK-DDC-24, bao gồm:

- **OS Layer:** Debian 12 Linux trên SOM quad-core ARM Cortex-A55 (Radxa CM3 / RK3566)
- **Soft PLC Runtime:** component graph (chạy thật hôm nay) + Mekong Program Runtime IEC 61131-3-aligned (FBD, ST) — roadmap ADR-020, đang C0, chưa release
- **BACnet Stack:** BACnet/IP (Annex J), PICS-compliant *(MS/TP loại bỏ — ARCH-R010)*
- **Communication Services:** Northbound (IP): BACnet/IP, MQTT, REST API · Southbound (RS-485): **Modbus RTU master** xuống thiết bị phụ
- **I/O Driver Layer:** Giao tiếp SOM ↔ MCU qua Kinexus-IOP protocol
- **Security Services:** TLS, secure boot, auth, audit logging
- **OTA Update System:** A/B partition, signed packages

### 1.2 Tài liệu Tham chiếu

| Tài liệu | Mô tả |
|---------|-------|
| ASHRAE 135-2020 | BACnet — A Data Communication Protocol for Building Automation |
| IEC 61131-3:2013 | Programming languages for PLCs |
| IEC 62443-4-1:2018 | Secure product development lifecycle |
| IEC 62443-4-2:2019 | Technical security requirements for components |
| IEC 61709:2017 | Electronic components — Reliability — Reference conditions |
| Debian Policy Manual | Packaging và OS configuration policy |
| PREEMPT_RT Wiki | Real-time Linux patch |

---

## 2. Kiến trúc Phần mềm Tổng thể

```
┌──────────────────────────────────────────────────────┐
│                SOM — Debian 12 Linux                  │
│  ┌────────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ KinexusET  │  │ BACnet    │  │  MQTT / REST API  │ │
│  │  Web IDE   │  │  Stack    │  │  (kinexus-agent)  │ │
│  └─────┬──────┘  └─────┬─────┘  └────────┬─────────┘ │
│        │               │                  │            │
│  ┌─────▼───────────────▼──────────────────▼─────────┐ │
│  │           Soft PLC Runtime (IEC 61131-3)          │ │
│  │   FBD engine │ ST engine │ Scheduler │ Data model  │ │
│  └────────────────────────┬──────────────────────────┘ │
│                            │                           │
│  ┌─────────────────────────▼──────────────────────┐   │
│  │         I/O Abstraction Layer (kinexus-iohal)   │   │
│  └────────────────────────┬───────────────────────┘   │
│                            │ Kinexus-IOP (UART 921600, isolated)    │
└───────────────────────────-│───────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────┐
│              MCU — STM32G0 (FreeRTOS)                  │
│  ADC sampling │ DAC output │ GPIO │ Relay driver       │
└────────────────────────────────────────────────────────┘
```

---

## 3. Yêu cầu OS & Môi trường chạy

### 3.1 Hệ điều hành

| ID | Yêu cầu | Loại |
|----|---------|------|
| OS-001 | OS PHẢI là Debian 12 (Bookworm), stable release | MUST |
| OS-002 | Kernel PHẢI dùng PREEMPT_RT patch để đạt real-time scheduling | MUST |
| OS-003 | Soft PLC process PHẢI được cấp SCHED_FIFO priority ≥ 80 | MUST |
| OS-004 | Rootfs PHẢI read-only (OverlayFS), chỉ `/data` và `/var` là writable | MUST |
| OS-005 | PHẢI dùng systemd với unit watchdog (WatchdogSec) cho mọi service | MUST |
| OS-006 | Không được cài package ngoài danh sách đã kiểm duyệt (allowlist) | MUST |
| OS-007 | PHẢI kích hoạt AppArmor profiles cho toàn bộ service | SHOULD |
| OS-008 | Login console tắt trên production build, chỉ SSH key-based | MUST |

### 3.2 Boot Sequence

```
Power ON
  └─► U-Boot (verified boot)
        └─► Verify kernel signature (GPG)
              ├─ FAIL → Rollback partition (A/B) + log event
              └─ PASS → Load kernel + initramfs
                          └─► Debian init (systemd)
                                ├─► kinexus-io-driver.service
                                ├─► kinexus-plc.service (soft PLC)
                                ├─► kinexus-bacnet.service
                                ├─► kinexus-agent.service (MQTT/REST)
                                └─► kinexus-webide.service (KinexusET)
```

**Thời gian boot đến PLC ready:** ≤ 30 giây (cold boot).

---

## 4. Soft PLC Runtime — Mekong Program Runtime, IEC 61131-3-aligned (roadmap Rev A.0, ADR-020, đang C0, chưa release; không certified/compliant)

### 4.1 Yêu cầu Ngôn ngữ

| ID | Yêu cầu |
|----|---------|
| PLC-001 | PHẢI hỗ trợ Function Block Diagram (FBD) per IEC 61131-3 |
| PLC-002 | PHẢI hỗ trợ Structured Text (ST) per IEC 61131-3 |
| PLC-003 | Standard Function Blocks PHẢI có: TON, TOF, TP, CTU, CTD, CTUD, RS, SR, F_TRIG, R_TRIG |
| PLC-004 | PHẢI cung cấp PID_COMPACT block với proportional, integral, derivative tuning |
| PLC-005 | PID PHẢI hỗ trợ bumpless transfer (manual ↔ auto) |
| PLC-006 | PHẢI hỗ trợ ≥ 16 FBD programs chạy song song |
| PLC-007 | PHẢI cho phép enable/disable từng program qua BACnet object |

### 4.2 Scheduler & Timing

| ID | Yêu cầu |
|----|---------|
| PLC-010 | Chu kỳ scan mặc định 100 ms, cấu hình 50 ms – 2.000 ms |
| PLC-011 | Jitter chu kỳ scan PHẢI ≤ 5 ms (đo trong 1 giờ liên tục) |
| PLC-012 | Watchdog PLC PHẢI trigger nếu scan overrun > 3× chu kỳ liên tiếp |
| PLC-013 | Khi PLC watchdog trigger: output về safe-state, ghi event log, restart service |

### 4.3 Data Model

| ID | Yêu cầu |
|----|---------|
| PLC-020 | PHẢI ánh xạ (map) tự động I/O vật lý → BACnet objects (AI/AO/BI/BO) và Modbus register map |
| PLC-021 | PHẢI cung cấp global variable space ≥ 512 biến (REAL, BOOL, INT, DWORD) |
| PLC-022 | Biến retain (RETAIN) PHẢI lưu vào flash khi mất điện trong < 1 s |
| PLC-023 | Sau khi khôi phục điện, PLC PHẢI phục hồi biến retain và tiếp tục program |

---

## 5. BACnet Stack

### 5.1 Conformance Class & Objects

| Object Type | Số lượng | Read | Write | COV |
|-------------|:--------:|:----:|:-----:|:---:|
| Device | 1 | ✅ | ✅ | — |
| Analog Input (AI) | 8 | ✅ | — | ✅ |
| Analog Output (AO) | 4 | ✅ | ✅ | ✅ |
| Analog Value (AV) | 32 | ✅ | ✅ | ✅ |
| Binary Input (BI) | 8 | ✅ | — | ✅ |
| Binary Output (BO) | 4 | ✅ | ✅ | ✅ |
| Binary Value (BV) | 16 | ✅ | ✅ | ✅ |
| Multi-state Value (MSV) | 8 | ✅ | ✅ | ✅ |
| Trend Log | 8 | ✅ | — | — |
| Schedule | 8 | ✅ | ✅ | — |
| Calendar | 2 | ✅ | ✅ | — |
| Notification Class | 4 | ✅ | ✅ | — |
| Event Enrollment | 8 | ✅ | ✅ | — |

### 5.2 Yêu cầu Protocol

> ⚠ **Cập nhật 2026-05-30 (ARCH-R010):** BACnet **CHỈ qua BACnet/IP** (Ethernet/WiFi). **BỎ BACnet MS/TP** — cổng RS-485 dành 100% cho Modbus RTU master (§6.3). Northbound chỉ chạy trên IP.

| ID | Yêu cầu |
|----|---------|
| BAC-001 | PHẢI hỗ trợ **BACnet/IP (Annex J)** trên Ethernet/WiFi, UDP/47808 *(MS/TP đã loại bỏ — ARCH-R010)* |
| BAC-002 | PHẢI hỗ trợ BBMD / Foreign-Device registration (cho BACnet/IP qua router) |
| BAC-003 | PHẢI hỗ trợ Who-Is, I-Am, Read-Property, Write-Property |
| BAC-004 | PHẢI hỗ trợ Read-Property-Multiple, Write-Property-Multiple |
| BAC-005 | PHẢI hỗ trợ Subscribe-COV và Unsubscribe-COV |
| BAC-006 | PHẢI hỗ trợ Confirmed-Event-Notification (Alarm) |
| BAC-007 | PHẢI hỗ trợ Time-Synchronization (master và slave) |
| BAC-008 | Max APDU: 1476 bytes (BACnet/IP) |
| BAC-009 | Segmentation: hỗ trợ trên BACnet/IP (both) |
| BAC-010 | Device ID PHẢI cấu hình 1 – 4.194.302 (không trùng trên mạng) |
| BAC-011 | PHẢI pass BACnet BTL conformance test (profile B-ASC, BACnet/IP) trước khi ship GA |

---

## 6. Communication Services

### 6.1 MQTT

| ID | Yêu cầu |
|----|---------|
| MQ-001 | PHẢI hỗ trợ MQTT v3.1.1 và v5.0 |
| MQ-002 | TLS 1.3 BẮT BUỘC, certificate pinning SHOULD |
| MQ-003 | Topic structure: `kinexus/{device_id}/io/{point_name}` |
| MQ-004 | PHẢI publish tất cả AI/AO/BI/BO thay đổi (COV-based) |
| MQ-005 | Retain message PHẢI bật cho last-value topics |
| MQ-006 | PHẢI hỗ trợ Last Will & Testament (LWT) cho trạng thái offline |
| MQ-007 | Reconnect tự động với exponential backoff (max 5 phút) |

### 6.2 ~~Modbus TCP slave~~ — ĐÃ LOẠI BỎ (ARCH-R010)

> ⚠ **Cập nhật 2026-05-30:** **BỎ Modbus TCP slave.** Northbound lên BMS/SCADA dùng **BACnet/IP + MQTT + REST** (đều trên IP). DDC **không** phục vụ Modbus về phía BMS. Vai trò Modbus duy nhất của DDC là **RTU master xuống thiết bị phụ** (§6.3). Các ID MB-001..009 cũ huỷ bỏ.

### 6.3 Modbus RTU Master — Field Bus xuống thiết bị phụ (RS-485)

> ✅ **Mô hình (ARCH-R010):** RS-485 dành **100%** cho **Modbus RTU MASTER**. DDC là **master**, chủ động poll các slave là **thiết bị phụ**: module mở rộng I/O, màn hình phụ (remote HMI), thiết bị Modbus bên thứ 3 (đồng hồ điện, biến tần, cảm biến). Thiết kế theo **khung mở (device profile)** — thêm loại slave mới chỉ bằng cấu hình. Chi tiết: [D-2 Modbus RTU Master/Expansion ICD](../02_design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md), [SW_FIELDBUS_DESIGN](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md).

| ID | Yêu cầu |
|----|----------|
| RTU-001 | PHẢI hoạt động như **Modbus RTU master** trên RS-485, poll nhiều slave theo chu kỳ cấu hình |
| RTU-002 | PHẢI hỗ trợ **device profile** (template register-map) để thêm loại thiết bị phụ mới bằng cấu hình, không cần đổi code |
| RTU-003 | Baud rate: 9.600 / 19.200 / 38.400 / 57.600 / 115.200 bps; 8N1/8E1/8O1 (cấu hình) |
| RTU-004 | PHẢI hỗ trợ FC03/04 (đọc), FC06/16 (ghi) tới slave; map điểm slave vào shared memory / biến PLC |
| RTU-005 | PHẢI phát hiện slave mất kết nối (timeout/CRC) → đánh dấu điểm "bad quality" + sinh alarm |
| RTU-006 | Hỗ trợ tối thiểu **16 slave** trên 1 bus (mở rộng được); địa chỉ slave 1–247 |
| RTU-007 | Module mở rộng I/O và remote HMI của Kinexus có profile chuẩn sẵn (plug-and-play) |
| RTU-008 | KHÔNG hoạt động như Modbus slave (DDC không phục vụ Modbus về phía BMS) |


### 6.4 REST API

| ID | Yêu cầu |
|----|---------|
| API-001 | PHẢI cung cấp REST API HTTPS (TLS 1.3) trên port 8443 |
| API-002 | Authentication: Bearer token (JWT, exp 1 giờ) |
| API-003 | `GET /api/v1/points` — danh sách tất cả points + giá trị |
| API-004 | `GET /api/v1/points/{id}` — đọc giá trị + timestamp |
| API-005 | `PUT /api/v1/points/{id}` — ghi giá trị (auth required) |
| API-006 | `GET /api/v1/system/status` — CPU, RAM, uptime, firmware version |
| API-007 | `POST /api/v1/ota/apply` — trigger OTA update |
| API-008 | Rate limiting: 100 requests/giây per IP |
| API-009 | PHẢI trả HTTP 429 khi vượt rate limit |

### 6.5 I/O Protocol nội bộ (Kinexus-IOP)

| ID | Yêu cầu |
|----|---------|
| IOP-001 | SOM giao tiếp với MCU qua UART 921600 baud + CRC16 frame check |
| IOP-002 | SOM poll MCU mỗi 2 ms (500 Hz) và MCU trả snapshot hoàn chỉnh mới nhất |
| IOP-003 | MCU trả IO_RESP 74 byte: 16 × int32 signed UI raw, 2 ADC status, MCU temp, fault flags, sample counter, DO feedback; base SKU không có DI_MASK |
| IOP-004 | SOM ghi AO (16-bit, DAC8554) và DO (4-bit) xuống MCU trong frame riêng |
| IOP-005 | Response timeout 3 ms, retry tối đa 3 lần; 20 ms không có response hợp lệ thì set fault/log; MCU mất GET_IO 200 ms thì vào safe-state |
| IOP-006 | Protocol PHẢI có sequence number để phát hiện missed frame |

---

## 7. Security Requirements (IEC 62443-4-1 / 4-2)

### 7.1 Secure Development Lifecycle (SDL)

| ID | Yêu cầu |
|----|---------|
| SEC-001 | Toàn bộ code PHẢI đi qua static analysis (cppcheck, Semgrep) |
| SEC-002 | Dependency scanning PHẢI chạy mỗi build (trivy, grype) |
| SEC-003 | PHẢI có SBOM (Software Bill of Materials) cho mỗi release |
| SEC-004 | Penetration test PHẢI thực hiện trước mỗi major release |
| SEC-005 | CVE CVSS ≥ 7.0 PHẢI được vá trước khi ship |
| SEC-006 | CVE CVSS 4.0–6.9 PHẢI được vá trong vòng 30 ngày |

### 7.2 Secure Boot & Update

| ID | Yêu cầu |
|----|---------|
| SEC-010 | U-Boot PHẢI verify GPG signature của kernel trước khi boot |
| SEC-011 | Firmware package PHẢI là Debian .deb với GPG signature |
| SEC-012 | A/B partition: nếu boot partition B thất bại 2 lần → rollback về A |
| SEC-013 | Private key ký firmware PHẢI là HSM-protected (không lưu plain text) |
| SEC-014 | Rollback prevention: không được downgrade xuống version có CVE đã fix |

### 7.3 Network & Authentication

| ID | Yêu cầu |
|----|---------|
| SEC-020 | nftables firewall PHẢI chặn mọi port trừ: **2222** (SSH, non-default; PHẢI đổi khỏi 22 trong provisioning), **8080** (KinexusET HTTP, LAN only), **443/8443** (HTTPS), **47808** (BACnet/IP), **502** (Modbus TCP), **8883** (MQTT over TLS). **Port 1883 (MQTT plaintext) MẶC ĐỊNH bị chặn** vì MQ-002 bắt buộc TLS; chỉ mở 1883 nếu admin chủ động bật cho mạng nội bộ tin cậy |
| SEC-021 | SSH PHẢI disable password auth, chỉ dùng RSA/ED25519 key |
| SEC-022 | Root login PHẢI bị disable |
| SEC-023 | Web UI PHẢI brute-force protection: lockout 15 phút sau 5 lần sai |
| SEC-024 | Session token PHẢI invalidate khi logout |
| SEC-025 | Audit log PHẢI ghi: login success/fail, config change, firmware update, point write |

---

## 8. OTA Update System

| ID | Yêu cầu |
|----|---------|
| OTA-001 | PHẢI hỗ trợ A/B (active/standby) partition scheme |
| OTA-002 | Download firmware qua HTTPS với TLS 1.3 + cert validation |
| OTA-003 | PHẢI verify checksum (SHA-256) và GPG signature trước khi apply |
| OTA-004 | PHẢI update MCU firmware đồng thời với SOM firmware |
| OTA-005 | Nếu boot sau OTA thất bại 2 lần → rollback tự động về partition trước |
| OTA-006 | Quá trình download + chuẩn bị OTA PHẢI xảy ra trong nền, không ảnh hưởng điều khiển thời gian thực; bao giờ cũng giảm gián đoạn tối đa — nếu cần reboot để apply thì downtime PHẢI ≤ 60 giây (x. OTA-007) |
| OTA-007 | Thời gian downtime khi apply + reboot PHẢI ≤ 60 giây |
| OTA-008 | PHẢI ghi log: version trước, version sau, timestamp, kết quả |

---

## 9. Logging & Diagnostics

| ID | Yêu cầu |
|----|---------|
| LOG-001 | PHẢI ghi system log vào `/data/log/` (persistent across reboot) |
| LOG-002 | Log rotation: max 50 MB, giữ 7 ngày |
| LOG-003 | PHẢI hỗ trợ Syslog remote (UDP/TCP) cho tích hợp với SIEM |
| LOG-004 | BACnet alarm event PHẢI ghi timestamp ISO8601 + severity |
| LOG-005 | PHẢI cung cấp API download log (`GET /api/v1/logs/download`) |
| LOG-006 | Diagnostics endpoint PHẢI trả: CPU%, RAM usage, uptime, I/O fault status |

---

## 10. Testing Requirements

### 10.1 Unit & Integration Test

| ID | Yêu cầu |
|----|---------|
| TEST-001 | Code coverage unit test PHẢI ≥ 80% cho core modules (PLC engine, BACnet) |
| TEST-002 | BACnet protocol test PHẢI dùng BACnet Stack Test Tool (ASHRAE) |
| TEST-003 | I/O driver PHẢI có Hardware-in-the-Loop (HIL) test tự động |
| TEST-004 | PHẢI có regression test suite chạy tự động trên CI/CD |

### 10.2 Acceptance Test (FAT/SAT)

| Test | Tiêu chí |
|------|---------|
| Boot time | Cold boot → PLC ready ≤ 30 s |
| PLC scan jitter | Jitter ≤ 5 ms trong 1 giờ |
| BACnet Who-Is response | < 100 ms |
| OTA update | Thành công + rollback tự động khi bị lỗi |
| Failsafe | Output hold last value sau 30 s mất BACnet |
| Auth brute force | Lockout sau 5 lần sai |
| Uptime stress | 72 giờ liên tục, không crash, không memory leak |

---

## 11. KinexusET Web IDE Requirements

KinexusET là web IDE browser-based chạy trên chính thiết bị.

- **Development / LAN commissioning:** `http://<ip>:8080` (HTTP, chỉ dùng trong mạng nội bộ khi commissioning)
- **Production (hardened build):** HTTP 8080 tự động redirect sang HTTPS 8443; không cần cài phần mềm trên máy tính SI.

> ⚠️ **Chính sách production:** Port 8080 chỉ mở trong LAN VLAN nội bộ (commissioning VLAN). Firewall DMZ chặn 8080 từ WAN. REST API (8443) luôn HTTPS.

### 11.1 Giao diện & Lập trình

| ID | Yêu cầu | Loại |
|----|---------|------|
| IDE-001 | PHẢI cung cấp editor FBD dạng drag-and-drop trên trình duyệt (Chrome/Edge/Firefox) | MUST |
| IDE-002 | PHẢI cung cấp editor Structured Text (ST) với syntax highlighting | MUST |
| IDE-003 | PHẢI có thư viện function block chuẩn: TON, TOF, PID_COMPACT, Hysteresis, Ramp, Avg | MUST |
| IDE-004 | PHẢI cho phép tạo, lưu, xóa, rename chương trình FBD/ST | MUST |
| IDE-005 | PHẢI hỗ trợ import/export chương trình dạng file (`.kxp` hoặc XML) | MUST |
| IDE-006 | PHẢI hiển thị realtime value trên wire kết nối khi đang run (live watch) | MUST |
| IDE-007 | PHẢI có compile-time error check trước khi upload lên PLC | MUST |
| IDE-008 | PHẢI hỗ trợ ≥ 2 người dùng xem đồng thời (read-only cho viewer thứ 2) | SHOULD |

### 11.2 I/O Configuration & Commissioning

| ID | Yêu cầu | Loại |
|----|---------|------|
| IDE-010 | PHẢI cung cấp trang cấu hình UI type per kênh (NTC10k / PT100 / 0-10V / 4-20mA / Dry contact) | MUST |
| IDE-011 | PHẢI hiển thị giá trị đo thực của từng kênh I/O theo dạng bảng realtime (refresh ≤ 1s) | MUST |
| IDE-012 | PHẢI cung cấp chức năng Force I/O: ghi giá trị tạm thời lên AO/DO để test | MUST |
| IDE-013 | Force I/O PHẢI tự động expire sau ≤ 10 phút nếu người dùng không tương tác | MUST |
| IDE-014 | PHẢI hiển thị trạng thái relay DO (đóng/mở) với indication màu sắc | MUST |
| IDE-015 | PHẢI cho phép export point list ra Excel/CSV (BACnet object name, instance, unit) | MUST |
| IDE-016 | PHẢI có checklist FAT/SAT: đánh dấu từng kênh đã test, lưu timestamp + tên người test | SHOULD |

### 11.3 BACnet & Network Configuration

| ID | Yêu cầu | Loại |
|----|---------|------|
| IDE-020 | PHẢI cho phép đặt BACnet Device ID (1–4.194.302) và Device Name qua web UI | MUST |
| IDE-021 | PHẢI cho phép đặt IP tĩnh / DHCP qua web UI | MUST |
| IDE-022 | PHẢI cho phép cấu hình **RS-485 Modbus RTU master**: baud/parity, danh sách slave (địa chỉ + device profile), chu kỳ poll | MUST |
| IDE-023 | PHẢI hiển thị thống kê field bus: trạng thái từng slave (online/offline), tỉ lệ lỗi CRC/timeout | SHOULD |
| IDE-024 | PHẢI cho phép cấu hình Trend Log (interval, object list, buffer size) | MUST |
| IDE-025 | PHẢI cho phép download Trend Log dạng CSV | MUST |

### 11.4 Security & Session

| ID | Yêu cầu | Loại |
|----|---------|------|
| IDE-030 | PHẢI có authentication cho Web bằng đúng bốn local user role: `viewer`, `operator`, `engineer`, `admin` | MUST |
| IDE-031 | Session timeout: tự động logout sau 30 phút idle | MUST |
| IDE-032 | Admin PHẢI có thể tạo/xóa/đổi mật khẩu tài khoản qua web UI | MUST |
| IDE-033 | Tất cả action/denial (force I/O, alarm operation, upload/deploy program, config/user change) PHẢI được ghi audit log và redact password/token/secret/payload nhạy cảm | MUST |
| IDE-034 | Web IDE PHẢI hỗ trợ HTTPS (TLS 1.3) trên port 8443; trong production build, HTTP 8080 PHẢI redirect tự động sang HTTPS 8443 | MUST |
| IDE-035 | Web PHẢI authorize deny-by-default theo capability: Viewer chỉ đọc ngoài đổi mật khẩu cá nhân và Display/language local; Operator thêm runtime operation/commissioning/alarm action và edit/validate/build program nhưng không Settings/config hoặc deploy; Engineer thêm Settings/config/network/deploy/rollback/OTA/log nhưng không Users hoặc database historian mutation; Admin có toàn bộ business capability | MUST |
| IDE-036 | JWT PHẢI đối chiếu `session_version` lưu bền vững mỗi request; đổi role/password hoặc xóa user phải vô hiệu token account-wide ngay, và hệ thống PHẢI chặn self-delete cùng demote/xóa admin cuối bằng `409` | MUST |

---

## 12. HMI Display Software Requirements

Màn hình local 2.4" KD024QVFIA073-02-C021B/JD9852 dùng MIPI DSI một lane,
cảm ứng FT5436 qua I2C/evdev và DRM/KMS. HMI là presentation/limited-operator
service tùy chọn, không phải control authority và không phụ thuộc kết nối mạng để
đọc trạng thái local. Phạm vi này không bao gồm full Web HMI/SCADA.

### 12.1 Display Application

| ID | Yêu cầu | Loại |
|----|---------|------|
| HMI-001 | PHẢI chạy LVGL v9 userspace trên Debian, render qua DRM/KMS `/dev/dri/card0`; không dùng fbdev/fbtft/ILI9341 | MUST |
| HMI-002 | Frame rate PHẢI ≥ 10 FPS trên target đã chọn | MUST |
| HMI-003 | Home PHẢI dùng bố cục glanceable trung tính, dành màu bão hòa cho abnormal/attention; không bắt buộc arc gauge | MUST |
| HMI-004 | PHẢI hiển thị network status kỹ thuật, uptime, data quality/age và fault indicator; không gọi BACnet/IP UDP là `connected` | MUST |
| HMI-005 | Telemetry hiển thị PHẢI lấy từ shared memory read-only do `mkddc-iobus`/`mkddc-core` xuất bản; không polling qua network và không dùng SHM làm command channel | MUST |
| HMI-006 | Refresh dữ liệu trên màn hình PHẢI ≤ 1 giây | MUST |
| HMI-007 | PHẢI có screen saver (dim backlight sau 5 phút không nhấn nút) | SHOULD |
| HMI-008 | Backlight PHẢI bật lại khi touch hoặc nhấn bất kỳ nút nào; thao tác đầu chỉ wake, không kích hoạt lệnh | MUST |
| HMI-009 | Mọi trạng thái PHẢI có text/symbol/shape ngoài màu; coding màu và actuator phải được review theo IEC 60073 | MUST |

### 12.2 Navigation & Menu

| ID | Yêu cầu | Loại |
|----|---------|------|
| HMI-010 | PHẢI hỗ trợ song song touch và 6 nút (UP/DOWN/LEFT/RIGHT/ENTER/ESC), với focus nhìn thấy được | MUST |
| HMI-011 | Menu PHẢI gồm đúng năm surface: Home / Points / Control / Alarms / Service; communication/system diagnostics phải được giữ trong Home/Service | MUST |
| HMI-012 | PHẢI hiển thị danh sách ≥ 10 alarm gần nhất với timestamp và mức độ | MUST |
| HMI-013 | PHẢI hiển thị 16 UI + 4 AO + 4 DO của base SKU; DI chỉ hiển thị trên optional SKU khi capability map xác nhận | MUST |
| HMI-014 | Từ màn hình System Info PHẢI hiển thị: firmware version, uptime, CPU temp, RAM% | MUST |
| HMI-015 | Restart/reboot PHẢI yêu cầu quyền, tóm tắt ảnh hưởng và xác nhận giữ 3 giây; safe state phải được core chấp nhận trước reboot | MUST |
| HMI-016 | ACK alarm PHẢI được gửi tới alarm authority, ghi user/time/result vào audit trail và không được làm mất alarm đang active | MUST |
| HMI-017 | Alarm PHẢI có priority, state, timestamp, source, message và operator response text; lifecycle/historian/metrics được quản lý theo alarm philosophy dựa trên IEC 62682 | MUST |
| HMI-018 | Service action PHẢI fail-closed khi identity/role không xác định; role từ file cấu hình hoặc PIN đơn lẻ không được coi là production identity | MUST |
| HMI-019 | Action chưa triển khai hoặc thiếu telemetry PHẢI ẩn/disable với lý do rõ ràng; không hiển thị dữ liệu giả như trạng thái thật | MUST |

### 12.3 Localization

| ID | Yêu cầu | Loại |
|----|---------|------|
| HMI-020 | Label trên HMI PHẢI hỗ trợ tiếng Anh (mặc định) và tiếng Việt (Unicode UTF-8) | MUST |
| HMI-021 | Font PHẢI bao gồm ký tự có dấu tiếng Việt (LVGL lv_font_montserrat + NotoSans) | MUST |
| HMI-022 | Ngôn ngữ hiển thị cấu hình được qua web UI, áp dụng không cần reboot | SHOULD |
| HMI-023 | Mọi hành động thay đổi trạng thái PHẢI có audit gồm timestamp đồng bộ, user/role, action, target, old/new value và result | MUST |
| HMI-024 | Thiết kế PHẢI qua scenario usability test trên panel thật với operator/commissioning/service, gồm găng tay, alarm flood, stale data và mất I/O | MUST |
| HMI-025 | Control PHẢI chỉ hiển thị point được authoritative policy whitelist; input/raw/feedback, PID, mapping, calibration, alarm configuration và safety policy là read-only hoặc không xuất hiện với Operator | MUST |
| HMI-026 | Setpoint/mode/override/release PHẢI qua authenticated local broker rồi core priority/interlock/safety; HMI không được ghi command trực tiếp vào SHM hoặc hardware | MUST |
| HMI-027 | Override PHẢI có reason, bounded TTL, actor, policy priority và explicit release; effective source/priority/expiry phải hiển thị từ authoritative response | MUST |
| HMI-028 | Nếu broker/core/alarm authority unavailable hoặc timeout, mutation PHẢI disable/fail rõ và HMI tiếp tục read-only; không replay command cũ khi reconnect | MUST |
| HMI-029 | Production session PHẢI fail closed, idle expiry không quá 15 phút và audit login/logout/denial; static role/PIN trong `hmi.conf` không phải identity hợp lệ | MUST |
| HMI-030 | Touch target hành động PHẢI tối thiểu 40×40 px hoặc có nút cứng tương đương; body text tối thiểu 14 px và focus phải quan sát được | MUST |
| HMI-031 | Nominal telemetry refresh PHẢI ≤1 s; command accepted/rejected/timeout feedback PHẢI ≤2 s; duplicate request ID không được tạo double action | MUST |
| HMI-032 | Local point DB chỉ được dùng cho presentation; quyền, range, priority và TTL PHẢI được authority revalidate tại mỗi mutation | MUST |

---

## 13. Fault Code Catalog

Mọi fault event ghi vào `/data/log/fault.log` với format:
```
[ISO8601 timestamp] [SEVERITY] [CODE] [MODULE] [description]
Ví dụ: 2026-05-28T14:23:01+07:00 ERROR E101 MCU_IOP MCU no response for 100ms
```

### 13.1 System Faults (E1xx)

| Code | Mức | Module | Mô tả | Hành động |
|------|:---:|--------|-------|----------|
| E101 | ERROR | MCU_IOP | MCU không phản hồi > 100ms | Set fault flag, log, output hold last value |
| E102 | ERROR | MCU_IOP | Sequence number gap detected (missed frame) | Log, tăng counter |
| E103 | CRITICAL | MCU_IOP | MCU không phản hồi liên tục > 5s | Output về safe-state, ghi critical log |
| E104 | WARNING | WATCHDOG | PLC scan overrun > 3× liên tiếp | Log event, restart PLC service |
| E105 | ERROR | WATCHDOG | HW watchdog kick fail | Auto reboot |
| E110 | WARNING | POWER | Undervoltage rail +3.3V < 3.1V | Log, cảnh báo LED |
| E111 | WARNING | POWER | Nhiệt độ MCU > 85°C | Log, throttle output update rate |
| E112 | CRITICAL | POWER | Nhiệt độ SOM CPU > 90°C | cpufreq throttle, ghi critical log |

### 13.2 I/O Faults (E2xx)

| Code | Mức | Module | Mô tả | Hành động |
|------|:---:|--------|-------|----------|
| E201 | WARNING | UI | UI kênh N: over-range (> 110% FS) | BACnet AI object = OVERRANGE, log |
| E202 | WARNING | UI | UI kênh N: under-range (< -5% FS) | BACnet AI object = UNDERRANGE, log |
| E203 | ERROR | UI | UI kênh N: sensor open circuit (resistance > threshold) | BACnet AI = FAULT, log |
| E204 | ERROR | UI | UI kênh N: sensor short circuit | BACnet AI = FAULT, log |
| E210 | WARNING | AO | AO kênh N: load resistance out of range | Log, giữ output |
| E211 | ERROR | AO | AO kênh N: short circuit detected | Current fold-back, log |
| E220 | WARNING | DI | DI kênh N: chatter detected (> 10 lần đổi trong 100ms) | Log, tăng debounce tạm thời |

### 13.3 Network Faults (E3xx)

| Code | Mức | Module | Mô tả | Hành động |
|------|:---:|--------|-------|----------|
| E301 | WARNING | BACNET | BACnet/IP: không nhận Who-Is response > 30s | Log, chuyển standalone mode |
| E302 | WARNING | FIELDBUS | Modbus RTU master: slave không phản hồi (timeout) | Log, đánh dấu điểm slave "bad", tăng counter |
| E303 | ERROR | FIELDBUS | Modbus RTU master: tỉ lệ lỗi CRC/timeout > 10% | Log, gửi alarm notification |
| E310 | WARNING | MQTT | MQTT broker mất kết nối | Reconnect backoff, log |
| E311 | INFO | MQTT | MQTT reconnect thành công | Log |
| E320 | WARNING | ETH | Ethernet link down | Log, enable standalone mode |
| E321 | INFO | ETH | Ethernet link up | Log |

### 13.4 Security Faults (E4xx)

| Code | Mức | Module | Mô tả | Hành động |
|------|:---:|--------|-------|----------|
| E401 | WARNING | AUTH | Login thất bại (web UI) | Log IP, tăng fail counter |
| E402 | ERROR | AUTH | Brute force detected (≥5 lần sai) | Lockout 15 phút, log |
| E403 | ERROR | FIRMWARE | Firmware signature verification fail | Từ chối flash, log |
| E404 | CRITICAL | SECBOOT | Kernel signature fail (U-Boot) | Rollback partition, log |
| E410 | WARNING | TLS | TLS certificate sắp hết hạn (< 30 ngày) | Log, gửi MQTT alert |

### 13.5 OTA Faults (E5xx)

| Code | Mức | Module | Mô tả | Hành động |
|------|:---:|--------|-------|----------|
| E501 | ERROR | OTA | Download thất bại (timeout, checksum lỗi) | Retry 3 lần, log |
| E502 | ERROR | OTA | Boot partition B thất bại lần 1 | Log, boot lại lần 2 |
| E503 | CRITICAL | OTA | Boot partition B thất bại lần 2 | Rollback về A, log |
| E504 | INFO | OTA | OTA thành công | Log version trước/sau |

---

## 14. Phân bổ Trách nhiệm Phát triển

| Module | Team | Ngôn ngữ |
|--------|------|---------|
| OS base image, U-Boot, PREEMPT_RT | Embedded Linux | C, Shell |
| I/O MCU firmware (FreeRTOS) | Firmware | C (STM32 HAL) |
| Kinexus-IOP protocol driver | Embedded Linux | C |
| Component graph (nay) + Mekong Program Runtime IEC 61131-3-aligned (roadmap, đang C0) | PLC Engine | C++ |
| BACnet stack (BACnet/IP) | Protocol | C |
| Modbus RTU master / field bus (`kinexus-fieldbus`) | Backend | C / Python |
| MQTT / REST API service | Backend | Python / Go |
| KinexusET Web IDE | Frontend | React / TypeScript |
| HMI Display app (LVGL) | Embedded Linux | C |
| OTA update daemon | DevOps | Python |
| Security (TLS, auth, audit) | Security | Go / Python |

---

**Document ID:** SRS-MK-DDC-24-VI
**Revision:** 2.3 | 2026-07-27 — ADR-022 Web RBAC target: exact viewer/operator/engineer/admin capability matrix, deny-by-default authorization, persisted session invalidation and last-admin invariant · 2.2 | 2026-07-22 — selected limited-operator local HMI: five surfaces, whitelisted point commands, broker/core authority, TTL/release, fail-closed session and measurable usability/timing
**Approved by:** Software Lead, CTO KINEXUS Technologies
