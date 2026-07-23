# PRD — MK-DDC-24 Product Requirements Document

> **Phiên bản:** 2.0 | 2026-06-30
> **Trạng thái:** Draft — Ver 1
> **Tác giả:** KINEXUS Technologies — Product Team
> **Liên quan:** [DS](DS_MK-DDC-24_VI.md) | [SRS](SRS_MK-DDC-24_VI.md) | [HW_SPEC](HW_SPEC_MK-DDC-24_VI.md)

> ⚠️ **RECONCILE (2026-07-23, ADR-018 supersedes 2026-06-08 banner cũ).** Định vị & triết
> lý sản phẩm theo nguồn-chuẩn [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md):
> **component-based DDC** (engine chạy thật hôm nay), Linux 3-process `mkddc-*`, UI Rev A
> form/JSON, BACnet/IP northbound + Modbus RTU/TCP field. **FR-001 bên dưới (IEC 61131-3
> FBD+ST) không còn bị loại khỏi Rev A** — đã trở thành roadmap chính thức qua ADR-018
> (Mekong-owned Program Runtime, ST+FBD, đang C0, chưa release, không certified/compliant).
> Phạm vi Rev A: [REVA_SCOPE](REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md).
> Baseline I/O và IOP theo [ADR-010](../adr/ADR-010-iop-v2-poll-capability-map.md): 16 UI + 4 AO + 4 DO, không có DI công nghiệp trên base SKU.

---

## 1. Mục tiêu Sản phẩm

MK-DDC-24 phải là bộ điều khiển DDC compact phù hợp cho **FCU, VAV và AHU nhỏ** trong các tòa nhà thương mại tại thị trường Đông Nam Á, với các mục tiêu:

| Mục tiêu | Chỉ tiêu đo lường |
|----------|------------------|
| Chi phí cạnh tranh | Giá bán ≤ 550 USD (EXW), thấp hơn ≥ 15% so với SBO/PXC4 |
| Tích hợp nhanh | Commissioning một FCU zone < 2 giờ |
| Tiêu chuẩn mở | IEC 61131-3-aligned (Mekong-owned, roadmap) + BACnet BTL — không vendor lock-in |
| Linux-based | Chạy Debian trên SOM quad-core, RAM < 2 GB |
| Linh hoạt kết nối | BACnet MS/TP + BACnet/IP + MQTT trên cùng thiết bị |
| Bảo mật tích hợp | Secure boot, TLS 1.3, tuân thủ IEC 62443-4-1 |

---

## 2. Stakeholders & Người dùng

| Vai trò | Nhu cầu chính |
|---------|--------------|
| **System Integrator (SI)** | Lập trình FBD nhanh, point mapping tự động, BACnet object export |
| **BMS Engineer** | BACnet/IP và MS/TP song song, PICS đầy đủ, COV reliable |
| **Facility Manager** | Dashboard web, alarm qua email/MQTT, lịch vận hành linh hoạt |
| **OEM / Project Owner** | Giá tốt, lead time ngắn, bảo hành 2 năm, hỗ trợ local |
| **Maintenance Technician** | Trạng thái I/O real-time, log CSV download, reset đơn giản |

---

## 3. Use Cases Chính

### UC-01 — FCU Zone Control
**Actor:** Hệ thống tự động (soft PLC nội bộ)
**Trigger:** Giờ làm việc (schedule) hoặc lệnh BACnet từ BMS
**Flow:**
1. Đọc nhiệt độ phòng từ UI1 (NTC 10k)
2. Chạy PID loop → tính % valve cooling (AO1)
3. Chọn cấp quạt (DO1/DO2/DO3) theo setpoint
4. Ghi trend log mỗi 5 phút
5. Gửi COV notification khi nhiệt độ lệch > 0.5°C

**Tiêu chí hoàn thành:** Nhiệt độ duy trì ±0.5°C quanh setpoint trong điều kiện tải thay đổi 50%.

### UC-02 — BACnet Discovery & Integration
**Actor:** BMS Server
**Flow:**
1. BMS gửi Who-Is (broadcast)
2. DDC-24 trả I-Am (Device ID, vendor ID, max APDU)
3. BMS đọc object list
4. BMS ghi Present-Value vào AO/BO objects
5. DDC-24 thực hiện output tương ứng trong < 500 ms

