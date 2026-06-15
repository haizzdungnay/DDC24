# Software Requirements Specification (Detailed) — MK-DDC-24
## SOM Application Layer / Debian 12

> **Document ID:** SW-REQ-MK-DDC-24-VI  
> **Phiên bản:** 1.1-DRAFT (2026-06-15: §2.2 wrap legacy inline struct in <details>; actual contract = shared/mkddc_shm.h) | 2026-05-28  
> **Trạng thái:** Draft — Pending SW Lead review  
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))  
> **Tác giả:** KINEXUS Technologies — Software Team  
> **Nguồn gốc:** Trace từ SRS-MK-DDC-24-VI (v1.1), PRD-MK-DDC-24-VI (v1.1)

> **Quan hệ với SRS:** Tài liệu này phân rã SRS thành requirements cụ thể theo module. SRS vẫn là tài liệu cấp cao (functional). SW-REQ là cấp thấp hơn — implementation-binding.

> ⚠️ **RECONCILE (2026-06-08).** Module/naming/ngôn ngữ cập nhật theo [ADR-005](../adr/ADR-005-three-process-architecture.md)/[ADR-007](../adr/ADR-007-web-stack-go.md) + [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md). Xem **§1 Modules (Rev A)** ngay dưới; bảng §1-legacy giữ làm tham chiếu.

---

## 1. Modules & Owner (Rev A — nguồn-chuẩn)

| Process | Vai trò | Ngôn ngữ | Trace |
|---------|---------|----------|-------|
| `mkddc-core` | IO image + **component graph engine** + priority/safe-state + Modbus cache + BACnet object table | **C++17** | `RUN-001..` (thay `PLC-*`) |
| `mkddc-iobus` | Modbus RTU x2 / TCP (async) + BACnet/IP datalink | C++17 / C | `SW-FB-*`, `SW-BAC-*` |
| `mkddc-web` | Web config (form/JSON) + **validator (library)** + commissioning + SQLite | **Go** | `SW-IDE-*`→`SW-WEB-*` |

**Deferred Rev B+** (giữ từ thiết kế cũ, không mất): HMI Display (`kinexus-hmi`, LVGL),
MQTT/REST Agent (`kinexus-agent`), Security Service, OTA (`kinexus-ota`), cloud. Xem
[REVA_SCOPE §3](REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md). Validator **không** dùng Rust service.

<details><summary>§1-legacy — decomposition cũ (7+ service `kinexus-*`, tham chiếu)</summary>

| Module | Service Name | Language | Owner |
|--------|-------------|---------|-------|
| IOP Driver | `kinexus-io-driver` | C (hoặc Rust) | SW Team |
| Soft PLC Runtime | `kinexus-plc` | C++ | SW Team |
| BACnet Stack | `kinexus-bacnet` | C | SW Team |
| MQTT / REST Agent | `kinexus-agent` | Python 3.11 | SW Team |
| Web IDE | `kinexus-webide` | Python (backend) + JS (frontend) | SW Team |
| HMI Display | `kinexus-hmi` | C (LVGL v9) | SW Team |
| Security Service | `kinexus-sec` (part of agent) | Python | SW Team |
| OTA Update | `kinexus-ota` | Python / shell | SW Team |

</details>

---

## 2. IOP Driver (`kinexus-io-driver`)

### 2.1 Core Requirements

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-IOP-001 | PHẢI implement IOP Master theo `IOP-SPEC-MK-DDC-24-VI` | MUST | IOP-001 | T-SW-001 |
| SW-IOP-002 | PHẢI poll MCU mỗi 10ms (100Hz) bằng GET_IO frame | MUST | IOP-002 | T-SW-002 |
| SW-IOP-003 | PHẢI verify CRC-16/Modbus mọi frame nhận được | MUST | IOP-001 | T-SW-003 |
| SW-IOP-004 | Implement timeout/retry: 10ms timeout, max 3 retry, sau đó set fault | MUST | IOP-005 | T-SW-004 |
| SW-IOP-005 | PHẢI expose I/O snapshot qua POSIX shared memory `kinexus_io_shm` | MUST | — | T-SW-005 |
| SW-IOP-006 | Shared memory PHẢI dùng seqlock pattern (reader không block writer) | MUST | — | T-SW-006 |
| SW-IOP-007 | PHẢI gửi SET_AO / SET_DO khi PLC thay đổi giá trị output | MUST | IOP-004 | T-SW-007 |
| SW-IOP-008 | PHẢI implement fault state machine: NORMAL → IOP_FAULT → SAFE_STATE | MUST | IOP-005 | T-SW-008 |
| SW-IOP-009 | Khi SAFE_STATE: gửi RESET_IO, set alarm qua shared alarm bus | MUST | IOP-005 | T-SW-009 |
| SW-IOP-010 | PHẢI chạy với SCHED_FIFO priority 70 | MUST | — | T-SW-010 |
| SW-IOP-011 | PHẢI expose metrics: iop_crc_err, iop_timeout, iop_seq_err qua REST `/api/v1/system/status` | MUST | IOP-006 | T-SW-011 |

