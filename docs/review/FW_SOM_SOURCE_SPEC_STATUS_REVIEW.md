# FW SOM — Source, SPEC và Implementation Status Review

> **Document ID:** REV-FWSOM-STATUS-MK-DDC-24-VI
> **Phiên bản:** 2.0 | 2026-07-28
> **Người thực hiện:** PM kỹ thuật (review độc lập)
> **Phạm vi:** `services/core`, `services/iobus`, `shared/`, `packaging/systemd` + toàn bộ tài liệu SPEC/design/ADR/plan liên quan FW SOM
> **Commit review:** `5c39c61` trên nhánh `feat/fw-som-typed-ir`
> **Kết luận tổng thể:** `FW_SOM_HANDOFF_CONDITIONAL` — xem §18
>
> **Trạng thái tách riêng theo từng phạm vi** (không gộp thành một con số chung):
>
> | Phạm vi | Rev 1.1 (sáng 2026-07-28) | **Rev 2.0 (hiện tại)** |
> |---|---|---|
> | `EXISTING_FW_SOM_BASELINE` | STABLE | **STABLE** |
> | `FW_SOM_ST_HOST_SLICE` | COMPLETED | **COMPLETED** |
> | `PRODUCTION_ST_INTEGRATION` | BLOCKED | **IMPLEMENTED — chờ verification target** |
> | `C1_PLUS_OPENING` | BLOCKED | **UNBLOCKED một phần** (C0.4/C0.6/C0.7 Done) |
> | `BE_HANDOFF_CONTRACT` | — | **COMPLETE** |
> | `TARGET_VERIFICATION` | — | **BLOCKED** (RT trên kernel) |

---

## 0. Rev 2.0 khác Rev 1.1 ở đâu

Rev 1.1 viết vào **buổi sáng** 2026-07-28, khi FW SOM còn 3 blocker cứng và
không có Typed IR. Rev 2.0 viết **cuối cùng ngày đó**, sau khi ACTION 1–15 của
`Yeucau.md` được thực hiện. Toàn bộ finding của Rev 1.1 đã được xử lý.

| Finding Rev 1.1 | Trạng thái Rev 2.0 |
|---|---|
| `F-01` parser segfault | ✅ **ĐÓNG** — giới hạn tài nguyên + 27 test đối kháng |
| `F-02` runtime chạy AST từ source | ✅ **ĐÓNG** — Typed IR + tách thư viện link-time |
| `F-03` allocation trong scan path | ✅ **ĐÓNG** — 1000 chu kỳ, `operator new` = 0 |
| `F-04` overrun không ép safe | ✅ **ĐÓNG** — `OverrunMonitor` trong `safety/` |
| `F-05` không có multi-task scheduler | ✅ **ĐÓNG** — `StScheduler`, 30 test |
| `F-06` không có RETAIN | ✅ **ĐÓNG** — CRC + atomic write, 12 test |
| `F-07` không có integrity/signature | ✅ **ĐÓNG** — SHA-256 + Ed25519 |
| `F-08`/`F-09`/`F-10` tài liệu lỗi thời | ✅ **ĐÓNG** |
| `F-11` 15/15 C0 chưa bắt đầu | 🟡 **một phần** — C0.4/C0.6/C0.7 Done, còn 12 |
| `F-12` biên watchdog mỏng | ✅ **ĐÓNG** — `WatchdogSec` theo công thức + test target |
| `B-07` không có evidence đối kháng | 🟡 **một phần** — có test đối kháng, chưa có ASan/fuzz/soak |

**Finding mới của Rev 2.0:** `F-13` — target đang chạy **không có real-time**
(§10). Đây là phát hiện quan trọng nhất của bản này.

---

## 1. Executive Summary

FW SOM hiện là **hai process C++17** trên SOM Linux: `mkddc-iobus` (IOP/UART
tới STM32, Modbus, BACnet) và `mkddc-core` (point table, arbitration, graph
runtime, **Program Runtime ST**, safe-state, alarm, schedule, IPC). Cộng hai
binary CLI: `mkddc-st-validate` và `mkddc-st-compile`.

### 1.1 Trạng thái tách theo phạm vi

| Cờ | Giá trị | Nghĩa vận hành |
|---|---|---|
| `EXISTING_FW_SOM_BASELINE` | **STABLE** | Baseline cũ không bị ảnh hưởng: `st_sched = nullptr` thì scan loop chạy y như trước |
| `FW_SOM_ST_HOST_SLICE` | **COMPLETED** | Lát cắt `FW-SOM-ST-001` đã giao xong từ trước |
| `PRODUCTION_ST_INTEGRATION` | **IMPLEMENTED** | ST đã chạy trong `ScanLoop` thật, qua trọng tài ưu tiên và safe-state. Code + test host đầy đủ; **chờ verification trên target đúng cấu hình** |
| `C1_PLUS_OPENING` | **UNBLOCKED một phần** | C0.4/C0.6/C0.7 Done nên C1+ có SPEC để dựa vào; 12 workstream C0 còn lại chưa xong |
| `BE_HANDOFF_CONTRACT` | **COMPLETE** | 9 action, JSON schema, 7 tài liệu, tool, sample, script 18/18 |
| `TARGET_VERIFICATION` | **BLOCKED** | RT không hoạt động trên kernel hiện tại (`F-13`) |

### 1.2 Số đo thật (build sạch từ đầu, 2026-07-28)

