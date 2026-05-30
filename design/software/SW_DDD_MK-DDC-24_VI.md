# Software Detailed Design — MK-DDC-24
## SOM Application Layer / Debian 12 (IEEE 1016)

> **Document ID:** DDD-SW-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30
> **Trạng thái:** Draft (DP-0 skeleton có decomposition) — chi tiết service ở DP-2
> **Owner:** Software Team
> 📘 [spec/README](../../spec/README.md) · Nâng từ `SW_ARCH_SPEC` · Trace `SW_REQUIREMENTS`, `SRS`

---

## 1. Mục đích & Phạm vi
Thiết kế chi tiết các service userspace trên SOM: phân rã, interface (IPC/REST/topic), dữ liệu, luồng, lỗi. **Trace:** `SW-*`, `OS-*`, `SEC-*`, `OTA-*`, `LOG-*`.
Không bao gồm: firmware MCU (xem FW_DDD), phần cứng.

## 2. Bối cảnh & ràng buộc
- Debian 12 + kernel 6.1 PREEMPT_RT; init systemd, `WatchdogSec=30s`.
- Rootfs read-only (OverlayFS), ghi chỉ `/data`,`/var` (OS-004).
- Real-time: `kinexus-io-driver` SCHED_FIFO 70, `kinexus-plc` 80.
- IPC: POSIX shm seqlock/rwlock (SW_ARCH §2). Stack công nghệ: SW_ARCH §7.

## 3. Phân rã service (process model — SW_ARCH §1)
```
io-driver → plc → { bacnet, agent(MQTT/REST/Modbus), hmi }
                         agent → webide
ota (root, on-failure)    sec (trong agent)
```

| Service | Ngôn ngữ | Vai trò | Trace |
|---------|----------|---------|-------|
| `kinexus-io-driver` | C/Rust | IOP master, scale raw→eng, shm | SW-IOP-001..011 |
| `kinexus-plc` | C++17 | runtime IEC 61131-3 (FBD/ST), scan, retain | SW-PLC-001..022 |
| `kinexus-bacnet` | C | BACnet/IP+MS/TP, objects, COV | SW-BAC-001..008 |
| `kinexus-agent` | Python | MQTT, REST, Modbus TCP/RTU slave | SW-MQ/API/MOD-* |
| `kinexus-webide` | Py+Svelte | IDE FBD/ST, config, monitor | SW-IDE-001..023 |
| `kinexus-hmi` | C/LVGL | dashboard TFT từ shm | SW-HMI-001..008 |
| `kinexus-ota` | Py/shell | A/B update, verify, rollback | SW-OTA-001..008 |
| security (in agent) | Py | TLS, JWT, audit, key store | SW-SEC-001..008 |

## 4. Thiết kế chi tiết service

### 4.1 `kinexus-io-driver`
- **Interface:** IOP master theo [SWFW_INTERFACE_SPEC]; ghi `/dev/shm/kinexus_io_shm` (seqlock, SW-IOP-006).
- **Luồng:** poll GET_IO 100Hz → parse/CRC → **scale raw→engineering** (SW_ARCH §4: CVD, Steinhart-Hart β=3950) → write shm. Đọc AO/DO setpoint từ shm, đổi → SET_AO/SET_DO.
- **FSM:** NORMAL→IOP_FAULT→SAFE_STATE (gửi RESET_IO, alarm bus) (SW-IOP-008/009).
- **Lỗi:** timeout 10ms ×3 → fault; metrics qua REST (SW-IOP-011).
- **Real-time:** SCHED_FIFO 70 (SW-IOP-010).

### 4.2 `kinexus-plc`
- **Interface:** đọc/ghi `kinexus_io_shm` (AI/AO/DI/DO), ghi `kinexus_plc_shm` (objects BACnet/AV/BV/MSV).
- **Engine:** thực thi ≥16 FBD + ST; FB chuẩn TON/TOF/.../PID_COMPACT (bumpless). **Chi tiết → [D-6 SW_PLC_ENGINE_DESIGN]**.
- **Scan:** mặc định 100ms (50–2000ms), jitter ≤5ms, SCHED_FIFO 80.
- **Watchdog:** overrun >3× → safe-state + restart (SW-PLC-013).
- **Retain:** ghi `/data/plc/retain.dat` <1s khi power-fail (UPS signal); load khi boot.

### 4.3 `kinexus-bacnet`
- **Objects:** theo SRS §5.1 (Device, AI8/AO4/AV32/BI8/BO4/BV16/MSV8, Trend8, Schedule8, Calendar2, NC4, EE8). **PICS → [D-3]**.
- **Transport:** BACnet/IP UDP 47808 + MS/TP RS-485; COV; Who-Is<100ms.
- **Nguồn dữ liệu:** đọc `kinexus_plc_shm`; ghi Write-Property → shm (arbitration với PLC).
- **Device ID:** `/data/config/device.conf`, fallback DIP qua CM3 GPIO (SW-BAC-006).

### 4.4 `kinexus-agent` (MQTT / REST / Modbus)
- **MQTT:** v3.1.1/v5.0, TLS 1.3, topic `kinexus/{id}/io/{point}`, COV publish, LWT, backoff.
- **REST:** FastAPI HTTPS 8443, JWT (exp 1h), endpoints theo SW_ARCH §6, rate-limit 100/s→429.
- **Modbus:** TCP 502 (≥5 client) + RTU; **map = [D-2]** (INT16 ×100); FC01/02/03/04/05/06/15/16; exception codes.
- Đọc/ghi qua `kinexus_plc_shm`.

### 4.5 `kinexus-webide`
- FBD/ST editor (browser), upload/download program, watch table, force I/O (auth admin), I/O config, BACnet/IP config. HTTP 8080 (LAN) → redirect HTTPS 8443 (prod). Roles admin/operator. **Config schema → [D-5]**.

### 4.6 `kinexus-hmi`
- LVGL v9 → `/dev/fb0` (fbtft ILI9341, SPI0); data từ `kinexus_io_shm` (không network); 6-nút GPIO; màn Dashboard/IO/Alarm/Network/System; ≥10 FPS; refresh ≤1s.

### 4.7 `kinexus-ota`
- A/B partition; download HTTPS TLS1.3 + cert validation; verify SHA-256 + GPG; **update MCU đồng thời** (FW-OTA path); rollback 2 lần fail; downtime ≤60s; log. **Sequence (SOM+MCU) → [D-7]**.

### 4.8 Security (in agent)
- TLS 1.3, JWT HS256 secret từ **key store [D-11]**; AppArmor; nftables (SEC-020, port policy đã sửa — 1883 chặn mặc định); brute-force lockout; audit log.

## 5. IPC & dữ liệu (SW_ARCH §2 — nguồn-chuẩn)
- `kinexus_io_shm` (io-driver→PLC/HMI/agent, seqlock).
- `kinexus_plc_shm` (PLC→bacnet/agent, rwlock).
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
| DEC-001 | PLC engine: build vs OpenPLC (ảnh hưởng D-6) | SW Lead | DP-2 |
| SW-Q-004 | key store OP-TEE/TPM/encrypted FS (D-11) | SW+HW | DP-2 |
| SW-Q-005 | OTA server endpoint (cert pinning, D-7) | DevOps | DP-1 |
| — | Service designs riêng ở DP-2 | SW | DP-2 |

---
**Rev** 1.0 | 2026-05-30
