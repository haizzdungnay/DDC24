# Software Architecture Specification — MK-DDC-24
## SOM Application Layer / Debian 12

> **Document ID:** SW-ARCH-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-28
> **Trạng thái:** Draft — Pending SW Lead review
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))
> **Tác giả:** KINEXUS Technologies — Software Team

> ⚠️ **RECONCILE (2026-06-08) — kiến trúc cập nhật.** Nguồn-chuẩn mới về process/naming
> là [ADR-005](../adr/ADR-005-three-process-architecture.md) + [PRODUCT_DEFINITION §6](PRODUCT_DEFINITION_MK-DDC-24_VI.md). Tóm tắt thay đổi:
> - **7 service `kinexus-*` → 3 process `mkddc-*`** (chia theo real-time boundary):
>   `mkddc-core` (IO+graph engine+priority, gộp io-driver+plc), `mkddc-iobus`
>   (bacnet+modbus/fieldbus), `mkddc-web` (webide+validator-library).
>   `mkddc-hmi` là fourth feature-gated Rev A service theo ADR-016;
>   `kinexus-agent`/`kinexus-ota` vẫn deferred Rev B+.
> - Engine không còn là IEC 61131-3 PLC mà là **component graph** ([ADR-004](../adr/ADR-004-component-based-runtime.md));
>   mô hình thực thi: [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md).
> - **Hợp đồng IPC/shm/seqlock với MCU bên dưới giữ nguyên** (rename header
>   `kinexus_shm.h` → `mkddc_shm.h` ĐÃ thực hiện 2026-06-11). Bảng §1.1 dưới đây là
>   decomposition cũ, đọc như tham chiếu; ánh xạ sang `mkddc-*` theo banner này.

> ⚠️ **CONTRACT FREEZE (2026-06-11).** Giá trị thực thi (SHM layout/path/ownership,
> IOP opcode/fault/reason/CRC, startup order) lấy theo `shared/iop_protocol.h` +
> `shared/mkddc_shm.h` + [16_CONTRACT_FREEZE](../03_implementation/16_CONTRACT_FREEZE.md).
> File này lệch các nguồn đó → nguồn freeze thắng. Đặc biệt: **boundary đã chốt là
> `mkddc-iobus` sở hữu UART/IOP + ghi SHM IO** (không phải core) — xem
> [00_IMPLEMENTATION_README §3](../03_implementation/00_IMPLEMENTATION_README.md).

---

## 1. Process Model

### 1.1 Danh sách Process / Service (Rev A — ADR-005)

| Process | Binary | User | Restart | Dep (systemd) |
|---------|--------|------|---------|----------------|
| `mkddc-iobus` | `/usr/sbin/mkddc-iobus` | `mkddc` | always | — (creator `/dev/shm/mkddc_io_shm`) |
| `mkddc-core` | `/usr/sbin/mkddc-core` | `mkddc` | always | `After=mkddc-iobus` (Wants) |
| `mkddc-web` | `/usr/bin/mkddc-web` | `mkddcweb` | always | `After=mkddc-core` (Wants) |
| `mkddc-hmi` | `/usr/sbin/mkddc-hmi` | `mkddc` | always khi SKU enable | `After=mkddc-core mkddc-iobus` (Wants) |

`mkddc-iobus` sở hữu UART/IOP tới MCU + scale + ghi SHM IO; gộp BACnet/IP datalink +
fieldbus/modbus. `mkddc-core` chạy component graph engine + priority/safe-state (đọc SHM,
ghi `ao_setpoint[]/do_cmd[]`). `mkddc-web` gồm web config + validator (library).
`mkddc-hmi` đọc SHM read-only và gửi limited operator action qua local authenticated
broker rồi core. **Deferred Rev B+:** `kinexus-agent` (MQTT), `kinexus-ota`.

### 1.2 Startup Order (chốt theo Contract Freeze — iobus tạo SHM nên chạy TRƯỚC)

```
mkddc-iobus (SCHED_FIFO 70, UART/IOP master, creator + writer mkddc_io_shm)
    └─► mkddc-core (SCHED_FIFO 80, graph engine + priority/safe-state, scan 1s)
            └─► mkddc-web (REST/config/validator/commissioning)
```