| Hạng mục | Kết quả |
|---|---|
| Configure + build `-Wall -Wextra -Werror`, BACNET=ON, MODBUS=ON | **exit 0, 0 lỗi** |
| `ctest` (host x86_64) | **649/649 PASS, 0 FAIL, 0 SKIP** |
| **Build native aarch64 trên Orange Pi 5B** | **exit 0, 0 lỗi** |
| **`ctest` trên aarch64** | **646/646 PASS** |
| **Deploy lên board + vận hành 3 phút** | **ổn định, 0 restart, jitter max 250–294 µs, 0 overrun** |
| **Artifact tất định giữa x86_64 và aarch64** | **giống hệt từng byte** |
| Test thuộc lớp ST | **220** |
| `cppcheck` trên `services/core/st/*.cpp` | **0 lỗi** |
| Symbol compiler trong `mkddc-core` | **0** |
| Script integration BE | **18/18 pass** |
| Thư viện transport | `libmodbus 3.1.10`, `bacnet-stack` rev 19, `BACDL_BIP=ON` |

Rev 1.1 đo 477 test. Rev 2.0 đo **649** — tăng 172, gần như toàn bộ là test
của Program Runtime và test đối kháng.

### 1.3 Một finding chặn

**`F-13`:** `mkddc-core` trên target chạy `SCHED_OTHER` prio 0 chứ không phải
`SCHED_FIFO 80`. Nguyên nhân gốc đã xác định chắc chắn: `CONFIG_RT_GROUP_SCHED=y`
**cộng** cgroup v2 ⇒ không service systemd nào dùng được RT. Hệ quả: **mọi số
jitter/WCET đo trên target không đại diện cho cấu hình production**.

Đây **không** phải lỗi của FW SOM — nó là cấu hình kernel/BSP. Nhưng nó chặn
việc tuyên bố bàn giao, vì không thể khẳng định biên thời gian thực khi chưa
đo trên cấu hình đúng.

---

## 2. FW SOM Intended Scope

Không đổi so với Rev 1.1. Theo `ADR-020` và `PROGRAM_SOM_FW_DRAFT_DESIGN` §4.1:

**Thuộc FW SOM:** active package, task execution, retain state, output
arbitration; physical/protocol point value + quality; IOP v2 session; safe-state
và failure behavior; watchdog.

**Ngoài scope:** FE Program IDE, `mkddc-program-service` (backend Go), STM32
firmware, FBD editor, `services/hmi`, `services/netcfg`.

**Mở rộng thực tế của Rev 2.0:** phần "Program Runtime" trước đây chỉ là thiết
kế nay đã có implementation trong `services/core/st/`, và interface bàn giao BE
đã hoàn chỉnh.

---

## 3. Architecture Found in Repository

```text
                    STM32 (fw/ — ngoài scope)
                         │ UART 921600, IOP v2, poll 2 ms
                         ▼
  ┌──────────────────────────────────────────────────┐
  │ mkddc-iobus                                      │
  │  main thread : IOP poll loop                     │
  │  + thread    : fieldbus/Modbus                   │
  │  + thread    : BACnet server                     │
  └──────────────────────────────────────────────────┘
       │ /dev/shm/mkddc_io_shm         │ /run/mkddc/fieldbus.sock
       ▼                                ▼
  ┌──────────────────────────────────────────────────┐
  │ mkddc-core   SINGLE THREAD, scan 500..2000 ms    │
  │                                                  │
  │  1 read shm → 2 point table + quality            │
  │  3 ext snapshot → 4 web/BACnet cmd               │
  │  5 graph execute                                 │
  │  5b ★ ST Program Runtime  ← MỚI (ACTION 10)      │
  │       load inputs → StScheduler::tick()          │
  │       → apply outputs vào PRIO_LOCAL_LOGIC       │
  │  6 priority resolve → 7 safe-state → write       │
  │  8 publish → 9 metrics → 10 kick watchdog        │
  └──────────────────────────────────────────────────┘
       │ /run/mkddc/core.sock (line-JSON)
       ▼  web/backend, HMI broker

  ┌─────────────────────┐   ┌──────────────────────┐
  │ mkddc-st-validate   │   │ mkddc-st-compile     │
  │ kiểm nhanh source   │   │ source → artifact ký │
  └─────────────────────┘   └──────────────────────┘
     (liên kết st_compiler_lib — KHÔNG có trong mkddc-core)
```

### 3.1 Ranh giới compiler/runtime là ràng buộc LINK-TIME

Điểm kiến trúc quan trọng nhất của Rev 2.0:

```cmake
core_lib          : loader, executor, runtime, scheduler, retain, control API
st_compiler_lib   : parser, semantic, compile, serialize   →  phụ thuộc core_lib
mkddc-core        : liên kết core_lib          (KHÔNG có st_compiler_lib)
mkddc-st-compile  : liên kết st_compiler_lib
```

`mkddc-core` **không thể** gọi parser dù có muốn — không phải vì kỷ luật lập
trình mà vì nó không liên kết thư viện đó. Kiểm lại bằng symbol check trong CI.

Trước ACTION 6, `nm mkddc-core` cũng cho 0 symbol — nhưng chỉ do linker loại bỏ
code không dùng, tức là **sẽ hỏng ngay khi wire ST vào ScanLoop**. Tách thư
viện biến may mắn thành bảo đảm.

### 3.2 Đường đi đầu ra ST

```
Program ST → PriorityResolver (PRIO_LOCAL_LOGIC = 5)
                    │  manual(2) / BACnet(3) / schedule(4) cùng tranh
                    ▼
              safe-state override
                    ▼
              OutputWriter → MCU
```

Chương trình ST **không có đường tắt** ra phần cứng. Bất biến này là cấu trúc.

---

## 4. Source Code Inventory