### UC-03 — OTA Firmware Update
**Actor:** Admin kỹ thuật
**Flow:**
1. Upload firmware package (signed .deb) lên portal KINEXUS
2. DDC-24 download qua HTTPS (TLS 1.3) trong giờ bảo trì
3. Flash vào partition B (A/B partition scheme)
4. Reboot → U-Boot verify chữ ký → boot B
5. Nếu boot thất bại → rollback về A tự động

### UC-04 — Commissioning Web UI
**Actor:** System Integrator
**Flow:**
1. Kết nối laptop cùng mạng Ethernet hoặc USB-C (serial console)
2. Truy cập `http://<ip>:8080` — KinexusET IDE
3. Cấu hình UI type (NTC/PT100/0-10V) cho từng kênh
4. Upload FBD program
5. Chạy Force I/O test — xác nhận output relay đóng/mở
6. Enable trend log → export checklist FAT/SAT

### UC-05 — Failsafe & Recovery
**Actor:** Hệ thống (tự động khi mất kết nối BMS)
**Flow:**
1. BACnet connection timeout > 30 s
2. Soft PLC chuyển sang chế độ local standalone
3. Output giữ giá trị cuối (hold last value) hoặc về safe-state (cấu hình)
4. Khi BACnet restore → resume bình thường, ghi event log

### UC-06 — Mở rộng I/O qua Modbus RTU master *(cập nhật ARCH-R010)*
**Actor:** Kỹ thuật viên lắp đặt
**Trigger:** Dự án cần nhiều hơn 24 điểm, hoặc cần màn hình phụ / đọc đồng hồ điện
**Flow:**
1. Đấu module mở rộng I/O (hoặc thiết bị Modbus bên thứ 3) vào bus RS-485 của DDC.
2. Khai báo slave trong Web UI: địa chỉ + chọn **device profile** (template register-map).
3. DDC (master) tự động poll slave theo chu kỳ, đọc giá trị → đưa vào shared memory / biến PLC.
4. PLC/BACnet/MQTT dùng các điểm mở rộng như I/O nội bộ; ghi xuống slave khi cần (vd bật relay module).
5. Nếu slave mất kết nối → đánh dấu "bad quality" + alarm.

**Tiêu chí hoàn thành:** Thêm 1 module mở rộng I/O qua RTU không cần đổi code; điểm của nó dùng được trong PLC/BACnet; phát hiện được khi module rớt mạng.

### UC-07 — Vận hành giới hạn tại HMI local
**Actor:** Operator tại tủ điện
**Trigger:** Cần kiểm tra hoặc điều chỉnh nhanh mà không dùng browser/laptop
**Flow:**
1. Operator đăng nhập session local có thời hạn.
2. HMI hiển thị Home/Points/Control/Alarms/Service và chỉ đưa point được authority whitelist vào Control.
3. Operator chỉnh setpoint hoặc chọn Auto/Manual; override phải có reason và TTL.
4. Local broker xác thực role/policy và ghi audit; core kiểm priority/interlock/safety.
5. HMI chỉ hiện accepted/active sau authoritative response; operator có thể Release để trả automatic control.
6. Khi broker/core unavailable, Control/ACK/Service bị disable nhưng monitoring SHM vẫn hoạt động read-only.

**Tiêu chí hoàn thành:** Không có đường ghi trực tiếp từ HMI tới SHM/hardware; command hợp lệ có feedback trong 2 giây nominal, command ngoài quyền/range hoặc duplicate bị từ chối/idempotent và có audit.

---

## 4. Yêu cầu Chức năng (Functional Requirements)

### 4.1 Lõi Điều khiển