### 2.2 Shared Memory Layout — ⛔ LEGACY, ĐÃ BỊ THAY THẾ

> ⚠️ **CONTRACT FREEZE (2026-06-11):** layout dưới đây là bản phác thảo cũ, **KHÔNG dùng
> để code**. Struct chuẩn duy nhất là `kx_io_shm_t` trong
> [`shared/mkddc_shm.h`](../../shared/mkddc_shm.h) (khác đáng kể: `ts_ns` thay
> `timestamp_ms`, có `ui_quality[]/ui_unit[][]/di_state[]/di_counter[]/do_cmd[]/
> do_feedback[]/metrics`, không có `ui_type[]/do_mask/safe_state_active`). Path runtime:
> `/dev/shm/mkddc_io_shm`. Ownership/bảng field:
> [06 §5](../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md). Giữ block cũ chỉ
> để trace lịch sử requirement.

```c
<details>
<summary>legacy inline struct (CHỈ để trace lịch sử; KHÔNG dùng để code)</summary>

// ===== LEGACY DRAFT (superseded by shared/mkddc_shm.h) =====
// Shared memory structure — accessible by IOP driver (W) and PLC runtime (R)
typedef struct {
    // Seqlock fields
    volatile uint32_t seq;           // Odd = write in progress, even = valid
    uint32_t          timestamp_ms;  // Monotonic ms timestamp

    // Universal Inputs (scaled engineering values)
    float    ui_value[8];            // Scaled value (V, mA, °C, etc.)
    uint8_t  ui_type[8];             // Sensor type enum (see ui_type_t)
    bool     ui_fault[8];            // true = measurement invalid

    // Digital Inputs (debounced)
    uint8_t  di_mask;                // Bit per channel, 1=ON

    // Analog Outputs (setpoint from PLC)
    float    ao_setpoint[4];         // 0.0–10.0V or 4.0–20.0mA
    uint8_t  ao_mode[4];             // AO_MODE_VOLT or AO_MODE_CURR

    // Digital Outputs (setpoint from PLC)
    uint8_t  do_mask;                // Bit per channel, 1=relay closed

    // Fault state
    uint16_t mcu_fault_flags;        // From MCU FAULT_FLAGS (IOP spec)
    bool     iop_fault;              // SOM-side IOP fault
    bool     safe_state_active;      // Safe state currently active

    uint8_t  _pad[2];                // Alignment
} kinexus_io_shm_t;
</details>
```

---

## 3. Soft PLC Runtime (`kinexus-plc`)

### 3.1 Yêu cầu Ngôn ngữ & Chương trình

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-PLC-001 | PHẢI thực thi chương trình FBD per IEC 61131-3 với ≥ 16 programs song song | MUST | PLC-001, PLC-006 | T-SW-020 |
| SW-PLC-002 | PHẢI thực thi Structured Text (ST) per IEC 61131-3 | MUST | PLC-002 | T-SW-021 |
| SW-PLC-003 | Standard FBs PHẢI có: TON, TOF, TP, CTU, CTD, CTUD, RS, SR, F_TRIG, R_TRIG, PID_COMPACT | MUST | PLC-003, PLC-004 | T-SW-022 |
| SW-PLC-004 | PID_COMPACT PHẢI hỗ trợ bumpless manual→auto transfer | MUST | PLC-005 | T-SW-023 |
| SW-PLC-005 | PHẢI map I/O objects (AI/AO/BI/BO) từ shared memory `kinexus_io_shm` | MUST | PLC-020 | T-SW-024 |