| Nhóm | File nguồn | File test |
|---|---|---|
| `services/core` | **79** | **31** |
| trong đó `services/core/st` | **39** | 10 |
| `services/iobus` | 62 | 20 |
| `shared/` | 6 | — |

Rev 1.1: `services/core` có 57 nguồn + 22 test. Rev 2.0: **79 + 31**.

### 4.1 `services/core/st` — Program Runtime

| Lớp | File | Vai trò |
|---|---|---|
| **Compiler** | `st_parser`, `st_semantic`, `st_compile`, `st_program` | Source → AST → IR. **Chỉ có trong `st_compiler_lib`** |
| **Artifact** | `st_ir`, `st_artifact`, `st_public_key`, `st_test_key` | Định dạng, serialize, ký |
| **Runtime** | `st_loader`, `st_exec`, `st_runtime`, `st_cyclic_runtime` | Verify 22 bước, thực thi, vòng đời |
| **Scheduler** | `st_scheduler`, `st_process_image` | Task/Program, cầu nối process image |
| **Persistence** | `st_retain` | Bản ghi RETAIN |
| **Interface** | `st_control_api`, `st_validate_main`, `st_compile_main` | Hợp đồng BE, 2 CLI |
| **Hỗ trợ** | `st_limits`, `st_diagnostic`, `st_io_map`, `st_trace` | Giới hạn, mã lỗi, binding, trace |

### 4.2 Thành phần mới ngoài `st/`

| File | Vai trò |
|---|---|
| `safety/overrun_monitor.{hpp,cpp}` | Đánh giá sức khoẻ Task, trả `should_force_safe()` |
| `tests/allocation_probe.{hpp,cpp}` | Đếm cấp phát, dùng chung cho mọi test |
| `shared/st_program_control_v1.schema.json` | Schema hợp đồng BE |

---

## 5. Specification Inventory

| Tài liệu | Trạng thái Rev 2.0 |
|---|---|
| `PROGRAM_SOM_FW_DRAFT_DESIGN` v0.6 | Active — vẫn là SPEC chủ đạo |
| `ST_SUBSET_SPEC_MK-DDC-24_VI.md` | **MỚI** — C0.4, EBNF đầy đủ, normative |
| `TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md` | **MỚI** — C0.6, định dạng + 33 opcode + 22 bước load |
| `PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` | **MỚI** — C0.7, fixed-priority non-preemptive |
| `INTERFACES.md` | Cập nhật: Typed IR contract, RT health, giới hạn parser |
| `docs/handoff/` (7 tài liệu) | **MỚI** — hợp đồng bàn giao BE |
| C0 plan | 3/15 workstream Done (C0.4, C0.6, C0.7) |
| `32_DEV_TEAM_NEXT_ACTION.md` | SUPERSEDED |

---

## 6. Spec-to-Code Traceability Matrix