| ID | Yêu cầu | Mức độ |
|----|---------|--------|
| FR-001 | Phải chạy FBD và ST (Mekong Program Runtime, IEC 61131-3-aligned) trên Debian — roadmap Rev A.0, ADR-018, đang C0, không certified | MUST |
| FR-002 | Chu kỳ scan phải cấu hình được 50 ms – 2 s | MUST |
| FR-003 | Phải cung cấp PID block với auto-tuning cơ bản | MUST |
| FR-004 | Phải hỗ trợ ≥ 8 schedule object (ngày/tuần/exception) | MUST |
| FR-005 | Phải hỗ trợ ≥ 8 trend log, ≥ 1.000 records mỗi log | MUST |
| FR-006 | Phải có chế độ failsafe khi mất BACnet > 30 s | MUST |
| FR-007 | Phải hỗ trợ Structured Text (ST) đồng thời với FBD | MUST |

### 4.2 I/O

| ID | Yêu cầu | Mức độ |
|----|---------|--------|
| FR-010 | 16 Universal Input phải cấu hình mode độc lập theo từng kênh | MUST |
| FR-011 | UI Rev A phải hỗ trợ 0–10V, 4–20mA, NTC và auxiliary dry contact; không claim PT100/PT1000 | MUST |
| FR-012 | Base SKU không có DI công nghiệp; optional isolated-DI chỉ được expose khi capability map và phần cứng SKU xác nhận | MUST |
| FR-013 | 4 Analog Output 0–10V hoặc 4–20mA (cấu hình per kênh), 16-bit DAC8554 | MUST |
| FR-014 | 4 Digital Output relay SPDT 5A @ 250 VAC | MUST |
| FR-015 | Sampling rate I/O phải ≤ 1 ms tại MCU layer | MUST |
| FR-016 | Phải có over-range và short-circuit protection trên AI | MUST |

### 4.3 Giao tiếp

| ID | Yêu cầu | Mức độ |
|----|---------|--------|
> ⚠ **Cập nhật 2026-05-30 (ARCH-R010):** Northbound chỉ qua IP (Ethernet/WiFi). Bỏ BACnet MS/TP, bỏ Modbus slave. RS-485 = Modbus RTU master xuống thiết bị phụ.

| FR-020 | Phải hỗ trợ **BACnet/IP** (qua Ethernet/WiFi), PICS B-ASC *(MS/TP đã bỏ — ARCH-R010)* | MUST |
| FR-021 | BACnet Device ID phải cấu hình qua web UI và DIP switch | MUST |
| FR-022 | Phải hỗ trợ MQTT v3.1.1 và v5.0 (TLS) | MUST |
| FR-023 | Phải có REST API JSON cho đọc/ghi point và cấu hình | MUST |
| FR-024 | Phải hoạt động như **Modbus RTU master** trên RS-485, poll thiết bị phụ theo device profile *(thay cho Modbus TCP slave)* | MUST |
| FR-025 | Phải hỗ trợ module mở rộng I/O + remote HMI qua RTU master (plug-and-play profile) | MUST |

### 4.4 Bảo mật

| ID | Yêu cầu | Mức độ |
|----|---------|--------|
| FR-030 | Firmware phải được ký GPG — từ chối flash unsigned image | MUST |
| FR-031 | Secure boot U-Boot phải verify chữ ký trước khi boot kernel | MUST |
| FR-032 | Tất cả API, MQTT, OTA phải dùng TLS 1.3 | MUST |
| FR-033 | SSH: disable root, chỉ key auth, non-default port | MUST |
| FR-034 | Web UI phải có authentication (local account, LDAP optional) | MUST |
| FR-035 | Phải log toàn bộ auth events và config changes | MUST |
| FR-036 | Phải tuân thủ quy trình SDLC theo IEC 62443-4-1 | MUST |

### 4.5 HMI local

| ID | Yêu cầu | Mức độ |
|----|---------|--------|
| FR-040 | HMI local phải có năm surface Home/Points/Control/Alarms/Service trên TFT 2.4 inch, touch + 6 nút | MUST |
| FR-041 | Operator chỉ được setpoint/mode/override/release point được authority whitelist; không được engineering/configuration sâu | MUST |
| FR-042 | Mọi HMI mutation phải qua authenticated broker, audit và core arbitration/safety; broker lỗi làm HMI read-only | MUST |
| FR-043 | Alarm ACK phải authoritative, audited và không clear active condition | MUST |
| FR-044 | Override phải có reason, bounded TTL, visible effective priority/source và explicit release | MUST |