### 3.2 Scheduling

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-PLC-010 | ~~Chu kỳ scan mặc định 100ms, cấu hình 50ms–2000ms~~ **(LEGACY PLC timing — Rev A chốt: scan mặc định 1000ms theo graph runtime, xem SW_RUNTIME_EXECUTION_MODEL + 07 §2)** | MUST | PLC-010 | T-SW-030 |
| SW-PLC-011 | Jitter scan PHẢI ≤ 5ms (đo trong 1 giờ liên tục) | MUST | PLC-011 | T-SW-031 |
| SW-PLC-012 | Process PHẢI SCHED_FIFO priority ≥ 80 | MUST | OS-003 | T-SW-032 |
| SW-PLC-013 | Watchdog: nếu scan overrun > 3× liên tiếp → output safe state, log event, restart service | MUST | PLC-012, PLC-013 | T-SW-033 |

### 3.3 Data Persistence

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-PLC-020 | ≥ 512 global variables (REAL/BOOL/INT/DWORD) | MUST | PLC-021 | T-SW-040 |
| SW-PLC-021 | RETAIN variables PHẢI ghi xuống `/data/plc/retain.dat` trong < 1s khi detect power fail (UPS signal) | MUST | PLC-022 | T-SW-041 |
| SW-PLC-022 | Sau power restore: load retain vars và resume program từ state trước | MUST | PLC-023 | T-SW-042 |

---

## 4. BACnet Stack (`kinexus-bacnet`)

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-BAC-001 | PHẢI implement BACnet/IP (Annex J) trên UDP/47808 | MUST | BAC-002 | T-SW-050 |
| SW-BAC-002 | PHẢI hỗ trợ BBMD / Foreign-Device cho BACnet/IP qua router *(MS/TP đã loại bỏ — ARCH-R010)* | MUST | BAC-002 | T-SW-051 |
| SW-BAC-003 | PHẢI support object types theo SRS §5.1 table | MUST | BAC-001..009 | T-SW-052 |
| SW-BAC-004 | PHẢI implement COV (subscribe/unsubscribe) cho AI/AO/BI/BO/AV/BV/MSV | MUST | BAC-005 | T-SW-053 |
| SW-BAC-005 | PHẢI respond Who-Is trong < 100ms | MUST | PRD UC-02 | T-SW-054 |
| SW-BAC-006 | Device ID: đọc từ `/data/config/device.conf`; nếu không tồn tại, đọc **DIP bootstrap ID (SW1–SW7) trực tiếp qua CM3 GPIO** (xem SOM_SPEC §3.5, HW_SPEC §16) | MUST | BAC-010 | T-SW-055 |
| SW-BAC-007 | PHẢI pass BACnet BTL test suite (ASHRAE BACnet Stack Test) trước GA | MUST | BAC-011 | T-SW-056 |
| SW-BAC-008 | Failsafe: khi mất kết nối BMS > 30s, PLC chuyển standalone mode; log event | MUST | PRD UC-05 | T-SW-057 |

---

## 5. MQTT & REST Agent (`kinexus-agent`)

### 5.1 MQTT

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-MQ-001 | PHẢI hỗ trợ MQTT v3.1.1 và v5.0 (Paho MQTT hoặc tương đương) | MUST | MQ-001 | T-SW-060 |
| SW-MQ-002 | TLS 1.3 BẮT BUỘC, không cho phép fallback TLS 1.2 | MUST | MQ-002 | T-SW-061 |
| SW-MQ-003 | Topic: `kinexus/{device_id}/io/{point_name}` | MUST | MQ-003 | T-SW-062 |
| SW-MQ-004 | Publish AI/AO/BI/BO khi thay đổi (COV threshold-based) | MUST | MQ-004 | T-SW-063 |
| SW-MQ-005 | Retain message = TRUE cho last-value topics | MUST | MQ-005 | T-SW-064 |
| SW-MQ-006 | LWT: `kinexus/{device_id}/status` với payload `{"online": false}` | MUST | MQ-006 | T-SW-065 |
| SW-MQ-007 | Reconnect với exponential backoff: 1s → 2s → 4s → ... → max 300s | MUST | MQ-007 | T-SW-066 |