| ID | Chức năng | SPEC | Source code | Test | Trạng thái | Vấn đề |
|----|-----------|------|-------------|------|------------|--------|
| T-01 | Cyclic scan deterministic | Design §7.3 | `graph/scan_loop.cpp` | `ScanLoop` 14 | DONE | — |
| T-02 | Coherent input snapshot | Design §7.3 | `scan_loop.cpp:40-57` | `IobusReader` 7 | DONE | — |
| T-03 | Output staging, commit 1 lần | Design §7.3 | `st_runtime.cpp` shadow copy | `StExec` 20 | DONE | — |
| T-04 | Priority arbitration | Design §8 | `ipc/priority_resolver.cpp` | 8 | DONE | — |
| T-05 | Safe-state đa trigger | Design §10 | `safety/safe_state.cpp` | `SafeState` 10 | DONE | +T8 overrun |
| T-06 | MCU safe timeout 200 ms | Design §10 | `shared/iop_protocol.h:54` | — | OUT_OF_SCOPE | `fw/` |
| T-07 | Atomic activation + rollback | Design §10 | `st_runtime.cpp`, `st_scheduler.cpp` | `StScheduler` 30 | DONE | — |
| T-08 | Activation tại ranh giới cycle | Design §7.3 | `st_scheduler.cpp::tick` | `StScheduler` | DONE | — |
| T-09 | NaN/Inf reject | Design §8 | `st_exec.cpp`, `st_process_image.cpp` | `StExec`, `StIntegration` | DONE | 2 lớp chặn |
| T-10 | ST parser + semantic | C0.4 | `st_parser.cpp`, `st_semantic.cpp` | `StLang` 45, `StLimits` 19 | **DONE** | ~~F-01~~ đóng |
| T-10b | Giới hạn tài nguyên parser | C0.4 §8 | `st_limits.hpp` | `StLimits` 19 | **DONE** | — |
| T-11 | **Typed IR + loader validation** | C0.6 | `st_ir.*`, `st_loader.*` | `StIr` 19 + `StIrSecurity` 5 | **DONE** | ~~F-02~~ đóng |
| T-12 | **Không allocation trong scan** | Design §7.2 | `st_exec.cpp`, `st_runtime.cpp` | `StExec.ThousandCycles…` | **DONE** | ~~F-03~~ đóng |
| T-13 | **Multi-task scheduler** | C0.7 | `st_scheduler.{hpp,cpp}` | `StScheduler` 30 | **DONE** | ~~F-05~~ đóng |
| T-14 | **Overrun → alarm → safe** | Design §10 | `safety/overrun_monitor.*` | `OverrunMonitor` 11+2 | **DONE** | ~~F-04~~ đóng |
| T-15 | **RETAIN + cold/warm start** | Design §7.4 | `st_retain.{hpp,cpp}` | `StRetain` 12 | **DONE** | ~~F-06~~ đóng |
| T-16 | Persistence graph state | 22 plan | `graph/state_snapshot.cpp` | `StateSnapshot` 8 | DONE | — |
| T-17 | io_map binding | C0.10 | `st_io_map.cpp`, `st_process_image.cpp` | `StIoMap` 12 | **PARTIAL** | Chưa có CRUD `io_map.json` (việc BE) |
| T-18 | Validate gateway CLI | INTERFACES | `st_validate_main.cpp` | `StValidateCli` 14 | DONE | — |
| T-18b | **Compile CLI** | HANDOFF | `st_compile_main.cpp` | script BE 18 | **DONE** | — |
| T-19 | Deterministic build | SWR-REQ-IEC-005 | `st_compile.cpp` | `StIr.Deterministic…` | DONE | — |
| T-20 | **Package integrity/signature** | Design §7.2 | `st_ir.cpp`, `st_loader.cpp` | `StIrSecurity` 5 | **DONE** | ~~F-07~~ đóng |
| T-21 | Trace/diagnostic runtime | Design §7.3 | `st_trace.hpp` | `StCyclicRuntime` 10 | PARTIAL | Chưa persist |
| T-22 | IOP v2 contract | Design §9.1 | `shared/iop_protocol.h` | `IopFrame`/`IopParser`… | DONE (host) | Chưa MCU thật |
| T-23 | SHM ABI | INTERFACES | `shared/mkddc_shm.h` | `test_shm_layout`, `BacnetObjTableAbi` 3 | DONE | +RT health |
| T-24 | Web/HMI IPC | Design §4.1 | `ipc/web_ipc.cpp` | `WebIpc` 39 | DONE | — |
| T-25 | FE/BE down → core tiếp tục | Design §10 | Kiến trúc process tách rời | `WebIpc` | DONE | — |
| T-26 | Watchdog + recovery | Design §10 | `main.cpp`, `mkddc-core.service` | Target T1–T4 | **PARTIAL** | `F-13`: chờ RT |
| T-27 | SIGHUP reload | COR-008 | `ipc/config_reload.cpp` | `ConfigReload` | DONE | — |
| T-28 | Modbus/BACnet cache | Design §9.1 | `iobus/fieldbus`, `iobus/bacnet` | nhiều | DONE (host) | — |
| T-29 | **ST chạy trong production ScanLoop** | Design §7.3 | `scan_loop.cpp:5b`, `st_process_image.*` | `StIntegration` 9 | **DONE** | Chờ target |
| T-30 | **Runtime control interface cho BE** | HANDOFF | `st_control_api.{hpp,cpp}` | `StControlApi` 17 | **DONE** | — |
| T-31 | **RT health quan sát được** | INTERFACES | `main.cpp`, `bacnet_objtable.cpp` | `BacnetObjTable` 12 | **DONE** | — |
| T-32 | FBD editor + compiler | Design §5 | — | — | SPEC_ONLY | Ngoài scope |
| T-33 | `mkddc-program-service` (BE Go) | Design §6 | — | — | SPEC_ONLY | Việc của BE |

---

## 7. Interface Status

| Interface | Trạng thái | Bằng chứng |
|---|---|---|
| FW SOM ↔ MCU (IOP v2) | IMPLEMENTED (host + fake MCU) | Hằng số khớp `INTERFACES.md`; chưa có MCU thật |
| iobus ↔ core (io_shm) | IMPLEMENTED | `test_shm_layout` |
| core → BACnet/Web (plc_shm) | IMPLEMENTED | `BacnetObjtable` 12 + `BacnetObjTableAbi` 3 |
| **RT health trong plc_shm** | **IMPLEMENTED** | 4 field nối cuối, không đổi magic |
| core ↔ BE (command, core.sock) | IMPLEMENTED | `WebIpc` 39 |
| **core ↔ BE (Program control)** | **IMPLEMENTED** | `StControlApi` 17, schema JSON |
| **BE → artifact (compile CLI)** | **IMPLEMENTED** | `mkddc-st-compile`, script 18/18 |
| BE → validate CLI | IMPLEMENTED | `StValidateCli` 14 |
| core ↔ config storage | IMPLEMENTED | `ConfigReload` |
| **core ↔ RETAIN storage** | **IMPLEMENTED** | `StRetain` 12 |
| core ↔ systemd watchdog | IMPLEMENTED | Target T1–T4 |
| `io_map.json` CRUD | SPEC_ONLY | Việc của BE (C2) |

**Điểm đổi lớn nhất so với Rev 1.1:** validate CLI trước đây "IMPLEMENTED nhưng
**0 consumer**". Nay đã có hợp đồng đầy đủ, tool sinh artifact, schema, script
integration — BE có mọi thứ cần để tích hợp.

---

## 8. Build and Test Results

### 8.1 Lệnh và kết quả

```bash
cmake -S services -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" \
  -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_MODBUS=ON
cmake --build build --parallel $(nproc)
ctest --test-dir build --parallel 4
```

- **CONFIGURE = 0, BUILD = 0**, 0 lỗi.
- **`ctest`: 649/649 pass, 0 fail, 0 skip.**
- `libmodbus 3.1.10`; `bacnet-stack` rev 19, `BACDL_BIP=ON`.

### 8.2 Phân bố test lớp ST — 220 test