Dùng `Wants=` (không `Requires=`): service trước restart không kéo service sau chết;
reader tự retry attach SHM tới khi magic hợp lệ. Tất cả process dùng systemd
`WatchdogSec=` + hardware watchdog. `mkddc-core` PHẢI báo `sd_notify("READY=1")` sau khi
scan cycle đầu tiên hoàn thành; `mkddc-iobus` READY sau handshake MCU (degraded: RECONNECT).
Unit file đầy đủ: [06 §10](../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) ·
[07 §9](../03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md).

<details><summary>§1.1-legacy — danh sách 7 service <code>kinexus-*</code> (tham chiếu)</summary>

| Service | Binary | User | Restart | Dep |
|---------|--------|------|---------|-----|
| `kinexus-io-driver` | `/usr/sbin/kinexus-iod` | `kinexus` | always | — |
| `kinexus-plc` | `/usr/sbin/kinexus-plcd` | `kinexus` | always | `kinexus-io-driver` |
| `kinexus-bacnet` | `/usr/sbin/kinexus-bacnetd` | `kinexus` | always | `kinexus-plc` |
| `kinexus-agent` | `/usr/bin/kinexus-agent` | `kinexus` | always | `kinexus-plc` |
| `kinexus-webide` | `/usr/bin/kinexus-webide` | `webide` | always | `kinexus-agent` |
| `kinexus-hmi` | `/usr/sbin/kinexus-hmid` | `kinexus` | always | `kinexus-io-driver` |
| `kinexus-ota` | `/usr/sbin/kinexus-otad` | `root` | on-failure | — |

</details>

---

<details>
<summary>§2-legacy — IPC Architecture (7 service <code>kinexus-*</code>, SHM <code>/dev/shm/kinexus_*_shm</code>) — superseded by 3-process <code>mkddc-*</code> + <code>/dev/shm/mkddc_*_shm</code> (xem <a href="../../shared/mkddc_shm.h">shared/mkddc_shm.h</a>, ADR-005)</summary>

## 2. IPC Architecture

### 2.1 Tổng quan IPC

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         SOM Debian 12 Process Space                      │
│                                                                          │
│  kinexus-io-driver                                                       │
│   [SCHED_FIFO 70]  ──W──► /dev/shm/kinexus_io_shm (seqlock) ◄──R──┐    │
│                    ──W──► alarm_bus (Unix socket)            ◄──R──┤    │
│                                                                     │    │
│  kinexus-plc                                                        │    │
│   [SCHED_FIFO 80]  ──R──► kinexus_io_shm                          │    │
│                    ──W──► kinexus_io_shm (AO/DO setpoint fields)   │    │
│                    ──W──► plc_data_shm (BACnet object values) ◄──R──┤    │
│                                                                     │    │
│  kinexus-bacnet    ──R──► plc_data_shm                            │    │
│                    ──R──► /data/config/device.conf                 │    │
│                                                                     │    │
│  kinexus-agent     ──R──► plc_data_shm (MQTT publish)              │    │
│                    ──R──► REST API requests → plc_data_shm          │    │
│                    ──W──► plc_data_shm (REST/MQTT write commands)  │    │
│                                                                     │    │
│  kinexus-hmi       ──R──► kinexus_io_shm (display values)          │    │
│                    ──R──► alarm_bus                                 │    │
│                                                                     │    │
│  kinexus-webide    ──TCP──► kinexus-agent (8443/8080)               │    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Shared Memory Segments

| Name | Type | Writer | Readers | Content |
|------|------|--------|---------|---------|
| `/kinexus_io_shm` | POSIX shm + seqlock | `kinexus-io-driver` | PLC, HMI, agent | I/O snapshot (`kinexus_io_shm_t`, định nghĩa trong IOP spec) |
| `/kinexus_plc_shm` | POSIX shm + rwlock | `kinexus-plc` | BACnet, agent | PLC data model (BACnet objects + AV/BV values) |

