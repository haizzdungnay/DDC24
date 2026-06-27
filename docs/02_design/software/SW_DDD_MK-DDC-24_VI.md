# Software Detailed Design — MK-DDC-24
## SOM Application Layer / Debian 12 (IEEE 1016)

> **Document ID:** DDD-SW-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-13 (reconcile 3-process mkddc, Modbus RTU master, BACnet/Modbus implementation docs) · 1.0 | 2026-05-30
> **Trạng thái:** Draft (DP-0 skeleton có decomposition) — chi tiết service ở DP-2
> **Owner:** Software Team
> 📘 [README](../../01_specs/README.md) · Nâng từ `SW_ARCH_SPEC` · Trace `SW_REQUIREMENTS`, `SRS`

> ⚠️ **RECONCILE (2026-06-08).** Decomposition cập nhật theo [ADR-005](../../adr/ADR-005-three-process-architecture.md): **3 process `mkddc-*`**
> (core C++ component-graph + iobus + web Go). Engine **component-based**, không IEC 61131-3 ([ADR-004](../../adr/ADR-004-component-based-runtime.md)).
> Nguồn-chuẩn: [PRODUCT_DEFINITION](../../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md), [SW_RUNTIME_EXECUTION_MODEL](SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md).

---

## 1. Mục đích & Phạm vi
Thiết kế chi tiết các service userspace trên SOM: phân rã, interface (IPC/REST/topic), dữ liệu, luồng, lỗi. **Trace:** `SW-*`, `OS-*`, `SEC-*`, `OTA-*`, `LOG-*`.
Không bao gồm: firmware MCU (xem FW_DDD), phần cứng.

## 2. Bối cảnh & ràng buộc
- Debian 12 + kernel 6.1 PREEMPT_RT; init systemd, `WatchdogSec=30s`.
- Rootfs read-only (OverlayFS), ghi chỉ `/data`,`/var` (OS-004).
- Real-time: `mkddc-core` SCHED_FIFO (IO image + component graph engine, scan 1s).
- IPC: POSIX shm seqlock/rwlock (SW_ARCH §2). Stack công nghệ: SW_ARCH §7.

## 3. Phân rã service (process model — ADR-005, Rev A)

Rev A: **3 process `mkddc-*`** (chia theo real-time boundary).
```
mkddc-core (RT) ──► mkddc-iobus (BACnet/IP, Modbus RTU master)
                ──► mkddc-web   (REST/config/validator/commissioning)
   (HMI / agent MQTT / OTA / cloud: deferred Rev B+)
```

| Process | Ngôn ngữ | Vai trò | Trace |
|---------|----------|---------|-------|
| `mkddc-core` | C++17 | IO image (gộp io-driver) + **component graph engine** (scan 1s) + priority/safe-state + BACnet object table | RUN-001..009, SW-IOP-* |
| `mkddc-iobus` | C/C++17 | BACnet/IP (bacnet-stack), COV *(MS/TP bỏ)* + **Modbus RTU master** (async ext cache, device profile) | SW-BAC-*, SW-MOD-* |
| `mkddc-web` | Go | web config (**form/JSON**) + **validator (library)** + monitor + commissioning + SQLite | SW-WEB-* (thay SW-IDE-*) |

**Deferred Rev B+** (thiết kế cũ giữ tham chiếu, không mất): `kinexus-agent` (MQTT/REST),
`kinexus-hmi` (LVGL TFT), `kinexus-ota`, security service in-agent. Xem [REVA_SCOPE §3](../../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md).

<details><summary>§3-legacy — decomposition cũ (7+ service <code>kinexus-*</code>, IEC 61131-3 — tham chiếu)</summary>