| Nhóm | Số test | Trọng tâm |
|---|---|---|
| `StLang` | 45 | Ngữ nghĩa ngôn ngữ theo từng mục SPEC |
| `StScheduler` | 30 | 12 nhóm bắt buộc của C0.7 |
| `StExec` | 20 | Thực thi + **zero-allocation** |
| `StLimits` | 19 | **Đối kháng parser** |
| `StIr` | 19 | Reject từng mã `IR-E-*` + cắt xén + lật bit |
| `StControlApi` | 17 | Hợp đồng BE, gồm request rác |
| `StValidateCli` | 14 | fork+execv binary thật |
| `StRetain` | 12 | 6 kịch bản bắt buộc |
| `StIoMap` | 12 | Binding validation |
| `StCyclicRuntime` | 10 | Activation tại ranh giới |
| `StIntegration` | 9 | **Bất biến an toàn khi tích hợp** |
| `StIrSecurity` | 5 | Khoá khác, cờ bị xoá, `allow_unsigned` |

Cộng `OverrunMonitor` 11 + `OverrunMonitorSeparation` 2 + `BacnetObjTableAbi` 3.

### 8.3 Lint và bất biến kiến trúc

| Kiểm tra | Kết quả |
|---|---|
| `cppcheck` trên `services/core/st/*.cpp` | **0 lỗi** |
| `nm -C mkddc-core \| grep parse_st_program` | **0** |
| Link markdown nội bộ `docs/handoff/` | 0 gãy |

### 8.4 Script integration cho BE

`services/core/st/samples/be_integration_test.sh` — **18/18 pass**: validate,
compile, **build tất định** (`cmp` hai lần compile), base64 khớp file, 4 mã lỗi
đúng, rác nhị phân không crash.

### 8.5 Khoảng trống verification — cập nhật

| # | Loại | Rev 1.1 | **Rev 2.0** |
|---|---|---|---|
| VG-01 | ASan | KHÔNG CÓ | **vẫn KHÔNG CÓ** |
| VG-02 | UBSan | KHÔNG CÓ | **vẫn KHÔNG CÓ** |
| VG-03 | Fuzzing parser/loader | KHÔNG CÓ | **vẫn KHÔNG CÓ** — nhưng đã có test cắt xén/lật bit toàn diện |
| VG-04 | WCET/jitter trên target | KHÔNG CÓ | 🟡 **có số, nhưng KHÔNG hợp lệ** vì đo không có RT (`F-13`) |
| VG-08 | **Build + test native trên aarch64** | KHÔNG CÓ | ✅ **ĐÃ LÀM** — 646/646, deploy chạy ổn định |
| VG-09 | **Build tất định cross-arch** | KHÔNG CÓ | ✅ **ĐÃ LÀM** — artifact giống hệt byte giữa x86_64 và aarch64 |
| VG-05 | Xác minh RT capability | KHÔNG CÓ | ✅ **ĐÃ LÀM** — và phát hiện `F-13` |
| VG-06 | HIL MCU thật | KHÔNG CÓ | **DEFERRED** có ghi nhận |
| VG-07 | Fault injection | KHÔNG CÓ | 🟡 một phần — watchdog T1–T4 trên target |

`VG-05` là ví dụ rõ nhất về giá trị của việc kiểm: nó không tìm ra lỗi trong
code, nó tìm ra rằng **hệ đang chạy khác thiết kế nhiều ngày mà không ai biết**.

---

## 9. Functional Status Matrix

| Chức năng | Rev 1.1 | **Rev 2.0** |
|---|---|---|
| Program Runtime | PARTIAL | **DONE** |
| Task Scheduler + cycle time | PARTIAL | **DONE** |
| Thực thi ST | PARTIAL | **DONE** — `BOOL`/`INT`/`REAL`/`TIME`, số học, FB |
| Quản lý Program/Task/Instance | PARTIAL | **DONE** — 11 trạng thái |
| I/O image / process image | DONE | DONE |
| Mapping I/O ↔ variable | PARTIAL | **PARTIAL** — validator + bridge xong; CRUD là việc BE |
| Giao tiếp MCU | DONE (fake) | DONE (fake) |
| Giao tiếp BE SOM | DONE | **DONE** + Program control |
| Deploy/activate/rollback | PARTIAL | **DONE** |
| Watchdog | DONE | **DONE** (giá trị tạm) |
| Safe state | DONE | **DONE** + trigger overrun |
| Fault handling | DONE | **DONE** |
| Restart recovery | PARTIAL | **DONE** — RETAIN |
| Diagnostics/metrics | DONE | **DONE** + RT health |
| Trace | PARTIAL | PARTIAL — chưa persist |
| Persistence ST RETAIN | NOT_STARTED | **DONE** |
| Xác thực gói | NOT_STARTED | **DONE** |
| Typed IR | CODE_WITHOUT_SPEC | **DONE** — có SPEC + implementation |
| FBD | SPEC_ONLY | SPEC_ONLY |
| STM32 firmware | OUT_OF_SCOPE | OUT_OF_SCOPE |

---

## 10. Architecture and Code Quality Findings

### F-13 — [CHẶN] Target chạy KHÔNG có real-time

**Đây là finding duy nhất còn mở và là finding quan trọng nhất của Rev 2.0.**

Nguyên nhân gốc đã xác định, không còn giả thuyết:

```
CONFIG_RT_GROUP_SCHED=y
CONFIG_PREEMPT_VOLUNTARY=y        (CONFIG_PREEMPT không bật)
/sys/fs/cgroup       → cgroup2fs
cpu.rt_runtime_us    → KHÔNG TỒN TẠI
mkddc-core cgroup    → /system.slice/mkddc-core.service
Max realtime priority → 0
```

`CONFIG_RT_GROUP_SCHED=y` **cộng** cgroup v2 là bất tương thích đã biết: cgroup
v2 không implement RT group scheduling nên không có `cpu.rt_runtime_us`, và mọi
process trong cgroup không phải root **không thể** dùng `SCHED_FIFO`. systemd
đặt mỗi service vào cgroup riêng ⇒ **không service nào trên board có RT**.

