# 22 — SOM Source Implementation Plan
## MK-DDC-24 — Kế hoạch triển khai cấu trúc source thật chi tiết cho Dev 2

> **Document ID:** IMPL-SOM-SRC-PLAN-MK-DDC-24-VI
> **Phiên bản:** 1.12 | 2026-07-20 (reconciled downstream WEB-HIST-001..005 code-local status; v2 Trends authority feature-gated) · 1.11 | 2026-07-20 (reconciled downstream WEB-HIST-001..004 code-local status) · 1.10 | 2026-07-20 (reconciled downstream WEB-HIST-001/002/003 code-local status) · 1.9 | 2026-07-17 (S8 COR-HIST-001 core/local Done) · 1.8 | 2026-07-15 (S8 COR-HIST-001 coherent runtime snapshot planned) · 1.7 | 2026-06-19 (TD-001..003 / ACT-014..016 ĐÃ làm: thay JSON parser, fix SHM race, phân biệt EAGAIN write) ·
> 1.6 | 2026-06-17 (S7 #5/#6: doc gap CLOSED — BAC-CONFLICT-001/bind_interface/Vendor_Identifier/kx_ext_snapshot/rs485.device) ·
> 1.5 | 2026-06-13 (S7 #4 ĐÃ làm: COR-009/010 done, 97/97 pass) ·
> 1.4 | 2026-06-13 (S7 #4 Active; thêm plan S7 #5 BACnet và S7 #6 Modbus) ·
> 1.3 | 2026-06-12 (S7 #4: audit thiết kế xong, tách plan riêng
> [23_GRAPH_STATEFUL_COMPONENTS_PLAN](23_GRAPH_STATEFUL_COMPONENTS_PLAN.md), lúc đó còn Draft) ·
> 1.2 | 2026-06-12 (thêm S7 Production Hardening — 6 việc còn lại sau S6;
> #1 web_ipc overridden+audit, #2 SIGHUP reload, #3 packaging/systemd ĐÃ làm; cây §4 thêm
> packaging/) · 1.1 | 2026-06-12 (SOM-COR-005: chốt microtask 1–4 ĐÃ làm theo
> SAFETY SPEC 07 §5, thêm microtask 5 Rev A.1 cho trigger T6/T7) · 1.0 | 2026-06-11
> **Trạng thái:** Active — S0–S6 ĐÃ thực thi xong 2026-06-11 (round-trip pass);
> S7 #1/#2/#3 xong 2026-06-12; S7 #4/#5/#6 đã có task/code-ready docs 2026-06-13;
> TD-001/002/003 xong 2026-06-19; S8 COR-HIST-001 core/local DONE 2026-07-17; historian target E2E chưa đóng
> **Đối tượng đọc:** Dev 2, Lead, Tester
> **Phạm vi:** chỉ phía SOM: `services/iobus`, `services/core`, `tools/fake_mcu`, `tools/shm_dump_io`, `shared/`

---

## 1. Kết luận trước khi làm

**Có rồi, nhưng chưa đủ gom vào 1 chỗ cho Dev 2 cầm làm.**

Hiện repo đã có:
- `phase plan`: [03_PHASE_PLAN.md](03_PHASE_PLAN.md)
- `task checklist`: [11_TASK_CHECKLIST.md](11_TASK_CHECKLIST.md)
- `definition of done`: [13_DEFINITION_OF_DONE.md](13_DEFINITION_OF_DONE.md)
- `module contract iobus`: [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md)
- `module contract core`: [07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md)
- `quick start no-board`: [17_QUICK_START_SOM_DEV.md](17_QUICK_START_SOM_DEV.md)

Nhưng còn thiếu 3 thứ cho Dev 2:
- 1 plan chỉ dành riêng cho **cấu trúc source SOM**
- 1 breakdown tới mức **microtask theo file**
- 1 thứ tự làm đủ rõ để tránh dựng nhầm cây thư mục, nhầm dependency, nhầm test gate

File này lấp đúng 3 chỗ thiếu đó.

---

## 2. Mục tiêu của Dev 2

Dev 2 phải tạo được toàn bộ khung source SOM để cuối cùng chạy đúng luồng này:

```text
fake_mcu / board thật
        <-> UART/IOP
mkddc-iobus
        <-> /dev/shm/mkddc_io_shm
mkddc-core
        <-> /run/mkddc/core.sock
mkddc-web
```

Trong scope file này, đích gần nhất là:
- dựng cây `services/iobus` và `services/core` build được
- có `tools/fake_mcu` và `tools/shm_dump_io`
- pass no-board path: `fake_mcu -> iobus -> shm -> core`

Không nằm trong scope file này:
- code web chi tiết
- board MCU firmware chi tiết
- BACnet/Modbus Rev A.1+

---

## 3. Nguồn-chuẩn phải khóa trước khi code

Dev 2 chỉ được code sau khi chốt 6 nguồn này:

1. [shared/iop_protocol.h](../../shared/iop_protocol.h)
2. [shared/mkddc_shm.h](../../shared/mkddc_shm.h)
3. [16_CONTRACT_FREEZE.md](16_CONTRACT_FREEZE.md)
4. [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md)
5. [07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md)
6. [21_VIRTUAL_COM_DECISION.md](21_VIRTUAL_COM_DECISION.md)

Rule:
- header `shared/*` thắng mọi docs
- docs này là execution plan, không được tự fork contract

---

## 4. Cấu trúc source cuối cùng phải có

```text
shared/
├── iop_protocol.h
└── mkddc_shm.h

services/
├── iobus/
│   ├── CMakeLists.txt
│   ├── README.md
│   ├── main.cpp
│   ├── config/
│   │   ├── iobus_config.hpp
│   │   └── iobus_config.cpp
│   ├── iop/
│   │   ├── iop_port.hpp
│   │   ├── iop_port.cpp
│   │   ├── iop_frame.hpp
│   │   ├── iop_frame.cpp
│   │   ├── iop_crc.hpp
│   │   ├── iop_crc.cpp
│   │   ├── iop_client.hpp
│   │   ├── iop_client.cpp
│   │   ├── iop_parser.hpp
│   │   └── iop_parser.cpp
│   ├── io/
│   │   ├── io_types.hpp
│   │   ├── io_scaling.hpp
│   │   ├── io_scaling.cpp
│   │   ├── io_cache.hpp
│   │   └── io_cache.cpp
│   ├── bridge/
│   │   ├── core_bridge.hpp
│   │   ├── core_bridge.cpp
│   │   ├── output_command.hpp
│   │   └── output_command.cpp
│   ├── diagnostics/
│   │   ├── iobus_metrics.hpp
│   │   ├── iobus_metrics.cpp
│   │   ├── alarm_publisher.hpp
│   │   └── alarm_publisher.cpp
│   ├── platform/
│   │   ├── systemd_notify.hpp
│   │   ├── systemd_notify.cpp
│   │   ├── realtime.hpp
│   │   └── realtime.cpp
│   └── tests/
│       ├── test_iop_crc.cpp
│       ├── test_iop_frame.cpp
│       ├── test_iop_parser.cpp
│       ├── test_io_scaling.cpp
│       ├── test_output_command.cpp
│       └── test_iop_client_fake_mcu.cpp
├── core/
│   ├── CMakeLists.txt
│   ├── README.md
│   ├── main.cpp
│   ├── scan_loop.hpp
│   ├── scan_loop.cpp
│   ├── point_table.hpp
│   ├── point_table.cpp
│   ├── point_quality.hpp
│   ├── point_quality.cpp
│   ├── graph_runtime.hpp
│   ├── graph_runtime.cpp
│   ├── priority_resolver.hpp
│   ├── priority_resolver.cpp
│   ├── safe_state.hpp
│   ├── safe_state.cpp
│   ├── iobus_reader.hpp
│   ├── iobus_reader.cpp
│   ├── output_writer.hpp
│   ├── output_writer.cpp
│   ├── bacnet_objtable.hpp
│   ├── bacnet_objtable.cpp
│   ├── web_ipc.hpp
│   ├── web_ipc.cpp
│   ├── core_metrics.hpp
│   ├── core_metrics.cpp
│   └── tests/
│       ├── test_iobus_reader.cpp
│       ├── test_point_quality.cpp
│       ├── test_priority_resolver.cpp
│       ├── test_safe_state.cpp
│       └── test_scan_loop.cpp
└── CMakeLists.txt

tools/
├── fake_mcu/
│   ├── CMakeLists.txt
│   ├── fake_mcu.cpp
│   └── scenarios/
└── shm_dump_io/
    ├── CMakeLists.txt
    └── shm_dump_io.c

packaging/                      # S7 (2026-06-12) — unit files THẬT, không chép tay từ docs
├── install.sh
└── systemd/
    ├── mkddc-iobus.service     # nội dung chốt: 06 §10
    └── mkddc-core.service      # nội dung chốt: 07 §9 (+ ExecReload SIGHUP)
```

Rule:
- Phase đầu có thể dùng stub file rỗng + compile pass
- nhưng **tên file và thư mục phải chốt đúng từ đầu**
- không đổi tên tùy hứng sau khi task đã tách người làm

---

## 5. Trạng thái hiện tại của repo

Tại thời điểm `2026-06-11`, repo docs đã có plan rất sâu nhưng **cây source thật chưa tồn tại**.

Điều này kéo theo:
- phải làm **P0 scaffold thật** trước
- không được nhảy thẳng vào business logic
- mọi plan dưới đây giả định Dev 2 đang bắt đầu từ cây thư mục gần như trống

---

## 6. Bản đồ phase riêng cho SOM

```text
S0 Contract Lock
 -> S1 Skeleton Repo Layout
 -> S2 iobus Protocol Layer
 -> S3 iobus Service Layer
 -> S4 core Runtime Layer
 -> S5 Dev Tools Layer
 -> S6 No-Board Round-Trip Gate
```

Map sang phase tổng:
- `S0-S1` ~= `P0`
- `S2` ~= phần SOM của `P2`
- `S3` ~= `P3`
- `S4` ~= `P4`
- `S5-S6` ~= glue/no-board gate giữa `P2-P4`

---

## 7. Phase chi tiết

## S0 — Contract Lock

**Mục tiêu:** Dev 2 hiểu đúng ranh giới trước khi tạo file.

### Input
- `shared/iop_protocol.h`
- `shared/mkddc_shm.h`
- docs `05`, `06`, `07`, `15`, `16`, `20`

### Output
- checklist đọc xong 6 file nguồn-chuẩn
- list module sẽ tạo
- không còn tranh cãi về UART/SHM ownership

### Microtask
1. Đọc `iop_protocol.h`, ghi ra note local: frame, CRC, command, timeout, FAULT bit, reset reason.
2. Đọc `mkddc_shm.h`, ghi ra ownership: iobus writer gì, core writer gì.
3. Đọc `06`, chốt tree `services/iobus/`.
4. Đọc `07`, chốt tree `services/core/`.
5. Đọc `20`, chốt test no-board dùng `socat + PTY`.
6. Đọc `16`, chốt thứ tự bring-up dev.

### Gate qua phase
- trả lời đúng 5 câu:
  - ai mở UART?
  - ai tạo `mkddc_io_shm`?
  - ai ghi `ao_setpoint[]`?
  - fake MCU đi qua gì?
  - core có được mở serial không?

---

## S1 — Skeleton Repo Layout

**Mục tiêu:** tạo toàn bộ cây source SOM và build rỗng được.

### Input
- tree mục tiêu ở §4
- CMake mẫu từ `06 §10` và `07 §9`

### Output
- thư mục `services/` tồn tại
- `services/iobus` build ra binary
- `services/core` build ra binary
- `tools/fake_mcu` và `tools/shm_dump_io` có target build

### Task

#### `SOM-SKEL-001` — Root layout
File:
- `services/CMakeLists.txt`
- `services/iobus/...`
- `services/core/...`
- `tools/fake_mcu/...`
- `tools/shm_dump_io/...`

Microtask:
1. Tạo thư mục đúng cây.
2. Tạo `README.md` ngắn cho `iobus`, `core`.
3. Tạo `main.cpp` stub cho `iobus` và `core`.
4. Tạo tất cả header/source stub theo đúng tên file.
5. Tạo test file stub.

Done khi:
- không thiếu file nào trong cây chuẩn
- `rg --files services tools` ra đúng khung chính

#### `SOM-SKEL-002` — Build system
Input:
- danh sách file từ `06`/`07`

Output:
- `cmake -S services -B build/services`
- `cmake --build build/services -j`

Microtask:
1. Viết root `services/CMakeLists.txt`.
2. Viết `services/iobus/CMakeLists.txt`.
3. Viết `services/core/CMakeLists.txt`.
4. Gắn include path `shared/`.
5. Tạo test target stub.
6. Tạo executable `fake_mcu`, `shm_dump_io`.

Done khi:
- build pass từ repo clone sạch

#### `SOM-SKEL-003` — Runtime stub
Output:
- `mkddc-iobus` chạy log boot rồi exit 0 hoặc sleep loop
- `mkddc-core` chạy log boot, `sd_notify` stub hoặc no-op

Microtask:
1. `iobus/main.cpp` parse CLI tối thiểu `--uart`, `--log-level`.
2. `core/main.cpp` parse `--log-level`.
3. Hook signal `SIGINT/SIGTERM`.
4. Loop ngủ 1s + log heartbeat nhẹ.

Done khi:
- binary chạy được, không crash tức thì

### Gate qua phase
- build pass
- chạy được 4 target: `mkddc-iobus`, `mkddc-core`, `fake_mcu`, `shm_dump_io`

---

## S2 — iobus Protocol Layer

**Mục tiêu:** hoàn tất lớp thuần protocol của `mkddc-iobus`.

### Input
- `shared/iop_protocol.h`
- `05_IOP_UART_IMPLEMENTATION_GUIDE.md`

### Output
- `iop_crc`, `iop_frame`, `iop_parser`, `iop_port`, `iop_client`
- unit test protocol pass

### Task

#### `SOM-IOP-001` — `iop_crc`
File:
- `services/iobus/iop/iop_crc.hpp`
- `services/iobus/iop/iop_crc.cpp`
- `services/iobus/tests/test_iop_crc.cpp`

Input:
- `iop_crc16()` từ header shared

Output:
- wrapper `crc16()` dùng chung
- test 12 vector chuẩn

Microtask:
1. Tạo API `uint16_t crc16(const uint8_t*, size_t)`.
2. Gọi thẳng `iop_crc16`, không tự viết thuật toán khác.
3. Thêm 12 vector test.
4. Assert 2 vector đầu `0x6C20`, `0xACE1`.

Done khi:
- `ctest` pass phần CRC

#### `SOM-IOP-002` — `iop_frame`
Output:
- build frame
- parse stream nhiều chunk

Microtask:
1. Định nghĩa `ParsedFrame`, `ParseError`, `ParseResult`.
2. Viết `build()` theo `SOF|LEN|CMD|SEQ|PAYLOAD|CRC`.
3. Viết `feed()` kiểu stateful/ring buffer.
4. Handle `SOF` sai, `LEN` quá max, `CRC` sai.
5. Thêm round-trip test.

Done khi:
- frame `GET_IO SEQ=1` ra `AA 00 01 01 AC E1`

#### `SOM-IOP-003` — `iop_parser`
Output:
- parse `IO_RESP`
- parse `DIAG_RESP`

Microtask:
1. Tạo `IopIoResp`, `IopDiagResp` trong `io_types.hpp`.
2. Parse BE field đúng offset.
3. Dùng `iop_be32s()` cho 16 raw UI signed.
4. Test đủ `ui_raw[16]`, `adc1_stat`, `adc2_stat`, `fault_flags`, `sample_cnt`, `do_fb_mask`; no base DI_MASK.

Done khi:
- byte offset khớp đúng docs/header

#### `SOM-IOP-004` — `iop_port`
Output:
- mở UART/PTTY raw 921600 8N1

Microtask:
1. `open()` với `O_RDWR|O_NOCTTY|O_NONBLOCK`.
2. `cfmakeraw`, set baud, tắt flow control.
3. `flush()`.
4. retry `EINTR`, handle `EAGAIN`.
5. test với PTY loopback.

Done khi:
- mở được `/dev/pts/*` và đọc/ghi ổn định

#### `SOM-IOP-005` — `iop_client`
Output:
- handshake
- request/response
- timeout/retry/fault

Microtask:
1. Tạo state machine `INIT/HANDSHAKE/NORMAL/FAULT/RECONNECT`.
2. Tạo counter `seq_`, `retry_`, `last_io_resp_ts`.
3. Implement `handshake()`, `get_io()`, `set_do()`, `set_ao()`, `set_ao_cfg()`, `get_diag()`, `reset_io()`.
4. Verify `SEQ echo`.
5. Timeout `10ms`, retry `<=3`, reconnect `5s`.
6. Test qua fake transport hoặc PTY harness.

Done khi:
- fake flow handshake + poll pass

### Gate qua phase
- unit test protocol xanh
- chạy được với fake MCU mức `handshake + GET_IO`

---

## S3 — iobus Service Layer

**Mục tiêu:** biến protocol lib thành service `mkddc-iobus` hoàn chỉnh.

### Input
- lớp protocol từ `S2`
- `mkddc_shm.h`
- `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md`

### Output
- `mkddc-iobus` poll 2ms/500Hz
- ghi `kx_io_shm`
- đọc output từ shm và gửi ngược xuống MCU/fake MCU

### Task

#### `SOM-IOB-001` — config + types
File:
- `config/iobus_config.*`
- `io/io_types.hpp`

Output:
- config struct default
- type chung nội bộ

Microtask:
1. Chốt field config tối thiểu: uart path, baud, sensor_type[], ao_mode[], log-level.
2. Parse JSON hoặc stub defaults.
3. Validate giá trị bắt buộc.

#### `SOM-IOB-002` — `io_scaling`
Output:
- raw UI -> engineering
- eng AO -> raw

Microtask:
1. Implement `0-10V`, `4-20mA`, `dry-contact` trước.
2. Add `PT100/PT1000/NTC` skeleton nếu chưa calib thật.
3. Map `quality` theo overrange/open-loop.
4. Thêm test clamp AO.

Done khi:
- test case trong `06 §3.6` pass

#### `SOM-IOB-003` — `io_cache`
Output:
- create/attach `KX_SHM_IO_PATH`
- seqlock write snapshot

Microtask:
1. `shm_open` + `ftruncate` + `mmap`.
2. Init defaults toàn struct.
3. Set `magic` cuối cùng.
4. Implement `write_io()` với `KX_WRITE_BEGIN/END`.
5. Fill `ts_ns`, `iop_status`, metrics.

Done khi:
- reader thấy snapshot nhất quán

#### `SOM-IOB-004` — `core_bridge` + `output_command`
Output:
- đọc `ao_setpoint[]`, `do_cmd[]`
- chỉ gửi `SET_*` khi giá trị đổi

Microtask:
1. Read-only access đúng ownership.
2. So với `last_sent_*`.
3. Pack `SET_DO` mask/value.
4. Convert eng AO -> raw theo `ao_mode`.
5. Handle `ACK/NACK`.

Done khi:
- ghi `do_cmd[0]=1` làm fake MCU phản hồi `DO_FB`

#### `SOM-IOB-005` — metrics + alarm
Output:
- tăng counter `iop_rx`, `crc_err`, `timeout`, `seq_err`
- publish alarm JSON lines

Microtask:
1. Struct metrics.
2. Hook tăng counter ở nơi đúng.
3. Unix socket `/run/mkddc/alarm.sock` non-blocking.
4. Rate-limit log lỗi.

#### `SOM-IOB-006` — runtime main loop
Output:
- service thực chạy 2ms/500Hz

Microtask:
1. init realtime + mlockall.
2. load config.
3. attach shm.
4. open UART.
5. handshake.
6. poll loop: GET_IO -> parse -> scale -> write shm -> read outputs -> maybe send SET_*.
7. watchdog notify.
8. signal shutdown.

Done khi:
- `mkddc-iobus` chạy 10 phút với fake MCU không crash

### Gate qua phase
- `shm_dump_io` đọc được dữ liệu sống
- round-trip `do_cmd -> SET_DO -> DO_FB` pass

---

## S4 — core Runtime Layer

**Mục tiêu:** `mkddc-core` đọc SHM, resolve output, ghi ngược output fields.

### Input
- `mkddc_shm.h`
- `07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md`

### Output
- point table
- scan loop 1s
- priority resolver
- safe-state
- output writer

### Task

#### `SOM-COR-001` — `iobus_reader`
Output:
- seqlock read snapshot nhất quán

Microtask:
1. attach `KX_SHM_IO_PATH` không `O_CREAT`.
2. check `magic`.
3. retry seqlock read tối đa 5 lần.
4. fallback snapshot cũ + metric nếu fail.

#### `SOM-COR-002` — `point_table`
Output:
- đủ 24 IO + virtual point

Microtask:
1. define `Point`, `PointId`, `PointSource`.
2. map AI/BI/AO/BO.
3. update inputs từ snapshot.
4. set/get virtual point.

#### `SOM-COR-003` — `point_quality`
Output:
- GOOD/UNCERTAIN/BAD đúng rule

Microtask:
1. map `iop_status`.
2. map `fault_flags`.
3. stale `ts_ns` theo số scan.
4. test từng case.

#### `SOM-COR-004` — `priority_resolver`
Output:
- 6 mức priority hoạt động

Microtask:
1. define storage per channel per level.
2. implement `set`, `release`, `resolve` cho AO/DO.
3. conflict cùng mức -> log warn.
4. default fallback.

#### `SOM-COR-005` — `safe_state`
Output:
- fault/stale -> output safe

Microtask:
1. trigger on FAULT/SAFE. — ĐÃ làm 2026-06-11 (T1/T2 theo 07 §5.2)
2. trigger on stale > threshold. — ĐÃ làm 2026-06-11 (T3, >3 scan)
3. write safe AO/DO vào `OutputCmd`. — ĐÃ làm 2026-06-11 (AO 0V/4mA theo ao_mode, DO open)
4. clear override khi recover. — ĐÃ làm 2026-06-11 (trả quyền resolver ≤1 scan, không hysteresis)
5. trigger T6/T7 graph-based theo 07 §5.2 — ĐÃ làm 2026-06-12 (graph_runtime
   implemented + test trong `test_safe_state.cpp`; task COR-006 trong
   [11_TASK_CHECKLIST.md](11_TASK_CHECKLIST.md)).

#### `SOM-COR-006` — `output_writer`
Output:
- atomic write `ao_setpoint[]`, `do_cmd[]`

Microtask:
1. only core writes 2 field này.
2. write only on change.
3. use atomic store/aligned write.
4. keep eng unit, không convert raw.

#### `SOM-COR-007` — `scan_loop` + `core_metrics`
Output:
- loop 1s tuyệt đối thời gian

Microtask:
1. `clock_nanosleep(...ABSTIME...)`.
2. call steps đúng thứ tự.
3. count scan, overrun, exec time.
4. `sd_notify READY=1` sau scan đầu.

#### `SOM-COR-008` — `web_ipc`, `graph_runtime`, `bacnet_objtable` stub
Output:
- compile-ready boundary, chưa cần business logic đầy đủ

Microtask:
1. `web_ipc` mở `/run/mkddc/core.sock`, nhận queue stub.
2. `graph_runtime` no-op stub.
3. `bacnet_objtable` no-op hoặc minimal publish stub.

### Gate qua phase
- `mkddc-core` đọc snapshot từ iobus
- `mkddc-core` ghi `do_cmd` làm iobus gửi `SET_DO`
- no bypass serial trong core

---

## S5 — Dev Tools Layer

**Mục tiêu:** có tool để dev/test không cần board.

### Input
- [21_VIRTUAL_COM_DECISION.md](21_VIRTUAL_COM_DECISION.md)
- fake MCU contract trong `06 §11`

### Output
- `fake_mcu`
- `shm_dump_io`

### Task

#### `SOM-TOOL-001` — `fake_mcu`
Output:
- nhận `HANDSHAKE`, `GET_IO`, `SET_DO`, `SET_AO`, `GET_DIAG`, `RESET_IO`

Microtask:
1. parse CLI `--pty` hoặc `--uart`.
2. emulate slave IOP.
3. maintain fake IO state.
4. inject options: timeout, crc-error, seq-wrong, nack, stuck-relay.
5. print useful logs.

#### `SOM-TOOL-002` — `shm_dump_io`
Output:
- dump `kx_io_shm` text/json

Microtask:
1. attach read-only.
2. read via seqlock.
3. print magic/seq/age/ui/di/ao/do/fault/metrics.
4. support `--watch`, `--json`.

### Gate qua phase
- dev có thể debug không cần `xxd`

---

## S6 — No-Board Round-Trip Gate

**Mục tiêu:** xác nhận cây source SOM đủ sống trước khi đụng board thật.

### Input
- `socat + PTY`
- `fake_mcu`
- `mkddc-iobus`
- `mkddc-core`

### Output
- pass flow `handshake -> poll -> shm write -> core read -> do_cmd write -> SET_DO -> DO_FB`

### Checklist
1. Build tất cả target.
2. Chạy `socat` tạo 2 PTY cố định.
3. Chạy `fake_mcu` ở đầu B.
4. Chạy `mkddc-iobus` ở đầu A.
5. Chạy `shm_dump_io --watch` thấy `seq` đổi.
6. Chạy `mkddc-core`.
7. Inject lệnh manual/stub để `do_cmd[0]=1`.
8. Xác nhận fake MCU nhận `SET_DO` và phản hồi `DO_FB`.
9. Inject timeout/CRC/SEQ lỗi.
10. Xác nhận metrics + alarm + safe-state.

### Gate cuối
- pass 10 bước trong `06 §11.1`

---

## S7 — Production Hardening sau round-trip (Rev A.x)

**Mục tiêu:** đóng 6 khoảng trống còn lại sau S6 để SOM stack đủ production-grade.
Thứ tự ưu tiên chốt 2026-06-12 (cụm 1+2+3 mở khóa Dev 3 web + board bring-up).

| # | Việc | Task | Nặng | Trạng thái |
|---|------|------|------|------------|
| 1 | `web_ipc` overridden + audit log (07 §8 đủ contract) | COR-007 | nhỏ | ✅ ĐÃ làm 2026-06-12 |
| 2 | SIGHUP reload config không restart (CONFIG_SCHEMA D-5) | COR-008 | nhỏ | ✅ ĐÃ làm 2026-06-12 |
| 3 | `packaging/systemd/*.service` + install script | SKEL-005 | rất nhỏ | ✅ ĐÃ làm 2026-06-12 |
| 4 | Graph component thiếu: 10 type còn lại (OnDelay/OffDelay, Interlock, ManualAuto, RuntimeCounter/PulseCounter, SafeState, AlarmHigh/Low/Delay) + persist state qua reboot | COR-009/010 — [23_GRAPH_STATEFUL_COMPONENTS_PLAN](23_GRAPH_STATEFUL_COMPONENTS_PLAN.md) | vừa | ✅ ĐÃ làm 2026-06-13 — 97/97 test pass |
| 5 | BACnet/IP full: object registry, priority[16], relinquish_default, reliability, COV/alarm, BTL pretest | BAC-001..011 — [25_BACNET_IMPLEMENTATION_PLAN](25_BACNET_IMPLEMENTATION_PLAN.md) | lớn | ✅ **DOC GAP CLOSED 2026-06-17** — sẵn sàng implement (BAC-CONFLICT-001 resolved, bind_interface added, Vendor_Identifier=9999) |
| 6 | Modbus RTU master trong iobus: fieldbus.conf (rs485.device bắt buộc), profile parser, poll scheduler, ext cache (kx_ext_snapshot_msg_t → mkddc_shm.h), write queue | MOD-001..011 — [26_MODBUS_IMPLEMENTATION_PLAN](26_MODBUS_IMPLEMENTATION_PLAN.md) | vừa-lớn | ✅ **DOC GAP CLOSED 2026-06-17** — sẵn sàng implement (kx_ext_snapshot struct resolved, device path resolved) |

Ràng buộc giữ nguyên:
- Modbus/BACnet nằm trong `iobus`, KHÔNG phá rule "core quyết output" —
  BACnet write đi qua `core.sock` source=bacnet (mức 3, 07 §8 Rev 1.6), không ghi thẳng IO.
- Mapping 6 mức priority nội bộ ↔ 16 mức BACnet đã chốt trong [24 §4b](25_BACNET_IMPLEMENTATION_PLAN.md):
  BACnet priority array resolve riêng trong iobus, winner gửi vào core.sock source=bacnet mức 3.

## S8 — Coherent historian runtime snapshot (ADR-018, COR-HIST-001)

**Mục tiêu:** mở một read-only IPC operation để `mkddc-web` lấy state UI/AO/DO nhất quán từ cùng scan; core không sở hữu historian DB.

**Files:**

- modify `services/core/web_ipc.hpp/.cpp`;
- modify `services/core/scan_loop.hpp/.cpp`;
- modify `services/core/point_table.hpp/.cpp`;
- modify `services/core/tests/test_web_ipc.cpp`;
- create `services/core/tests/test_runtime_point_snapshot.cpp`;
- modify `services/core/CMakeLists.txt`.

**Microtasks:**

1. RED: request `{"op":"point_snapshot"}` currently rejected; add JSON/size/escaping tests.
2. RED: one-scan fixture for UI-01..16 engineering value, AO-01..04 post-safe resolved setpoint and DO-01..04 hardware feedback.
3. GREEN: freeze immutable point enumeration after resolve + safe-state, before scan publication completes.
4. Serialize one `snapshotId`, `snapshotObservedAtUtc` and each point `id/kind/value/quality/source/role/unit/updatedAtMonotonicNs/generation`.
5. Keep optional DI kind/capability intact but exclude it from this owner-approved DB policy scope.
6. No metadata/tag/name lookup and no backend VP inside core; web unions VP runtime registry after response.
7. Bound response/request handling; snapshot read must not block scan or mutate priority/output.
8. Run focused C++ tests, then full core CTest.

**Done evidence:** strict read-only 24-row snapshot contract passes after resolve/safe-state; physical output write precedes allocation-free fixed-buffer publication; DI deferred pending capability authority; uppercase quality and actual source semantics; generation=1 Rev A; bounded cached IPC with 4-client/fair per-client quotas. Clean WSL/Ninja Release ON CTest passes 209/209, focused snapshot/IPC/scan 64/64, clean production OFF build passes, and synthetic worst-width stress fixture is 6,427 bytes including newline under the 64 KiB cap. No `shared/mkddc_shm.h`, SQLite, backend or FE change.

Trạng thái: **DONE 2026-07-17 cho S8/COR-HIST-001 code/local gates**. Host timing is evidence only; no board-jitter claim. Downstream WEB-HIST-001..005 code-local slices are Done; v2 Trends authority remains feature-gated until activation/cutover, and E2E-HIST-001 target board/eMMC/recovery gates remain open. Plan 42 remains the historian source plan and is not a release-Done claim.

---

## 8. Thứ tự làm thật ngoài đời

Không được làm lung tung. Thứ tự đúng:

1. `S0` khóa contract
2. `S1` tạo cây source + build
3. `S2` hoàn tất protocol layer
4. `S5` dựng `fake_mcu` tối thiểu để test `S2`
5. `S3` hoàn tất iobus service
6. `S5` hoàn tất `shm_dump_io`
7. `S4` hoàn tất core runtime tối thiểu
8. `S6` chạy round-trip no-board
9. `S8` thêm coherent historian snapshot bằng TDD, không đổi SHM
10. mới được nối web historian/qua board thật

Rule:
- không viết core trước khi iobus có SHM sống
- không viết web path trước khi core có IPC boundary
- không test board thật khi no-board path còn đỏ

---

## 9. Bảng input / output / dependency theo module

| Module | Input | Output | Phụ thuộc trực tiếp |
|--------|-------|--------|---------------------|
| `iop_crc` | byte buffer | `uint16_t crc` | `shared/iop_protocol.h` |
| `iop_frame` | cmd/seq/payload, stream bytes | frame bytes, parsed frame | `iop_crc` |
| `iop_parser` | payload `IO_RESP`/`DIAG_RESP` | struct response | `io_types`, `shared/iop_protocol.h` |
| `iop_port` | UART/PTTY path | read/write bytes | POSIX termios |
| `iop_client` | parsed frame + timer tick | handshake/poll/set/reset | `iop_frame`, `iop_port`, `iop_parser` |
| `io_scaling` | raw UI / eng AO | eng UI / raw AO | `io_types` |
| `io_cache` | `IoSnapshot` | `kx_io_shm` live data | `shared/mkddc_shm.h` |
| `core_bridge` | SHM output fields | AO/DO command view | `mkddc_shm.h` |
| `output_command` | AO/DO command view | `SET_DO`, `SET_AO` | `core_bridge`, `iop_client`, `io_scaling` |
| `iobus_reader` | `kx_io_shm` | core snapshot | `mkddc_shm.h` |
| `point_table` | IO snapshot | points state | `iobus_reader` |
| `priority_resolver` | command sources | final output command | `point_table` |
| `safe_state` | io status/fault/stale | overridden output command | `priority_resolver` |
| `output_writer` | final output command | `ao_setpoint[]`, `do_cmd[]` | `mkddc_shm.h` |
| `fake_mcu` | UART/PTTY bytes | fake slave behavior | `shared/iop_protocol.h` |
| `shm_dump_io` | `kx_io_shm` | text/json dump | `mkddc_shm.h` |
| `point_snapshot` IPC | post-resolve point table from one scan | immutable UI/AO/DO historian source DTO | `web_ipc`, `scan_loop`, `point_table`; no DB dependency |

---

## 10. Checklist review trước khi merge từng task

Mỗi task SOM chỉ merge khi qua đủ checklist này:

1. File đặt đúng thư mục chuẩn ở §4.
2. Không tự ý đổi contract `shared/*`.
3. Có test hoặc tool check đi kèm.
4. Không bypass ownership của SHM.
5. `iobus` mới là process duy nhất mở UART.
6. `core` không mở serial.
7. `web` path chỉ là boundary/stub nếu chưa làm tới phase đó.
8. Log đủ để debug nhưng không spam 500Hz.
9. Failure path có xử lý, không silent fail.
10. Có command chứng minh output đo được hoặc assert được.

---

## 11. Câu trả lời trực tiếp cho câu hỏi của mày

**Đã có chưa?**

- `plan`: **có**
- `phase`: **có**
- `task`: **có**
- `microtask`: **có rải rác trong 06/07 nhưng chưa gom riêng cho SOM src**
- `checklist`: **có**
- `input/output`: **có, nhưng nằm rải ở 06/07/10/11/12**

**Thiếu gì?**

- thiếu 1 execution plan cực chi tiết chỉ cho Dev 2 từ cây source trống tới round-trip no-board

**File này chính là bản đó.**

---

## 12. Hành động ngay sau file này

Ngay sau khi chốt plan này, Dev 2 nên làm đúng 3 việc đầu tiên:

1. tạo `services/`, `tools/` theo đúng cây §4
2. dựng `CMakeLists.txt` để build 4 target stub
3. ưu tiên `iop_crc -> iop_frame -> iop_parser -> fake_mcu tối thiểu`

Không làm bước 4 trước khi 3 bước này xanh.

---

**Rev** 1.12 | 2026-07-20 — Reconciled downstream WEB-HIST-001..005 code-local completion and retained feature-gated v2 authority, activation/cutover, target and E2E gates as open. · **Rev** 1.11 | 2026-07-20 — Reconciled downstream WEB-HIST-001..004 code-local completion and retained WEB-HIST-005, activation/cutover, target and E2E gates as open. · **Rev** 1.10 | 2026-07-20 — Reconciled downstream WEB-HIST-001/002/003 code-local completion and retained WEB-HIST-004/005, activation/cutover, target and E2E gates as open. · **Rev** 1.9 | 2026-07-17 — Closed S8/COR-HIST-001 code/local evidence; retained historian target E2E gates. · **Rev** 1.8 | 2026-07-15 — Added owner-approved S8/COR-HIST-001 coherent read-only runtime snapshot microtasks, tests, boundaries and build order; product code remains PLANNED. · **Rev** 1.7 | 2026-06-19 (TD-001..003 / ACT-014..016 ĐÃ làm: thay JSON parser, fix SHM race, phân biệt EAGAIN write) ·
1.6 | 2026-06-17 (S7 #5/#6: doc gap CLOSED — BAC-CONFLICT-001/bind_interface/Vendor_Identifier/kx_ext_snapshot/rs485.device; cập nhật ràng buộc BACnet IPC path) ·
1.5 | 2026-06-13 (S7 #4 ĐÃ làm: COR-009/010 done, 97/97 pass) · 1.4 | 2026-06-13 · 1.3 | 2026-06-12 · 1.2 | 2026-06-12 · 1.1 | 2026-06-12 · 1.0 | 2026-06-11
