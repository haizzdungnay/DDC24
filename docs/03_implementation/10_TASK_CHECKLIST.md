# 10 — Task Checklist
## MK-DDC-24 — Toàn bộ implement thành task (Jira/GitHub ready)

> **Document ID:** IMPL-TASKS-MK-DDC-24-VI
> **Phiên bản:** 1.3 | 2026-06-13 (bổ sung S7 #4/#5/#6: COR-009/010, BAC-001..011, MOD-001..011) · 1.2 | 2026-06-12
> **Cách dùng:** mỗi task = 1 issue. Copy block vào Jira/GitHub. Owner: FW=Dev1, SOM=Dev2, WEB=Dev3.

**Mã task:** `SKEL` (P0) · `FW` (firmware) · `IOP` (UART/IOP) · `IOB` (iobus) · `COR` (core) · `WEB` (web) · `E2E` (integration).

---

## Phase 0 — Skeleton

```
Task ID: SKEL-001
Tên: CubeMX .ioc + firmware skeleton (blink LED)
Owner: Dev FW_MCU | Phase: 0 | Module: setup
File: fw/Core/*, fw/.ioc, fw/app/main.c
Input: FW_PINOUT_MASTER §2
Output: firmware build, blink PD6 1Hz, log USART2
Test: nạp ST-Link, đèn nhấp nháy, console in "boot"
Done khi: build sạch + nạp chạy + log ra USART2
Phụ thuộc: —
```
```
Task ID: SKEL-002
Tên: Skeleton mkddc-iobus + mkddc-core build
Owner: Dev SOM | Phase: 0 | Module: setup
File: services/iobus/main.cpp, services/core/main.cpp, CMakeLists.txt
Input: ADR-005, shared/*.h
Output: 2 binary rỗng (main loop+log), sd_notify stub
Test: cmake build + chạy in log
Done khi: build sạch, systemd unit start được
Phụ thuộc: —
```
```
Task ID: SKEL-003
Tên: Skeleton mkddc-web (Go + React)
Owner: Dev Web | Phase: 0 | Module: setup
File: web/backend/main.go, web/frontend/*
Input: ADR-007
Output: HTTP server + trang trống
Test: curl /healthz → 200; React build
Done khi: build sạch, server lên :8080
Phụ thuộc: —
```
```
Task ID: SKEL-004
Tên: shared header + CI build matrix
Owner: Dev SOM (lead) | Phase: 0 | Module: shared
File: shared/iop_protocol.h, shared/mkddc_shm.h (rename ĐÃ làm 2026-06-11), .github/workflows
Input: iop_protocol.h, mkddc_shm.h
Output: header compile chung FW+SOM; CI build 4 phần
Test: CI xanh
Done khi: 4 build job xanh
Phụ thuộc: SKEL-001..003
```
```
Task ID: SKEL-005
Tên: packaging/systemd unit files + install script
Owner: Dev SOM | Phase: 0 (hoàn tất Rev A) | Module: packaging
File: packaging/systemd/mkddc-iobus.service, packaging/systemd/mkddc-core.service,
      packaging/install.sh
Input: 06 §10, 07 §9 (nội dung unit ĐẦY ĐỦ đã chốt trong docs)
Output: 2 unit file THẬT trong repo + script install lên SOM (không chép tay từ docs)
Test: systemd-analyze verify 2 unit; install.sh đưa binary + unit vào đúng chỗ
Done khi: file trong repo khớp 06 §10 / 07 §9 — điều kiện board bring-up 17_WEEK1
Phụ thuộc: SKEL-002
Trạng thái: ĐÃ làm 2026-06-12 — core unit kèm ExecReload (SIGHUP, xem COR-008)
```

---

## Phase 1 — MCU bring-up

```
Task ID: FW-001
Tên: gpio_drv + do_control (relay)
Owner: Dev FW_MCU | Phase: 1 | Module: do_control, gpio_drv
File: fw/app/do_control.c, fw/drivers/gpio_drv.c
Input: lệnh debug console {mask,value}
Output: PC0..PC3 đóng/mở relay; do_fb_mask
Test: console "do 0F 05" → DO1,DO3 đóng; feedback khớp; stuck-detect
Done khi: relay thật đóng/mở đúng + feedback + RELAY_STUCK
Phụ thuộc: SKEL-001
```
```
Task ID: FW-002
Tên: adc_drv + io_sample (UI/DI)
Owner: Dev FW_MCU | Phase: 1 | Module: io_sample, adc_drv
File: fw/app/io_sample.c, fw/drivers/adc_drv.c
Input: ADS131M08 SPI3; DI GPIO
Output: ui_raw[8] s24, di_mask, sample_cnt
Test: điện áp biết trước UI1 → raw đúng <1%; DI1 debounce; ADC_FAULT khi rút SPI
Done khi: 8UI+8DI đọc đúng, budget<200µs
Phụ thuộc: SKEL-001
```
```
Task ID: FW-003
Tên: dac_drv + ao_output
Owner: Dev FW_MCU | Phase: 1 | Module: ao_output, dac_drv
File: fw/app/ao_output.c, fw/drivers/dac_drv.c
Input: 4×u16 raw
Output: DAC8554 ra analog, LDAC sync
Test: raw=32768 → ~5.0V đo đồng hồ; safe-state 0V/4mA
Done khi: AO ra đúng V/mA + safe-state theo mode
Phụ thuộc: SKEL-001
```
```
Task ID: FW-004
Tên: watchdog + safe-state
Owner: Dev FW_MCU | Phase: 1 | Module: watchdog
File: fw/app/watchdog.c, fw/drivers/wdg_drv.c
Input: health flag, IOP timer
Output: IWDG kick, safe-state flag, WDG_RESET cause
Test: treo task → IWDG reset ~1s; mất GET_IO 200ms → safe-state
Done khi: IWDG + 200ms safe-state + reset cause đúng
Phụ thuộc: FW-001..003
```

---

## Phase 2 — IOP UART

```
Task ID: IOP-001
Tên: CRC16 + unit test (cả 2 phía)
Owner: Dev FW_MCU + Dev SOM | Phase: 2 | Module: crc16/iop_crc
File: fw/common/crc16.c, services/iobus/iop_crc.cpp
Input: byte buffer
Output: CRC-16/Modbus
Test: 12 vector chuẩn (SWFW §10.1); {AA 00 01 00}→0x6C20, {AA 00 01 01}→0xACE1
Done khi: 2 phía cùng kết quả 12 vector chuẩn
Phụ thuộc: SKEL-004
```
```
Task ID: IOP-002
Tên: HANDSHAKE + version negotiate
Owner: Dev FW_MCU + Dev SOM | Phase: 2 | Module: iop_comm / iop_client
File: fw/app/iop_comm.c, services/iobus/iop_client.cpp
Input: HANDSHAKE 4B
Output: HANDSHAKE_RESP 6B (STATUS)
Test: SOM gửi v1.1 → MCU STATUS=0x00; version major mismatch → STATUS=0x02 abort
Done khi: handshake pass, version check đúng
Phụ thuộc: IOP-001
```
```
Task ID: IOP-003
Tên: GET_IO/IO_RESP trên MCU + parse trên SOM
Owner: Dev FW_MCU (build) + Dev SOM (parse) | Phase: 2 | Module: iop_comm / iop_parser
File: fw/app/iop_comm.c, fw/common/iop_protocol.h, services/iobus/iop_parser.cpp
Input: GET_IO frame từ SOM
Output: IO_RESP 34B
Test: SOM gửi GET_IO 1000 lần → 0 CRC/SEQ err; latency ≤5ms (scope GPIO toggle)
Done khi: 1000 GET_IO không lỗi; IO_RESP parse được trên SOM
Phụ thuộc: IOP-002, FW-002
```
```
Task ID: IOP-004
Tên: SET_DO + SET_AO + ACK
Owner: Dev FW_MCU + Dev SOM | Phase: 2 | Module: iop_comm / output_command
File: fw/app/iop_comm.c, services/iobus/output_command.cpp
Input: SET_DO 2B / SET_AO 8B
Output: relay/AO thật đổi + ACK
Test: SET_DO mask=01 value=01 → DO1 đóng; SET_AO 32768 → 5V; ACK echo SEQ
Done khi: relay/AO thật đổi qua IOP + ACK đúng
Phụ thuộc: IOP-003, FW-001, FW-003
```
```
Task ID: IOP-005
Tên: GET_DIAG/DIAG_RESP + RESET_IO + SET_AO_CFG
Owner: Dev FW_MCU + Dev SOM | Phase: 2 | Module: iop_comm / diagnostics
File: fw/app/iop_comm.c, fw/app/diagnostics.c
Input: GET_DIAG/RESET_IO/SET_AO_CFG
Output: DIAG_RESP 20B; safe-state+ACK; AO mode đổi
Test: GET_DIAG → 20B; RESET_IO → IO safe + ACK; SET_AO_CFG bit0=1 → AO1 4-20mA
Done khi: 3 lệnh pass
Phụ thuộc: IOP-004
```
```
Task ID: IOP-006
Tên: Error handling (NACK CRC/SEQ/LEN/UNKNOWN)
Owner: Dev FW_MCU + Dev SOM | Phase: 2 | Module: iop_comm / iop_client
File: fw/app/iop_comm.c, services/iobus/iop_client.cpp
Input: frame hỏng
Output: NACK đúng error code; SOM retry/timeout
Test: CRC hỏng→NACK 0x03; CMD lạ→0x01; LEN sai→0x02; timeout→retry≤3→fault
Done khi: mọi negative case trả NACK đúng + SOM xử lý fault
Phụ thuộc: IOP-005
```

---

## Phase 3 — mkddc-iobus

```
Task ID: IOB-001
Tên: iop_port + service skeleton SCHED_FIFO
Owner: Dev SOM | Phase: 3 | Module: iop_port, main
File: services/iobus/iop_port.cpp, main.cpp
Output: mở /dev/ttyS2 921600 8N1, SCHED_FIFO≥70, sd_notify
Test: service start, journalctl log; prio đúng (chrt)
Done khi: systemd chạy Restart=always + WatchdogSec
Phụ thuộc: IOP-006
```
```
Task ID: IOB-002
Tên: Poll loop 100Hz + io_cache (shm writer)
Owner: Dev SOM | Phase: 3 | Module: iop_client, io_cache
File: services/iobus/iop_client.cpp, io_cache.cpp
Output: GET_IO 100Hz → kx_io_shm (seqlock)
Test: reader test đọc shm; DI đổi → di_state đổi; jitter <2ms
Done khi: poll ổn định, reader đọc đúng không nửa-ghi
Phụ thuộc: IOB-001
```
```
Task ID: IOB-003
Tên: Scale raw→engineering
Owner: Dev SOM | Phase: 3 | Module: iop_parser
File: services/iobus/iop_parser.cpp
Input: ui_raw + sensor_type config
Output: ui_value eng + unit
Test: 0-10V, NTC10k (S-H), PT100 (CVD) đúng so điện áp/điện trở biết trước
Done khi: mọi sensor_type scale đúng
Phụ thuộc: IOB-002
```
```
Task ID: IOB-004
Tên: Output bridge (shm → SET_DO/SET_AO)
Owner: Dev SOM | Phase: 3 | Module: output_command
File: services/iobus/output_command.cpp
Input: kx_io_shm.do_cmd/ao_setpoint
Output: SET_DO/SET_AO khi đổi
Test: ghi do_cmd[0]=1 (test tool) → relay đóng; ao_setpoint=5 → AO 5V
Done khi: thay đổi shm → MCU output đổi
Phụ thuộc: IOB-003
```
```
Task ID: IOB-005
Tên: Metrics + alarm bus + fault handling
Owner: Dev SOM | Phase: 3 | Module: iobus_metrics
File: services/iobus/iobus_metrics.cpp
Output: iop_rx/crc_err/timeout/seq_err; alarm.sock JSON
Test: rút UART → iop_status=FAULT + alarm phát; metrics tăng
Done khi: lỗi UART phản ánh ra metrics+alarm, không giả lập IO
Phụ thuộc: IOB-004
```

---

## Phase 4 — mkddc-core

```
Task ID: COR-001
Tên: Scan loop SCHED_FIFO 1s + sd_notify
Owner: Dev SOM | Phase: 4 | Module: scan_loop, main
File: services/core/scan_loop.cpp, main.cpp
Output: clock_nanosleep ABSTIME 1s, READY=1 sau scan đầu
Test: scan_count tăng đều, không drift, không overrun
Done khi: loop ổn định, mlockall, prio 80
Phụ thuộc: IOB-002
```
```
Task ID: COR-002
Tên: Point table + iobus_reader (shm reader)
Owner: Dev SOM | Phase: 4 | Module: point_table, iobus_reader
File: services/core/point_table.cpp, iobus_reader.cpp
Output: 24 IO + virtual, đọc kx_io_shm seqlock
Test: DI/UI đổi ở MCU → point_table đổi; seqlock retry đúng
Done khi: point table phản ánh IO thật
Phụ thuộc: COR-001
```
```
Task ID: COR-003
Tên: Priority resolver (6 mức)
Owner: Dev SOM | Phase: 4 | Module: priority_resolver
File: services/core/priority_resolver.cpp
Output: 1 output/kênh theo priority cao nhất
Test: web(prio3)+safety(prio1) cùng ghi DO1 → safety thắng; conflict log
Done khi: output luôn theo priority; không bypass
Phụ thuộc: COR-002
```
```
Task ID: COR-004
Tên: Safe-state resolver + quality
Owner: Dev SOM | Phase: 4 | Module: safe_state, point_quality
File: services/core/safe_state.cpp, point_quality.cpp
Input: 07 §5 SAFETY SPEC (trigger matrix §5.2 — chỉ làm phần implemented T1/T2/T3)
Output: IO fault → safe output + quality bad
Test: iop_status=FAULT → DO open, AO 0V/4mA, quality bad
Done khi: mọi fault → safe trong ≤1 scan
Phụ thuộc: COR-003
Trạng thái: ĐÃ làm 2026-06-11 (T1/T2/T3 + recovery, test_safe_state pass).
            Trigger graph-based T6/T7 KHÔNG thuộc task này → COR-006 (Rev A.1).
```
```
Task ID: COR-005
Tên: output_writer + web_ipc + BACnet objtable
Owner: Dev SOM | Phase: 4 | Module: output_writer, web_ipc, bacnet_objtable
File: services/core/output_writer.cpp, web_ipc.cpp, bacnet_objtable.cpp
Output: ghi ao_setpoint/do_cmd shm; nhận command web; ghi kx_plc_shm
Test: web command → core → shm → iobus → relay; audit result trả về web
Done khi: web→core→shm path hoạt động, không ghi thẳng IO
Phụ thuộc: COR-004
```
```
Task ID: COR-006
Tên: graph_runtime + safety trigger T6/T7 (Rev A.1)
Owner: Dev SOM | Phase: 4 (Rev A.1) | Module: graph_runtime, safe_state
File: services/core/graph_runtime.cpp, safe_state.cpp
Input: 07 §5.2 trigger matrix (T6: ui_quality=BAD trên kênh graph đang dùng;
       T7: chưa có graph hợp lệ VÀ không có lệnh manual/BMS active), GRAPH_SCHEMA
Output: graph_runtime hết stub; safe_state thêm trigger T6/T7
Test: test_safe_state.cpp thêm case T6/T7; graph đọc point BAD → fallback
Done khi: T6/T7 chuyển ✅ trong 07 §5.2 + test pass; cập nhật trigger matrix
Phụ thuộc: COR-005
Trạng thái: ĐÃ làm 2026-06-12 — graph_runtime implemented (Rev A subset: 13 component,
       load/validate/topo/execute → resolver mức 5); T6/T7 ✅ trong 07 §5.2;
       test: test_graph_runtime.cpp + test_safe_state.cpp (T6GraphInputBadForcesSafe,
       T7NoGraphNoManualForcesSafe); E2E 3 lớp: tools/test_safety_e2e.sh
```
```
Task ID: COR-007
Tên: web_ipc production — overridden + audit log (07 §8 đủ contract)
Owner: Dev SOM | Phase: 4 (Rev A.1) | Module: web_ipc, priority_resolver, scan_loop
File: services/core/web_ipc.cpp, priority_resolver.cpp, scan_loop.cpp
Input: 07 §8 (3 result: accepted/rejected/overridden), SEC-REQ audit (IEC 62443)
Output: respond DỜI sau resolve+safe-state (scan step 7) — write bị nguồn cao hơn /
        safe-state đè → {"result":"overridden","applied_value":..,"active_source":..};
        mỗi lệnh 1 dòng AUDIT chuẩn {id,user,point,op,value,result,active_source}
Test: test_web_ipc.cpp case overridden (safety đè manual, safe-state active), audit line
Done khi: web phân biệt accepted vs overridden; user không còn bị vứt — có trong log
Phụ thuộc: COR-005
Trạng thái: ĐÃ làm 2026-06-12 — priority_resolver expose winning_ao/do_level(),
       respond chuyển từ step 4 → sau step 7 (vẫn trong cùng 1 scan, ≤2 chu kỳ theo 07 §8)
```
```
Task ID: COR-008
Tên: SIGHUP reload config không restart (CONFIG_SCHEMA D-5)
Owner: Dev SOM | Phase: 4 (Rev A.1) | Module: config_reload, scan_loop, graph_runtime, main
File: services/core/config_reload.cpp, scan_loop.cpp, graph_runtime.cpp, main.cpp
Input: CONFIG_SCHEMA §0 (io_safe_state.conf → SIGHUP core), GRAPH_SCHEMA §7 (deploy atomic)
Output: SIGHUP → reload io_config + io_safe_state + graph Ở RANH GIỚI scan (không nuốt
        config giữa lúc resolve); fail bất kỳ phần nào → GIỮ config cũ (khác boot fail-fast);
        manual/priority đang active giữ nguyên; graph không đổi nội dung → giữ state PID
Test: test_config_reload.cpp (bad config giữ cũ, graph swap atomic, unchanged → no reset)
Done khi: sửa io_safe_state.conf + kill -HUP → default mức 6 đổi, không restart, manual giữ
Phụ thuộc: COR-006
Trạng thái: ĐÃ làm 2026-06-12 — GraphRuntime::reload() swap-on-success (load_string cũ
       clear member ngay đầu hàm, fail là mất graph cũ — không dùng trực tiếp cho reload)
```
```
Task ID: COR-009
Tên: Graph runtime multi-output + 10 component stateful/utility còn thiếu
Owner: Dev SOM | Phase: 4 (S7 #4) | Module: graph_runtime
File: services/core/graph_runtime.cpp, graph_runtime.hpp, tests/test_graph_runtime.cpp
Input: 22_GRAPH_STATEFUL_COMPONENTS_PLAN §2-§3, SW_COMPONENT_LIBRARY
Output: engine hỗ trợ named output port; thêm ManualAuto, OnDelay, OffDelay, Interlock,
        RuntimeCounter, PulseCounter, SafeState, AlarmHigh, AlarmLow, AlarmDelay
Test: unit từng component; RuntimeCounter hours/alarm; Interlock truth table; timer dt giả lập;
      PulseCounter mode channel dùng di_counter delta; invalid graph reject rõ lỗi
Done khi: 10 component pass test, multi-output không phá 13 component cũ
Phụ thuộc: COR-006, COR-008
Trạng thái: ĐÃ làm 2026-06-13 — 10 component + multi-output engine; 97/97 test pass
```
```
Task ID: COR-010
Tên: Persist state snapshot cho RuntimeCounter/PulseCounter
Owner: Dev SOM | Phase: 4 (S7 #4) | Module: state_snapshot, graph_runtime, packaging
File: services/core/state_snapshot.cpp, state_snapshot.hpp, graph_runtime.cpp,
      packaging/systemd/mkddc-core.service, packaging/install.sh
Input: 22_GRAPH_STATEFUL_COMPONENTS_PLAN §4, SW_RUNTIME_EXECUTION_MODEL §6 Rev 1.1
Output: `/data/mkddc/state.snap` JSON version=1; ghi 60s khi dirty + shutdown + trước graph swap;
        restore theo node id+type; StateDirectory/install tạo thư mục
Test: restore counter sau restart; bad snapshot bỏ qua + WARN; graph deploy giữ counter cùng id+type;
      PID/timer/interlock không persist
Done khi: power-loss/reload/deploy semantics đúng §22, không ghi flash mỗi scan
Phụ thuộc: COR-009
Trạng thái: ĐÃ làm 2026-06-13 — state_snapshot module; boot/shutdown/reload/60s persist; 97/97 test pass
```

---

## Phase 4/5 — BACnet/IP (S7 #5)

> Chi tiết triển khai: [24_BACNET_IMPLEMENTATION_PLAN](24_BACNET_IMPLEMENTATION_PLAN.md).

| Task ID | Tên | Owner | Output | Test |
|---------|-----|-------|--------|------|
| BAC-001 | Link `bacnet-stack` + CMake option | Dev SOM | `MKDDC_ENABLE_BACNET` build sạch | build smoke |
| BAC-002 | Loader `device.conf` + `bacnet.conf` | Dev SOM | device id/name/port/interface | bad config reject |
| BAC-003 | Object registry AI/BI/AO/BO/AV/BV/MSV | Dev SOM | count/name/instance đúng D-3 | object map unit |
| BAC-004 | `bacnet_objtable` publish từ core | Dev SOM | value/quality/reliability vào `mkddc_plc_shm` | shm unit |
| BAC-005 | ReadProperty/ReadPropertyMultiple | Dev SOM | BMS đọc object | `bacrp`/BTL smoke |
| BAC-006 | WriteProperty + Priority_Array[16] | Dev SOM | BACnet write -> core mức 3 | priority/core IPC fake |
| BAC-007 | COV subscribe/change detect | Dev SOM | notify theo threshold | COV unit |
| BAC-008 | Reliability/Status_Flags map | Dev SOM | fault -> BACnet flags | table unit |
| BAC-009 | Alarm/Notification Class bridge | Dev SOM | alarm bus -> event | fake alarm smoke |
| BAC-010 | TimeSync/ReinitializeDevice policy | Dev SOM | guarded restart/time sync | integration smoke |
| BAC-011 | BTL pretest script/checklist | Tester + Dev SOM | repeatable B-ASC pretest | group 9 PASS |

Done khi: DoD §8 pass; BACnet write không bypass core; safety/manual cao hơn vẫn thắng.

---

## Phase 3/4 — Modbus RTU Master (S7 #6)

> Chi tiết triển khai: [25_MODBUS_IMPLEMENTATION_PLAN](25_MODBUS_IMPLEMENTATION_PLAN.md).

| Task ID | Tên | Owner | Output | Test |
|---------|-----|-------|--------|------|
| MOD-001 | Link `libmodbus` + CMake option | Dev SOM | `MKDDC_ENABLE_MODBUS` build sạch | build smoke |
| MOD-002 | `fieldbus.conf` loader/reload | Dev SOM | rs485/slaves/poll config | config unit |
| MOD-003 | Device profile parser/validator | Dev SOM | profile JSON strict | parser unit |
| MOD-004 | Register codec | Dev SOM | bool/int/float scale/endian | codec vectors |
| MOD-005 | Poll scheduler | Dev SOM | due-time/retry/offline | scheduler unit |
| MOD-006 | RTU read FC01/02/03/04 | Dev SOM | ext cache update | fake slave integration |
| MOD-007 | RTU write FC05/06/15/16 | Dev SOM | pending write result | fake slave write |
| MOD-008 | Metrics/alarm E302/E303 | Dev SOM | status + alarm | fault injection |
| MOD-009 | Core ext point read path | Dev SOM | graph đọc ext values | core integration |
| MOD-010 | BACnet expose config for ext points | Dev SOM | ext -> AV/BV/AI optional | object map test |
| MOD-011 | 16-slave timing smoke | Tester + Dev SOM | stable poll budget | group 10 PASS |

Done khi: DoD §9 pass; Modbus không làm slave northbound; không có output bypass core.

---

## Phase 5 — mkddc-web

```
Task ID: WEB-001
Tên: Login JWT + RBAC
Owner: Dev Web | Phase: 5 | Module: auth
File: web/backend/auth.go, web/frontend/Login
Test: login đúng → JWT; sai → 401; role enforce
Done khi: login + token + RBAC chạy
Phụ thuộc: SKEL-003
```
```
Task ID: WEB-002
Tên: Point list + detail (đọc qua core)
Owner: Dev Web | Phase: 5 | Module: points, core_client
File: web/backend/points.go, core_client.go, web/frontend/PointList
Test: GET /points → 24 IO {value,quality,unit}
Done khi: UI hiển thị 24 IO đúng
Phụ thuộc: WEB-001, COR-005
```
```
Task ID: WEB-003
Tên: Commissioning test point (DO/AO)
Owner: Dev Web | Phase: 5 | Module: commissioning
File: web/backend/commissioning.go
Test: POST test DO1 → relay thật bật (qua core prio2); test AO1=5V
Done khi: test point bật IO thật qua core + audit log
Phụ thuộc: WEB-002
```
```
Task ID: WEB-004
Tên: System status + Alarms + Config
Owner: Dev Web | Phase: 5 | Module: system, alarms, config
File: web/backend/system.go, alarms.go, web/frontend/*
Test: status có IOP metrics; alarm list+ack; config sensor type lưu+reload
Done khi: 3 trang chạy, lỗi hiển thị tiếng Việt
Phụ thuộc: WEB-002
```
```
Task ID: WEB-005
Tên: Validator + Graph deploy
Owner: Dev Web | Phase: 5 | Module: validator, graph
File: web/validator/*, web/backend/graph.go
Test: graph thiếu limit AO → validate FAIL → deploy chặn; pass → deploy graph.json
Done khi: 4 check Rev A chạy; deploy chỉ khi pass
Phụ thuộc: WEB-004
```

---

## Phase 6 — End-to-end

```
Task ID: E2E-001
Tên: Web → DO relay thật (đường đầy đủ)
Owner: cả 3 + Tester | Phase: 6 | Module: all
Test: web bật/tắt DO1 → relay thật bật/tắt; feedback về web; audit log
Done khi: TC-E2E-01/02 (xem 11) pass
Phụ thuộc: WEB-005, COR-005, IOB-005, IOP-006
```
```
Task ID: E2E-002
Tên: DI/UI thật → web; Web → AO thật
Owner: cả 3 + Tester | Phase: 6 | Module: all
Test: DI đổi ngoài → web ≤2s; AO set → đo V/mA đúng
Done khi: TC-E2E-03/04 pass
Phụ thuộc: E2E-001
```
```
Task ID: E2E-003
Tên: Fault injection + recover (kiểm đủ 3 lớp safety — 07 §5.1)
Owner: cả 3 + Tester | Phase: 6 | Module: all
Test: rút UART → web báo lỗi + safe-state; cắm lại/reset MCU → recover.
      Kiểm 3 lớp trong CÙNG kịch bản: MCU tự safe ≤200ms (đo relay/AO),
      iobus iop_status=FAULT/SAFE ≤100ms+retry, core ghi đè output ≤1 scan.
Done khi: TC-E2E-05/06 + group 7 pass; 3 lớp safety đều được quan sát/ghi nhận
Phụ thuộc: E2E-002
```
```
Task ID: E2E-004
Tên: Long-run 24h + handover prep
Owner: Tester + PM | Phase: 6 | Module: all
Test: 24h không treo, không leak, scan không overrun
Done khi: group 8 pass + 14_HANDOVER tick đủ
Phụ thuộc: E2E-003
```

---
**Rev** 1.4 | 2026-06-13 (COR-009/010 ĐÃ làm: 10 component + state_snapshot, 97/97 test pass) · 1.3 | 2026-06-13 (bổ sung task S7 #4/#5/#6) ·
1.2 | 2026-06-12 (thêm SKEL-005 packaging/systemd, COR-007 web_ipc overridden+audit,
COR-008 SIGHUP reload — cụm production-hardening 1+5+6 ĐÃ làm) · 1.1 | 2026-06-12 (COR-004 chốt trạng thái theo SAFETY SPEC 07 §5; thêm COR-006
Rev A.1 cho trigger T6/T7; E2E-003 kiểm đủ 3 lớp safety) · 1.0 | 2026-06-10 ·
Test chi tiết: [11_INTEGRATION_TEST_PLAN](11_INTEGRATION_TEST_PLAN.md)
