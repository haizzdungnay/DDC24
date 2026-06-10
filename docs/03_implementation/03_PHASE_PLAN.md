# 03 — Phase Plan
## MK-DDC-24 — Chia phase làm thật

> **Document ID:** IMPL-PHASEPLAN-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Đọc trước:** [02_TEAM_WORK_SPLIT](02_TEAM_WORK_SPLIT.md)
> **Map sang task:** [10_TASK_CHECKLIST](10_TASK_CHECKLIST.md) · **Map sang test:** [11_INTEGRATION_TEST_PLAN](11_INTEGRATION_TEST_PLAN.md)

---

## 0. Bản đồ phase

```
P0 Skeleton ──► P1 MCU bring-up ──► P2 IOP UART ──► P3 iobus ──► P4 core ──► P5 web ──► P6 E2E
   (cả 3)         (Dev1)            (Dev1+Dev2)     (Dev2)       (Dev2)      (Dev3)     (cả 3)
```

Mỗi phase chỉ "đóng" khi **Output** đạt + test group tương ứng trong
[11_INTEGRATION_TEST_PLAN](11_INTEGRATION_TEST_PLAN.md) pass + DoD trong
[12_DEFINITION_OF_DONE](12_DEFINITION_OF_DONE.md) tick đủ.

---

## Phase 0 — Skeleton

**Mục tiêu:** Tạo khung code build được cho cả 4 phần. Chưa cần chạy IO.

**Owner:** cả 3 dev (song song).

**Việc:**
- Dev 1: CubeMX `.ioc` đúng pinout → generate → firmware rỗng blink LED (PD6 1Hz).
- Dev 2: `services/iobus` + `services/core` CMake build ra binary rỗng (main loop + log).
- Dev 3: `web/backend` Go build + `web/frontend` React build ra trang trống.
- Chung: đưa `shared/iop_protocol.h` + `shared/mkddc_shm.h` vào build cả FW lẫn SOM.
- Chung: viết `systemd` unit mẫu cho 3 service.

**Output:**
```
1. fw/ build được firmware rỗng (blink LED, log USART2).
2. services/iobus build được binary rỗng.
3. services/core build được binary rỗng (sd_notify READY=1 stub).
4. web build được backend + frontend rỗng.
5. shared/iop_protocol.h + mkddc_shm.h compile chung cả 2 phía.
6. systemd unit mẫu (mkddc-core.service, mkddc-iobus.service, mkddc-web.service) có sẵn.
```

**Test:** Test group 0 (build/CI). **DoD:** §12.0.

---

## Phase 1 — MCU bring-up

**Mục tiêu:** MCU điều khiển được IO THẬT (chưa cần UART tới SOM).

**Owner:** Dev 1. Dùng debug console USART2 + nút bấm test/ST-Link.

**Việc:** io_sample (ADC+DI), do_control (relay), ao_output (DAC), watchdog, safe-state.
Test bằng lệnh debug console (không cần IOP).

**Output:**
```
1. Đọc DI: contact đổi → biến debounce đổi → log đúng.
2. Đọc UI raw: ADS131M08 trả 8×24-bit, sample_cnt tăng.
3. Bật/tắt DO relay: PC0..PC3 đóng/mở relay thật, đọc feedback.
4. Xuất AO: DAC8554 ra điện áp đo được (0V, 5V, 10V).
5. Watchdog chạy: treo task giả → IWDG reset.
6. Safe-state chạy: trigger flag → AO=0V/4mA, DO=open.
```

**Test:** Test group 1 (MCU standalone). **DoD:** §12.1 (phần IO).

---

## Phase 2 — IOP UART

**Mục tiêu:** SOM và MCU giao tiếp được qua UART/IOP (hợp đồng `iop_protocol.h`).

**Owner:** Dev 1 (MCU slave) + Dev 2 (SOM master). **Cross-test bắt buộc trên board.**

**Việc:** iop_comm (MCU) + iop_frame/iop_client (SOM). Trước tiên dùng PC test harness
(Python/host) rồi tới SOM thật.

**Output:**
```
1. HANDSHAKE pass (version negotiate, STATUS=0x00).
2. GET_IO/IO_RESP pass (34 byte, CRC đúng, SEQ echo).
3. SET_AO pass (ACK, AO thật đổi).
4. SET_DO pass (ACK, relay thật đổi).
5. GET_DIAG/DIAG_RESP pass (20 byte).
6. RESET_IO pass (safe-state + ACK).
7. CRC/SEQ/LEN error handling pass (NACK đúng code).
```