Kiểm chứng: ngay cả root cũng không đặt được (`ulimit -r`=0, `systemd-run` với
`CPUSchedulingPolicy=fifo` fail `status=214` = `EXIT_SETSCHEDULER`). Nhưng
kernel **có** hỗ trợ — kernel thread chạy `FF 99`.

**Drop-in `nofifo.conf` chỉ là hệ quả, không phải nguyên nhân.** Bằng chứng:
`mkddc-iobus` **không có** drop-in nào (`Max realtime priority = 80`) nhưng vẫn
chạy `SCHED_OTHER` vì thất bại cùng lý do.

**Đã xử lý phía FW SOM:** `mkddc-core` nay đo trạng thái RT **thật** bằng
`sched_getscheduler()` thay vì tin mã trả về của `pthread_setschedparam`, log ở
mức `ERROR`, và publish vào PLC SHM để Web/BE thấy **liên tục**.

**Còn lại là việc của Platform/BSP:** rebuild kernel `RT_GROUP_SCHED=n` (quyết
định 2026-07-28), cân nhắc bật luôn `CONFIG_PREEMPT`.

**Đính chính từ Rev 1.1:** bản nháp đầu từng ghi `mkddc-iobus` overrun 76%. Sai
— `overruns=` là bộ đếm **tích luỹ**, `count=` là số mẫu trong cửa sổ. Tỉ lệ
thật **0,009%** (22 706 / ~252 triệu poll trong 5,8 ngày). **Không thành phần
nào đang gặp sự cố vận hành vì thiếu RT.**

### F-11 (còn lại) — [TRUNG BÌNH] 12/15 workstream C0 chưa bắt đầu

C0.4, C0.6, C0.7 đã Done. Còn 12, trong đó đáng chú ý:

| Workstream | Ảnh hưởng |
|---|---|
| C0.2 Program/Resource/Task/POU model | Đã có implementation, chưa có SPEC riêng |
| C0.10 SOM–MCU I/O image contract | `st_io_map` + `st_process_image` tự định nghĩa luật |
| C0.11 Security/permission/audit | Đã có chữ ký, chưa có mô hình quyền |
| C0.14 Effort estimate | Chưa tổng hợp |
| C0.15 go/no-go | Chưa chạy |

### Đánh giá chất lượng

| Câu hỏi | Trả lời |
|---|---|
| Kiến trúc đúng trách nhiệm FW SOM? | **Có** — và nay được bảo đảm ở mức link-time |
| Có trộn trách nhiệm BE/FE/MCU? | **Không** |
| Runtime deterministic? | **Có** — zero-allocation kiểm được; chỉ nhảy tiến; đồng hồ chụp một lần/tick |
| Scheduler bảo đảm cycle/overrun/priority? | **Có** — cả ba |
| I/O snapshot nhất quán trong cycle? | **Có** |
| Safe state khi mất MCU/comm/crash? | **Có** — 5 trigger |
| Watchdog + recovery? | **Có** — kiểm trên target |
| Update không hỏng cấu hình đang chạy? | **Có** — activation lỗi giữ package cũ |
| Code maintain/test/mở rộng được? | **Có** — 649 test, cppcheck sạch, `-Werror` |
| Blocker khiến implement tiếp không an toàn? | **Không còn** ở phía code. Còn `F-13` ở phía platform |

---

## 11. Missing Specifications

| # | Thiếu | Ảnh hưởng |
|---|---|---|
| MS-04 | C0.2 Program/Resource/Task/POU model chính thức | Implementation đã có, SPEC chưa — ngược quy trình |
| MS-05 | C0.10 SOM–MCU I/O image contract | `st_io_map` tự định luật `PREFIX-NN` |
| MS-06 | C0.11 Security/permission/audit model | Chữ ký đã có, mô hình quyền chưa |
| MS-07 | SPEC hành vi watchdog + `WatchdogSec` chính thức | Chờ số đo target có RT |
| MS-09 | C0.1/C0.3/C0.5/C0.8/C0.9/C0.12/C0.13/C0.14 | Chặn C0.15 |

*(MS-01/02/03 của Rev 1.1 đã Done.)*

## 12. Missing Implementations

| # | Thiếu | Phụ thuộc |
|---|---|---|
| MI-08 | `io_map.json` storage + CRUD | BE (C2) |
| MI-09 | Trace persist + publish | C1+ |
| MI-12 | ST stdlib mở rộng (`CASE`, loop, POU) | Ngoài Rev A.0 |
| MI-13 | ASan/UBSan CI job | — (làm ngay được) |
| MI-14 | Fuzz harness parser + loader | — |
| MI-15 | Đo WCET/jitter trên target **có RT** | `F-13` |
| MI-16 | *(đã làm — VG-05)* | — |
| MI-17 | HIL MCU thật | DEFERRED |
| MI-18 | Fault-injection suite đầy đủ | MI-17 |
| MI-19 | Soak 24 giờ | — |
| MI-20 | Mock runtime cho BE | Tiện lợi, không chặn |

## 13. Conflicts and Technical Debt

