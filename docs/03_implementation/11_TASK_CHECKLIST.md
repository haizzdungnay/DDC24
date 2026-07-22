# 11 — Task Checklist
## MK-DDC-24 — Toàn bộ implement thành task (Jira/GitHub ready)

> **Document ID:** IMPL-TASKS-MK-DDC-24-VI
> **Phiên bản:** 1.24 | 2026-07-22 (ADR-016: historical six-screen HMI block superseded by HOP-000..077) · 1.23 | 2026-07-01 · 1.22 | 2026-07-01
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
Output: ui_raw[16] int32 signed, adc1/adc2 status, fault flags, sample_cnt, do_fb; no base-SKU DI_MASK
Test: điện áp biết trước UI1 → raw đúng <1%; DI1 debounce; ADC_FAULT khi rút SPI
Done khi: 16 UI từ 2× ADS131M08 đọc đúng; base SKU không DI; budget và ADC1/ADC2 fault đúng theo ADR-010
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
Output: IO_RESP v2 payload 74 byte
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
Tên: Poll loop 2ms/500Hz + io_cache (shm writer)
Owner: Dev SOM | Phase: 3 | Module: iop_client, io_cache
File: services/iobus/iop_client.cpp, io_cache.cpp
Output: GET_IO 2ms/500Hz → kx_io_shm (seqlock)
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

```
Task ID: IOB-006
Tên: CI cleanup /dev/shm/mkddc_io_shm trước ctest — fix 2 test SKIP
Owner: Dev SOM | Phase: 3 | Module: CI workflow
Input: 2 test IoCache SKIP do SHM còn từ run trước
Output: CI cleanup mkddc_io_shm + mkddc_plc_shm trước ctest; 226/226 inventory hiện tại PASS
Test: CI xanh, không còn SKIP
Done khi: CI green 226/226; IoCache.CleanBootInitsDefaults + ReattachPreservesCoreOwnedFields PASS
Phụ thuộc: IOB-002
Chi tiết: 31_PROTOCOL_LIB_INTEGRATION_PLAN.md §5
Trạng thái: ĐÃ implement 2026-06-22 — workflow cleanup; local 226/226 PASS, 2 IoCache PASS; chờ remote CI green.
```

```
Task ID: IOB-006-V2
Tên: IOP v2.0 protocol upgrade (ADR-010) — breaking change từ v1.1
Owner: Dev SOM | Phase: 3 | Module: iobus/iop, shared headers, tools
File: shared/iop_protocol.h, shared/mkddc_shm.h, services/iobus/iop/iop_parser.cpp,
      services/iobus/iop/iop_client.cpp, services/iobus/io/io_types.hpp,
      services/iobus/io/io_scaling.cpp, services/iobus/config/iobus_config.hpp,
      tools/fake_mcu/fake_mcu.cpp, tools/shm_dump_io/shm_dump_io.c
Input: ADR-010 (Accepted 2026-06-25) — Rev A HW: 16 UI analog, uint24→int32 signed, no DI base SKU
Output: IOP_VER 2.0; IO_RESP 74B (16×int32); HANDSHAKE_RESP 8B + BOARD_CAP_MAP;
        KX_N_UI=16; FAULT_FLAGS restructured; poll 500Hz; fake_mcu emit v2 frames
Test: test_iop_parser (74B layout), test_io_scaling (int32 input), test_iop_client_fake_mcu (full round-trip)
Done khi: all tests pass; fake_mcu HANDSHAKE_RESP = 8B with IOP_BOARD_CAP_REV_A; IoSnapshot 16-channel
Phụ thuộc: IOB-006
Trạng thái: ĐÃ làm 2026-06-25 — IOP v2 protocol implemented; ADR-010 Accepted; 05_IOP_UART_IMPLEMENTATION_GUIDE Rev 2.0 updated.
```

```
Task ID: IOB-007
Tên: UI raw live data SHM v3
Owner: Dev SOM + Dev Web | Phase: 3/5 | Module: iobus/io_cache, web core_client, FE Inputs Summary
File: shared/mkddc_shm.h, services/iobus/io/*, web/backend/core_client.go, src/frontend/src/pages/InputsPage.tsx
Input: ADR-011 — raw electrical value must come from iobus raw ADC path, not FE reconstruction
Output: `kx_io_shm.ui_raw[16]` + `ui_raw_unit[16][8]`; REST/WS points expose `raw`/`rawUnit`; FE shows Raw V/mA and dry-contact ON/OFF
Test: test_io_scaling raw cases; go test ./...; npm run build; smoke `/eng/inputs` Summary
Done khi: analog UI shows engineering Value + Raw V/mA; dry-contact hides raw and numeric min/max/avg
Phụ thuộc: IOB-006-V2, WEB-003
Trạng thái: ĐÃ làm 2026-06-30 — ADR-011 + SHM v3 contract, iobus raw writer, web `raw`/`rawUnit`, FE Raw card + dry-contact boolean handling. 2026-07-01: reconciled into SHM v4 with `ui_reliability[]`; raw fields remain in contract. Verification: `go build ./...`, `go test ./...`, `npm run build` pass; C++ CMake tests blocked locally because `cmake`/`g++`/`cl` unavailable.
```

```
Task ID: IOB-008
Tên: Reconcile UI raw/engineering scaling theo HW Rev A
Owner: Dev SOM | Phase: 3 | Module: iobus/io_scaling
File: services/iobus/io/io_scaling.cpp, services/iobus/io/io_scaling.hpp,
      services/iobus/io/io_types.hpp, services/iobus/config/iobus_config.cpp,
      services/iobus/tests/test_io_scaling.cpp, services/iobus/tests/test_iobus_config.cpp
Input: IO_UI_CIRCUIT §5.1/§5.2, BOM-UI-16CH 49.9R shunt, ADS131M08 VREF=2.44V
Output: UI voltage/current scaling uses physical ADC transfer; per-channel cal_gain/cal_offset hook exists; no SHM/IOP/AO contract change
Test: test_io_scaling: 10V, 2-10V under-range, 4/20mA, loop fault thresholds, cal identity/offset; ctest iobus PASS
Done khi: raw V/mA and engineering match Rev A hardware formulas and default calibration remains identity
Phụ thuộc: IOB-007
Trạng thái: ĐÃ làm 2026-06-30 — HW scaling reconcile + cal hook; Orange Pi build pass, full ctest 148/148 with 2 IoCache skips due live SHM, `ctest -R IoScaling` 19/19 pass.
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
Input: 23_GRAPH_STATEFUL_COMPONENTS_PLAN §2-§3, SW_COMPONENT_LIBRARY
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
Input: 23_GRAPH_STATEFUL_COMPONENTS_PLAN §4, SW_RUNTIME_EXECUTION_MODEL §6 Rev 1.1
Output: `/data/mkddc/state.snap` JSON version=1; ghi 60s khi dirty + shutdown + trước graph swap;
        restore theo node id+type; StateDirectory/install tạo thư mục
Test: restore counter sau restart; bad snapshot bỏ qua + WARN; graph deploy giữ counter cùng id+type;
      PID/timer/interlock không persist
Done khi: power-loss/reload/deploy semantics đúng §22, không ghi flash mỗi scan
Phụ thuộc: COR-009
Trạng thái: ĐÃ làm 2026-06-13 — state_snapshot module; boot/shutdown/reload/60s persist; 97/97 test pass
```

