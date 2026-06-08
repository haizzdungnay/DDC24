# BE Developer Guide & Backlog — MK-DDC-24
## Backend (SOM Debian) — từ số 0 đến chạy được

> **Document ID:** KX-DDC24-BE-DEVGUIDE-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved · **Owner:** SW Lead
> 📘 [docs/README](../README.md) · Code: [REPO](KX-DDC24-PM-REPO-001_VI.md) · Thiết kế: [SW_DDD](../02_design/software/SW_DDD_MK-DDC-24_VI.md) · Chuẩn: [SW Coding Standard](../02_design/software/SW_CODING_STANDARD_MK-DDC-24_VI.md)

> 🎯 Backend gồm nhiều **service độc lập** nối nhau qua **shared memory** ([`shared/kinexus_shm.h`](../../shared/kinexus_shm.h)). Dev mở file này là: cài môi trường → chạy được io-driver đọc MCU & in giá trị → rồi đắp PLC, BACnet, fieldbus, agent theo backlog.

> ⚠️ **RECONCILE (2026-06-08).** Backend Rev A là **3 process `mkddc-*`** (ADR-005): `mkddc-core`
> (C++, IO+**component graph engine**, không phải PLC 61131-3) + `mkddc-iobus` (C++, BACnet/Modbus) +
> `mkddc-web` (**Go**, thay Python/FastAPI; validator là Go library, bỏ Rust service — [ADR-007](../adr/ADR-007-web-stack-go.md)).
> Engine: [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md); component: [SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).
> Header `kinexus_shm.h` → `mkddc_shm.h` (rename là task riêng). Backlog cũ (PLC/agent Python) đọc như tham chiếu.

---

## 1. Chuẩn bị
| Việc | Lệnh |
|------|------|
| Host dev | `sudo apt install build-essential cmake python3.11 python3-venv libmodbus-dev` |
| BACnet | `git clone https://github.com/bacnet-stack/bacnet-stack` (build static lib) |
| Python | `pip install fastapi uvicorn paho-mqtt pymodbus pytest ruff mypy` |
| Thiết bị | SSH `ssh -p 2222 kinexus@<ip>`; UART tới MCU `/dev/ttySx` |
| Đọc trước | [SW_ARCH §2 (IPC)](../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md), [`kinexus_shm.h`](../../shared/kinexus_shm.h), [`iop_protocol.h`](../../shared/iop_protocol.h) |

## 2. Bản đồ service (code ở đâu)
```
services/
├── libkinexus/      ← lib chung: shm_open/seqlock helper, log JSON, config loader
├── io-driver/       ← C   IOP master + scaling → ghi io_shm           ⭐ làm trước
├── plc/             ← C++ IEC 61131-3 engine; io_shm <-> plc_shm
├── bacnet/          ← C   BACnet/IP; đọc/ghi plc_shm
├── fieldbus/        ← C/Py Modbus RTU master; ghi ext vào shm
├── agent/           ← Py  MQTT + REST (FastAPI); đọc/ghi plc_shm
├── hmi/             ← C   LVGL; đọc io_shm
└── ota/             ← Py  A/B update
```
Mỗi service 1 systemd unit (`infra/debian-image/systemd/`), restart=always, `sd_notify`.

## 3. 🚶 Walking skeleton (mốc "chạy được" đầu tiên)
> Mục tiêu: io-driver **đọc giá trị từ MCU thật và in ra** + ghi `io_shm`; một tool nhỏ đọc shm in ra. Có cái này = mạch máu dữ liệu đã thông.

```
B1  libkinexus: shm_create/open + seqlock write/read + test reader/writer  (T-BE-02)
B2  io-driver: mở UART, iop_crc16 (từ header), HANDSHAKE với MCU           (T-BE-01)
B3  io-driver: vòng GET_IO 100Hz, parse IO_RESP, ghi raw vào io_shm        (T-BE-03a)
B4  tool `shmdump`: đọc io_shm in ra terminal                              (debug)
✅  thấy giá trị MCU đổi realtime trên terminal = SKELETON SỐNG
B5  thêm scaling raw→engineering (°C/V/mA)                                  (T-BE-03b)
```

## 4. 🎫 Backlog (ticket-level)

### BE-T01 — libkinexus: shared memory + seqlock ` (S2) `
- **Mục tiêu:** helper shm dùng chung.
- **File:** `services/libkinexus/shm.c/.h` (include `shared/kinexus_shm.h`), `log.c`, `config.c`.
- **Acceptance:** create/open `kinexus_io_shm` + `kinexus_plc_shm`; macro KX_WRITE_BEGIN/END; reader đọc đúng khi writer chạy 100Hz (không rách dữ liệu).
- **Test:** stress reader/writer đa luồng (T-SW-005).
- **Trace:** SW-IOP-006, SW_ARCH §2.

### BE-T02 — io-driver: IOP master handshake ⭐ ` (S2) `
- **File:** `services/io-driver/` (`uart.c`, `iop_master.c`, `main.c`).
- **Acceptance:** mở `/dev/ttySx` 921600; `iop_crc16` khớp test vector header; HANDSHAKE với MCU thật OK; SCHED_FIFO 70.
- **Test:** handshake với board; `chrt -p` = FIFO 70.
- **Trace:** SW-IOP-001..003.