| # | Mâu thuẫn | Trạng thái |
|---|---|---|
| ~~C-01~~ | Runtime chạy AST | ✅ **ĐÓNG** |
| ~~C-02~~ | Allocation trong scan | ✅ **ĐÓNG** |
| ~~C-03~~ | Overrun không ép safe | ✅ **ĐÓNG** |
| ~~C-04~~/~~C-05~~/~~C-06~~ | Tài liệu lỗi thời | ✅ **ĐÓNG** |
| C-07 | 12 workstream C0 chưa bắt đầu nhưng code đã có | 🟡 giảm từ 15 xuống 12 |
| ~~C-08~~ | `st_program.hpp` tự gọi là "typed IR" | ✅ **ĐÓNG** — nay ghi rõ là AST |
| **C-09** | **Thiết kế nói `SCHED_FIFO 80`, thực tế `SCHED_OTHER`** | **MỞ** — `F-13` |
| ~~TD-01~~ | `kStIrSchemaVersion` không ai validate | ✅ **ĐÓNG** |
| ~~TD-02~~ | CLI không có consumer | ✅ **ĐÓNG** |
| TD-03 | Evidence host/fake, chưa có board thật | MỞ — DEFERRED |
| **TD-04** | RETAIN không có migration giữa layout | Chấp nhận ở Rev A.0, có ghi rõ |

---

## 14. Blockers

| # | Blocker | Chặn cái gì | Mức |
|---|---|---|---|
| ~~B-01~~ … ~~B-04~~ | 4 blocker của Rev 1.1 | ✅ **ĐÃ GỠ HẾT** | — |
| **B-05** | C0.15 go/no-go chưa chạy | Chính thức mở C1–C10 | CHẶN QUY TRÌNH |
| **B-07** | Chưa có ASan/UBSan/fuzzing/soak | `C0.15` PASS | CHẶN VERIFICATION |
| **B-08** | **`F-13` — RT không hoạt động trên target** | `WATCHDOG_GATE` định lượng, mọi số WCET | **CHẶN VERIFICATION** |
| B-06 | Không có MCU thật | G4 | DEFERRED có ghi nhận |

### 14.1 Quy tắc gating — cập nhật

Rev 1.1 viết: *"chưa được wire ST vào `ScanLoop` cho tới khi B-01→B-05 đóng và
C0.15 PASS"*. Trạng thái nay:

- B-01→B-04 **đã đóng**; ST **đã** được wire vào `ScanLoop` với test đầy đủ.
- B-05 (C0.15) **chưa chạy** — nên **chưa được tuyên bố hoàn tất production**.
- B-07, B-08 chặn việc `C0.15` có cơ sở để PASS.

> **Quy tắc còn hiệu lực:** chưa được **tuyên bố bàn giao chính thức** và chưa
> được mở C1+ cho tới khi `B-05`, `B-07`, `B-08` đóng.
>
> Điều này **không** chặn BE bắt đầu tích hợp — hợp đồng đã ổn định và đầy đủ.

---

## 15. Recommended Fixes

Theo thứ tự dependency:

```
① Platform/BSP: rebuild kernel RT_GROUP_SCHED=n  (+ cân nhắc CONFIG_PREEMPT)
      ↓
② Gỡ nofifo.conf → xác nhận SCHED_FIFO 80 thật (V-05)
      ↓
③ Đo lại WCET/jitter dưới tải (V-04) → chốt WatchdogSec
      ↓  (song song, không phụ thuộc ①)
④ ASan + UBSan thành CI job bắt buộc
⑤ Fuzz harness parser + artifact loader
⑥ Soak 24 giờ
      ↓
⑦ Viết nốt 12 workstream C0 còn lại
      ↓
⑧ C0.15 go/no-go → ký nghiệm thu bàn giao BE
```

④⑤⑥ **không phụ thuộc** ① nên làm được ngay và song song.

---

## 16. Implementation Readiness

| Câu hỏi | Trả lời | Cờ |
|---|---|---|
| Baseline cũ có ổn định không? | **Có** — `st_sched=nullptr` giữ hành vi cũ | `EXISTING_FW_SOM_BASELINE = STABLE` |
| Program Runtime đã implement chưa? | **Rồi** — compiler, IR, loader, executor, scheduler, RETAIN, control API | `PRODUCTION_ST_INTEGRATION = IMPLEMENTED` |
| BE tích hợp được chưa? | **Được ngay** — 9 action, schema, tool, sample, script 18/18, 7 tài liệu | `BE_HANDOFF_CONTRACT = COMPLETE` |
| Có thể tuyên bố bàn giao chính thức chưa? | **Chưa** — B-05, B-07, B-08 | `TARGET_VERIFICATION = BLOCKED` |
| Số liệu thời gian thực tin được chưa? | **Chưa** — đo trên hệ không có RT | `F-13` |
| Có blocker nào ở phía code không? | **Không còn** | — |

---

## 17. Next Implementation Plan

| # | Việc | Ai | Phụ thuộc | Ưu tiên |
|---|---|---|---|---|
| 1 | Rebuild kernel `RT_GROUP_SCHED=n`, cân nhắc `CONFIG_PREEMPT` | Platform/BSP | — | **P0** |
| 2 | Gỡ `nofifo.conf`, xác nhận `SCHED_FIFO 80` (`chrt -p`, journal sạch) | QA | 1 | **P0** |
| 3 | Đo WCET/jitter trên target có RT, **dưới tải** | QA | 2 | **P0** |
| 4 | Chốt `WatchdogSec` từ số đo mới, thay giá trị tạm 6 s | SOM Backend Lead | 3 | **P0** |
| 5 | ASan + UBSan thành CI job bắt buộc | FW SOM | — | **P0** (song song) |
| 6 | Fuzz harness `parse_st_program` + artifact loader, nightly 1 giờ | FW SOM | — | **P1** |
| 7 | Soak 24 giờ trên target | QA | 2 | **P1** |
| 8 | Chạy lại watchdog T1–T4 trên cấu hình có RT | QA | 2 | **P1** |
| 9 | Viết C0.2, C0.10, C0.11 (có implementation, thiếu SPEC) | Architect | — | **P1** |
| 10 | Viết nốt C0.1/C0.3/C0.5/C0.8/C0.9/C0.12/C0.13/C0.14 | Architect | — | P2 |
| 11 | `C0.15` go/no-go chính thức | PM | 1–10 | P2 |
| 12 | Trace persist + publish ra ngoài process | FW SOM | C1+ | P2 |
| 13 | Mock runtime cho BE | FW SOM | — | P3 |
| 14 | HIL với STM32 thật | QA | Phần cứng | DEFERRED |