```
Task ID: COR-011
Tên: Protocol 5 graph nodes — implement trong graph_runtime (Modbus_RTU_Read/Write, Modbus_TCP_Read, BACnet_AV/BV)
Owner: Dev SOM | Phase: 4 (Rev A feature-complete) | Module: graph_runtime, scan_loop, ext_cache_reader
File: services/core/graph_runtime.cpp, graph_runtime.hpp, scan_loop.cpp,
      services/core/ext_cache_reader.hpp (mới),
      services/core/tests/test_graph_protocol.cpp (mới)
Input: GRAPH_SCHEMA §10, SW_COMPONENT_LIBRARY §8, 07_guide §12 (COR-011 spec)
Output:
  - 5 Protocol node type parse + validate trong build_plan()
  - Scan loop step 3 cập nhật ext_cache → Protocol node inputs
  - Modbus_RTU_Write sink: push vào fieldbus write-queue
  - BACnet_AV/BV: đọc/ghi bacnet_objtable mức 5 (graph)
  - Quality BAD lan downstream (weakest-link rule §6 COMPLIB)
  - Validator check #4/#5/#6 (fallback mandatory, host/bus ref check)
Test: 12 unit test checklist COR-011 trong 07_guide §12.4 — tất cả PASS
Done khi:
  - graph_runtime.build_plan() accept/reject đúng các Protocol node type
  - Test coverage 12/12 checklist pass
  - Modbus_RTU_Read out = cached_value × scale (GOOD) / fallback (BAD)
  - Modbus_TCP_Read out = tcp_cached_value × scale / fallback
  - BACnet_AV in=22.5 → bacnet_objtable pv=22.5 tại mức 5
  - Quality BAD propagation downstream verified
  - 11_TASK_CHECKLIST + 07_guide Rev bump
Phụ thuộc: COR-009 (graph engine), MOD-009 (ext_cache path), BAC-004 (bacnet_objtable), MOD-012 (TCP ext_cache TCP key — liên quan MOD-013)
Trạng thái: ĐÃ làm 2026-06-26 — COR-011 DONE: 5 Protocol node type (Modbus_RTU_Read/Write, Modbus_TCP_Read, BACnet_AV/BV); str_params map; proto_ext_idx từ modbus section graph.json; feed_ext_snapshot + apply_ext_writes; scan_loop step 3a/5a; 12/12 test pass; 122/122 core_tests pass
```

---

## Phase 4/5 — BACnet/IP (S7 #5)

> Chi tiết triển khai: [25_BACNET_IMPLEMENTATION_PLAN](25_BACNET_IMPLEMENTATION_PLAN.md).
> **Doc gap audit 2026-06-17 — tất cả gap BACnet ĐÃ CLOSED. Sẵn sàng implement toàn bộ BAC-001..011.**

Doc gap đã resolve (2026-06-17):
- BAC-CONFLICT-001 CLOSED: core.sock mở rộng nhận source=bacnet mức 3 → 07 guide §8 Rev 1.6, plan 24 §4b
- bacnet.conf `bind_interface` CLOSED → CONFIG_SCHEMA §5 Rev 1.2
- Vendor_Identifier placeholder CLOSED → BACNET_PICS_EPICS §7 Rev 1.1 (giá trị 9999)

| Task ID | Tên | Owner | Output | Test |
|---------|-----|-------|--------|------|
| BAC-001 | Link `bacnet-stack` + CMake option | Dev SOM | `MKDDC_ENABLE_BACNET` build sạch | build smoke |
| BAC-002 | Loader `device.conf` + `bacnet.conf` (incl. `bind_interface`) | Dev SOM | device id/name/port/interface | bad config reject |
| BAC-003 | Object registry AI/BI/AO/BO/AV/BV/MSV | Dev SOM | count/name/instance đúng D-3 | object map unit |
| BAC-004 | `bacnet_objtable` publish từ core | Dev SOM | value/quality/reliability vào `mkddc_plc_shm` | shm unit |
| BAC-005 | ReadProperty/ReadPropertyMultiple | Dev SOM | BMS đọc object | `bacrp`/BTL smoke |
| BAC-006 | WriteProperty + Priority_Array[16] → core.sock source=bacnet | Dev SOM | BACnet write -> core mức 3; audit log | priority/core IPC fake |
| BAC-007 | COV subscribe/change detect | Dev SOM | notify theo threshold | COV unit |
| BAC-008 | Reliability/Status_Flags map | Dev SOM | fault -> BACnet flags | table unit |
| BAC-009 | Alarm/Notification Class bridge | Dev SOM | alarm bus -> event | fake alarm smoke |
| BAC-010 | TimeSync/ReinitializeDevice policy | Dev SOM | guarded restart/time sync | integration smoke |
| BAC-011 | BTL pretest script/checklist | Tester + Dev SOM | repeatable B-ASC pretest | group 9 PASS |