**`kinexus_plc_shm_t` Layout:**
```c
// Max 256 Analog Values + 256 Binary Values + 64 MSV
#define KX_MAX_AV  256
#define KX_MAX_BV  256
#define KX_MAX_MSV  64

typedef struct {
    float    value;          // Present value
    float    cov_threshold;  // COV subscribe threshold
    uint8_t  quality;        // 0=good, 1=uncertain, 2=bad
    bool     out_of_service; // BACnet Out_Of_Service flag
    uint8_t  _pad[2];
} kx_av_t;                   // Analog Value / AI / AO object

typedef struct {
    bool     value;          // Present value
    uint8_t  quality;        // 0=good, 1=uncertain, 2=bad
    bool     out_of_service;
    uint8_t  _pad;
} kx_bv_t;                   // Binary Value / BI / BO object

typedef struct {
    uint8_t  value;          // State index (0-based)
    uint8_t  num_states;     // Number of states
    uint8_t  quality;
    bool     out_of_service;
} kx_msv_t;                  // Multi-State Value

typedef struct {
    volatile uint32_t seq;          // rwlock sequence (same seqlock pattern)
    uint32_t          timestamp_ms;

    // I/O Physical Points (mapped from kinexus_io_shm)
    kx_av_t  ai[8];          // AI1-AI8 (Universal Inputs scaled)
    kx_av_t  ao[4];          // AO1-AO4
    kx_bv_t  bi[8];          // BI1-BI8 (Digital Inputs)
    kx_bv_t  bo[4];          // BO1-BO4 (Digital Outputs)

    // PLC Virtual Points
    kx_av_t  av[KX_MAX_AV];  // Analog Values (PLC internal / virtual)
    kx_bv_t  bv[KX_MAX_BV];  // Binary Values
    kx_msv_t msv[KX_MAX_MSV]; // Multi-State Values

    // Device-level
    char     device_name[64];
    uint32_t device_id;       // BACnet Device Instance
} kinexus_plc_shm_t;
```

**Seqlock Pattern cho `kinexus_io_shm`:**
```c
// Writer (IOP driver):
shm->seq++;                    // odd → write in progress
__sync_synchronize();          // memory barrier
// ... write fields ...
__sync_synchronize();
shm->seq++;                    // even → valid

// Reader (PLC, non-blocking):
uint32_t s1, s2;
do {
    s1 = shm->seq;
    if (s1 & 1) continue;      // write in progress, retry
    __sync_synchronize();
    // read fields
    __sync_synchronize();
    s2 = shm->seq;
} while (s1 != s2);
```

### 2.3 Alarm Bus (Unix Domain Socket)

- Path: `/run/kinexus/alarm.sock`
- Protocol: JSON lines (newline-delimited)
- Direction: `kinexus-io-driver`, `kinexus-plc` (publisher) → `kinexus-agent`, `kinexus-hmi` (subscriber)
- Message format:
```json
{"ts": "2026-05-28T10:00:00Z", "source": "iop", "code": "IOP_FAULT", "severity": "critical", "msg": "MCU not responding"}
```

---


</details>

## 3. Data Flow

### 3.1 I/O Read Flow (AI → BACnet → MQTT)

```
MCU (1ms)
  └─► ADS131M08 sample → io_data_buf

IOP Driver (10ms)
  └─► GET_IO frame → UART DMA
      ← IO_RESP frame
      Parse + CRC check
      Scale raw → engineering value (per sensor type config)
      Write kinexus_io_shm (seqlock)

PLC Runtime (100ms)
  └─► Read kinexus_io_shm → PLC variable %IW1..%IW8
      Execute FBD/ST program
      Compute AO/DO setpoints
      Write kinexus_io_shm (AO/DO fields) + plc_data_shm (BACnet AI/AO objects)

IOP Driver (10ms, after PLC write)
  └─► Read new AO/DO from kinexus_io_shm
      If changed: send SET_AO / SET_DO → MCU

BACnet / MQTT (event-driven)
  └─► Read plc_data_shm
      On COV: send BACnet COV notification / MQTT publish
```

### 3.2 Output Write Flow (BACnet → PLC → MCU)

```
BMS writes BACnet Write-Property (AO1)
  └─► kinexus-bacnet receives
      Update plc_data_shm AO1.present_value
      (optionally) signal PLC via eventfd

PLC Runtime (next 100ms scan)
  └─► Read plc_data_shm AO1.present_value → %QW1
      If program allows write: propagate to kinexus_io_shm.ao_setpoint[0]

IOP Driver (next 10ms)
  └─► Detect ao_setpoint changed
      Send SET_AO to MCU
      MCU applies to DAC8554
```