---

## 18. Final PM Conclusion

### `FW_SOM_HANDOFF_CONDITIONAL`

Rev 1.1 kết luận `FW_SOM_IMPLEMENTATION_BLOCKED` vì ba blocker cứng và không
có Typed IR. **Cả ba đã được gỡ, cùng bốn finding khác.** Nhưng cũng không thể
tuyên bố `READY_FOR_BE_HANDOFF`, vì verification trên phần cứng đúng cấu hình
chưa xong. Trạng thái ở giữa, và tách bạch nó ra là cách trung thực nhất.

### 18.1 Diễn giải — đọc cả bốn vế

**1. Phần code và hợp đồng đã xong, có bằng chứng.**
649/649 test, build `-Werror` sạch, cppcheck 0 lỗi, symbol check sạch, script
BE 18/18. Program Runtime chạy trong `ScanLoop` thật, qua trọng tài ưu tiên và
safe-state. Không còn blocker nào ở phía code.

**2. BE bắt đầu tích hợp được NGAY.**
9 action, JSON schema, hai CLI, sample đã verify bằng tool thật, script 18 test,
7 tài liệu bàn giao. `FW_SOM_BE_INTEGRATION_GUIDE.md` là điểm vào duy nhất cần
đọc. Không có lý do kỹ thuật nào để BE phải đợi.

**3. Chưa được tuyên bố bàn giao chính thức.**
Ba blocker còn lại — `B-05` (C0.15 chưa chạy), `B-07` (chưa có ASan/fuzz/soak),
`B-08` (`F-13`, RT trên target) — đều thuộc **verification**, không thuộc chức
năng. Không cái nào chặn BE làm việc; cả ba chặn việc ký nghiệm thu.

**4. Mọi số liệu thời gian thực hiện tại chưa dùng được.**
Target chạy `SCHED_OTHER` thay vì `SCHED_FIFO`. Jitter 284–356 µs và
`WatchdogSec=6` là số **tạm**, phải đo lại sau khi RT hoạt động.

### 18.2 Nhận định

Điều đáng nói nhất của Rev 2.0 không phải là số test tăng từ 477 lên 649, mà là
**ba bất biến chuyển từ quy ước thành thứ kiểm được**:

- "runtime không parse source" → **ràng buộc link-time** + symbol check CI;
- "không cấp phát trong scan path" → **test đếm `operator new`**;
- "hằng không ghi đè được", "chương trình luôn chấm dứt" → **luật loader kiểm
  tại thời điểm nạp**.

Trước đây cả ba đều đúng "nếu lập trình viên cẩn thận". Giờ chúng đúng vì hệ
thống không cho phép sai — và đó là khác biệt giữa một hệ điều khiển chạy được
và một hệ điều khiển tin được.

Điểm cần rút kinh nghiệm: `F-13` cho thấy **hệ đã chạy khác thiết kế nhiều
ngày mà không ai biết**, vì cảnh báo chỉ log một dòng lúc khởi động rồi cuộn
mất. Sửa kernel là cần, nhưng thứ thực sự ngăn tái diễn là việc đưa trạng thái
RT vào metric quan sát được liên tục — đã làm.

Và một lần nữa, giá trị lớn nhất của lớp test đối kháng không phải bắt lỗi lập
trình, mà bắt **giả định sai**: `VG-05` không tìm ra bug nào trong code, nó tìm
ra rằng tiền đề "chúng ta đang chạy real-time" là sai.

### 18.3 Đề xuất

**Bàn giao có điều kiện.** BE bắt đầu tích hợp ngay, song song với việc
Platform/BSP xử lý `F-13` và FW SOM chạy nốt ASan/UBSan/fuzzing/soak. Ký nghiệm
thu cuối khi `B-05`, `B-07`, `B-08` đóng.

Không có lý do gì để BE ngồi đợi kernel.

---

**Rev** 2.0 | 2026-07-28 — Cập nhật toàn diện theo source code hiện tại (commit `5c39c61`). Kết luận đổi từ `FW_SOM_IMPLEMENTATION_BLOCKED` sang `FW_SOM_HANDOFF_CONDITIONAL`. 7/12 finding của Rev 1.1 đã đóng hoàn toàn, 2 đóng một phần; thêm `F-13` (RT không hoạt động trên target) là finding chặn duy nhất còn lại. Traceability mở rộng lên 33 dòng (thêm T-10b, T-18b, T-29..T-33). Số đo: build sạch `-Werror`, **ctest 649/649**, 220 test lớp ST, cppcheck 0 lỗi, symbol check 0, script BE 18/18. Thêm §0 bảng đối chiếu Rev 1.1 → Rev 2.0.
· 1.1 | 2026-07-28 — Đổi kết luận sang `FW_SOM_IMPLEMENTATION_BLOCKED`; tách 4 cờ trạng thái; sắp lại §17 theo dependency; tách safety policy khỏi `CoreMetrics`; cấm kick watchdog giữa scan; thêm §8.5 khoảng trống verification + `B-07` + `V-01..V-07`; thêm §14.1 quy tắc gating.
· 1.0 | 2026-07-28 — Tạo mới. 12 finding, 30 dòng traceability, 15 microtask.