| Service | Ngôn ngữ | Vai trò | Trace |
|---------|----------|---------|-------|
| `kinexus-io-driver` | C/Rust | IOP master, scale raw→eng, shm | SW-IOP-001..011 |
| `kinexus-plc` | C++17 | runtime IEC 61131-3 (FBD/ST), scan, retain | SW-PLC-001..022 |
| `kinexus-bacnet` | C | BACnet/IP, objects, COV *(MS/TP bỏ)* | SW-BAC-001..008 |
| `kinexus-agent` | Python | MQTT, REST | SW-MQ/API-* |
| `kinexus-fieldbus` | C/Py | **Modbus RTU master** (poll thiết bị phụ, device profile) | SW-MOD-001..011 |
| `kinexus-webide` | Py+Svelte | IDE FBD/ST, config, monitor | SW-IDE-001..023 |
| `kinexus-hmi` | C/LVGL | dashboard TFT từ shm | SW-HMI-001..008 |
| `kinexus-ota` | Py/shell | A/B update, verify, rollback | SW-OTA-001..008 |
| security (in agent) | Py | TLS, JWT, audit, key store | SW-SEC-001..008 |

</details>

## 4. Thiết kế chi tiết service

### 4.1 `mkddc-iobus` IOP layer
- **Interface:** IOP master theo [SWFW_INTERFACE_SPEC]; ghi `/dev/shm/mkddc_io_shm` (seqlock, SW-IOP-006).
- **Luồng:** poll GET_IO 100Hz → parse/CRC → **scale raw→engineering** (SW_ARCH §4: CVD, Steinhart-Hart β=3950) → write shm. Đọc AO/DO setpoint từ shm, đổi → SET_AO/SET_DO.
- **FSM:** NORMAL→IOP_FAULT→SAFE_STATE (gửi RESET_IO, alarm bus) (SW-IOP-008/009).
- **Lỗi:** timeout 10ms ×3 → fault; metrics qua REST (SW-IOP-011).
- **Real-time:** SCHED_FIFO 70 (SW-IOP-010).