---

## 4. Scaling & Engineering Value Conversion

Tất cả scaling PHẢI thực hiện trong `kinexus-io-driver` (không trong PLC, không trong BACnet). PLC chỉ thấy engineering values.

### 4.1 UI Scaling (per sensor type)

| Sensor Type | Raw → Engineering Value | Unit |
|-------------|------------------------|------|
| 0–10V | `V = (raw_s24 / 8388607.0) × 10.0` | V |
| 4–20mA | `mA = 4.0 + (raw_s24 / 8388607.0) × 16.0` | mA |
| PT100 | Callendar-Van Dusen: `R = R0 × (1 + A×T + B×T²)`; invert for T | °C |
| PT1000 | Same CVD, R0=1000Ω | °C |
| NTC 10k | Steinhart-Hart: `1/T = A + B×ln(R) + C×(ln(R))³` | °C |
| NTC 20k | Same S-H coefficients, different R0 | °C |
| Dry Contact | `raw_s24 > threshold` → 1 (ON); else 0 | bool |

**Hệ số CVD cho PT100/PT1000 (IEC 60751):**
- A = 3.9083×10⁻³, B = -5.775×10⁻⁷, C = -4.183×10⁻¹² (below 0°C)

**Hệ số Steinhart-Hart cho NTC 10kΩ β=3950 (sensor HVAC tiêu chuẩn — khớp IO_UI §3.5):**
- A = 1.129×10⁻³, B = 2.341×10⁻⁴, C = 8.76×10⁻⁸
- > NTC chuẩn của sản phẩm là **10kΩ β=3950**. Nếu dùng part khác (vd Murata NCP18XH103 β=3380) → user nhập hệ số riêng qua web UI (xem SW-Q-007).

> **Lưu ý:** Nếu dùng NTC khác nhà sản xuất, cần cập nhật hệ số. Xem Open Issues SWFW-Q-007.

### 4.2 AO Scaling (engineering → DAC raw)

| Mode | Engineering → Raw |
|------|------------------|
| 0–10V | `raw = (V / 10.0) × 65535`, clamp [0, 65535] |
| 4–20mA | `raw = ((mA - 4.0) / 16.0) × 65535`, clamp [0, 65535] |

---

## 5. Configuration Files

| File | Owner | Format | Mô tả |
|------|-------|--------|-------|
| `/data/config/device.conf` | Web IDE | JSON | BACnet Device ID, Device Name |
| `/data/config/network.conf` | Web IDE | JSON | IP/DHCP, DNS |
| `/data/config/io_config.conf` | Web IDE | JSON | UI sensor type per kênh |
| `/data/config/io_safe_state.conf` | Web IDE | JSON | Safe state values per kênh |
| `/data/config/bacnet.conf` | Web IDE | JSON | BACnet/IP: UDP port, BBMD, segmentation (MS/TP đã bỏ — ARCH-R010) |
| `/data/config/fieldbus.conf` | Web IDE | JSON | RS-485 Modbus RTU master: baud/parity, danh sách slave + device profile, poll |
| `/data/config/mqtt.conf` | Web IDE | JSON | Broker URL, cert, topic prefix |
| `/data/config/users.conf` | Web IDE | JSON | User accounts (password hashed bcrypt) |
| `/data/plc/programs/` | Web IDE | `.kxp` (XML) | FBD/ST programs |
| `/data/plc/retain.dat` | PLC runtime | Binary | RETAIN variables |
| `/data/certs/` | Admin | PEM | TLS certificates + private key |

---

## 6. REST API — Endpoint Reference