---

## 5. Yêu cầu Phi chức năng (Non-Functional Requirements)

| ID | Loại | Yêu cầu |
|----|------|---------|
| NFR-001 | **Performance** | Control loop jitter ≤ 5 ms (PREEMPT_RT) |
| NFR-002 | **Performance** | BACnet Who-Is → I-Am response < 100 ms |
| NFR-003 | **Reliability** | Uptime ≥ 99.9% (< 8.7 h downtime/năm) |
| NFR-004 | **Reliability** | MTBF ≥ 60.000 h @ 40°C (IEC 61709) |
| NFR-005 | **Reliability** | Watchdog reboot trong < 30 s khi hệ thống treo |
| NFR-006 | **Security** | Không có CVE CVSS ≥ 7.0 trên build release |
| NFR-007 | **Maintainability** | OTA update downtime ≤ 60 giây khi reboot (A/B partition, rolling update) |
| NFR-008 | **Usability** | Commissioning FCU zone < 2 giờ (SI có kinh nghiệm) |
| NFR-009 | **Compliance** | BACnet BTL certified trước khi ship Ver 1 GA |
| NFR-010 | **Environmental** | Hoạt động ổn định -20°C đến +65°C, 10–90% RH |

---

## 6. Ràng buộc & Giả định

### Ràng buộc
- **BOM cost:** SOM module phải ≤ 40 USD (để giữ giá bán ≤ 550 USD)
- **DIN-rail:** Kích thước tối đa 180 × 110 × 60 mm
- **Nguồn:** Chỉ dùng 24 VAC/VDC (không dùng 12V hay 5V trực tiếp)
- **OS:** Debian Linux (không CentOS, không Ubuntu) — phù hợp industrial support cycle

### Giả định
- Mạng Ethernet sẵn có tại vị trí lắp đặt (cho BACnet/IP, MQTT)
- SI đã quen IEC 61131-3 nên onboarding ST/FBD nhanh hơn khi Program Runtime roadmap release — vẫn cần training riêng cho Mekong Web IDE (chưa phải PLC IDE chuẩn thị trường)
- BMS upstream đã sẵn BACnet/IP hoặc MS/TP router

---

## 7. Roadmap & Phân kỳ

| Phiên bản | Tính năng | Target |
|-----------|-----------|--------|
| **Ver 1.0 (MVP)** | BACnet MS/TP + IP, web UI cơ bản, OTA. Program Runtime FBD/ST (ADR-018) không nằm trong Ver 1.0 — roadmap riêng, gate theo C0–C10 | Q4/Y7 |
| **Ver 1.1** | MQTT TLS, REST API đầy đủ, dashboard realtime | Q1/Y8 |
| **Ver 1.2** | BACnet/SC (Secure Connect), IEC 62443-4-2 certification | Q2/Y8 |
| **Ver 2.0** | IEC 62443-4-2 component certification, edge AI anomaly detection (NPU), advanced ST libraries | Q4/Y8 |

---

## 8. Ma trận Trách nhiệm (Traceability Matrix — FR → SRS)

Bảng dưới ánh xạ từng Functional Requirement (FR) sang ID trong SRS và test case tương ứng:

| FR ID | Mô tả ngắn | SRS Requirement IDs | Test Case |
|-------|-----------|--------------------|-----------|
| FR-001 | FBD + ST (Mekong Program Runtime, roadmap ADR-018) | PLC-001, PLC-002, IDE-001, IDE-002 | TEST-001, FAT: PLC scan jitter |
| FR-002 | Scan cycle 50ms–2s | PLC-010 | TEST-001 |
| FR-003 | PID block + auto-tuning | PLC-004, PLC-005 | TEST-001 |
| FR-004 | Schedule ≥ 8 objects | BAC-006 (Event), BACnet Schedule object | FAT: BACnet objects |
| FR-005 | Trend log ≥ 8, 1000 records | IDE-025, LOG-001 | FAT: Trend export |
| FR-006 | Failsafe khi mất BACnet > 30s | PLC-013, E301 | FAT: Failsafe test |
| FR-007 | ST đồng thời FBD | PLC-002, IDE-002 | TEST-001 |
| FR-010 | 16 UI cấu hình mode độc lập | IOP-003, ADR-010 | FAT: UI1-UI16 |
| FR-011 | UI hỗ trợ 0-10V / 4-20mA / NTC / auxiliary dry contact | IOP-003, ADR-010 | FAT: I/O hardware |
| FR-012 | 0 DI base SKU; optional isolated-DI capability-gated | IOP-003, ADR-010 | FAT: base/optional SKU capability |
| FR-013 | 4 AO 0-10V/4-20mA 16-bit | IOP-004 | FAT: I/O hardware |
| FR-014 | 4 DO relay SPDT 5A | IOP-004 | FAT: I/O hardware |
| FR-015 | Sampling ≤ 1ms tại MCU | IOP-001, IOP-002 | TEST-003 (HIL) |
| FR-016 | Over-range + short-circuit protection | E201–E211 | FAT: I/O hardware |
| FR-020 | BACnet/IP northbound only | BAC-001, BAC-002 | FAT: BACnet/IP interop |
| FR-021 | Device ID qua web UI + DIP | IDE-020 | FAT: Commissioning |
| FR-022 | MQTT v3.1.1 + v5.0 TLS | MQ-001, MQ-002 | TEST-002 |
| FR-023 | REST API JSON | API-001–API-009 | TEST-002 |
| FR-024 | Modbus RTU master | RTU-001–RTU-006 | TEST-002 |
| FR-025 | RTU expansion/device profiles | RTU-007, fieldbus design | FAT: configured field device |
| FR-030 | Firmware ký GPG | SEC-011, SEC-013 | FAT: OTA + rollback |
| FR-031 | Secure boot U-Boot | SEC-010, E404 | FAT: OTA + rollback |
| FR-032 | TLS 1.3 toàn bộ API/MQTT/OTA | SEC-020, MQ-002, API-001, OTA-002 | TEST-004 (pentest) |
| FR-033 | SSH hardening | SEC-021, SEC-022 | TEST-004 (pentest) |
| FR-034 | Web UI authentication | IDE-030–IDE-034, SEC-023 | TEST-004 |
| FR-035 | Audit log | SEC-025, LOG-005, IDE-033 | TEST-002 |
| FR-036 | IEC 62443-4-1 SDLC | SEC-001–SEC-006 | Code review |
| FR-040 | Five-surface local HMI | HMI-001–HMI-015, HMI-030 | T-SW-100–T-SW-106, T-SW-121 |
| FR-041 | Whitelisted limited control | HMI-025–HMI-027, HMI-032 | T-SW-118 |
| FR-042 | Broker/audit/core command boundary | HMI-026, HMI-028, HMI-029 | T-SW-117, T-SW-119, T-SW-122 |
| FR-043 | Authoritative alarm ACK | HMI-016, HMI-017, HMI-023 | T-SW-107, T-SW-120 |
| FR-044 | Override lifecycle | HMI-027, HMI-031 | T-SW-118, T-SW-121 |

---

## 9. Tiêu chí Chấp nhận (Acceptance Criteria — Ver 1.0)

- [ ] 100% test case base-SKU hardware pass (16 UI across supported Rev A modes, 4 AO, 4 DO; capability map confirms no populated DI)
- [ ] BACnet BTL conformance test pass (ASHRAE SSPC-135)
- [ ] Modbus TCP: đọc/ghi toàn bộ I/O từ SCADA không ảnh hưởng BACnet
- [ ] FCU commissioning end-to-end < 2 giờ (thực hiện bởi SI độc lập)
- [ ] OTA update thành công + rollback tự động khi boot lỗi
- [ ] Uptime 72 giờ liên tục trong lab test không crash
- [ ] Penetration test: không CVE CVSS ≥ 7.0 trên build release
- [ ] BOM cost SOM ≤ 40 USD, giá bán ≤ 550 USD EXW

---

**Document ID:** PRD-MK-DDC-24-VI
**Revision:** 2.1 | 2026-07-22 — added ADR-016 limited-operator local HMI use case, functional requirements and trace rows
**Approved by:** Product Manager, CTO KINEXUS Technologies