### 4.2 `mkddc-core` (component graph engine, gộp io-driver)
- **Interface:** đọc/ghi `mkddc_io_shm` (AI/AO/DI/DO), cập nhật BACnet object table (AI/AO/BI/BO/AV/BV).
- **Engine:** thực thi **component graph** (execution plan topo-sort); component chuẩn OnDelay/OffDelay/Compare/Scale/Limit/PID (anti-windup). **Chi tiết → [D-6 SW_RUNTIME_EXECUTION_MODEL](SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [SW_COMPONENT_LIBRARY](SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)**.
- **Scan:** mặc định **1s** (min 500ms), SCHED_FIFO; đo budget + đếm overrun.
- **Priority/Safe-state:** mọi AO/DO qua priority resolver; sensor/Modbus BAD → safe-state (RUN-006/007).
- **State:** snapshot chỉ node persist (`RuntimeCounter`, `PulseCounter`) ra `/data/mkddc/state.snap` (60s dirty + shutdown + graph swap) + recovery theo node id+type (RUN-004; xem RUNTIME_MODEL Rev 1.1).

### 4.3 BACnet module trong `mkddc-iobus`
- **Objects:** theo SRS §5.1 (Device, AI8/AO4/AV32/BI8/BO4/BV16/MSV8, Trend8, Schedule8, Calendar2, NC4, EE8). **PICS → [D-3]**.
- **Transport:** BACnet/IP UDP 47808 (Ethernet/WiFi); COV; Who-Is<100ms. *(MS/TP bỏ — ARCH-R010.)*
- **Nguồn dữ liệu:** đọc `/dev/shm/mkddc_plc_shm`; Write-Property cập nhật BACnet Priority_Array[16], winner đi vào core mức 3 qua IPC; không ghi IO trực tiếp. Chi tiết triển khai → [Implementation 24](../../03_implementation/25_BACNET_IMPLEMENTATION_PLAN.md).
- **Device ID:** `/data/config/device.conf`, fallback DIP qua CM3 GPIO (SW-BAC-006).

### 4.4 Fieldbus module trong `mkddc-iobus` (Modbus RTU master)
- **Fieldbus:** poll thiết bị phụ theo **device profile**; xem [D-2](../interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md), [SW_FIELDBUS_DESIGN](SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md), [Implementation 25](../../03_implementation/26_MODBUS_IMPLEMENTATION_PLAN.md). Map điểm slave vào ext cache/core point. *(Không còn Modbus slave phục vụ BMS; MQTT/agent deferred Rev B+.)*

### 4.5 `mkddc-web` (Go) *(thay kinexus-webide)*
- **Form/JSON** config (KHÔNG FBD/ST): IO/BACnet/Modbus mapping + import/export `graph.json`; watch table/monitor (WebSocket), force I/O (auth admin); validator (library) chạy lúc deploy; commissioning + backup/restore. HTTP 8080 (LAN) → HTTPS 8443 (prod). **Graph/REST → [GRAPH_SCHEMA §7](../interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md)**, config schema → [D-5]. Xem [ADR-006](../../adr/ADR-006-rev-a-ui-form-json.md)/[ADR-007](../../adr/ADR-007-web-stack-go.md).

### 4.6 `kinexus-hmi`
- LVGL v9 → `/dev/fb0` (fbtft ILI9341, SPI0); data từ `mkddc_io_shm` nếu HMI bật lại Rev B+; 6-nút GPIO; màn Dashboard/IO/Alarm/Network/System; ≥10 FPS; refresh ≤1s.

### 4.7 `kinexus-ota`
- A/B partition; download HTTPS TLS1.3 + cert validation; verify SHA-256 + GPG; **update MCU đồng thời** (FW-OTA path); rollback 2 lần fail; downtime ≤60s; log. **Sequence (SOM+MCU) → [D-7]**.

### 4.8 Security (in agent)
- TLS 1.3, JWT HS256 secret từ **key store [D-11]**; AppArmor; nftables (SEC-020, port policy đã sửa — 1883 chặn mặc định); brute-force lockout; audit log.

## 5. IPC & dữ liệu (SW_ARCH §2 — nguồn-chuẩn)
- `mkddc_io_shm` (iobus→core/web, seqlock).
- `mkddc_plc_shm` (core→BACnet/web, rwlock/seqlock theo shared header).
- `alarm.sock` (Unix socket, JSON lines).
- Config `/data/config/*.conf` (JSON, **schema D-5**).

## 6. Xử lý lỗi & phục hồi
- systemd restart=always + WatchdogSec; `sd_notify(READY=1)` sau scan đầu.
- Failsafe: mất BMS >30s → PLC standalone (SW-BAC-008); mất IOP → safe-state.
- Fault catalog: SRS §13 (E1xx–E5xx) → alarm bus → BACnet NC/MQTT/HMI.

## 7. Ma trận truy vết (trích)
| REQ | Design unit | Test |
|-----|-------------|------|
| SW-IOP-006 | §4.1 | T-SW-005 |
| SW-PLC-011 | §4.2 / D-6 | T-SW-031 |
| SW-BAC-005 | §4.3 / D-3 | T-SW-053 |
| SW-MOD-003 | §4.4 / D-2 | T-SW-122 |
| SW-OTA-005 | §4.7 / D-7 | T-SW-094 |
| SW-SEC-005 | §4.8 / D-11 | T-SW-084 |

## 8. Open points
| ID | Vấn đề | Owner | Hạn |
|----|--------|-------|-----|
| DEC-001 | ✅ ĐÃ CHỐT ([ADR-004](../../adr/ADR-004-component-based-runtime.md)): component graph, không 61131-3/OpenPLC | — | Closed |
| SW-Q-004 | key store OP-TEE/TPM/encrypted FS (D-11) | SW+HW | DP-2 |
| SW-Q-005 | OTA server endpoint (cert pinning, D-7) | DevOps | DP-1 |
| — | Service designs riêng ở DP-2 | SW | DP-2 |

---
**Rev** 1.1 | 2026-06-13 (reconcile mkddc naming + S7 #4/#5/#6 docs) · 1.0 | 2026-05-30