### 6.1 Endpoint Catalog

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| `POST` | `/api/v1/auth/login` | None | Login, trả JWT |
| `POST` | `/api/v1/auth/logout` | Bearer | Logout, invalidate token |
| `GET` | `/api/v1/points` | Bearer | Danh sách tất cả I/O points |
| `GET` | `/api/v1/points/{id}` | Bearer | Giá trị + timestamp + quality |
| `PUT` | `/api/v1/points/{id}` | Bearer | Ghi giá trị |
| `GET` | `/api/v1/system/status` | Bearer | CPU%, RAM%, IOP metrics, version |
| `GET` | `/api/v1/system/config` | Bearer (admin) | Đọc cấu hình hiện tại |
| `PUT` | `/api/v1/system/config` | Bearer (admin) | Cập nhật cấu hình |
| `POST` | `/api/v1/ota/upload` | Bearer (admin) | Upload firmware package |
| `POST` | `/api/v1/ota/apply` | Bearer (admin) | Trigger OTA apply + reboot |
| `GET` | `/api/v1/ota/status` | Bearer | OTA status, progress% |
| `GET` | `/api/v1/logs/download` | Bearer (admin) | Download log (gzip) |
| `GET` | `/api/v1/bacnet/objects` | Bearer | BACnet object list |
| `GET` | `/api/v1/alarms` | Bearer | Active alarms list |
| `POST` | `/api/v1/alarms/{id}/ack` | Bearer | Acknowledge alarm |

### 6.2 Response Schemas

**Point Object:**
```json
{
  "id": "UI1",
  "type": "AI",
  "value": 23.5,
  "unit": "°C",
  "quality": "good",
  "timestamp": "2026-05-28T10:00:00.123Z",
  "sensor_type": "NTC10k",
  "fault": false
}
```

**System Status:**
```json
{
  "cpu_percent": 12.5,
  "ram_percent": 35.2,
  "uptime_s": 86400,
  "fw_version": "1.0.0",
  "iop": {
    "status": "normal",
    "crc_errors": 0,
    "timeouts": 0,
    "seq_errors": 0
  }
}
```

---

## 7. Technology Stack

| Layer | Technology | Version | Lý do |
|-------|-----------|---------|-------|
| OS | Debian 12 Bookworm | — | BSP chính thức Radxa CM3 |
| Kernel | Linux 6.1 LTS + PREEMPT_RT | 6.1.x-rt | Real-time I/O driver |
| IOP Driver | C11 (gcc 12) | — | Latency-sensitive, SCHED_FIFO |
| PLC Runtime | C++17 | — | IEC 61131-3 engine |
| BACnet | bacnet-stack (open source) | 1.3.x | Proven BTL candidate |
| Modbus RTU master | libmodbus | 3.1.10 | `modbus_new_rtu()` master mode — poll thiết bị phụ (không tự viết stack) |
| MQTT | Paho MQTT C + Python | 1.6.x | TLS 1.3 support |
| REST API | FastAPI (Python 3.11) | 0.111+ | Async, auto OpenAPI docs |
| Web IDE (backend) | FastAPI | — | Shared với agent |
| Web IDE (frontend) | Svelte + TypeScript | — | Lightweight, fast |
| HMI | C++17 + LVGL v9 + DRM/KMS | 9.x | JD9852 MIPI DSI, FT5436 evdev; feature-gated limited operator client |
| Init system | systemd | 252+ | WatchdogSec support |
| Firewall | nftables | — | SEC-020 |
| Container | None (bare systemd services) | — | Simpler, lower overhead |

---

## 8. Directory Structure

```
/usr/sbin/
  kinexus-iod           # IOP driver binary
  kinexus-plcd          # Soft PLC runtime binary
  kinexus-bacnetd       # BACnet daemon
  kinexus-hmid          # HMI display daemon
  kinexus-otad          # OTA daemon

/usr/lib/kinexus/
  libkinexus-iop.so     # IOP protocol library (shared with FW test harness)
  libkinexus-plc.so     # PLC runtime library

/usr/share/kinexus/
  fb_standard/          # IEC 61131-3 standard function blocks
  webide/               # Web IDE static files (JS, CSS)

/data/                  # Writable, persistent
  config/
  log/
  plc/
  certs/
  ota/

/run/kinexus/           # Runtime (tmpfs, non-persistent)
  alarm.sock            # Alarm bus Unix socket
  *.pid                 # PID files
```

---

**Document ID:** SW-ARCH-MK-DDC-24-VI
**Revision:** 1.1 | 2026-07-22 — reconciled optional Rev A HMI, DRM/MIPI target and ADR-016 limited-operator command boundary
**Approved by:** Software Lead, System Architect — KINEXUS Technologies
