# 03 — Phase Plan
## MK-DDC-24 — Chia phase làm thật

> **Document ID:** IMPL-PHASEPLAN-MK-DDC-24-VI
> **Phiên bản:** 1.9 | 2026-07-15 (P4/P5/P6 historian + unique display-name workstream planned) · 1.8 | 2026-06-27 (P5.5 HMI added) · 1.5 | 2026-06-13 (bổ sung S7 #4/#5/#6: stateful graph Active, BACnet/Modbus implementation plan) · 1.4 | 2026-06-12 (P4: web_ipc overridden+audit, SIGHUP reload, systemd units — COR-007/008, SKEL-005)
> **Trạng thái:** Active
> **Đọc trước:** [02_TEAM_WORK_SPLIT](02_TEAM_WORK_SPLIT.md)
> **Map sang task:** [11_TASK_CHECKLIST](11_TASK_CHECKLIST.md) · **Map sang test:** [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md)

---

## 0. Bản đồ phase

```
P0 Skeleton ──► P1 MCU bring-up ──► P2 IOP UART ──► P3 iobus ──► P4 core ──► P5 web ──► P6 E2E
   (cả 3)         (Dev1)            (Dev1+Dev2)     (Dev2)       (Dev2)      (Dev3)     (cả 3)
```

Mỗi phase chỉ "đóng" khi **Output** đạt + test group tương ứng trong
[12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md) pass + DoD trong
[13_DEFINITION_OF_DONE](13_DEFINITION_OF_DONE.md) tick đủ.

---

## Phase 0 — Skeleton

**Mục tiêu:** Tạo khung code build được cho cả 4 phần. Chưa cần chạy IO.

**Owner:** cả 3 dev (song song).

**Việc:**
- Dev 1: CubeMX `.ioc` đúng pinout → generate → firmware rỗng blink LED (PD6 1Hz).
- Dev 2: `services/iobus` + `services/core` CMake build ra binary rỗng (main loop + log) —
  CMakeLists mẫu copy nguyên văn từ [06 §10](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) / [07 §9](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md).
- Dev 3: `web/backend` Go build + `web/frontend` React build ra trang trống.
- Chung: đưa `shared/iop_protocol.h` + `shared/mkddc_shm.h` vào build cả FW lẫn SOM
  (rename `kinexus_shm.h → mkddc_shm.h` ĐÃ làm 2026-06-11 — chỉ include, không copy).
- Chung: lấy `systemd` unit ĐẦY ĐỦ từ 06 §10 + 07 §9 (không tự viết stub khác).
- Trước khi code: cả 3 dev đọc [16_CONTRACT_FREEZE](16_CONTRACT_FREEZE.md) (10 phút).

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

**Việc:** iop_comm (MCU) + iop_frame/iop_client (SOM). Phía SOM làm trước với
`tools/fake_mcu` qua PTY ([06 §11.1](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) — checklist 10 bước,
hoàn thành được phần lớn phase này KHÔNG cần board), rồi cross-test trên board thật.

**Output (mỗi dòng đo được, pass/fail rõ):**
```
1. HANDSHAKE pass (version negotiate, STATUS=0x00).
2. GET_IO/IO_RESP v2 pass (74-byte payload, CRC đúng, SEQ echo; 1000 poll liên tục 0 lỗi).
3. SET_AO pass (ACK, AO thật đổi — đo đồng hồ).
4. SET_DO pass (ACK, relay thật đổi — DO_FB khớp).
5. GET_DIAG/DIAG_RESP pass (20 byte).
6. RESET_IO pass (mọi reason 0x00-0x05: safe-state + ACK; xem 05 §6.9).
7. CRC/SEQ/LEN error handling pass (NACK đúng code; negative table 05 §15 đủ 10 case).
```

**Test:** Test group 2 (UART IOP) — CRC cross-check bằng **12 vector chuẩn** (SWFW §10.1;
vector cũ 0x84C0/0x556B là sai, đã thay 2026-06-11). **DoD:** §12.2.

---

## Phase 3 — mkddc-iobus

**Mục tiêu:** Đóng gói UART/IOP thành Linux service ổn định.

**Owner:** Dev 2.

**Việc:** main loop SCHED_FIFO, poll 2ms/500Hz, parse+scale, ghi `kx_io_shm`, đọc output từ
shm gửi MCU, metrics, log, systemd integration.

**Output:**
```
1. systemd service mkddc-iobus chạy (Restart=always, WatchdogSec).
2. Poll MCU liên tục 2ms/500Hz (GET_IO).
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

**Việc:** point table, scan loop 1s, graph runtime (Rev A subset — ĐÃ implement 2026-06-12), priority resolver,
safe-state resolver, iobus_reader (đọc shm), output_writer (ghi shm), stateful graph Rev A.1,
BACnet object/priority bridge, Modbus ext cache integration.

**Output:**
```
1. Point table đủ 24 IO base SKU (16 UI + 4 AO + 4 DO) + virtual point; optional DI capability-gated.
2. Scan loop chạy 1s, clock_nanosleep ABSTIME, không overrun.
3. Priority resolver chạy (6 mức, fire/safety > BMS > schedule > logic > default).
4. Safe-state resolver chạy (IO fault/stale → fallback output — SAFETY SPEC 07 §5;
   trigger graph-based T6/T7 ĐÃ implement — trigger matrix 07 §5.2).
5. Output command đi qua core (web/BACnet không ghi thẳng shm IO).
6. IO fault → point quality = bad → graph thấy stale.
7. web_ipc đủ contract 07 §8: accepted/rejected/OVERRIDDEN + audit log mỗi lệnh
   (ĐÃ implement 2026-06-12 — COR-007, respond sau resolve+safe-state).
8. SIGHUP reload io_config/io_safe_state/graph ở ranh giới scan, fail giữ config cũ,
   manual đang giữ không mất (ĐÃ implement 2026-06-12 — COR-008, CONFIG_SCHEMA D-5).
9. packaging/systemd unit files thật trong repo + install script
   (ĐÃ tạo 2026-06-12 — SKEL-005, điều kiện board bring-up 17_WEEK1).
10. Stateful graph components còn thiếu + persist counter: COR-009/COR-010 theo
    [23_GRAPH_STATEFUL_COMPONENTS_PLAN](23_GRAPH_STATEFUL_COMPONENTS_PLAN.md) — Active 2026-06-13.
11. BACnet/IP full path: object registry, Read/WriteProperty, Priority_Array[16] → core.sock
    source=bacnet mức 3 (BAC-CONFLICT-001 CLOSED 2026-06-17 — 07 §8 Rev 1.6), Reliability/
    Status_Flags, COV/alarm/pretest theo [25_BACNET_IMPLEMENTATION_PLAN](25_BACNET_IMPLEMENTATION_PLAN.md).
    **ĐÃ implement 2026-06-17 — BAC-001..011 DONE (114 test pass).**
12. Modbus RTU master: `fieldbus.conf` (incl. `rs485.device`), device profile, poll scheduler,
    ext cache (kx_ext_snapshot_msg_t vào mkddc_shm.h), write queue, E302/E303 alarm theo
    [26_MODBUS_IMPLEMENTATION_PLAN](26_MODBUS_IMPLEMENTATION_PLAN.md).
    **ĐÃ implement 2026-06-17 — MOD-001..011 DONE (114 test pass).**
13. `COR-HIST-001`: read-only coherent historian snapshot từ cùng scan, sau resolve + safe-state;
    UI-01..16/AO-01..04/DO-01..04 với quality/source/role/generation. Core không ghi DB.
    **PLANNED 2026-07-15 — contract owner-approved, code chưa Done.**
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
9. Per-point historian policy UI/AO/DO/VP: 11 interval, start ngay/server time hoặc UTC tương lai,
   state off/scheduled/recording, persist qua restart; VP diagnostic log tách riêng.
10. SQLite historian: 48h hot cache + >=180d archive, backend merge RAM/hot/archive,
    unified UTC query/CSV, quality/source/gap, không browser merge.
11. Hai namespace độc lập unique `tag` và display `name/label`; legacy blank name→canonical ID,
    duplicate content giữ runtime/read nhưng chặn mutation ngoài conflict-reducing rename.
```

Trạng thái P5 amendment: PLANNED 2026-07-15 — WEB-HIST-001..005 + WEB-NAME-001; contract/docs approved, product code chưa Done.

**Test:** Test group 5 (web). **DoD:** §12.5.

---

## Phase 5.5 — mkddc-hmi

**Mục tiêu:** Màn hình tại chỗ (local HMI) hiển thị trạng thái DDC, cho phép kỹ sư vận hành không cần laptop.

**Owner:** Dev SOM (C++ / LVGL).

**Spec:** [SW_HMI_DESIGN Rev 2.2](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md) · [UC Rev 2.1](../04_uiux/KX-DDC24-UC-HMI-001_VI.md) · [UX Rev 2.0](../04_uiux/KX-DDC24-UX-HMI-001_VI.md).
**Guide:** [08_MKDDC_HMI_IMPLEMENTATION_GUIDE](08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md).

**Hardware:** KD024QVFIA073-02-C021B (JD9852 MIPI DSI 240×320) · FT5436 CTP I2C 0x38 · 6 GPIO buttons.

**Output:**
```
1. Build LVGL v9 + DRM/KMS /dev/dri/card0 (HMI-001).
2. Input: FT5436 evdev touch + 6 GPIO buttons (HMI-002).
3. Tab strip + 6-page ring navigation (HMI-003).
4. Screen 1 — Home / Controller Health (HMI-004).
5. Screen 2 — I/O Monitor + AGE column + BAD/STALE filter (HMI-005).
6. Screen 3 — Alarm / Event (4-state model + ACK) (HMI-006).
7. Screen 4 — Communication (BACnet/Modbus status, Last req: Xs ago) (HMI-007).
8. Screen 5 — System / Diagnostics read-only (HMI-008).
9. Screen 6 — Service / Config (PIN lock, Reload, Reboot 3s hold) (HMI-009).
10. SHM data binding 1s (kx_io_shm + kx_plc_shm) + AGE (HMI-010).
11. Localization EN/VI + SIGHUP reload locale (HMI-011).
12. systemd mkddc-hmi.service + packaging (HMI-012).
```

**Test:** UC-LOCAL-001..014 theo [KX-DDC24-UC-HMI-001 Rev 2.1](../04_uiux/KX-DDC24-UC-HMI-001_VI.md). **DoD:** HMI-001..012 tick đủ + 6 màn render + touch/button pass.

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
5. Rút UART → web báo lỗi MCU timeout + safe-state (kiểm đủ 3 lớp: MCU 200ms /
   iobus 100ms / core ≤1 scan — 07 §5.1; no-board đo bằng `tools/test_safety_e2e.sh`).
6. Reset MCU → hệ thống recover (handshake lại, IO trở lại normal).
7. E2E-HIST-001: UI/AO/DO/VP logging immediate/future/restart/clock/disk; Trends qua ranh 48h;
   rename/delete/recreate generation; duplicate-name migration/recovery; target eMMC benchmark.
```

Trạng thái P6 historian gate: PLANNED 2026-07-15 — không claim release trước benchmark/race/a11y/E2E evidence.

**Test:** Test group 6 (E2E) + group 7 (fault injection) + group 8 (long-run 24h). **DoD:** §12.6.

---

## 4. Cổng chuyển phase (gate)

| Gate | Điều kiện qua | Người duyệt |
|------|---------------|-------------|
| P0→P1 | 4 build CI xanh | Lead |
| P1→P2 | MCU IO thật chạy (group 1 pass) | FW Lead |
| P2→P3 | IOP cross-test pass, 12 CRC vector khớp 2 phía | FW + SW Lead |
| P3→P4 | iobus service ổn định 1h, shm đúng | SW Lead |
| P4→P5 | core priority/safe-state pass, output qua core; nếu historian scope active thì COR-HIST-001 coherent snapshot pass; nếu scope Rev A production bật BACnet/Modbus thì BAC-001..011 + MOD-001..011 pass group 9/10 | SW Lead |
| P5→P5.5 | web command path qua core, không bypass; historian scope phải qua WEB-HIST-001..005 + WEB-NAME-001 contract/unit/build gates | SW + Web Lead |
| P5.5→P6 | HMI-001..012 done, 6 screens render trên board, touch + button input pass | SW Lead |
| P6→Release | group 6/7/8 + E2E-HIST-001/target eMMC benchmark pass, [14_HANDOVER](15_RELEASE_HANDOVER_CHECKLIST.md) tick đủ | PM |

> 📍 Tuần đầu trên SOM: làm theo 8 mốc [18_WEEK1_SOM_BRINGUP_CHECKLIST](18_WEEK1_SOM_BRINGUP_CHECKLIST.md)
> (map P0→P4 round-trip). Dev mới: bắt đầu từ [17_QUICK_START_SOM_DEV](17_QUICK_START_SOM_DEV.md).

---
**Rev** 1.9 | 2026-07-15 — Added owner-approved P4/P5/P6 historian and unique display-name workstream: COR-HIST-001, WEB-HIST-001..005, WEB-NAME-001, E2E-HIST-001; all remain PLANNED. · **Rev** 1.8 | 2026-06-27 (Phase 5.5 mkddc-hmi added — HMI kéo vào Rev A per REVA_SCOPE amendment 2026-06-27; gate P5.5→P6 added) · 1.7 | 2026-06-17 (P4 output 11/12 DONE: BAC-001..011 + MOD-001..011 implemented, 114 test pass, bypass check sạch) ·
1.6 | 2026-06-17 (P4 output 11/12: BAC+MOD doc gap CLOSED — BAC-CONFLICT-001, bind_interface, kx_ext_snapshot, rs485.device; sẵn sàng implement) ·
1.5 | 2026-06-13 (S7 #4/#5/#6 docs code-ready: 22 Active, 24 BACnet, 25 Modbus) ·
1.4 | 2026-06-12 (P4: web_ipc overridden+audit COR-007, SIGHUP reload COR-008, systemd units SKEL-005) · 1.3 | 2026-06-12 (graph_runtime + T6/T7 implemented; E2E script) · 1.2 | 2026-06-12 (P4/P6: tham chiếu SAFETY SPEC 07 §5 — trigger matrix
implemented/planned, kiểm 3 lớp safety ở E2E) · 1.1 | 2026-06-11