### 5.2 REST API

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-API-001 | PHẢI cung cấp REST API HTTPS TLS 1.3 trên port 8443 | MUST | API-001 | T-SW-070 |
| SW-API-002 | Auth: Bearer JWT, expire 1 giờ, signed HS256 với secret từ HSM / secure key store | MUST | API-002 | T-SW-071 |
| SW-API-003 | `GET /api/v1/points`: trả tất cả I/O points + giá trị current | MUST | API-003 | T-SW-072 |
| SW-API-004 | `GET /api/v1/points/{id}`: trả giá trị + timestamp + quality | MUST | API-004 | T-SW-073 |
| SW-API-005 | `PUT /api/v1/points/{id}`: ghi giá trị (auth required, kiểm tra range) | MUST | API-005 | T-SW-074 |
| SW-API-006 | `GET /api/v1/system/status`: CPU%, RAM%, uptime, firmware ver, IOP metrics | MUST | API-006 | T-SW-075 |
| SW-API-007 | `POST /api/v1/ota/apply`: trigger OTA (auth: admin role only) | MUST | API-007 | T-SW-076 |
| SW-API-008 | Rate limit: 100 req/s per IP. HTTP 429 khi vượt. | MUST | API-008, API-009 | T-SW-077 |
| SW-API-009 | Tất cả response PHẢI có `Content-Type: application/json` | MUST | — | T-SW-078 |
| SW-API-010 | Error response format: `{"error": "...", "code": NNN, "request_id": "..."}` | MUST | — | T-SW-079 |

---

## 6. Security Requirements (Module Level)

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-SEC-001 | Secure boot: U-Boot PHẢI verify GPG signature kernel | MUST | SEC-010 | T-SW-080 |
| SW-SEC-002 | AppArmor profiles PHẢI được enable cho mọi service | MUST | OS-007 | T-SW-081 |
| SW-SEC-003 | Rootfs PHẢI read-only (OverlayFS); `/data` và `/var` là writable partition riêng | MUST | OS-004 | T-SW-082 |
| SW-SEC-004 | SSH: port 2222, key-only, root login disabled | MUST | SEC-020..022 | T-SW-083 |
| SW-SEC-005 | JWT secret PHẢI generate khi provisioning; không hardcode | MUST | — | T-SW-084 |
| SW-SEC-006 | Audit log: mọi login attempt, config change, output write, OTA PHẢI được ghi vào `/data/log/audit.log` | MUST | SEC-025 | T-SW-085 |
| SW-SEC-007 | Web UI: brute-force lockout 15 phút sau 5 lần sai | MUST | SEC-023 | T-SW-086 |
| SW-SEC-008 | TLS certificate: self-signed mặc định; hỗ trợ import custom cert (LetsEncrypt / enterprise CA) | MUST | — | T-SW-087 |

---

## 7. OTA Update Requirements

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-OTA-001 | A/B partition scheme: active=A hoặc B; update selalu vào inactive | MUST | OTA-001 | T-SW-090 |
| SW-OTA-002 | Download qua HTTPS TLS 1.3 với cert validation; không accept self-signed cho OTA server | MUST | OTA-002 | T-SW-091 |
| SW-OTA-003 | Verify SHA-256 + GPG signature trước khi flash | MUST | OTA-003 | T-SW-092 |
| SW-OTA-004 | MCU firmware (STM32) PHẢI update đồng thời trong cùng OTA package | MUST | OTA-004 | T-SW-093 |
| SW-OTA-005 | Rollback tự động nếu boot partition mới thất bại 2 lần | MUST | OTA-005 | T-SW-094 |
| SW-OTA-006 | Rollback prevention: kiểm tra version metadata, không allow downgrade qua known-vulnerable | MUST | SEC-014 | T-SW-095 |
| SW-OTA-007 | Apply + reboot downtime PHẢI ≤ 60 giây | MUST | OTA-007 | T-SW-096 |
| SW-OTA-008 | Ghi log: prev_ver, new_ver, timestamp, result (success/fail/rollback) | MUST | OTA-008 | T-SW-097 |

---