### BE-T03 — io-driver: GET_IO loop + scaling ⭐ ` (S2-3) `
- **File:** `io-driver/iop_master.c`, `scale.c`.
- **Acceptance:** poll 100Hz, parse IO_RESP (offsets từ header), retry×3→fault FSM; scale raw→eng (0-10V, 4-20mA, PT100/1000 CVD, NTC β=3950, dry); ghi `io_shm`; metrics.
- **Test:** so giá trị chuẩn (T-SW-006..009); cắt MCU → IOP_FAULT→SAFE (gửi RESET_IO).
- **Trace:** SW-IOP-004..011, [SW_IODRIVER](../02_design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md).

### BE-T04 — io-driver: ghi AO/DO từ shm ` (S3) `
- **Acceptance:** đọc `ao_setpoint/do_cmd` từ shm (PLC ghi) → SET_AO/SET_DO khi đổi; SET_AO_CFG theo `io_config.conf`.
- **Trace:** SW-IOP, FW-AO-007.

### BE-T05 — core: component graph scan engine ⭐ ` (S5-6) `
- **File:** `services/core/` (`engine.cpp`, `component_lib.cpp`, `pid.cpp`, `node_state.cpp`).
- **Acceptance:** snapshot inputs → build/execute plan (topo-sort) → priority resolve → write io_shm + BACnet object table; SCHED_FIFO scan 1s; component chuẩn (OnDelay/OffDelay/PID anti-windup); snapshot/recovery.
- **Test:** graph nhiều node; PID step settle ±2% ≤30s; power-loss recovery; scan budget (T-SW-020..031).
- **Trace:** RUN-001..009, [D-6 Runtime Execution Model](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md). (DEC-001 đã chốt: [ADR-004](../adr/ADR-004-component-based-runtime.md).)

### BE-T06 — bacnet: BACnet/IP objects + COV ⭐ ` (S5) `
- **File:** `services/bacnet/` (callbacks ↔ plc_shm).
- **Acceptance:** AI8/AO4/AV32/BI8/BO4/BV16/MSV8 + Device; R/W-Property(-Multiple); COV; Who-Is<100ms; **BACnet/IP only** (BBMD/FD); Reliability map.
- **Test:** YABE đọc/ghi; COV≤200ms (T-SW-050..058).
- **Trace:** SW-BAC-001..008, [D-3](../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md).

### BE-T07 — fieldbus: Modbus RTU master ` (S3-4) `
- **File:** `services/fieldbus/` (`rtu_master.c`, `profile.c`), `profiles/*.json`.
- **Acceptance:** poll slave theo `fieldbus.conf` + device profile; decode type/scale/byte_order → ghi `ext` shm; ghi xuống slave (FC06/16); offline→bad+E302.
- **Test:** slave giả lập (diagslave); rút slave→offline (T-SW-120..128).
- **Trace:** SW-MOD-001..011, [SW_FIELDBUS](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md).

### BE-T08 — agent: REST API ` (S3) `
- **File:** `services/agent/api/` (FastAPI theo [openapi.yaml](../02_design/interfaces/openapi.yaml)).
- **Acceptance:** /auth, /points (GET/PUT), /system/status, /alarms; JWT; rate-limit 429; error `{error,code,request_id}`; Swagger khớp openapi.yaml.
- **Test:** curl đọc/ghi; T-SW-070..079.
- **Trace:** SW-API-001..010.

### BE-T09 — agent: MQTT ` (S5) `
- **Acceptance:** TLS 8883, LWT, COV publish `kinexus/{id}/io/{point}`, reconnect backoff.
- **Trace:** SW-MQ-001..007.

### BE-T10 — hmi: LVGL dashboard ` (S8) `
- **File:** `services/hmi/` (đọc io_shm, fbdev, 6 nút GPIO).
- **Acceptance:** 5 màn ≥10FPS; giá trị khớp BACnet (theo [UX_HMI](../04_uiux/KX-DDC24-UX-HMI-001_VI.md)).
- **Trace:** SW-HMI-001..008.

### BE-T11 — ota + security ` (S8-9) `
- **Acceptance:** A/B + rollback; TLS1.3+JWT keystore; nftables (KHÔNG mở 502); audit log.
- **Trace:** OTA-*, SEC-*, [D-7](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md), [D-11](../02_design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md).

## 5. Definition of Done (mọi ticket BE)
- [ ] C/C++: `-Werror` + clang-tidy; Python: ruff + `mypy --strict`; cov core ≥80%.
- [ ] Validate mọi input mạng; không hardcode secret.
- [ ] systemd unit + `sd_notify(READY=1)`.
- [ ] PR ghi REQ ID + Task ID; cập nhật Traceability.

## 6. Bẫy hay gặp
- Đọc shm phải theo **seqlock pattern** (đọc seq trước/sau), không thì vớ dữ liệu rách.
- io-driver phải **SCHED_FIFO** + `clock_nanosleep(ABSTIME)` cho nhịp 10ms ổn định.
- BACnet Write-Property **không ghi thẳng MCU** — ghi vào plc_shm, PLC scan sau áp dụng (priority array).
- fieldbus là **master** — chỉ 1 process mở cổng RS-485, đừng để 2 service tranh.
- Không mở port 502 (không phải Modbus slave).

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | SW Lead | Phát hành đầu — guide + walking skeleton + 11 ticket |