Trạng thái BACnet: BAC-001..011 logic/unit test ✅. BAC-012 IN PROGRESS 2026-06-26 — MKDDC_ENABLE_BACNET=ON: 123/123 test PASS (DoD #3 ✅); CI matrix bacnet + modbus+bacnet added; còn LAN/board smoke.

Done khi: DoD §8 pass; BACnet write không bypass core; safety/manual cao hơn vẫn thắng.

```
Task ID: BAC-012
Tên: bacnet-stack install + MKDDC_ENABLE_BACNET=ON build + smoke test mạng thật
Owner: Dev SOM | Phase: 4.5 | Module: bacnet_server, CMake, CI
Input: bacnet-stack >= 1.3.x; LAN với máy test có bacnet-tools
Output: mkddc-iobus bind UDP/47808 thật; Who-Is/I-Am/ReadProperty/WriteProperty pass từ máy khác
Test: bacwi/bacrp/bacwp smoke; DoD §3.5 trong 31_PROTOCOL_LIB_INTEGRATION_PLAN
Done khi: 10 checkbox DoD BAC-012 tick đủ; build CI có MKDDC_ENABLE_BACNET=ON xanh
Phụ thuộc: BAC-001..011
Chi tiết: 31_PROTOCOL_LIB_INTEGRATION_PLAN.md §3
Trạng thái: IN PROGRESS 2026-06-26 — DoD #3 (BACNET=ON build 123 test) ✅; còn LAN smoke, aarch64 cross-build, board.
```

---

## Phase 4.6 — BACnet Object Model Alignment (ADR-011 + ADR-012, Gate BTL) — IMPLEMENTED, BOARD BTL PENDING 2026-07-01

> **Authority:** ADR-011 (Reliability mapping), ADR-012 (AO config model)
> **Gate:** tất cả task group này PHẢI DONE trước khi close BAC-012 và schedule BTL lab.
> **Blocker DAG:** BAC-013 → BAC-014 → BAC-015; IOB-AO-001 → IOB-AO-002 → BAC-014

| Task ID | Tên | Owner | Output | Test |
|---------|-----|-------|--------|------|
| BAC-013 | Thêm `kx_reliability_t` enum + `ui_reliability[16]` field vào `shared/mkddc_shm.h` | Dev SOM | kx_reliability_t typedef; kx_io_shm_t.ui_reliability[] + kx_point_t.reliability | unit build clean iobus+core |
| BAC-014 | `io_scaling.cpp`: compute `kx_reliability_t` per fault type + ghi SHM; xem ADR-011 §Decision table | Dev SOM | reliability populated per UI channel sau mỗi poll | iobus_tests: 11 test cases fault-inject R-01..R-09 |
| BAC-015 | `bacnet_objtable.cpp` (BAC-008): map `kx_reliability_t` → BACnet Reliability enum; AI+AO+AV; xem ADR-011 | Dev SOM | ReadProperty AI1 Reliability trả giá trị đúng | core_tests: Reliability map unit; BTL test cases R-01..R-11 |
| IOB-AO-001 | Parse `ao[].name/units/min_pv/max_pv` trong `iobus_config.cpp`; thêm `AoChannelConfig` struct | Dev SOM | AoChannelConfig populated cho 4 channel | iobus_tests: parse test + default test |
| IOB-AO-002 | `bacnet_objtable.cpp`: populate AO Object_Name, Units, Min/Max_Pres_Value từ AoChannelConfig | Dev SOM | ReadProperty AO1 Units/Min/Max trả giá trị đúng | BTL test cases AO-01..AO-11 |
| IOB-AO-003 | AO engineering conversion: `raw_u16 ↔ eng float` dùng min_pv/max_pv trong bacnet_objtable | Dev SOM | WriteProperty AO1 PV=50% → DAC ra 5V | AO-11 test + board smoke |

```
Task ID: BAC-013
Tên: kx_reliability_t enum + SHM field (shared/mkddc_shm.h)
Owner: Dev SOM | Phase: 4.6 | Module: shared/mkddc_shm.h, services/iobus, services/core
Input: ADR-011 §Decision — 8 kx_reliability_t values + mapping table
Output:
  - typedef enum kx_reliability_t { KX_REL_RELIABLE=0, ..., KX_REL_UNRELIABLE_OTHER=7 }
  - uint8_t ui_reliability[KX_N_UI] trong kx_io_shm_t (sau ui_quality[])
  - uint8_t reliability trong kx_point_t để core publish vào plc_shm AI objects
Test: build clean iobus + core (recompile đồng bộ — SHM size thay đổi)
Done khi: mkddc_shm.h compile clean; iobus_tests + core_tests link OK
Phụ thuộc: —
Trạng thái: IMPLEMENTED 2026-07-01 — clean build/tests pass; SHM v4 requires synchronized board redeploy.
```

```
Task ID: BAC-014
Tên: io_scaling.cpp — compute kx_reliability_t per fault type
Owner: Dev SOM | Phase: 4.6 | Module: services/iobus/io/io_scaling.cpp
Input: ADR-011 §Decision table; BAC-013 (kx_reliability_t available)
Output: ui_to_eng() ghi ui_reliability[ch] theo fault type:
  - type=none → KX_REL_CONFIGURATION_ERROR
  - 4-20mA < 3.5mA → KX_REL_OPEN_LOOP
  - 4-20mA > 21.0mA → KX_REL_SHORTED_LOOP
  - overrange → KX_REL_OVER_RANGE; underrange → KX_REL_UNDER_RANGE
  - IOP timeout > 5s → KX_REL_COMMUNICATION_FAILURE (all 16 channels)
  - KX_Q_UNCERTAIN → KX_REL_UNRELIABLE_OTHER
  - KX_Q_GOOD → KX_REL_RELIABLE
Test: iobus_tests — 11 fault-inject test cases (R-01..R-09 + R-10 recovery + R-11 IOP recovery)
Done khi: 11 test cases pass + ui_reliability populated trong board SHM (read via /dev/shm)
Phụ thuộc: BAC-013
Trạng thái: IMPLEMENTED 2026-07-01 — local fault mapping/recovery tests pass; board fault injection remains.
```

```
Task ID: BAC-015
Tên: bacnet_objtable.cpp — BACnet Reliability enum map (BAC-008 completion)
Owner: Dev SOM | Phase: 4.6 | Module: services/core/bacnet_objtable.cpp
Input: ADR-011 §Decision; BAC-014 (ui_reliability[] populated); PICS/EPICS §4.1 Rev 1.2
Output: AI ReadProperty Reliability → 1 trong 8 BACnet Reliability enum values
  Map: KX_REL_RELIABLE→0, OVER_RANGE→2, UNDER_RANGE→3, OPEN_LOOP→4,
       SHORTED_LOOP→5, UNRELIABLE_OTHER→7, CONFIGURATION_ERROR→10, COMMUNICATION_FAILURE→12
  Status_Flags.FAULT bit = 1 khi Reliability ≠ NO_FAULT_DETECTED
Test: core_tests: Reliability map unit (8 cases); BTL tool R-01..R-11 test cases
Done khi: BTL pre-test R-01..R-11 tất cả PASS trên board với bacnet-tools
Phụ thuộc: BAC-013, BAC-014
Trạng thái: IMPLEMENTED 2026-07-01 — local ReadProperty smoke pass; board R-01..R-11 remains.
```

```
Task ID: IOB-AO-001
Tên: iobus_config.cpp — parse AoChannelConfig (name/units/min_pv/max_pv)
Owner: Dev SOM | Phase: 4.6 | Module: services/iobus/config/iobus_config.hpp/cpp
Input: ADR-012 §Decision; CONFIG_SCHEMA §3 Rev 1.4
Output: struct AoChannelConfig { std::string name; std::string units_str; float min_pv; float max_pv; };
  Parse io_config.conf ao[].name/units/min_pv/max_pv
  Default: name="AO{n}", units=auto từ mode, min_pv=0, max_pv=10/20
Test: iobus_tests — parse test (4 channel explicit) + default test (empty ao[]) + backward compat test
Done khi: 3 test cases pass; build clean
Phụ thuộc: —
Trạng thái: IMPLEMENTED 2026-07-01 — explicit/default/invalid config tests pass.
```

```
Task ID: IOB-AO-002
Tên: bacnet_objtable.cpp — AO Units + Min/Max_Pres_Value + Object_Name
Owner: Dev SOM | Phase: 4.6 | Module: services/core/bacnet_objtable.cpp
Input: ADR-012; IOB-AO-001 (AoChannelConfig available); PICS/EPICS §4.1 AO section Rev 1.2
Output:
  - AO Object_Name = ao.name
  - AO Units = units_str → BACnet enum (per CONFIG_SCHEMA §3.1 table)
  - AO Min_Pres_Value = ao.min_pv; Max_Pres_Value = ao.max_pv
Test: BTL AO test cases AO-01..AO-11; core_tests AO property unit
Done khi: bacrp AO1 Units / Min_Pres_Value / Max_Pres_Value trả đúng giá trị từ io_config.conf
Phụ thuộc: IOB-AO-001, BAC-013
Trạng thái: IMPLEMENTED 2026-07-01 — local UDP property readback pass; Orange Pi repeat remains.
```

```
Task ID: IOB-AO-003
Tên: Engineering conversion raw_u16 ↔ eng float (AO Present_Value scale)
Owner: Dev SOM | Phase: 4.6 | Module: services/core/bacnet_objtable.cpp + iobus AO path
Input: ADR-012 §Decision §4; IOB-AO-002
Output: WriteProperty AO1 PV=50.0 (percent) → raw_u16=32767 → DAC 5.0V on board
  Formula: raw = clamp((eng-min)/(max-min), 0, 1) × 65535
Test: AO-11 (board smoke); iobus_tests: AO conversion unit (boundary: 0%, 50%, 100%)
Done khi: board smoke AO1 output đo được đúng voltage theo engineering value
Phụ thuộc: IOB-AO-002
Trạng thái: IMPLEMENTED LOCAL 2026-07-01 — 50% → raw 32768 via fake MCU; board voltage measurement remains.
```

---

## Phase 3/4 — Modbus RTU Master (S7 #6)

> Chi tiết triển khai: [26_MODBUS_IMPLEMENTATION_PLAN](26_MODBUS_IMPLEMENTATION_PLAN.md).
> **Doc gap audit 2026-06-17 — tất cả gap Modbus ĐÃ CLOSED. Sẵn sàng implement toàn bộ MOD-001..011.**

Doc gap đã resolve (2026-06-17):
- kx_ext_snapshot_msg_t CLOSED: struct + KX_EXT_SNAP_MAGIC thêm vào mkddc_shm.h
- RS-485 device path CLOSED: fieldbus.conf thêm `rs485.device` bắt buộc → CONFIG_SCHEMA §5b Rev 1.2, D-2 §4 Rev 2.2

| Task ID | Tên | Owner | Output | Test |
|---------|-----|-------|--------|------|
| MOD-001 | Link `libmodbus` + CMake option | Dev SOM | `MKDDC_ENABLE_MODBUS` build sạch | build smoke |
| MOD-002 | `fieldbus.conf` loader/reload (incl. `rs485.device`) | Dev SOM | rs485/slaves/poll config | config unit |
| MOD-003 | Device profile parser/validator | Dev SOM | profile JSON strict | parser unit |
| MOD-004 | Register codec | Dev SOM | bool/int/float scale/endian | codec vectors |
| MOD-005 | Poll scheduler | Dev SOM | due-time/retry/offline | scheduler unit |
| MOD-006 | RTU read FC01/02/03/04 | Dev SOM | ext cache update | fake slave integration |
| MOD-007 | RTU write FC05/06/15/16 | Dev SOM | pending write result | fake slave write |
| MOD-008 | Metrics/alarm E302/E303 | Dev SOM | status + alarm | fault injection |
| MOD-009 | Core ext point read path qua fieldbus.sock (dùng kx_ext_snapshot_msg_t từ mkddc_shm.h) | Dev SOM | graph đọc ext values | core integration |
| MOD-010 | BACnet expose ext points theo profile | Dev SOM | ext -> AV/BV/AI optional | object map test |
| MOD-011 | 16-slave timing smoke | Tester + Dev SOM | stable poll budget | group 10 PASS |

Trạng thái Modbus RTU: MOD-001..011 logic/unit test ✅. MOD-012 IN PROGRESS 2026-06-26 — 9/11 DoD ✅ (PTY+E302+E303+ext snapshot); T11 TCP loopback fixed; còn 1h smoke + thiết bị thật.

Done khi: DoD §9 pass; Modbus không làm slave northbound; không có output bypass core.

```
Task ID: MOD-012
Tên: libmodbus install + MKDDC_ENABLE_MODBUS=ON build + fake slave + thiết bị thật RS-485
Owner: Dev SOM | Phase: 3.5 | Module: modbus_master, CMake, CI
Input: libmodbus >= 3.1.6; /dev/ttyUSB* hoặc socat PTY cho fake slave
Output: modbus_master.open() kết nối RS-485 thật; FC03 đọc được; timeout → E302
Test: diagslave PTY smoke; DoD §4.6 trong 31_PROTOCOL_LIB_INTEGRATION_PLAN
Done khi: 11 checkbox DoD MOD-012 tick đủ; build CI có MKDDC_ENABLE_MODBUS=ON xanh
Phụ thuộc: MOD-001..011
Chi tiết: 31_PROTOCOL_LIB_INTEGRATION_PLAN.md §4
Trạng thái: IN PROGRESS 2026-06-26 — 9/11 DoD ✅: libmodbus native, MODBUS=ON 141/141 test, PTY FC03/FC05/FC06, timeout→E302, E303 alarm, ext snapshot via fieldbus.sock; còn 1h smoke + thiết bị thật.
```

```
Task ID: MOD-013
Tên: Modbus TCP client — libmodbus TCP context, reconnect, ext_cache TCP key, graph Modbus_TCP_Read
Owner: Dev SOM | Phase: 3.5/4 (Rev A feature-complete) | Module: modbus_tcp, fieldbus_config, ext_cache, graph_runtime
File: services/iobus/fieldbus/modbus_tcp.{hpp,cpp} (mới),
      services/iobus/fieldbus/fieldbus_config.cpp (extend [modbus.tcp]),
      services/iobus/ext_cache.cpp (extend TCP key),
      services/core/graph_runtime.cpp (Modbus_TCP_Read node),
      services/iobus/tests/test_modbus_tcp.cpp (mới)
Input: SW_FIELDBUS_DESIGN §12, 06_guide §3.14, GRAPH_SCHEMA §10.3
Output:
  - modbus_tcp.cpp: libmodbus TCP context + reconnect state machine
  - fieldbus.conf: [modbus.tcp.slaves] section parse
  - ext_cache: TCP key (host+unit+addr) cạnh RTU key (bus+slave+addr)
  - poll_scheduler: TCP slave entries thêm vào scheduler
  - graph_runtime: Modbus_TCP_Read tick() đọc ext_cache TCP
  - graph validator check #5: host/unit match modbus.tcp[] config
Test: 10 unit test (DoD MOD-013 §12.8): FC03 TCP read OK, disconnect→BAD→reconnect→GOOD,
      fallback khi stale, graph_runtime output đúng, validator reject unknown host
Done khi:
  - modbus_tcp.open() connect thành công tới diagslave -m tcp
  - FC03 read OK; ext_cache TCP point quality GOOD
  - TCP disconnect → quality BAD; reconnect tự động sau reconnect_s
  - Modbus_TCP_Read node trong graph: output = tcp_value × scale / fallback
  - 10/10 DoD checklist tick đủ
  - 11_TASK_CHECKLIST + 06_guide + SW_FIELDBUS_DESIGN Rev bump
Phụ thuộc: MOD-001..011 (libmodbus, ext_cache, PollScheduler đã có), MOD-012 (transport pattern)
Trạng thái: ĐÃ làm 2026-06-26 — MOD-013 DONE: modbus_tcp.{hpp,cpp} ModbusTcp class + reconnect FSM; fieldbus_config.cpp tcp_slaves parse + TCP-only config; ModbusMaster.total_ext_count(); wired vào main.cpp fieldbus thread; 10/10 test pass; 140/140 iobus_tests pass (138+2skip)
```

---

### EasySet Config Tasks

```
Task ID: WEB-A01
Tên: EasySet Controller Diagram
Owner: Dev Web | Phase: A | Module: UI
Trạng thái: DONE
```

```
Task ID: WEB-A02
Tên: Engineering Nav/Routes/I18N
Owner: Dev Web | Phase: A | Module: UI
Trạng thái: DONE
```

```
Task ID: WEB-A03
Tên: Auxiliary Functions
Owner: Dev Web | Phase: A | Module: UI
Trạng thái: DONE
Ghi chú: ĐÃ làm 2026-06-24 — wired /eng/aux route + fix tsc/lint (remove as any, @ts-expect hacks, fix getDemoGraph meta)
```

```
Task ID: WEB-002
Tên: EasySet Alarm Config
Owner: Dev Web | Phase: A | Module: UI
Trạng thái: DONE
Ghi chú: ĐÃ làm 2026-06-24 — Alarm UI: wizard/advanced tabs, alarm type 0-7 conditional fields, interlock, sourcePointId, ackDelayS. Tabs component tái dùng.
```

```
Task ID: WEB-003
Tên: EasySet AI Inputs Config
Owner: Dev Web | Phase: A | Module: UI
Trạng thái: IN-PROGRESS
Ghi chú: BE validate 2026-06-25 — `/system/config/io` chấp nhận AI Universal Input `type:"2-10V"` và optional `name/enabled/invert/range_mult(0..5)`; C++ iobus consumer field mới để downstream.
Ghi chú: BE validate 2026-06-25 — mở đủ AI EasySet authoring `type:none/potentiometer/light/pulse` + optional `filter_samples(0..100)/sensor_cal(-12.7..12.8)/math_func(0..3)`.
```

```
Task ID: WEB-004
Tên: EasySet DI Inputs Config
Owner: Dev Web | Phase: A | Module: UI
Trạng thái: IN-PROGRESS
```

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
```
Task ID: WEB-006
Tên: Frontend theme/status ISA-101 Level A (P1/3)
Owner: Dev Web | Phase: 5 | Module: frontend theme/status
File: src/frontend/src/styles.css, src/frontend/src/utils.ts, src/frontend/src/components/StatusBadge.tsx, src/frontend/src/components/TrendChart.tsx
Input: ADR-009 Accepted; UX-SYSTEM §1/§2/§6/§7/§8
Output: web Rev A nền xám sáng Level A; normal/online/OK trung tính; warn/fault/force/critical dùng màu đúng chuẩn; badge luôn có icon+chữ
Test: npm run typecheck; npm run build; kiểm UI nền sáng và không đổi REST/WebSocket contract
Done khi: build sạch, trạng thái bình thường không còn xanh lá rực, màu không là nghĩa duy nhất
Phụ thuộc: WEB-004; ADR-009 Accepted
Trạng thái: ĐÃ làm 2026-06-16 — áp design tokens ISA-101 Level A P1/3 cho frontend theme/status; không đổi REST/WS contract
```

```
Task ID: WEB-007
Tên: Frontend navigation/routing ISA-101 3 nhóm (P2/3)
Owner: Dev Web | Phase: 5 | Module: frontend routing/nav
File: src/frontend/src/components/NavRail.tsx, src/frontend/src/App.tsx, src/frontend/src/i18n.tsx, src/frontend/src/pages/_Stub.tsx
Input: ADR-009 Accepted; UX-SYSTEM §6; WEB-006
Output: NavRail 3 nhóm thu gọn được; route mới Overview/Settings/Engineering; stub cho trang P3; redirect path cũ
Test: npm run typecheck; mở từng route mới/cũ; không đổi REST/WebSocket contract
Done khi: typecheck sạch, không 404, active item dùng dấu hiệu trung tính, path cũ redirect đúng
Phụ thuộc: WEB-006
Trạng thái: ĐÃ làm 2026-06-16 — điều hướng 3 nhóm + routing mới P2/3; không đổi REST/WS contract
```

```
Task ID: WEB-008
Tên: Frontend hoàn tất tái cấu trúc ISA-101 (P3/3)
Owner: Dev Web | Phase: 5 | Module: frontend pages/programming/health
File: src/frontend/src/App.tsx, src/frontend/src/pages/*, src/frontend/src/demo/simulator.ts, src/frontend/src/types.ts
Input: ADR-009 Accepted; UX-SYSTEM; WEB-006; WEB-007; SW_COMPONENT_LIBRARY
Output: 12 trang theo cây ADR-009 không còn stub; `/health` gộp vào Dashboard; `/eng/programming` thay Validator với thư viện component + graph validate/deploy demo; alarm settings demo
Test: npm run typecheck; mở từng route mới/cũ; không còn nền navy tối; không đổi REST/WebSocket contract
Done khi: typecheck sạch, route ADR-009 đầy đủ, Dashboard có health services + IOP/scan metrics, Programming deploy chỉ bật khi validate pass
Phụ thuộc: WEB-007
Trạng thái: ĐÃ làm 2026-06-16 — hoàn tất FE ISA-101 P3/3; không đổi REST/WS contract
```
```
Task ID: WEB-009
Tên: Frontend Level B hybrid status colors (green normal, gray off, warn-fg)
Owner: Dev Web | Phase: 5 | Module: frontend status colors/accessibility
File: src/frontend/src/styles.css, src/frontend/src/utils.ts, src/frontend/src/components/StatusBadge.tsx, src/frontend/src/components/Gauge.tsx, src/frontend/src/components/TrendChart.tsx, src/frontend/src/pages/DashboardPage.tsx, src/frontend/src/pages/TrendsPage.tsx
Input: ADR-009 amended Level B hybrid; UX-SYSTEM §2/§8
Output: `statusColor()` dùng màu fg đọc trên nền sáng; `statusFill()` dùng màu nền/dot/arc; normal/online/ON xanh lá, off/stopped xám, warn dùng amber sẫm cho chữ/đường hoặc chip nền vàng, fault dùng đỏ; trend amber đủ dày; không đổi REST/WebSocket contract
Test: npm run typecheck; kiểm Dashboard/Trends không còn chữ/đường vàng mảnh khó đọc và mọi trạng thái có chữ/icon phi-màu
Done khi: typecheck sạch, màu Level B hybrid đúng semantic và warn/fault/normal/off đọc tốt trên nền sáng
Phụ thuộc: WEB-008; ADR-009 amendment 2026-06-16
Trạng thái: ĐÃ làm 2026-06-16 — áp Level B hybrid: green normal, gray off, warn-fg/fault-fg cho chữ/đường; typecheck pass
```
```
Task ID: WEB-010
Tên: Dashboard dynamic metrics theo owner adjustment ISA-101
Owner: Dev Web | Phase: 5 | Module: frontend dashboard/status metrics
File: src/frontend/src/styles.css, src/frontend/src/utils.ts, src/frontend/src/components/StatusBadge.tsx, src/frontend/src/pages/DashboardPage.tsx
Input: Owner feedback 2026-06-16; ADR-009 adjustment; UX-SYSTEM 1.3
Output: OK/ONLINE/uptime/value trong ngưỡng bình thường xanh lá; CPU/RAM/nhiệt/scan vượt ngưỡng warn cam, fault đỏ; surface/card vẫn nền xám Level A; không đổi REST/WebSocket contract
Test: npm run typecheck; kiểm Dashboard top cards + Services + IOP/scan metrics đổi màu đúng ngưỡng
Done khi: typecheck sạch, normal xanh và bất thường cam/đỏ cho các giá trị biến thiên Dashboard
Phụ thuộc: WEB-009
Trạng thái: ĐÃ làm 2026-06-16 — cập nhật dashboard dynamic metrics theo ngưỡng; không đổi REST/WS contract
```
```
Task ID: WEB-011
Tên: Frontend sticky top status bar/NavRail
Owner: Dev Web | Phase: 5 | Module: frontend app shell/layout
File: src/frontend/src/components/TopBar.tsx, src/frontend/src/components/AppShell.tsx, src/frontend/src/components/NavRail.tsx
Input: Owner feedback 2026-06-16; 09_WEB §1.8; ADR-009/UX-SYSTEM Level A
Output: TopBar luôn cố định khi cuộn; reconnect banner bám dưới TopBar; NavRail cố định bên trái; không dùng glow/dark overlay; không đổi REST/WebSocket contract
Test: npm run typecheck; cuộn trang dài vẫn thấy top status bar/NavRail
Done khi: typecheck sạch, thanh điều khiển không biến mất khi cuộn
Phụ thuộc: WEB-010
Trạng thái: ĐÃ làm 2026-06-16 — cố định shell chrome khi cuộn; không đổi REST/WS contract
```
```
Task ID: WEB-012
Tên: Monitor binary ON/OFF color semantics
Owner: Dev Web | Phase: 5 | Module: frontend monitor/status colors
File: src/frontend/src/pages/MonitorPage.tsx
Input: Owner feedback 2026-06-17; ADR-009 Level B hybrid; UX-SYSTEM §2 ngữ nghĩa màu trạng thái
Output: Monitor I/O hiển thị ON/active bằng green, OFF/inactive bằng gray; DI-01 ON không tự chuyển đỏ trong bảng/trang chi tiết/lịch sử nhị phân; không đổi REST/WebSocket contract
Test: npm run typecheck; kiểm Monitor DI/DO row, detail panel, history table theo ON xanh/OFF xám
Done khi: typecheck sạch, các bề mặt nhị phân Monitor theo đúng quy ước owner
Phụ thuộc: WEB-009
Trạng thái: ĐÃ làm 2026-06-17 — sửa Monitor binary ON/OFF: ON xanh, OFF xám; không đổi REST/WS contract
```
```
Task ID: WEB-013
Tên: Frontend i18n VI dấu + English mode thật
Owner: Dev Web | Phase: 5 | Module: frontend i18n/pages
File: src/frontend/src/i18n.tsx, src/frontend/src/components/*, src/frontend/src/pages/*
Input: Owner feedback 2026-06-17; 09_WEB §1.9; Display `/settings/display` language vi/en
Output: tiếng Việt hiển thị có dấu trên shell và 12 trang ADR-009; English mode đổi nhãn/nút/toast chính theo tiếng Anh; không đổi REST/WebSocket contract
Test: npm run typecheck; bật VI/EN ở Display/TopBar và kiểm tra Dashboard, Monitor, Settings, Engineering không còn chuỗi VI không dấu ở UI chính
Done khi: typecheck sạch, UI chính đọc tốt ở VI và EN
Phụ thuộc: WEB-012
Trạng thái: ĐÃ làm 2026-06-17 — chuẩn hóa i18n VI có dấu + English mode cho frontend demo; không đổi REST/WS contract
```
```
Task ID: WEB-014
Tên: Frontend dependency security refresh for Vite GHSA gate
Owner: Dev Web | Phase: 5 | Module: frontend dependencies / CI
File: src/frontend/package.json, src/frontend/package-lock.json, src/frontend/vite.config.ts,
      web/backend/go.mod, web/backend/go.sum, .github/workflows/build-and-test.yml,
      .github/workflows/security.yml
Input: Security Scan PR failure (Trivy/Grype high gate), SEC-PROC CVE gate, 09_WEB §1.10
Output: Vite upgraded to fixed major, plugin-react aligned, Vite 8 config typing fixed,
        frontend CI runs on Node 22, Go crypto/sys modules upgraded past Trivy/Grype high gate,
        temporary Trivy debug action removed
Test: npm audit --audit-level=high; npm run build; npm run lint; go test ./...; govulncheck ./...; grype git archive scan
Done khi: npm/go security checks clean locally and Trivy/Grype no longer report known high findings
Phụ thuộc: WEB-013
Trạng thái: ĐÃ làm 2026-06-23 — Vite 8.0.16 + @vitejs/plugin-react 6.0.2; x/crypto 0.53.0 + x/sys 0.46.0; audit/build/lint/go test/govulncheck/Grype archive scan pass locally; chờ remote CI green.
```
---

## Phase 5.5 — mkddc-hmi

> **ADR-016 controlling plan (2026-07-22):** kế hoạch active là five-surface limited-
> operator HMI và được chia thành microtask `HOP-000..077` tại
> [08_MKDDC_HMI_IMPLEMENTATION_GUIDE](08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md).
> Block `HMI-001..012` bên dưới chỉ giữ như historical baseline của skeleton sáu màn;
> không được dùng làm task đầu vào mới hoặc release evidence.

<details><summary>Historical HMI-001..012 skeleton baseline — superseded by ADR-016 microtasks</summary>

```
Task ID: HMI-001
Tên: CMake skeleton services/hmi/ + LVGL v9 + DRM/KMS init
Owner: Dev SOM | Phase: 5.5 | Module: hmi/drm
File: services/hmi/CMakeLists.txt, drm/drm_init.cpp/hpp, main.cpp
Input: SW-HMI-001 (DRM/KMS /dev/dri/card0, LVGL v9)
Output: MKDDC_ENABLE_HMI cmake option; lv_init + drm_init("/dev/dri/card0"); màn hình blank lên
Test: build xanh; FPS ≥ 10; màn hiển thị màu nền
Done khi: LVGL render được 1 label lên màn thật; CI build sạch
Phụ thuộc: board Orange Pi 5B + module KD024QVFIA073-02-C021B
Trạng thái: ĐÃ làm 2026-06-27 — source/build DRM RGB565 portrait→landscape hoàn tất; còn TFT/FPS hardware gate T-SW-100/101.
```
```
Task ID: HMI-002
Tên: Input drivers — FT5436 evdev touch + 6 GPIO buttons
Owner: Dev SOM | Phase: 5.5 | Module: hmi/input
File: input/evdev_touch.cpp/hpp, input/gpio_buttons.cpp/hpp
Input: SW-HMI-006 (GPIO), FT5436 I2C 0x38 → /dev/input/touchscreen0
Output: LV_INDEV_TYPE_POINTER (evdev); LV_INDEV_TYPE_KEYPAD (GPIO 20ms debounce)
Test: tap vào widget đúng tọa độ; button UP/DOWN cuộn list; ENTER chọn; ESC thoát
Done khi: cả 2 input path hoạt động; screen saver wake test pass
Phụ thuộc: HMI-001
Trạng thái: ĐÃ làm 2026-06-27 — evdev calibration + GPIO debounce/SPSC/wake suppression có test; còn FT5436/GPIO target test.
```
```
Task ID: HMI-003
Tên: Tab strip + 6-page ring navigation + screen saver + I/O FAULT banner
Owner: Dev SOM | Phase: 5.5 | Module: hmi/ui
File: ui/nav_controller.cpp/hpp, ui/screen_saver.cpp/hpp, ui/fault_banner.cpp/hpp
Input: UX §3 (ring model), UX §4 (frame), UX §11 (I/O FAULT overlay)
Output: tab strip + swipe/tap navigation vòng 6 màn; dim 5min; banner đỏ khi FAULT
Test: UC-LOCAL-002 (navigation); screen saver dim 5min; FAULT banner không tắt được
Done khi: vòng Home→Svc→Home qua cả swipe và tap; FAULT test pass
Phụ thuộc: HMI-002
Trạng thái: ĐÃ làm 2026-06-27 — ring 6 page, tab/swipe/button, saver và FAULT overlay hoàn tất; còn UC-LOCAL-002 manual.
```
```
Task ID: HMI-010
Tên: SHM data binding 1s (kx_io_shm + kx_plc_shm) + AGE + point database
Owner: Dev SOM | Phase: 5.5 | Module: hmi/data
File: data/shm_reader.cpp/hpp, data/point_db.cpp/hpp
Input: kx_io_shm_t (UI/DI/AO/DO value+quality), kx_plc_shm_t (alarm count, ext)
Output: lv_timer 1s refresh; AGE = now - last_update_ts; STALE khi AGE > threshold
       point_db: load display_name/unit/scale từ /data/config/point_db.json
Test: thay đổi SHM → widget cập nhật ≤ 1s; AGE tăng đúng; STALE > 5s highlight
Done khi: SHM reader stable; point_db load đúng; AGE column chính xác
Phụ thuộc: HMI-003
Trạng thái: ĐÃ làm 2026-06-27 — SHM magic/seqlock/late attach + AGE/STALE + point DB transactional validation có test; còn producer/latency target test.
```
```
Task ID: HMI-004
Tên: Screen 1 — Home / Controller Health
Owner: Dev SOM | Phase: 5.5 | Module: hmi/screens
File: screens/screen_home.cpp/hpp
Input: UX §5, UC-LOCAL-001/003; kx_io_shm + kx_plc_shm
Output: 6 block: ID+status, alarm summary, controller health, I/O health, comm, config
Quy tắc: không hardcode "Room Temp/Fan/Power"; BACnet "Last req: Xs ago"
Test: UC-LOCAL-001 (30s glance); UC-LOCAL-003 (CPU/RAM/Temp); alarm count đúng
Done khi: tất cả 6 block hiển thị dữ liệu thật từ SHM
Phụ thuộc: HMI-010
Trạng thái: ĐÃ làm 2026-06-27 — đủ Home blocks và count theo point DB; còn UC-LOCAL-001/003 + communication telemetry target.
```
```
Task ID: HMI-005
Tên: Screen 2 — I/O Monitor (24 points, AGE, BAD/STALE filter)
Owner: Dev SOM | Phase: 5.5 | Module: hmi/screens
File: screens/screen_io.cpp/hpp
Input: UX §6, UC-LOCAL-004/005/006; kx_io_shm
Output: table POINT|NAME|TYPE|VALUE|UNIT|QUALITY|AGE; 3 page; filter BAD/STALE
Test: UC-LOCAL-004 (I/O overview); UC-LOCAL-005 (detail 24); UC-LOCAL-006 (filter)
Done khi: 24 điểm hiển thị đúng; AGE cập nhật; filter hoạt động
Phụ thuộc: HMI-010
Trạng thái: ĐÃ làm 2026-06-27 — bảng point DB động, TYPE/VALUE/UNIT/QUALITY/AGE và BAD/STALE filter; còn UC-LOCAL-004..006 visual/manual.
```
```
Task ID: HMI-006
Tên: Screen 3 — Alarm / Event (4-state model + ACK)
Owner: Dev SOM | Phase: 5.5 | Module: hmi/screens
File: screens/screen_alarm.cpp/hpp
Input: UX §7, UC-LOCAL-007/008; alarm bus từ iobus
Output: 4-state table; ACK đổi UNACK→ACK không xóa; filter; severity color
Test: UC-LOCAL-007 (view active); UC-LOCAL-008 (ACK — count không giảm)
Done khi: 4-state model đúng; ACK không xóa alarm; FAULT=đỏ, WARN=vàng, INFO=xám
Phụ thuộc: HMI-010
Trạng thái: ĐÃ làm 2026-06-27 — alarm.sock reader, ring 10, severity + 4-state ACK test pass; còn chốt ACK upstream contract.
```
```
Task ID: HMI-007
Tên: Screen 4 — Communication (BACnet/Modbus status codes)
Owner: Dev SOM | Phase: 5.5 | Module: hmi/screens
File: screens/screen_comm.cpp/hpp
Input: UX §8, UC-LOCAL-009/010
Output: Ethernet + BACnet (Last req: Xs ago) + Modbus RTU x2 + TCP sections
Quy tắc: BACnet KHÔNG "Đang kết nối"; chỉ OK/NO_TRAFFIC/TIMEOUT/CONFIG_ERROR/DUPLICATE_ID
Test: UC-LOCAL-009 (Ethernet); UC-LOCAL-010 (BACnet/Modbus)
Done khi: status codes đúng; "Last req: Xs ago" tính đúng
Phụ thuộc: HMI-010
Trạng thái: ĐÃ làm một phần 2026-06-27 — Ethernet/kernel và technical status UI; còn Device ID/Last Request/Modbus metrics vì contract SHM chưa cung cấp.
```
```
Task ID: HMI-008
Tên: Screen 5 — System / Diagnostics (read-only)
Owner: Dev SOM | Phase: 5.5 | Module: hmi/screens
File: screens/screen_system.cpp/hpp
Input: UX §9, UC-LOCAL-011
Output: FW version, uptime, CPU/RAM/storage, process status, watchdog, last error
Read-only: không có action button (restart → Screen 6)
Test: UC-LOCAL-011; dữ liệu từ SHM/procfs đúng
Done khi: 6 section hiển thị; không có nút nguy hiểm
Phụ thuộc: HMI-010
Trạng thái: ĐÃ làm 2026-06-27 — diagnostics read-only từ proc/sys/package; còn UC-LOCAL-011 trên board.
```
```
Task ID: HMI-009
Tên: Screen 6 — Service / Config (PIN lock + Reload + Reboot 3s hold)
Owner: Dev SOM | Phase: 5.5 | Module: hmi/screens
File: screens/screen_service.cpp/hpp
Input: UX §10, UC-LOCAL-012/013/014
Output: LOCKED default; unlock = PIN OR service switch OR Engineer role
       Reload Config: checksum check, rollback on fail
       Reboot: hold 3s confirm; áp per-point safe_state trước khi tắt
Test: UC-LOCAL-012 (unlock 3 path); UC-LOCAL-013 (reload); UC-LOCAL-014 (reboot 3s + safe state)
Done khi: LOCKED mặc định; 3 unlock path; reboot 3s hold; safe state per-point
Phụ thuộc: HMI-010
Trạng thái: ĐÃ làm một phần 2026-06-27 — lock/unlock/revoke, hold 3s và per-point safe-state IPC có test; còn checksum algorithm và Web-role mapping chưa có contract.
```
```
Task ID: HMI-011
Tên: Localization EN/VI + SIGHUP reload
Owner: Dev SOM | Phase: 5.5 | Module: hmi/i18n
File: i18n/locale.cpp/hpp
Input: UX §12; NotoSans font hỗ trợ UTF-8 tiếng Việt
Output: bảng locale EN + VI; SIGHUP đổi locale không restart service
Test: SIGHUP → locale đổi trong 1s; VI hiển thị đầy đủ dấu
Done khi: EN default; SIGHUP → VI; không lỗi font
Phụ thuộc: HMI-004..009
Trạng thái: ĐÃ làm 2026-06-27 — EN/VI UTF-8 + NotoSans FreeType + SIGHUP; còn visual font/reload test trên TFT.
```
```
Task ID: HMI-012
Tên: systemd mkddc-hmi.service + packaging + install script
Owner: Dev SOM | Phase: 5.5 | Module: packaging
File: packaging/mkddc-hmi.service, install.sh
Output: systemd start/stop/restart; Restart=always; After=mkddc-core+mkddc-iobus
Test: systemctl start mkddc-hmi; journalctl -u mkddc-hmi; reboot → tự start
Done khi: service tự start sau reboot; log đủ debug
Phụ thuộc: HMI-001..011
Trạng thái: ĐÃ làm 2026-06-27 — systemd notify/watchdog/capability + CMake/root installer; còn start/reboot acceptance trên Orange Pi.
```

</details>

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
**Rev** 1.24 | 2026-07-22 (ADR-016: block HMI-001..012 is historical; active plan is 54 HOP microtasks) · 1.23 | 2026-07-01 (Phase 4.6 implementation verified locally; hardware/BTL gates remain) · 1.22 | 2026-06-30 (Phase 4.6 BACnet/Object Model plan) ·
1.2 | 2026-06-12 (thêm SKEL-005 packaging/systemd, COR-007 web_ipc overridden+audit, COR-008 SIGHUP reload — cụm production-hardening 1+5+6 ĐÃ làm) · 1.1 | 2026-06-12 (COR-004 chốt trạng thái theo SAFETY SPEC 07 §5; thêm COR-006 Rev A.1 cho trigger T6/T7; E2E-003 kiểm đủ 3 lớp safety) · 1.0 | 2026-06-10 ·
Test chi tiết: [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md)

Revision addendum: **Rev 1.23** | 2026-07-01 (Phase 4.6 implementation verified locally: SHM v4 and BACnet smoke 14/14; Orange Pi/BTL gates remain open).