## 8. HMI Display Requirements (`kinexus-hmi`)

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-HMI-001 | PHẢI chạy LVGL v9 userspace, render vào `/dev/fb0` (fbtft/ILI9341 driver) | MUST | HMI-001 | T-SW-100 |
| SW-HMI-002 | Frame rate ≥ 10 FPS | MUST | HMI-002 | T-SW-101 |
| SW-HMI-003 | Data feed từ `kinexus_io_shm` (shared memory), không HTTP | MUST | HMI-005 | T-SW-102 |
| SW-HMI-004 | Refresh display data ≤ 1 giây | MUST | HMI-006 | T-SW-103 |
| SW-HMI-005 | Screen saver: dim backlight sau 5 phút không nhấn nút | SHOULD | HMI-007 | T-SW-104 |
| SW-HMI-006 | 6-nút navigation (UP/DOWN/LEFT/RIGHT/ENTER/ESC) qua GPIO interrupt | MUST | HMI-010 | T-SW-105 |
| SW-HMI-007 | Menu screens: Dashboard / I/O Status / Alarm List / Network Info / System Info | MUST | HMI-011 | T-SW-106 |
| SW-HMI-008 | Alarm list: ≥ 10 entries, timestamp + severity | MUST | HMI-012 | T-SW-107 |

---

## 9. Logging & Diagnostics

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|---------|
| SW-LOG-001 | System log vào `/data/log/` persistent | MUST | LOG-001 | T-SW-110 |
| SW-LOG-002 | Log rotation: max 50MB, 7 ngày | MUST | LOG-002 | T-SW-111 |
| SW-LOG-003 | Syslog remote qua UDP/TCP (rsyslog) | SHOULD | LOG-003 | T-SW-112 |
| SW-LOG-004 | Audit log: login, config change, write, OTA (timestamp ISO8601 + user + action) | MUST | LOG-001, SEC-025 | T-SW-113 |
| SW-LOG-005 | `GET /api/v1/logs/download` PHẢI trả file log compressed (gzip) | MUST | LOG-005 | T-SW-114 |

---

## 10. Modbus RTU **Master** — Field Bus thiết bị phụ (`kinexus-fieldbus`)

> **Cập nhật 2026-05-30 (ARCH-R010):** **BỎ vai trò Modbus slave** (TCP & RTU). DDC nay là **Modbus RTU MASTER** trên RS-485, poll **thiết bị phụ** (module mở rộng I/O, remote HMI, thiết bị bên thứ 3). Thiết kế khung mở (device profile). Chi tiết: [D-2 RTU Master/Expansion ICD](../02_design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md), [SW_FIELDBUS_DESIGN](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md).
> Northbound lên BMS dùng BACnet/IP + MQTT + REST (xem §9, §6).

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|----------|
| SW-MOD-001 | PHẢI hoạt động như **Modbus RTU master** trên RS-485, poll nhiều slave theo lịch | MUST | RTU-001 | T-SW-120 |
| SW-MOD-002 | PHẢI hỗ trợ **device profile** (template register-map) — thêm loại slave bằng cấu hình, không đổi code | MUST | RTU-002 | T-SW-121 |
| SW-MOD-003 | PHẢI hỗ trợ FC03/FC04 (đọc Holding/Input Reg của slave) | MUST | RTU-004 | T-SW-122 |
| SW-MOD-004 | PHẢI hỗ trợ FC06/FC16 (ghi xuống slave: vd lệnh relay module mở rộng) | MUST | RTU-004 | T-SW-123 |
| SW-MOD-005 | PHẢI ánh xạ điểm đọc/ghi của slave vào **shared memory / biến PLC** (như I/O ảo) để PLC, BACnet, MQTT dùng được | MUST | RTU-004 | T-SW-124 |
| SW-MOD-006 | PHẢI hỗ trợ baud 9.6k–115.2k, parity 8N1/8E1/8O1; địa chỉ slave 1–247 | MUST | RTU-003, RTU-006 | T-SW-125 |
| SW-MOD-007 | Chu kỳ poll cấu hình/slave; tổng vòng poll ≤ thời gian cấu hình; không chặn hot-path | MUST | RTU-001 | T-SW-126 |
| SW-MOD-008 | PHẢI phát hiện slave offline (timeout/CRC) → điểm "bad quality" + alarm E302/E303 | MUST | RTU-005 | T-SW-127 |
| SW-MOD-009 | PHẢI hỗ trợ ≥ 16 slave/bus (mở rộng được) | MUST | RTU-006 | T-SW-128 |
| SW-MOD-010 | Profile chuẩn sẵn cho module mở rộng I/O + remote HMI của Kinexus (plug-and-play) | MUST | RTU-007 | T-SW-129 |
| SW-MOD-011 | KHÔNG hoạt động như Modbus slave (không phục vụ Modbus về phía BMS) | MUST | RTU-008 | T-SW-130 |