**Test:** Test group 2 (UART IOP) — bao gồm test vector CRC cross-check. **DoD:** §12.2.

---

## Phase 3 — mkddc-iobus

**Mục tiêu:** Đóng gói UART/IOP thành Linux service ổn định.

**Owner:** Dev 2.

**Việc:** main loop SCHED_FIFO, poll 100Hz, parse+scale, ghi `kx_io_shm`, đọc output từ
shm gửi MCU, metrics, log, systemd integration.

**Output:**
```
1. systemd service mkddc-iobus chạy (Restart=always, WatchdogSec).
2. Poll MCU liên tục 100Hz (GET_IO).
3. Cập nhật IO state vào kx_io_shm (seqlock), reader đọc đúng.
4. Gửi output command (đọc do_cmd/ao_setpoint từ shm → SET_DO/SET_AO).
5. Báo lỗi UART/MCU (timeout → iop_status=FAULT, alarm bus).
6. Có log (journalctl) và metrics (iop_rx/crc_err/timeout/seq_err).
```

**Test:** Test group 3 (iobus). **DoD:** §12.3.

---

## Phase 4 — mkddc-core

**Mục tiêu:** Core quyết định output. Mọi DO/AO qua priority resolver.

**Owner:** Dev 2.

**Việc:** point table, scan loop 1s, graph runtime (Rev A subset), priority resolver,
safe-state resolver, iobus_reader (đọc shm), output_writer (ghi shm).

**Output:**
```
1. Point table đủ 24 IO (8UI+8DI+4AO+4DO) + virtual point.
2. Scan loop chạy 1s, clock_nanosleep ABSTIME, không overrun.
3. Priority resolver chạy (6 mức, fire/safety > BMS > schedule > logic > default).
4. Safe-state resolver chạy (IO fault → fallback output).
5. Output command đi qua core (web/BACnet không ghi thẳng shm IO).
6. IO fault → point quality = bad → graph thấy stale.
```

**Test:** Test group 4 (core). **DoD:** §12.4.

---

## Phase 5 — mkddc-web

**Mục tiêu:** User thao tác được qua web (đi đúng đường web→core).

**Owner:** Dev 3.

**Việc:** REST API đầy đủ, login JWT, point list/detail, commissioning test, system status,
config, alarm, graph validate/deploy, audit log.

**Output:**
```
1. Login (JWT, bcrypt).
2. Point list (24 IO, value+unit+quality).
3. Point detail (1 point + history nhẹ).
4. Test point (commissioning bật DO/đặt AO qua core).
5. System status (CPU/RAM/IOP metrics/version).
6. Config (sensor type, network, safe-state).
7. Alarm (list + ack).
8. Graph validate/deploy (validator pass → deploy graph.json).
```

**Test:** Test group 5 (web). **DoD:** §12.5.

---

## Phase 6 — End-to-end integration

**Mục tiêu:** Web điều khiển IO THẬT qua đúng đường chuẩn, recover được lỗi.

**Owner:** cả 3 dev + Tester.

**Output (mỗi dòng = 1 test E2E):**
```
1. Web bật DO1 → relay THẬT bật (đo bằng đèn/đồng hồ).
2. Web tắt DO1 → relay THẬT tắt.
3. DI đổi ngoài hardware → web cập nhật trong ≤ 2s.
4. AO set value → analog output THẬT thay đổi (đo V/mA).
5. Rút UART → web báo lỗi MCU timeout + safe-state.
6. Reset MCU → hệ thống recover (handshake lại, IO trở lại normal).
```

**Test:** Test group 6 (E2E) + group 7 (fault injection) + group 8 (long-run 24h). **DoD:** §12.6.

---

## 4. Cổng chuyển phase (gate)

| Gate | Điều kiện qua | Người duyệt |
|------|---------------|-------------|
| P0→P1 | 4 build CI xanh | Lead |
| P1→P2 | MCU IO thật chạy (group 1 pass) | FW Lead |
| P2→P3 | IOP cross-test pass, CRC vector khớp 2 phía | FW + SW Lead |
| P3→P4 | iobus service ổn định 1h, shm đúng | SW Lead |
| P4→P5 | core priority/safe-state pass, output qua core | SW Lead |
| P5→P6 | web command path qua core, không bypass | SW + Web Lead |
| P6→Release | group 6/7/8 pass, [14_HANDOVER](14_RELEASE_HANDOVER_CHECKLIST.md) tick đủ | PM |

---
**Rev** 1.0 | 2026-06-10