---

## 11. Web IDE Requirements (`kinexus-webide`)

> **Phạm vi:** KinexusET Web IDE — trình soạn thảo PLC program, quản lý cấu hình, và giám sát I/O qua browser

### 11.1 Core IDE

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|----------|
| SW-IDE-001 | PHẢI cung cấp Web IDE qua HTTP port 8080 (LAN/commissioning) và HTTPS port 8443 (production, redirect) | MUST | IDE-001 | T-SW-130 |
| SW-IDE-002 | Web IDE PHẢI truy cập được từ Chrome 120+, Firefox 120+ mà không cần plugin | MUST | IDE-002 | T-SW-131 |
| SW-IDE-003 | PHẢI cung cấp trình soạn thảo FBD (Function Block Diagram) dạng đồ họa | MUST | IDE-010 | T-SW-132 |
| SW-IDE-004 | PHẢI cung cấp trình soạn thảo Structured Text với syntax highlighting | MUST | IDE-011 | T-SW-133 |
| SW-IDE-005 | PHẢI hỗ trợ upload program lên PLC runtime và download program từ PLC | MUST | IDE-012 | T-SW-134 |
| SW-IDE-006 | PHẢI hỗ trợ Start / Stop / Reset PLC program từ Web IDE | MUST | IDE-013 | T-SW-135 |
| SW-IDE-007 | PHẢI hiển thị giá trị biến real-time (watch table / variable monitor) trong khi PLC đang chạy | MUST | IDE-014 | T-SW-136 |
| SW-IDE-008 | PHẢI cho phép force / write giá trị biến PLC (yêu cầu auth admin) | MUST | IDE-015 | T-SW-137 |

### 11.2 I/O Configuration & Monitoring

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|----------|
| SW-IDE-010 | PHẢI cung cấp giao diện cấu hình sensor type per kênh UI1–UI8 (dropdown + manual coefficient input) | MUST | IDE-020 | T-SW-138 |
| SW-IDE-011 | PHẢI cấu hình AO mode (0–10V / 4–20mA) per kênh AO1–AO4 | MUST | IDE-021 | T-SW-139 |
| SW-IDE-012 | PHẢI cấu hình safe state value per kênh | MUST | IDE-022 | T-SW-140 |
| SW-IDE-013 | PHẢI hiển thị I/O live dashboard: tất cả UI/DI/AO/DO với giá trị real-time, quality indicator | MUST | IDE-023 | T-SW-141 |
| SW-IDE-014 | PHẢI cấu hình BACnet Device ID, Device Name từ Web UI | MUST | IDE-024 | T-SW-142 |
| SW-IDE-015 | PHẢI cấu hình IP address (DHCP / static), DNS, hostname | MUST | IDE-025 | T-SW-143 |

### 11.3 User Management

| ID | Yêu cầu | Loại | Trace SRS | Test Ref |
|----|---------|------|-----------|----------|
| SW-IDE-020 | PHẢI có 2 roles: `admin` (full access) và `operator` (view + force I/O, không upload program) | MUST | IDE-030 | T-SW-144 |
| SW-IDE-021 | Password PHẢI hash bcrypt, không lưu plaintext | MUST | SEC-023 | T-SW-145 |
| SW-IDE-022 | PHẢI lock account sau 5 lần đăng nhập sai trong 15 phút | MUST | SEC-023 | T-SW-146 |
| SW-IDE-023 | Web UI session PHẢI tự logout sau **30 phút idle** (khớp SRS IDE-031). JWT REST token (API-002) expire 1 giờ là cơ chế riêng | MUST | IDE-031 | T-SW-147 |

---

**Document ID:** SW-REQ-MK-DDC-24-VI  
**Revision:** 1.1 | 2026-05-28  
**Changes v1.1:** Thêm §10 Modbus TCP/RTU (SW-MOD-001..010), §11 Web IDE (SW-IDE-001..023)  
**Approved by:** Software Lead, System Architect — KINEXUS Technologies
