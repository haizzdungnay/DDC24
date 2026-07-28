# FW SOM — Source, SPEC và Implementation Status Review

> **Document ID:** REV-FWSOM-STATUS-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-07-28
> **Người thực hiện:** PM kỹ thuật (review độc lập)
> **Phạm vi:** `services/core`, `services/iobus`, `shared/`, `packaging/systemd` + toàn bộ tài liệu SPEC/design/ADR/plan liên quan FW SOM
> **Commit review:** `7fff012` trên nhánh `docs/fw-som-st-scope-and-vi-rule` (nền `origin/main` = `8f2f330`)
> **Kết luận tổng thể:** `FW_SOM_IMPLEMENTATION_BLOCKED` — xem §18
>
> **Trạng thái tách riêng theo từng phạm vi** (không gộp thành một con số chung):
>
> | Phạm vi | Trạng thái |
> |---|---|
> | `EXISTING_FW_SOM_BASELINE` | **STABLE** |
> | `FW_SOM_ST_HOST_SLICE` | **COMPLETED** |
> | `PRODUCTION_ST_INTEGRATION` | **BLOCKED** |
> | `C1_PLUS_OPENING` | **BLOCKED** |

---

## 1. Executive Summary

FW SOM hiện là **hai process C++17 chạy trên SOM Linux**: `mkddc-iobus` (chủ IOP/UART tới STM32, Modbus, BACnet) và `mkddc-core` (point table, priority arbitration, graph runtime, safe-state, alarm, schedule, IPC tới Web/HMI). Cộng thêm một binary CLI phụ `mkddc-st-validate`.

### 1.1 Trạng thái tách theo phạm vi — đọc bảng này trước

Một kết luận chung duy nhất sẽ che mất sự thật rằng phần đang chạy production thì ổn định, còn phần muốn mở rộng thì bị chặn. Vì vậy trạng thái được ghi tách riêng:

| Cờ trạng thái | Giá trị | Nghĩa vận hành |
|---|---|---|
| `EXISTING_FW_SOM_BASELINE` | **STABLE** | `mkddc-iobus` + `mkddc-core` hiện hành (scan loop, arbitration, safe-state, alarm, schedule, IPC, IOP, Modbus/BACnet) build sạch, 477/477 test, đang vận hành được. Không có finding nào chặn việc tiếp tục dùng và bảo trì baseline này. |
| `FW_SOM_ST_HOST_SLICE` | **COMPLETED** | Lát cắt host-only theo `FW-SOM-ST-001` đã hoàn thành đúng phạm vi được phê duyệt và có bằng chứng build/CTest thật (61 test ST). Deliverable đã giao. |
| `PRODUCTION_ST_INTEGRATION` | **BLOCKED** | Cấm wire `StCyclicRuntime` vào `ScanLoop`. Chặn bởi B-01 (`F-01` segfault), B-02 (`F-02` không có typed IR), B-03 (`F-03` allocation trong scan path). |
| `C1_PLUS_OPENING` | **BLOCKED** | Cấm mở C1–C10. Chặn bởi B-02, B-04 (MS-01/MS-03 chưa có SPEC), B-05 (C0.15 chưa chạy). |

**Kết luận tổng thể `FW_SOM_IMPLEMENTATION_BLOCKED`** phản ánh hai cờ `BLOCKED` ở trên: mọi hướng *đi tiếp* đều đang bị chặn, kể cả khi baseline hiện tại ổn định và lát cắt đã giao xong. Xem §18.

### 1.2 Baseline kỹ thuật đo được thật (không lấy từ tài liệu)

| Hạng mục | Kết quả đo 2026-07-28 |
|---|---|
| Configure + build `services/` (`-Wall -Wextra -Werror`, BACNET=ON, MODBUS=ON) | **exit 0, 0 lỗi** |
| `ctest` toàn bộ | **477/477 PASS, 0 FAIL, 0 SKIP** (2.34 s) |
| `cppcheck` (warning/performance/portability) trên `core/{st,graph,safety,ipc}` | **0 error**, 8 note mức performance/portability, **0 note trong `st/`** |
| Thư viện transport thật | `libmodbus 3.1.10` (pkg-config), `bacnet-stack` BACDL_BIP=ON, protocol revision 19 |

**Nhưng "xanh" không đồng nghĩa "sẵn sàng đi tiếp".** Review này tìm thấy 3 vấn đề chặn việc mở rộng, 1 mâu thuẫn governance, và 1 khoảng trống verification:

1. **Lỗi crash đã repro** — ST parser đệ quy không giới hạn độ sâu, segfault với input hợp lệ về kích thước (§10, F-01).
2. **Runtime thực thi AST parse trực tiếp từ source text**, trong khi thiết kế §4/§7.2 cấm rõ điều này và bắt buộc phải có typed IR + loader validation (§10, F-02).
3. **Cấp phát heap trong scan execution path**, trong khi §7.2 ghi "không allocation ... trong scan execution" (§10, F-03).
4. **Governance lệch:** cả **15/15 workstream C0 đều `Chưa bắt đầu`**, nhưng code ST đã merge vào production `services/core`. Đây là hệ quả có chủ ý của ngoại lệ CTO ngày 2026-07-24, nhưng hậu quả là 4 hạng mục rơi vào trạng thái `CODE_WITHOUT_SPEC` (§11, §13).
5. **Toàn bộ evidence hiện có là host x86_64, chức năng, không đối kháng.** Không có ASan/UBSan, không có fuzzing, không có đo WCET/jitter trên SOM target, không có xác minh systemd RT capability trên target, không có HIL, không có fault-injection. `F-01` tồn tại được chính vì khoảng trống này — 477 test chỉ kiểm đường đi đúng (§8.5, §12 MI-13..MI-18).

**Điểm mạnh thật sự cần ghi nhận:** lớp runtime substrate (scan loop deterministic, seqlock snapshot, priority arbitration 6 mức, safe-state đa trigger, atomic activation + last-known-good, staging không commit nửa chừng, reject NaN/Inf) đã implement **và có test bao phủ**. Đây là nền tốt; các fix bên dưới là fix có mục tiêu, không phải viết lại.

---

## 2. FW SOM Intended Scope

Theo `ADR-020` (amended 2026-07-24, `docs/00_governance/DECISIONS.md`), `PROGRAM_SOM_FW_DRAFT_DESIGN` §4.1 và ngoại lệ CTO `FW-SOM-ST-001`:

**Thuộc FW SOM:**

| Trách nhiệm | Nguồn SPEC |
|---|---|
| Active package, task execution, retain state, output arbitration | Design §4.1 (`mkddc-program-core`) |
| Physical/protocol point value, unit, reliability/quality | Design §4.1 (`mkddc-iobus`) |
| IOP v2 session, raw→engineering, typed point snapshot cho Core | Design §9.1 |
| Safe-state, failure behavior, watchdog | Design §10 |
| Chạy/test một chương trình ST tối thiểu trên SOM host runtime | `FW-SOM-ST-001`, C0 plan §1 "Ngoại lệ được phê duyệt 2026-07-24" |

**KHÔNG thuộc FW SOM (ngoài scope review này):**

- FE Program IDE (Design §5) — `src/frontend`
- Backend/API/storage, project repository, artifact registry (Design §6) — `web/backend`, `mkddc-program-service` (chưa tồn tại)
- STM32 firmware (Design §9.2) — `fw/`
- HIL / FBD editor / compiler đầy đủ — chờ approval riêng (C0 plan §1)
- `services/hmi` (local TFT display), `services/netcfg` (network authority) — thuộc SOM nhưng không thuộc Program Runtime scope

---

## 3. Architecture Found in Repository

Kiến trúc **thực tế đọc từ code**, không từ diagram tài liệu:

```text
                    STM32 (fw/ — ngoài scope)
                         │ UART 921600, IOP v2, poll 2ms
                         ▼
  ┌──────────────────────────────────────────────────┐
  │ mkddc-iobus  (services/iobus/main.cpp)           │
  │  main thread : IOP poll loop (poll_period_ms=2)  │
  │  + thread    : fieldbus/Modbus (main.cpp:281)    │
  │  + thread    : BACnet server   (main.cpp:341)    │
  └──────────────────────────────────────────────────┘
       │ creator                          │ SOCK_DGRAM
       ▼ /dev/shm/mkddc_io_shm            ▼ /run/mkddc/fieldbus.sock
  ┌──────────────────────────────────────────────────┐
  │ mkddc-core   (services/core/main.cpp)            │
  │  SINGLE THREAD, SCHED_FIFO 80, mlockall          │
  │  ScanLoop::step() chu kỳ 500..2000 ms            │
  │   1 read shm(seqlock) → 2 point table + quality  │
  │   → 3 ext snapshot → 4 web/BACnet cmd queue      │
  │   → 5 graph execute → 6 priority resolve         │
  │   → 7 safe-state override → write → publish      │
  │  creator /dev/shm/mkddc_plc_shm                  │
  └──────────────────────────────────────────────────┘
       │ Unix stream, line-JSON
       ▼ /run/mkddc/core.sock  →  web/backend, HMI broker

  ┌──────────────────────────────────────────────────┐
  │ mkddc-st-validate  (st/st_validate_main.cpp)     │
  │  binary RỜI, short-lived, KHÔNG nối scan loop    │
  └──────────────────────────────────────────────────┘
```

**Xác nhận bằng code:** `mkddc-core` **không** có `std::thread`/`pthread_create` nào (grep sạch trên `services/core`, trừ test) — toàn bộ scan chạy trên một thread RT. Đây là lựa chọn tốt cho determinism.

**Xác nhận quan trọng — ST runtime CHƯA nối vào production:** [services/core/main.cpp:234-235](services/core/main.cpp#L234-L235) khởi tạo `ScanLoop` với 13 dependency; **không có `StCyclicRuntime` trong danh sách**. grep toàn `services/core` cho thấy `StCyclicRuntime`/`StProgramRuntime` chỉ xuất hiện trong `st/` và `st/tests/`. Điều này **khớp** với [docs/04_design/INTERFACES.md:47](docs/04_design/INTERFACES.md#L47) ("Không gắn vào scan loop sản xuất") — tài liệu và code nhất quán ở điểm này.

---

## 4. Source Code Inventory

| Nhóm | File nguồn | File test | Ghi chú |
|---|---|---|---|
| `services/core` | 57 | 22 | 8 domain subfolder (ADR-021 Phase A) |
| `services/iobus` | 62 | 20 | 7 domain subfolder |
| `shared/` | 5 | — | `iop_protocol.h`, `mkddc_shm.h`, `kinexus_shm.h`, 2 JSON schema |

### 4.1 `services/core` theo domain

| Domain | Module | Vai trò |
|---|---|---|
| `st/` | `st_parser`, `st_semantic`, `st_runtime`, `st_stdlib`, `st_artifact`, `st_io_map`, `st_cyclic_runtime`, `st_trace`, `st_validate_main` | Lớp ST — **host-only, chưa nối scan loop** |
| `graph/` | `scan_loop`, `graph_runtime`, `point_table`, `point_quality`, `runtime_point_snapshot`, `state_snapshot`, `clock_snapshot` | Scan loop + component graph 28-node + persistence |
| `safety/` | `safe_state`, `safe_state_config` | Safe-state trigger + config |
| `ipc/` | `web_ipc`, `iobus_reader`, `output_writer`, `priority_resolver`, `config_reload` | IPC + arbitration + SIGHUP reload |
| `alarm/` | `alarm_runtime`, `alarm_primitives` | Alarm engine |
| `schedule/` | `schedule_runtime` | Schedule engine |
| `bacnet/` | `bacnet_objtable` | PLC SHM publish cho BACnet |
| `diagnostics/` | `core_metrics` | scan_count / overrun / exec time |

### 4.2 `services/iobus` theo domain

`iop/` (frame, parser, crc, port, client) · `io/` (cache, scaling, types) · `fieldbus/` (modbus_master, modbus_tcp, poll_scheduler, register_codec, device_profile, ext_cache, metrics) · `bacnet/` (server, objects, priority, reliability, cov, alarm, config) · `bridge/` (core_bridge, output_command) · `config/` · `diagnostics/` · `platform/` (realtime, systemd_notify, network_address)

---

## 5. Specification Inventory

| Tài liệu | ID | Trạng thái | Nhận xét |
|---|---|---|---|
| [docs/02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md](docs/02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md) | DDD-PROGRAM-SOM-FW | Draft v0.6 | SPEC chủ đạo. Đầy đủ, chi tiết, tự nhận là corrective design |
| [docs/00_governance/DECISIONS.md](docs/00_governance/DECISIONS.md) | ADR-LOG-001 | Active | ADR-020 amended 2026-07-24 |
| [docs/04_design/INTERFACES.md](docs/04_design/INTERFACES.md) | IF-SPEC-001 | Active | Contract IOP/SHM/validate gateway. **Có path lỗi thời — F-08** |
| [docs/05_verification/VERIFICATION.md](docs/05_verification/VERIFICATION.md) | VVP-001 | Active | Gate G0 GREEN, G1–G6 RED |
| [C0 plan](docs/07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md) | C0-PLAN-001 | Active | **15/15 workstream `Chưa bắt đầu`** |
| [C1–C10 plan](docs/07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md) | IMPLPLAN-001 | Partially opened | Trung thực, tự cảnh báo không suy diễn. **Số test lỗi thời — F-09** |
| [docs/03_implementation/22_SOM_SRC_IMPLEMENTATION_PLAN.md](docs/03_implementation/22_SOM_SRC_IMPLEMENTATION_PLAN.md) | IMPL-SOM-SRC-PLAN | Active v2.2 | Cập nhật tới ADR-021 |
| [docs/03_implementation/32_DEV_TEAM_NEXT_ACTION.md](docs/03_implementation/32_DEV_TEAM_NEXT_ACTION.md) | IMPL-DEV-NEXTACTION | In progress v1.1 | **Lỗi thời nặng — F-10** |
| [docs/07_records/reviews/KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md](docs/07_records/reviews/KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md) | GAP-2026-07-22 | Record | Đã bị ADR-020 override |

---

## 6. Spec-to-Code Traceability Matrix

| ID | Chức năng | SPEC tham chiếu | Source code | Test | Trạng thái | Vấn đề | Hành động |
|----|-----------|-----------------|-------------|------|------------|--------|-----------|
| T-01 | Cyclic scan deterministic, mốc tuyệt đối không drift | Design §7.3 | [scan_loop.cpp:290-298](services/core/graph/scan_loop.cpp#L290-L298) `clock_nanosleep(TIMER_ABSTIME)` | `ScanLoop.*` 14 test | DONE | — | Giữ |
| T-02 | Coherent input snapshot trong 1 cycle | Design §7.3, §8 | [scan_loop.cpp:40-57](services/core/graph/scan_loop.cpp#L40-L57) seqlock + `last_io_` fallback | `IobusReader` 7, `ScanLoop` | DONE | — | Giữ |
| T-03 | Output staging, commit 1 lần, không commit nửa chừng | Design §7.3, §10 | [scan_loop.cpp:154-160](services/core/graph/scan_loop.cpp#L154-L160); [st_runtime.cpp:167-182](services/core/st/st_runtime.cpp#L167-L182) | `OutputWriter` 8, `StRuntime` 23 | DONE | — | Giữ |
| T-04 | Priority/interlock/safety arbitration, Core giữ quyền | Design §8 | [ipc/priority_resolver.cpp](services/core/ipc/priority_resolver.cpp) 6 mức | `PriorityResolver` 8 | DONE | — | Giữ |
| T-05 | Safe-state khi IOP fault / SHM stale / input BAD / no controller | Design §10 | [safe_state.cpp:9-32](services/core/safety/safe_state.cpp#L9-L32) | `SafeState` + `SafeStateConfig` 8 | DONE | — | Giữ |
| T-06 | MCU mất poll >200 ms → MCU tự ép safe | Design §10 | `IOP_SAFE_TIMEOUT_MS 200` [shared/iop_protocol.h:54](shared/iop_protocol.h#L54) | — (thuộc `fw/`) | OUT_OF_SCOPE | Không có evidence target | Giao `fw/` team |
| T-07 | Atomic activation + rollback last-known-good | Design §10 | [st_runtime.cpp:119-135](services/core/st/st_runtime.cpp#L119-L135) `active_` chỉ swap khi parse+typecheck OK | `StRuntime`, `StCyclicRuntime` 9 | DONE | — | Giữ |
| T-08 | Activation chỉ áp tại ranh giới cycle | Design §7.3 | [st_cyclic_runtime.cpp:19-49](services/core/st/st_cyclic_runtime.cpp#L19-L49) | `StCyclicRuntime` 9 | DONE | — | Giữ |
| T-09 | NaN/Inf/out-of-range reject trước commit | Design §8 | [st_runtime.cpp:146-161](services/core/st/st_runtime.cpp#L146-L161) | `StRuntime` | DONE | — | Giữ |
| T-10 | ST parser + semantic (subset REAL/BOOL/IF/CMP/bool/LIMIT) | Design §7.1, C0.4 | [st_parser.cpp](services/core/st/st_parser.cpp), [st_semantic.cpp](services/core/st/st_semantic.cpp), [st_limits.hpp](services/core/st/st_limits.hpp) | `StRuntime` 23, `StLimits` 19, `StValidateCli` 14 | **PARTIAL** | ~~F-01~~ **ĐÓNG 2026-07-28 (M-01)**; C0.4 vẫn chưa có SPEC | Viết C0.4 (MS-02) |
| T-11 | Typed IR có schema/version, loader reject magic/ABI/hash/limit | Design §4, §7.2, C0.6 | **KHÔNG TỒN TẠI** — [st_program.hpp:47-80](services/core/st/st_program.hpp#L47-L80) là AST con trỏ, không serialize | — | **CODE_WITHOUT_SPEC** | **F-02** runtime chạy AST parse từ source text | M-02 + viết C0.6 |
| T-12 | Không allocation trong scan execution | Design §7.2 | Vi phạm: [st_runtime.cpp:167-173](services/core/st/st_runtime.cpp#L167-L173) `std::map` mỗi cycle | — | **PARTIAL** | **F-03** | M-03 |
| T-13 | Multi-task scheduler: task set, priority, period, watchdog budget từ manifest | Design §7.3, C0.7 | Chỉ 1 cyclic loop cứng, period từ `graph.json` [main.cpp:160-173](services/core/main.cpp#L160-L173) | `ScanLoop` | **NOT_STARTED** | **F-05** | Viết C0.7 trước khi code |
| T-14 | Overrun: đo, alarm, ngưỡng lặp → chuyển safe theo config | Design §7.3, §10 | Đo + log có: [core_metrics.cpp:13-15](services/core/diagnostics/core_metrics.cpp#L13-L15); **không có ngưỡng→safe, không có alarm** | `CoreMetrics` | **PARTIAL** | **F-04** | M-04 |
| T-15 | RETAIN, cold/warm start, migration, CRC retain record | Design §7.4 | **KHÔNG TỒN TẠI** trong `st/` (grep `retain\|persist` chỉ ra 1 dòng comment) | — | **NOT_STARTED** | **F-06** | Sau C0.2/C0.6 |
| T-16 | Persistence graph state (không phải ST RETAIN) | 22 plan COR-010 | [state_snapshot.cpp](services/core/graph/state_snapshot.cpp) atomic tmp+rename, version=1 | `StateSnapshot` 8 | DONE | — | Giữ |
| T-17 | io_map binding typed variable ↔ physical point | Design §8, C0.10 | [st_io_map.cpp](services/core/st/st_io_map.cpp) validator thuần | `StIoMap` 12 | **PARTIAL** | Chưa có file `io_map.json`, chưa CRUD, chưa consumer | C2/BE |
| T-18 | Validate gateway CLI, JSON shape ổn định, exit code | INTERFACES.md §"validate gateway" | [st_validate_main.cpp](services/core/st/st_validate_main.cpp) | `StValidateCli` 14 (8 đối kháng) | **DONE** | ~~F-01~~ **ĐÓNG 2026-07-28 (M-01)** — exit ∈ {0,1,2} và 1 dòng JSON được test bằng fork+execv binary thật | — |
| T-10b | Giới hạn tài nguyên parser (source/token/depth/biến/statement/identifier/diagnostic) | INTERFACES.md §"Giới hạn tài nguyên", MS-02 (chờ) | [st_limits.hpp](services/core/st/st_limits.hpp), [st_parser.cpp](services/core/st/st_parser.cpp) | `StLimits` 19, `StValidateCli` 8 đối kháng | **DONE** (ngưỡng tạm) | Ngưỡng chính thức chốt ở MS-02 | MS-02 |
| T-19 | Deterministic build: cùng source → cùng hash | SWR-REQ-IEC-005 | [st_artifact.cpp:7-17](services/core/st/st_artifact.cpp#L7-L17) FNV-1a 64 | `StValidateCli.SameSourceProducesSameArtifactHash` | DONE | Hash không mật mã (đã ghi rõ trong doc) | Xem F-07 |
| T-20 | Package integrity / signature verification | Design §7.2, C0.11 | **KHÔNG TỒN TẠI** | — | **NOT_STARTED** | **F-07** | Sau C0.11 |
| T-21 | Trace/diagnostic runtime (activation/fault/overrun/rollback) | Design §7.3 | [st_trace.hpp](services/core/st/st_trace.hpp) ring buffer bounded, in-process | `StTraceLogTest` 1, `StCyclicRuntime` | **PARTIAL** | Chưa persist, chưa publish ra ngoài process | C1+ |
| T-22 | IOP v2 contract (baud/timeout/retry/fault/handshake/cap) | Design §9.1, INTERFACES.md | [shared/iop_protocol.h:47-54,74-82,112](shared/iop_protocol.h#L47-L54) khớp 100% bảng INTERFACES.md | `IopFrame` 8, `IopParser` 8, `IopCrc`, `IopClientFakeMcu` | DONE (host) | Chưa có evidence MCU thật | HIL |
| T-23 | SHM ABI: magic, seqlock, layout, static assert | INTERFACES.md §"Shared memory ABI" | [shared/mkddc_shm.h](shared/mkddc_shm.h) | `test_shm_layout.cpp` | DONE | — | Giữ |
| T-24 | Web/HMI IPC: accepted/rejected/overridden + audit | Design §4.1, INTERFACES.md | [ipc/web_ipc.cpp](services/core/ipc/web_ipc.cpp) | `WebIpc` **39 test** | DONE | — | Giữ |
| T-25 | FE/Backend down → Core tiếp tục package active | Design §10 | Kiến trúc process tách rời; `Wants=` không `Requires=` [mkddc-core.service](packaging/systemd/mkddc-core.service) | `WebIpc` | DONE | — | Giữ |
| T-26 | Watchdog + automatic recovery | Design §10 | `Type=notify`, `WatchdogSec=3` (core) / `5` (iobus), `Restart=always`; kick sau mỗi scan [main.cpp:286](services/core/main.cpp#L286) | — | **PARTIAL** | **F-12** biên độ mỏng | M-05 |
| T-27 | SIGHUP reload config tại ranh giới scan, fail → giữ config cũ | 22 plan COR-008 | [scan_loop.cpp:256-264](services/core/graph/scan_loop.cpp#L256-L264), [ipc/config_reload.cpp](services/core/ipc/config_reload.cpp) | `ConfigReload` | DONE | — | Giữ |
| T-28 | Modbus/BACnet cache cho vendor FB | Design §9.1 | [fieldbus/](services/iobus/fieldbus/), [bacnet/](services/iobus/bacnet/), `feed_ext_snapshot` | `ModbusTcp` 8, `RegisterCodec` 8, `BacnetObjects` 13, … | DONE (host) | Chưa evidence RS-485/LAN thật | HIL |
| T-29 | FBD editor + compiler | Design §5, §7.1 | **KHÔNG TỒN TẠI** | — | **SPEC_ONLY** | Chờ approval riêng | Ngoài scope |
| T-30 | `mkddc-program-service` / `libmkddc_iec` | Design §4, §6 | **KHÔNG TỒN TẠI** | — | **SPEC_ONLY** | C1+ chưa mở | Ngoài scope |

---

## 7. Interface Status

| Interface | Transport / contract | Nguồn contract | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FW SOM ↔ MCU | UART 921600, IOP v2, poll 2 ms, timeout 3 ms, retry 3, fault 20 ms, reconnect 5 s, handshake 1000 ms, `IO_RESP` 74/80 B, cap `0x000D` | [shared/iop_protocol.h](shared/iop_protocol.h) | **IMPLEMENTED (host) + FAKE MCU** | Hằng số trong header khớp 100% bảng [INTERFACES.md:11-22](docs/04_design/INTERFACES.md#L11-L22); test `IopClientFakeMcu`, `IopFrame`, `IopParser`, `IopCrc` |
| FW SOM iobus ↔ core | `/dev/shm/mkddc_io_shm` seqlock, magic `0x4B584404` | [shared/mkddc_shm.h](shared/mkddc_shm.h) | **IMPLEMENTED** | `test_shm_layout.cpp`, `IobusReader` 7 test |
| FW SOM core → BACnet/Web | `/dev/shm/mkddc_plc_shm` (core là creator) | INTERFACES.md | **IMPLEMENTED** | `BacnetObjtable` 12 test |
| FW SOM ↔ BE SOM (command) | Unix stream `/run/mkddc/core.sock`, line-JSON, accepted/rejected/overridden + audit | Design §4.1, INTERFACES.md | **IMPLEMENTED** | `WebIpc` 39 test |
| FW SOM ↔ BE SOM (ST validate) | CLI `mkddc-st-validate --source <path>`, 1 dòng JSON, exit 0/1/2 | [INTERFACES.md:42-109](docs/04_design/INTERFACES.md#L42-L109) | **IMPLEMENTED nhưng CHƯA CÓ CONSUMER** | `StValidateCli` 14 test (8 đối kháng). grep `mkddc-st-validate` trong `*.go`/`*.ts` → **0 caller**. ~~Contract bị F-01 phá vỡ~~ **F-01 đóng 2026-07-28 (M-01)** |
| FW SOM iobus fieldbus → core | `SOCK_DGRAM /run/mkddc/fieldbus.sock`, `kx_ext_snapshot_msg_t` | 22 plan MOD-009 | **IMPLEMENTED** | [main.cpp:206-232](services/core/main.cpp#L206-L232), `GraphProtocol` 12 test |
| FW SOM ↔ config storage | `graph.json`, `io_config.conf`, `io_safe_state.conf`, `alarm_settings.conf`, `schedule.conf` + SIGHUP reload | 07 guide, CONFIG_SCHEMA | **IMPLEMENTED** | `ConfigReload`, `IobusConfig` 16 test |
| FW SOM ↔ persistence | `StateSnapshot` JSON version=1, atomic tmp+rename, 60-scan dirty flush | 22 plan COR-010 | **IMPLEMENTED** | `StateSnapshot` 8 test |
| FW SOM ↔ program artifact storage | `io_map.json`, project/build registry | Design §6.2 | **SPEC_ONLY** | `find -name io_map.json` → không có file nào trong repo |
| FW SOM ↔ system watchdog | `sd_notify` `Type=notify`, `WatchdogSec` 3/5, `Restart=always` | Design §10 | **IMPLEMENTED** | [mkddc-core.service](packaging/systemd/mkddc-core.service), [mkddc-iobus.service](packaging/systemd/mkddc-iobus.service) |
| FW SOM ↔ program deploy/activate API | `POST /builds`, activate/rollback | Design §6.1 | **SPEC_ONLY** | `mkddc-program-service` chưa tồn tại |

---

## 8. Build and Test Results

Toàn bộ lệnh chạy thật ngày 2026-07-28 tại commit `7fff012`.

### 8.1 Build

```bash
cmake -S services -B build-all -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" \
  -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_MODBUS=ON
cmake --build build-all --parallel $(nproc)
```

- **CONFIGURE = 0, BUILD = 0**, 0 lỗi biên dịch.
- Thư viện thật được resolve: `Found libmodbus, version 3.1.10`; `BACNET: BACDL_BIP: "ON"`, `BACNET_PROTOCOL_REVISION: "19"`.
- Binary sinh ra: `mkddc-core` (12.4 MB), `mkddc-st-validate` (4.1 MB), `mkddc-iobus` (6.9 MB), `mkddc-netcfg` (6.9 MB).

> Ghi chú: điều này **bác bỏ** trạng thái ghi trong [32_DEV_TEAM_NEXT_ACTION.md](docs/03_implementation/32_DEV_TEAM_NEXT_ACTION.md) rằng MOD-012/BAC-012 còn "no-op vì thư viện chưa install" — xem F-10.

### 8.2 Test

```bash
rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm
ctest --test-dir build-all --output-on-failure --parallel 4
```

```
100% tests passed, 0 tests failed out of 477
Total Test time (real) = 2.34 sec
```

**0 SKIP** — IOB-006 (SHM cleanup) đã hết triệu chứng.

Phân bố test lớn nhất: `WebIpc` 39 · `GraphRuntime` 27 · `AlarmRuntime` 27 · `StRuntime` 23 · `IoScaling` 23 · `RuntimePointSnapshot` 16 · `IobusConfig` 16 · `ScheduleRuntime` 14 · `ScanLoop` 14.

**Test thuộc lớp ST: 61** (`StRuntime` 23 · `StIoMap` 12 · `StStdlib` 10 · `StCyclicRuntime` 9 · `StValidateCli` 6 · `StTraceLog` 1).

### 8.3 Lint

```bash
cppcheck --enable=warning,performance,portability --std=c++17 \
  -I services/core -I shared services/core/{st,graph,safety,ipc}
```

- **0 error.** 8 note: 3 × `passedByValue` (`scan_loop.hpp:52`, `web_ipc.hpp:101`, `web_ipc.cpp:270`), 5 × `memsetClassFloat` (toàn bộ trong file test).
- **0 note trong `services/core/st/`.**

### 8.4 Test tiêu cực do review thực hiện (không có trong suite)

```bash
# ST source 40 KB, lồng 20000 dấu ngoặc — dưới hạn mức 64 KiB của CLI
./mkddc-st-validate --source deep.st
→ Segmentation fault (core dumped), exit 139, stdout RỖNG
```

Ngưỡng đo được: depth 10000 → exit 0; **depth 12000 → exit 139**. Nested `IF` không khai thác được (18 B/cấp, hạn mức 64 KiB chặn ở ~3640 cấp; test 3500 cấp → exit 0).

### 8.5 Khoảng trống verification — những gì KHÔNG được kiểm

Toàn bộ evidence ở §8.1–§8.3 là **host x86_64, build chức năng, input hợp lệ**. Đây là điểm yếu hệ thống, không phải thiếu sót ngẫu nhiên: `F-01` sống sót qua 477 test chính vì không có lớp kiểm nào ở dưới đây.

| # | Loại verification | Trạng thái | Vì sao bắt buộc với FW SOM |
|---|---|---|---|
| VG-01 | **AddressSanitizer (ASan)** | **KHÔNG CÓ** | Bắt buffer overflow, use-after-free, **stack overflow có chẩn đoán** thay vì SIGSEGV câm. ASan sẽ báo `F-01` ngay lần chạy đầu |
| VG-02 | **UndefinedBehaviorSanitizer (UBSan)** | **KHÔNG CÓ** | Code có số học float, ép kiểu int24→int32 ([iop_protocol.h:210](shared/iop_protocol.h#L210)), shift, so sánh signed/unsigned — đúng loại UB mà `-Werror` không bắt được |
| VG-03 | **Fuzzing parser/CLI** | **KHÔNG CÓ** | `parse_st_program()` và `mkddc-st-validate` nhận input từ ngoài. Đây là bề mặt tấn công duy nhất của FW SOM hiện nay |
| VG-04 | **Đo WCET/jitter trên SOM target** | **KHÔNG CÓ** | Mọi số jitter hiện có là từ log runtime trên host dev. Không có phép đo nào trên aarch64/Orange Pi 5B. Không thể khẳng định cycle time deterministic nếu chưa đo trên phần cứng đích |
| VG-05 | **Xác minh systemd RT capability trên target** | **KHÔNG CÓ** | [main.cpp:112-115](services/core/main.cpp#L112-L115) chỉ in `WARN ... (degraded)` khi `SCHED_FIFO`/`mlockall` thất bại — service vẫn chạy tiếp **không có RT**. Chưa có test nào xác nhận `AmbientCapabilities=CAP_SYS_NICE CAP_IPC_LOCK` thực sự hiệu lực trên target |
| VG-06 | **HIL với MCU thật** | **KHÔNG CÓ** | Toàn bộ test IOP là fake-MCU trong process. Chưa có evidence UART thật, chưa có phép đo 200 ms safe timeout bằng thiết bị |
| VG-07 | **Fault injection** | **KHÔNG CÓ** | Design §7.3 yêu cầu rõ "fault injection test" cho overrun policy. §9.3 yêu cầu fault-inject UART disconnect, corrupted frame, ADC loss, DAC/relay fault, watchdog reset trên target |

Các mục này được đưa thành microtask **V-01..V-07** ở §17 và là điều kiện bắt buộc trước `C0.15`.

---

## 9. Functional Status Matrix

| Chức năng | Trạng thái | Bằng chứng |
|---|---|---|
| Program Runtime (thực thi ST tối thiểu) | **PARTIAL** | `StRuntime` 23 test pass; nhưng chạy AST, không IR (F-02) |
| Task Scheduler + cycle time | **PARTIAL** | 1 cyclic loop deterministic DONE; multi-task/priority NOT_STARTED (F-05) |
| Thực thi IEC 61131-3/ST | **PARTIAL** | Subset REAL/BOOL/IF/CMP/AND-OR-NOT/LIMIT; không có FB/TIME/CASE/loop/arith |
| Quản lý Program / Task / Instance / Runtime State | **PARTIAL** | 1 program active + last-known-good; không có Task/Instance model (C0.2 chưa có) |
| I/O image / process image | **DONE** (substrate) | seqlock snapshot + staging, `ScanLoop` 14 + `IobusReader` 7 test |
| Mapping physical I/O ↔ virtual variable | **PARTIAL** | `validate_io_map()` 12 test; chưa có file/CRUD/consumer |
| Giao tiếp MCU | **DONE (host/fake)** | IOP v2 đầy đủ, fake-MCU test; **chưa có evidence board thật** |
| Giao tiếp BE SOM | **DONE** | `WebIpc` 39 test |
| Deploy / activate / rollback chương trình | **PARTIAL** | activate + rollback last-known-good DONE trong process; deploy/enable/disable/start/stop API NOT_STARTED |
| Watchdog | **DONE** | systemd `Type=notify` + kick mỗi scan |
| Safe state | **DONE** | 4 trigger, `safe_state.cpp:32`, test |
| Fault handling | **DONE** (substrate) | reject NaN/Inf, không commit partial, seqlock fail metric |
| Restart recovery | **PARTIAL** | `Restart=always` + `StateSnapshot` restore; ST RETAIN/warm-start NOT_STARTED (F-06) |
| Runtime diagnostics / metrics | **DONE** | `CoreMetrics`, `StCyclicMetrics`, jitter log 60 s |
| Log | **DONE** | stderr có cấp `INFO/WARN/ERROR/AUDIT` → journald |
| Trace | **PARTIAL** | ring buffer in-process, chưa persist/publish |
| Persistence / versioning (graph) | **DONE** | `StateSnapshot` version=1, atomic write, 8 test |
| Persistence ST RETAIN | **NOT_STARTED** | grep sạch |
| Security / permission | **OUT_OF_SCOPE (FW SOM)** | Auth/RBAC thuộc BE/broker; core chỉ nhận `user` để audit |
| Xác thực gói chương trình (signature) | **NOT_STARTED** | F-07 |
| Typed IR + loader validation | **CODE_WITHOUT_SPEC** | F-02, C0.6 chưa bắt đầu |
| FBD | **SPEC_ONLY** | Chờ approval |
| STM32 firmware | **OUT_OF_SCOPE** | `fw/` |
| FE Program IDE | **OUT_OF_SCOPE** | `src/frontend` |

---

## 10. Architecture and Code Quality Findings

### F-01 — [CRITICAL] ST parser đệ quy không giới hạn độ sâu → stack overflow

- **Vị trí:** [services/core/st/st_parser.cpp:343-348](services/core/st/st_parser.cpp#L343-L348) — `parse_primary()` gọi lại `parse_expr()` khi gặp `(`; không có depth counter ở bất kỳ đâu (grep `depth|MAX_|limit|recursion` trong `st_parser.cpp` chỉ ra 2 dòng không liên quan).
- **Repro:** ST source 24 KB (dưới hạn mức 64 KiB) với 12000 dấu ngoặc lồng → `mkddc-st-validate` **SIGSEGV, exit 139, stdout rỗng**.
- **Tại sao nghiêm trọng:**
  1. Phá vỡ chính contract ghi ở [st_validate_main.cpp:10-16](services/core/st/st_validate_main.cpp#L10-L16) và [INTERFACES.md:59](docs/04_design/INTERFACES.md#L59) — "đúng 1 dòng JSON ra stdout, shape cố định dù ok=true/false". BE sẽ nhận stdout rỗng + exit 139, không phải `ok:false`.
  2. Cùng hàm `parse_st_program()` được gọi **in-process** bởi [st_runtime.cpp:124](services/core/st/st_runtime.cpp#L124). Khi `StCyclicRuntime` được nối vào `main.cpp` (chính là next action đang mở), một deploy ST hỏng sẽ **crash `mkddc-core`** — process điều khiển, không phải CLI phụ.
- **Giảm nhẹ hiện tại:** chưa có consumer nào (BE Go hay `main.cpp`) gọi tới, nên lỗi đang tiềm ẩn, chưa lộ production.
- **Fix:** M-01.

### F-02 — [HIGH] Runtime thực thi AST parse trực tiếp từ source text, không có typed IR

- **SPEC nói gì:** Design §4 ghi rõ — *"Runtime **không** thực thi trực tiếp source ST hay JSON graph — chỉ thực thi artifact đã validate và compile thành typed IR"* ([design §4, dòng 231-233](docs/02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md)). §7.2 bắt buộc loader reject: magic/schema/target ABI/compiler profile không khớp, hash/signature hỏng, vượt limit instruction/constant/instance, invalid jump/reference, I/O binding sai type.
- **Code làm gì:** [st_runtime.cpp:119-135](services/core/st/st_runtime.cpp#L119-L135) — `activate(const std::string& source)` nhận **source text**, gọi `parse_st_program()` + `typecheck_st_program()` rồi swap con trỏ. **Không có** magic, schema version check, ABI check, hash verify, hay resource limit nào.
- **`StProgram` không phải IR:** [st_program.hpp:47-80](services/core/st/st_program.hpp#L47-L80) là AST con trỏ (`std::unique_ptr<StExpr>`, `std::vector<StStmt>` lồng nhau) — không serialize được, không có schema, không bounds-check operand. Header tự gọi là "typed IR" nhưng không đáp ứng định nghĩa §7.2.
- **`kStIrSchemaVersion = 1`** ([st_artifact.hpp:22](services/core/st/st_artifact.hpp#L22)) được emit ra JSON nhưng **không có gì đọc/validate** — không tồn tại IR để version.
- **Fix:** M-02 (quyết định kiến trúc, cần C0.6 trước).

### F-03 — [HIGH] Cấp phát heap trong scan execution path

- **SPEC nói gì:** Design §7.2 — *"Runtime pre-allocate code, constant, instance và task memory khi load; không allocation, file I/O hoặc network I/O trong scan execution."*
- **Code làm gì:** [st_runtime.cpp:167-173](services/core/st/st_runtime.cpp#L167-L173) mỗi lần `execute()`:
  - `StIoImage staged;` — `std::map<std::string, StValue>`, cấp node mỗi output;
  - `StIoImage view = inputs;` — **copy nguyên map**, cấp node mỗi input;
  - vòng `for (const auto& kv : staged) view[kv.first] = kv.second;` — thêm cấp phát.
  - Ngoài ra [st_runtime.cpp:77-78](services/core/st/st_runtime.cpp#L77-L78): mỗi `CALL` cấp `std::vector<StValue> args`.
- **Hệ quả:** jitter không bị chặn trên (malloc có thể chạm `brk`/`mmap`), đi ngược mục tiêu deterministic của một control runtime. `mlockall(MCL_FUTURE)` ở [main.cpp:114](services/core/main.cpp#L114) giảm rủi ro page fault nhưng **không** loại bỏ chi phí allocator.
- **Giảm nhẹ hiện tại:** ST chưa nối scan loop nên chưa ảnh hưởng production.
- **Fix:** M-03.

### F-04 — [MEDIUM] Overrun không kích hoạt safe state và không sinh alarm

- **SPEC nói gì:** Design §10 — *"Task overrun | Ghi WCET/overrun, **alarm**; **repeated threshold chuyển safe** theo config đã test."* §7.3 — *"Overrun policy và safe output phải cấu hình có giới hạn, có alarm, fault injection test."*
- **Code làm gì:** [core_metrics.cpp:13-15](services/core/diagnostics/core_metrics.cpp#L13-L15) tăng counter + in `WARN scan.overrun`. Counter được publish vào PLC SHM ([scan_loop.cpp:228](services/core/graph/scan_loop.cpp#L228)) và in ở shutdown. **Hết.**
- **Thiếu:** không có ngưỡng cấu hình được, không có đường nối tới `SafeState::apply()` ([safe_state.cpp:32](services/core/safety/safe_state.cpp#L32) — `trigger` chỉ gồm `fault || stale || graph_input_bad || no_controller`), không có alarm code trong `AlarmRuntime`.
- **Ràng buộc thiết kế khi fix — KHÔNG đặt safety policy vào `CoreMetrics`:** `CoreMetrics` là **observability thuần tuý** (đếm, đo, publish). Nhét ngưỡng an toàn và quyết định chuyển safe-state vào đây sẽ trộn hai trách nhiệm khác hạng: một component có thể tắt/bỏ qua mà không ảnh hưởng điều khiển sẽ bỗng nhiên nắm quyền quyết định an toàn, và policy an toàn sẽ không thể test độc lập khỏi bộ đếm.
  - Tách thành **`OverrunMonitor`** (nhận `exec_ns`/`budget_ns`, giữ ngưỡng cấu hình, quyết định `should_force_safe()`) và **`TaskHealthMonitor`** (tổng hợp sức khoẻ per-task khi có multi-task ở M-06), đặt trong `safety/`, **không** đặt trong `diagnostics/`.
  - `CoreMetrics` giữ nguyên vai trò cũ: chỉ đếm và publish, không có nhánh điều khiển nào.
  - `SafeState::apply()` nhận kết quả từ `OverrunMonitor` như một trigger ngang hàng với `fault`/`stale`/`graph_input_bad`/`no_controller`.
- **Fix:** M-04.

### F-05 — [MEDIUM] Không có multi-task scheduler

Design §7.3 yêu cầu *"Mỗi resource có một tập task versioned"*, *"Task priority, period, watchdog budget và Program order nằm trong project manifest"*. Thực tế: một cyclic loop duy nhất, period lấy từ `graph.json` `scan_ms` (hợp lệ 500..2000 ms, [graph_runtime.cpp:164-169](services/core/graph/graph_runtime.cpp#L164-L169)) hoặc `--scan-ms`. Không có khái niệm task set, priority, hay per-task budget. Đây là **NOT_STARTED có chủ ý** (C0.7 chưa bắt đầu), không phải bug — nhưng phải có SPEC trước khi code.

### F-06 — [MEDIUM] Không có RETAIN / warm start cho ST

Design §7.4 quy định đầy đủ RETAIN, CRC record, atomic write, reject retain corrupt, cold/warm start test. grep `retain|persist` trong `services/core/st/` chỉ trả về **1 dòng comment**. `StateSnapshot` hiện chỉ phục vụ component graph, không phải ST program state.

### F-07 — [MEDIUM] Không có cơ chế integrity/signature cho package

Design §7.2 yêu cầu loader reject "hash/signature metadata hỏng". `compute_artifact_hash()` là FNV-1a 64-bit — **tài liệu đã ghi rõ và trung thực** rằng đây không phải hash mật mã ([st_artifact.hpp:7-11](services/core/st/st_artifact.hpp#L7-L11), [INTERFACES.md:75-77](docs/04_design/INTERFACES.md#L75-L77)). Ghi nhận đây là điểm minh bạch tốt, nhưng hạng mục "xác thực gói chương trình" vẫn là NOT_STARTED.

### F-08 — [LOW/DOC] `INTERFACES.md` còn path trước ADR-021

[INTERFACES.md:44](docs/04_design/INTERFACES.md#L44) ghi "Nguồn thực thi: `services/core/st_*.{hpp,cpp}`" và dòng 89 tham chiếu `st_stdlib.hpp`. Sau ADR-021 Phase A, đường dẫn đúng là `services/core/st/st_*.{hpp,cpp}`. **Tài liệu sai, code đúng** → sửa tài liệu.

### F-09 — [LOW/DOC] Số test lỗi thời trong C1–C10 plan

Plan ghi "`services/` CTest **468/468** pass". Đo thật hôm nay: **477/477**. Sửa tài liệu.

### F-10 — [LOW/DOC] `32_DEV_TEAM_NEXT_ACTION.md` lỗi thời nặng

Doc v1.1 (2026-06-22) ghi "226/226 test", "`modbus_master.open()` trả `false` ngay — libmodbus chưa install", "`bacnet_server.start()` là `fprintf + return`". Thực tế hôm nay: 477 test, `libmodbus 3.1.10` resolve được, `bacnet-stack` build với `BACDL_BIP=ON`. **Tài liệu sai, code đúng** → cập nhật hoặc đánh dấu Superseded.

### F-11 — [GOVERNANCE] 15/15 workstream C0 `Chưa bắt đầu` nhưng code đã merge

[C0 plan](docs/07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md) — mọi workstream C0.1 → C0.15 đều ghi `Trạng thái: Chưa bắt đầu`. Trong khi đó code ST đã merge vào `services/core`. Hệ quả trực tiếp:

| Workstream C0 | Đáng lẽ định nghĩa | Code đã có | Trạng thái |
|---|---|---|---|
| C0.4 ST subset grammar/semantic | Grammar chính thức | `st_parser.cpp`, `st_semantic.cpp` | CODE_WITHOUT_SPEC |
| C0.6 Typed IR | Schema/version IR | Không có IR (F-02) | Cả hai đều thiếu |
| C0.7 Deterministic scheduler model | Task model | `st_cyclic_runtime.cpp` | CODE_WITHOUT_SPEC |
| C0.10 SOM–MCU I/O image contract | Binding contract | `st_io_map.cpp` | CODE_WITHOUT_SPEC |

Đây là **hệ quả có thể dự đoán được** của ngoại lệ `FW-SOM-ST-001` (cho phép code trước khi C0 xong). Không phải vi phạm quy trình, nhưng nợ tài liệu phải trả trước khi mở C1.

### F-12 — [LOW] Biên độ watchdog mỏng ở cấu hình scan chậm nhất

[mkddc-core.service](packaging/systemd/mkddc-core.service) đặt `WatchdogSec=3`; core gửi `WATCHDOG=1` sau **mỗi** scan ([main.cpp:286](services/core/main.cpp#L286)). Với `scan_ms` tối đa hợp lệ = 2000 ms, khoảng kick là 2 s — vẫn dưới 3 s nên đúng, nhưng chỉ còn **1 s biên**. Một scan overrun >1 s sẽ khiến systemd restart core. Hành vi này có thể là mong muốn (watchdog đúng nghĩa) nhưng **chưa được ghi ở tài liệu nào** và chưa có test.

**Ràng buộc bắt buộc khi fix — KHÔNG kick watchdog giữa scan.** Cách sửa "dễ" là gọi `WATCHDOG=1` thêm ở giữa `step()` để nới biên. **Cấm làm vậy.** Watchdog phải chứng minh *scan hoàn tất thành công*, không phải *process còn sống*. Kick giữa scan biến watchdog thành liveness check vô nghĩa: một `step()` treo vĩnh viễn ở giữa vẫn kick đều và systemd sẽ không bao giờ restart — đúng loại lỗi mà watchdog sinh ra để bắt. Điều này cũng khớp Design §9.2 (`diag_wdg`): *"Watchdog feed phải phản ánh health của scheduler/I/O, không chỉ việc CPU còn chạy vòng lặp."*

Hướng đúng: **chỉ kick sau một cycle hoàn tất thành công** (giữ nguyên vị trí hiện tại trong `after_scan`), rồi chọn `WatchdogSec` từ số đo WCET thật trên target chứ không từ suy đoán. Việc chốt giá trị này phụ thuộc `V-03` (đo WCET/jitter trên SOM) và `V-04` (xác minh RT capability trên target) — không được chốt bằng đo trên host.

### Đánh giá chất lượng — các câu hỏi bắt buộc

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Kiến trúc đúng trách nhiệm FW SOM? | **Có** | Ownership §4.1 được tôn trọng: core không mở UART ([main.cpp:3-5](services/core/main.cpp#L3-L5)), iobus là creator io_shm, core là creator plc_shm |
| Có trộn trách nhiệm BE/FE/MCU vào FW SOM? | **Không** | Không có HTTP server, không có auth/RBAC trong core; core chỉ nhận `user` string để audit |
| Runtime deterministic? | **Một phần** | Scan loop: có (mốc tuyệt đối, SCHED_FIFO 80, mlockall, single-thread). ST runtime: **không** (F-03 allocation) |
| Scheduler bảo đảm cycle time / overrun / priority? | **Một phần** | Cycle time + overrun detection: có. Task priority: **không có khái niệm** (F-05). Overrun → hành động: **không** (F-04) |
| I/O snapshot nhất quán trong 1 cycle? | **Có** | seqlock read 1 lần đầu scan, `last_io_` dùng xuyên suốt `step()`, fallback snapshot cũ khi read fail |
| Safe state khi mất MCU / lỗi comm / crash? | **Có** | 4 trigger ([safe_state.cpp:32](services/core/safety/safe_state.cpp#L32)) + MCU tự safe 200 ms + `Restart=always` |
| Watchdog + automatic recovery? | **Có** (xem F-12) | `Type=notify` + `WatchdogSec` + `Restart=always` + re-attach SHM mỗi scan |
| Update không hỏng cấu hình đang vận hành? | **Có** | SIGHUP tại ranh giới scan, fail → giữ config cũ; activation fail → giữ package cũ |
| Code maintain / test / mở rộng được? | **Có** | 8 domain subfolder, 477 test, cppcheck 0 error, `-Werror` |
| Có blocker khiến implement tiếp không an toàn? | **Có — F-01, F-02, F-03** | Xem §14 |

---

## 11. Missing Specifications

| # | Thiếu | Ảnh hưởng | Ai viết |
|---|---|---|---|
| MS-01 | **C0.6 Typed IR schema** — magic, version, ABI, giới hạn tài nguyên, luật reject | Chặn F-02; không có IR thì không thể tách compile/execute | Program Runtime Architect |
| MS-02 | **C0.4 ST subset grammar chính thức** (EBNF) + luật giới hạn (độ sâu biểu thức, số biến, số statement) | Chặn F-01 (không biết ngưỡng đúng là bao nhiêu) | Program Runtime Architect |
| MS-03 | **C0.7 Deterministic scheduler model** — task set, priority, period, per-task watchdog budget, overrun policy | Chặn F-05, F-04 | Program Runtime Architect + SOM Backend Lead |
| MS-04 | **C0.2 Program/Resource/Task/POU model** | Chặn quản lý Program Instance | Program Runtime Architect |
| MS-05 | **C0.10 SOM–MCU I/O image contract** cho ST variable ↔ point | `st_io_map` đang tự định nghĩa luật (`PREFIX-NN`) mà không có SPEC | SOM Backend Lead |
| MS-06 | **C0.11 Security/permission/audit model** cho program package | Chặn F-07 | Security + Architect |
| MS-07 | SPEC cho hành vi watchdog khi scan chậm (F-12) | Không rõ restart là mong muốn hay sự cố | SOM Backend Lead |
| MS-08 | Retain/warm-start policy cụ thể cho ST (§7.4 mới ở mức nguyên tắc) | Chặn F-06 | Architect |

## 12. Missing Implementations

| # | Thiếu | Trạng thái | Phụ thuộc |
|---|---|---|---|
| MI-01 | Typed IR + serializer + loader validation | NOT_STARTED | MS-01 |
| MI-02 | Depth limit trong parser + diagnostic code | NOT_STARTED | MS-02 (có thể làm ngay với ngưỡng tạm) |
| MI-03 | Pre-allocated execution context (bỏ allocation trong scan) | NOT_STARTED | — |
| MI-04 | `OverrunMonitor` + `TaskHealthMonitor` trong `safety/` (tách khỏi `CoreMetrics`) → safe state + alarm code | NOT_STARTED | MS-03 |
| MI-05 | Multi-task scheduler | NOT_STARTED | MS-03 |
| MI-06 | ST RETAIN + cold/warm start | NOT_STARTED | MS-08 |
| MI-07 | Package signature/integrity | NOT_STARTED | MS-06 |
| MI-08 | `io_map.json` storage + CRUD | NOT_STARTED | BE (C2) |
| MI-09 | Trace persist + publish ra ngoài process | NOT_STARTED | C1+ |
| MI-10 | Wire `StCyclicRuntime` vào `ScanLoop` | NOT_STARTED | **Bị chặn bởi B-01..B-05 + C0.15 PASS** |
| MI-11 | BE Go gọi `mkddc-st-validate` | NOT_STARTED | M-01 phải xong trước |
| MI-12 | ST stdlib mở rộng (arith, `SEL`, `TON`, `CASE`) | NOT_STARTED | MS-02 |
| MI-13 | Build + CI job ASan/UBSan (VG-01, VG-02) | NOT_STARTED | — (làm được ngay) |
| MI-14 | Fuzz harness cho `parse_st_program()` + `mkddc-st-validate` (VG-03) | NOT_STARTED | M-01 (fix trước, fuzz để chứng minh) |
| MI-15 | Đo WCET/jitter trên SOM target aarch64 (VG-04) | NOT_STARTED | Cần board |
| MI-16 | Xác minh systemd RT capability trên target (VG-05) | NOT_STARTED | Cần board |
| MI-17 | HIL rig với MCU thật (VG-06) | NOT_STARTED | Cần board + MCU |
| MI-18 | Fault-injection suite (VG-07) | NOT_STARTED | MI-17 |

## 13. Conflicts and Technical Debt

| # | Mâu thuẫn | Bên nào đúng | Hành động |
|---|---|---|---|
| C-01 | Design §4/§7.2 "runtime chỉ chạy typed IR" **vs** `st_runtime.cpp:119` chạy AST từ source | **SPEC đúng, code lệch** | Sửa code (M-02) sau khi có MS-01 |
| C-02 | Design §7.2 "không allocation trong scan execution" **vs** `st_runtime.cpp:167-173` | **SPEC đúng, code lệch** | Sửa code (M-03) |
| C-03 | Design §10 "overrun → alarm + ngưỡng → safe" **vs** chỉ có counter + WARN | **SPEC đúng, code thiếu** | Sửa code (M-04) |
| C-04 | `INTERFACES.md:44` path `services/core/st_*` **vs** thực tế `services/core/st/st_*` | **Code đúng, doc sai** | Sửa doc (M-07) |
| C-05 | C1–C10 plan "468/468" **vs** đo thật 477/477 | **Code đúng, doc sai** | Sửa doc (M-07) |
| C-06 | `32_DEV_TEAM_NEXT_ACTION.md` "libmodbus chưa install, BACnet no-op" **vs** build thật OK | **Code đúng, doc sai** | Sửa doc (M-08) |
| C-07 | C0 plan 15/15 `Chưa bắt đầu` **vs** code ST đã merge | Cả hai đúng theo ngoại lệ CTO, nhưng **nợ tài liệu** | Viết MS-01..MS-05 |
| C-08 | `st_program.hpp` tự gọi là "typed IR" **vs** nó là AST | **Tên gọi sai lệch** | Đổi comment khi làm M-02 |
| **TD-01** | `kStIrSchemaVersion` emit ra API nhưng không ai validate | Nợ kỹ thuật | Gắn nghĩa thật khi M-02 |
| **TD-02** | `mkddc-st-validate` có contract + test nhưng 0 consumer | Nợ tích hợp | MI-11 |
| **TD-03** | Toàn bộ evidence IOP/Modbus/BACnet là host/fake, chưa có board thật | Nợ verification | HIL — ngoài scope FW SOM code |

---

## 14. Blockers

| # | Blocker | Chặn cái gì | Mức |
|---|---|---|---|
| ~~**B-01**~~ | ~~**F-01** — parser segfault~~ | **ĐÓNG 2026-07-28 (M-01)** — giới hạn tài nguyên + `ST-SYN-002`/`ST-LIM-*`, 27 test đối kháng, ctest 504/504. `PARSER_SAFETY_GATE = PASS` | ~~CHẶN CỨNG~~ **ĐÃ GỠ** |
| **B-02** | **F-02** — chưa có typed IR/artifact contract | Chặn C1+ (`mkddc-program-service` không có gì để build/deploy), chặn F-07 | **CHẶN CỨNG cho C1+** |
| **B-03** | **F-03** — allocation trong scan path | Chặn MI-10: không được đưa allocation vào vòng RT SCHED_FIFO 80 | **CHẶN CỨNG cho MI-10** |
| **B-04** | **MS-01/MS-03** — C0.6, C0.7 chưa có SPEC | Chặn MI-01, MI-04, MI-05 | CHẶN THIẾT KẾ |
| **B-05** | C0.15 go/no-go chưa chạy | Chặn chính thức toàn bộ C1–C10 | CHẶN QUY TRÌNH |
| **B-06** | Không có board/HIL evidence | Chặn G4 (I/O/MCU gate) | Ngoài scope code |
| **B-07** | **VG-01..VG-07** — không có ASan/UBSan/fuzzing/WCET target/RT capability/HIL/fault-injection | Chặn C0.15 PASS: không có cơ sở để tuyên bố runtime an toàn khi chưa từng kiểm bằng input đối kháng và chưa từng đo trên target | **CHẶN VERIFICATION** |

**Không phải blocker:** build, test, lint, transport library — tất cả đã xanh và verify được.

### 14.1 Quy tắc gating (bắt buộc, không diễn giải lại)

> **Chưa được wire ST vào `ScanLoop`, và chưa được mở C1+, cho tới khi TOÀN BỘ blocker `B-01` → `B-05` được đóng VÀ `C0.15` cho kết quả PASS.**

Ba hệ quả cụ thể của quy tắc này:

1. Đóng `B-01` (fix `F-01`) **một mình không đủ** để wire vào `ScanLoop`. Đây là hiểu nhầm dễ xảy ra nhất vì `F-01` là finding dễ thấy nhất.
2. `B-07` không nằm trong danh sách `B-01..B-05` nhưng là **điều kiện đầu vào của `C0.15`** — không có evidence VG-01..VG-07 thì `C0.15` không có cơ sở để PASS.
3. Không có đường tắt "wire tạm để test tích hợp". Một khi `StCyclicRuntime` nằm trong `ScanLoop`, nó chạy trong vòng `SCHED_FIFO 80` của process điều khiển — không còn là host-only nữa, bất kể chủ ý.

---

## 15. Recommended Fixes

Thứ tự đã được sắp lại **theo dependency**, không theo mức độ dễ làm. Bảng chi tiết ở §17; đây là 8 chặng:

```text
① M-01 (depth limit — chặn cứng, làm trước hết)
      ↓
② Cập nhật docs lỗi thời (M-07, M-08 — rẻ, gỡ nhiễu cho người làm tiếp)
      ↓
③ MS-02 (C0.4 grammar+limits) → MS-01 (C0.6 typed IR) → MS-03 (C0.7 scheduler)
      ↓            SPEC phải xong trước khi chạm lại runtime
④ M-02 (typed IR impl) + M-03 (pre-allocated exec context)
      ↓
⑤ M-04 (OverrunMonitor tách khỏi Metrics) / M-05 (watchdog sau cycle thành công)
      ↓
⑥ Verification gates V-01..V-07 (ASan, UBSan, fuzzing, WCET target,
      ↓                            RT capability, HIL, fault-injection)
⑦ C0.15 go/no-go — PASS
      ↓
⑧ M-09 (wire ST vào ScanLoop) → M-10 (BE integration)
```

**Vì sao MS-02 đứng trước MS-01:** grammar và bảng giới hạn (C0.4) quyết định IR phải mã hoá được cái gì và loader phải reject ngưỡng nào. Viết IR schema trước grammar là đặt cày trước trâu — và cũng là lý do ngưỡng depth trong M-01 chỉ là **giá trị tạm**, chốt chính thức ở MS-02.

**Vì sao M-03 lùi xuống chặng ④ thay vì làm sớm:** pre-allocated execution context phải cấp phát theo *layout của IR* (số slot, số constant, số instance). Làm M-03 trước M-02 sẽ phải viết lại toàn bộ khi IR ra đời.

**Vì sao verification gates đứng trước C0.15 chứ không sau:** `C0.15` là go/no-go. Nếu evidence đối kháng và evidence trên target chưa có, `C0.15` không có dữ liệu để quyết định — nó sẽ trở thành thủ tục đóng dấu.

---

## 16. Implementation Readiness

| Câu hỏi | Trả lời | Cờ trạng thái |
|---|---|---|
| Baseline `mkddc-iobus` + `mkddc-core` hiện hành có ổn định để tiếp tục vận hành/bảo trì không? | **Có.** 477/477, 0 skip, `-Werror` sạch, cppcheck 0 error. Không finding nào chặn baseline | `EXISTING_FW_SOM_BASELINE = STABLE` |
| Lát cắt "chạy ST tối thiểu trên SOM host runtime" (`FW-SOM-ST-001`) đã xong chưa? | **Rồi.** Chương trình demo bắt buộc trong C1–C10 plan §0.1 đã chạy thật, 61 test ST pass, build/CTest evidence có | `FW_SOM_ST_HOST_SLICE = COMPLETED` |
| Có đủ điều kiện **wire ST vào production scan loop** không? | **Không.** Cần B-01..B-05 đóng **và** C0.15 PASS (§14.1) | `PRODUCTION_ST_INTEGRATION = BLOCKED` |
| Có đủ điều kiện mở **C1+** không? | **Không.** B-02, B-04, B-05 chưa đóng | `C1_PLUS_OPENING = BLOCKED` |
| Có đủ điều kiện tiếp tục implement **trong lát cắt host-only** không? | **Có, theo đúng thứ tự §15** — bắt đầu từ M-01 rồi docs rồi SPEC. Không được nhảy cóc sang M-09 | — |
| Có cơ sở để tuyên bố runtime an toàn không? | **Chưa.** Không có ASan/UBSan/fuzzing/WCET target/HIL/fault-injection (§8.5, B-07) | — |

---

## 17. Next Implementation Plan

Thứ tự dưới đây là **thứ tự thi hành theo dependency**, đọc từ trên xuống. ID microtask (`M-xx`, `MS-xx`, `V-xx`) giữ nguyên để cross-reference với §11–§15 không đổi; chỉ cột "Thứ tự" phản ánh trình tự làm.

### Chặng ① — Gỡ blocker cứng

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 1 | **M-01** Thêm depth counter cho recursive descent. Trường `int depth_` trong parser; tăng/giảm ở `parse_expr`, `parse_stmt_list`; vượt ngưỡng → trả `StDiagnostic` code mới `ST-SYN-002` (nesting quá sâu) kèm line/column. Ngưỡng tạm **64**, ghi rõ trong comment là giá trị tạm **chờ MS-02 chốt** | `st/st_parser.cpp`, `st/st_parser.hpp`, `st/st_diagnostic.hpp` | Không | Parser không bao giờ segfault; CLI luôn trả 1 dòng JSON | Test `StParser.DeepNestingRejectedNotCrash`: source 12000 ngoặc → `parse_st_program()` trả false, code `ST-SYN-002`. Test `StValidateCli.DeepNestingExitsOneWithJson`: exit 1, stdout parse được JSON. Chạy lại repro thủ công 20000 ngoặc | **P0** |

### Chặng ② — Cập nhật tài liệu lỗi thời (gỡ nhiễu cho người làm tiếp)

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 2 | **M-07** Sửa `INTERFACES.md`: path `services/core/st/st_*` (F-08). Phần mô tả kiến trúc runtime để lại, cập nhật sau M-02 | `docs/04_design/INTERFACES.md` | Không | Doc khớp code | Đối chiếu từng path bằng `ls` | **P0** |
| 3 | **M-08** Cập nhật `32_DEV_TEAM_NEXT_ACTION.md` (226→477 test; MOD-012/BAC-012 đã có thư viện thật — F-10) và C1–C10 plan (468→477 — F-09) | `docs/03_implementation/32_DEV_TEAM_NEXT_ACTION.md`, `docs/07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md` | Không | Doc khớp kết quả đo | Chạy lại `ctest`, đối chiếu số | **P0** |

### Chặng ③ — SPEC (bắt buộc xong trước khi chạm lại runtime)

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 4 | **MS-02** Viết C0.4: ST subset grammar EBNF + **bảng giới hạn** (độ sâu biểu thức, số biến, số statement, độ dài định danh, kích thước source) | C0 plan §C0.4 | M-01 đã cho số liệu thực nghiệm về ngưỡng | Grammar chính thức; **chốt ngưỡng depth thay giá trị tạm 64 của M-01** | Đối chiếu grammar với `st_parser.cpp` từng luật; cập nhật ngưỡng M-01 nếu khác 64 | **P1** |
| 5 | **MS-01** Viết C0.6 Typed IR spec: magic, schema version, target ABI, encoding instruction, bảng constant, giới hạn tài nguyên, **danh sách đầy đủ luật reject của loader** | C0 plan §C0.6 + tài liệu schema mới | **MS-02** (grammar quyết định IR phải mã hoá cái gì) | SPEC đủ để implement M-02 | Review Architect; đối chiếu từng dòng luật reject Design §7.2 | **P1** |
| 6 | **MS-03** Viết C0.7 Deterministic scheduler model: task set, priority, period, per-task watchdog budget, **overrun policy + ngưỡng mặc định**, ranh giới trách nhiệm `OverrunMonitor` vs `CoreMetrics` | C0 plan §C0.7 | MS-01 | SPEC đủ để implement M-04 và M-06 | Review Architect + SOM Backend Lead | **P1** |

### Chặng ④ — Runtime core (IR + determinism)

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 7 | **M-02** Implement typed IR: serializer AST→IR, loader validate (magic/version/ABI/limit/binding), `activate()` đổi chữ ký nhận **artifact bytes** thay vì source text. CLI sinh artifact. Sửa comment "typed IR" sai ở `st_program.hpp` (C-08), gắn nghĩa thật cho `kStIrSchemaVersion` (TD-01) | `st/st_ir.{hpp,cpp}` (mới), `st/st_runtime.{hpp,cpp}`, `st/st_artifact.{hpp,cpp}`, `st/st_program.hpp`, `st/st_validate_main.cpp` | **MS-01 duyệt** | Runtime không còn parse source; đúng Design §4/§7.2 | Round-trip AST→IR→execute cho toàn bộ 23 case `StRuntime` hiện có; test loader reject **từng** luật §7.2 (magic sai, version sai, ABI sai, vượt limit, binding sai type) | **P1** |
| 8 | **M-03** Pre-allocate execution context theo **layout của IR**: `StExecContext` giữ `std::vector<StValue>` slot input/output + bảng chỉ số dựng **một lần** khi load artifact. `execute()` chỉ ghi vào vector đã cấp, bỏ `std::map` và bỏ copy `view`. Thay `view.find(name)` bằng chỉ số resolve tại compile time | `st/st_runtime.{hpp,cpp}`, `st/st_ir.{hpp,cpp}`, `st/st_semantic.cpp` | **M-02** (layout slot đến từ IR — làm trước sẽ phải viết lại) | `execute()` không cấp phát heap; O(1) truy cập biến | `StRuntime.ExecuteDoesNotAllocate`: override `operator new` đếm allocation, chạy 1000 cycle → count == 0. 23 test `StRuntime` cũ vẫn phải pass | **P1** |
| 9 | **M-06** Implement multi-task scheduler theo MS-03 | `st/st_scheduler.{hpp,cpp}` (mới), `st/st_cyclic_runtime.cpp` | MS-03, M-02, M-03 | Task set với priority/period/budget | Test task order deterministic, per-task overrun, priority preemption | **P2** |

### Chặng ⑤ — Safety policy và watchdog

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 10 | **M-04** Tạo **`OverrunMonitor`** trong `safety/` (giữ ngưỡng cấu hình từ `io_safe_state.conf`, đếm overrun liên tiếp, expose `should_force_safe()`) và **`TaskHealthMonitor`** (tổng hợp sức khoẻ per-task). Thêm trigger `overrun_exceeded` vào `SafeState::apply()`; thêm alarm code `E4xx` vào `AlarmRuntime`. **`CoreMetrics` KHÔNG được đổi vai trò — giữ nguyên chỉ đếm/publish, không chứa ngưỡng an toàn, không có nhánh điều khiển** | `safety/overrun_monitor.{hpp,cpp}` (mới), `safety/task_health_monitor.{hpp,cpp}` (mới), `safety/safe_state.{hpp,cpp}`, `safety/safe_state_config.cpp`, `alarm/alarm_runtime.cpp`. **KHÔNG sửa `diagnostics/core_metrics.*`** | MS-03 duyệt ngưỡng mặc định | Overrun lặp N lần → AO safe/DO open + alarm, policy test được độc lập khỏi bộ đếm | `OverrunMonitor.ConsecutiveOverrunTriggersThreshold`; `OverrunMonitor.ResetsWhenScanRecovers`; `SafeState.OverrunMonitorForcesSafe`; test khẳng định `CoreMetrics` không có API nào ảnh hưởng output | **P1** |
| 11 | **M-05** Watchdog: **giữ kick CHỈ sau một cycle hoàn tất thành công** (vị trí `after_scan` hiện tại). **Cấm thêm kick giữa `step()`.** Chốt `WatchdogSec` từ WCET đo trên target (V-03), không từ suy đoán; ghi quan hệ `WatchdogSec` ↔ `scan_ms` max vào doc | `packaging/systemd/mkddc-core.service`, `docs/04_design/INTERFACES.md`, `docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md`. **KHÔNG sửa `graph/scan_loop.cpp` để chèn kick** | **V-03, V-04** (phải có số đo target trước khi chốt giá trị) | Watchdog chứng minh *cycle hoàn tất*, không phải *process còn sống* | Test tích hợp trên **target SOM**: chạy `--scan-ms 2000`, không bị systemd kill trong 60 s. Test fault-injection: treo `step()` nhân tạo → systemd **phải** restart trong `WatchdogSec` | **P1** |

### Chặng ⑥ — Verification gates (điều kiện đầu vào của C0.15)

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 12 | **V-01** Thêm build preset + CI job **ASan** (`-fsanitize=address -fno-omit-frame-pointer`) chạy toàn bộ CTest | `services/CMakeLists.txt`, `.github/workflows/build-and-test.yml` | Không (làm được ngay) | CI bắt được stack/heap overflow có chẩn đoán | Job ASan xanh trên 477 test; chạy lại repro `F-01` dưới ASan phải cho stack-overflow report thay vì SIGSEGV câm | **P1** |
| 13 | **V-02** Thêm build preset + CI job **UBSan** (`-fsanitize=undefined,float-divide-by-zero,implicit-conversion`) | `services/CMakeLists.txt`, `.github/workflows/build-and-test.yml` | Không | Bắt UB trong số học float và ép kiểu int24→int32 | Job UBSan xanh trên 477 test; mọi finding phải fix hoặc suppress có lý do ghi rõ | **P1** |
| 14 | **V-03** Fuzz harness (libFuzzer/AFL++) cho `parse_st_program()` và `mkddc-st-validate`; corpus seed từ test hiện có; chạy tối thiểu 1 giờ trong CI nightly | `services/core/st/fuzz/` (mới), workflow nightly | **M-01** (fix trước, fuzz để chứng minh không còn crash class này) | Không còn crash/hang trên bề mặt input ngoài | Fuzz 1 giờ → 0 crash, 0 timeout, 0 OOM. Lưu corpus + log làm evidence | **P1** |
| 15 | **V-04** Đo **WCET và jitter trên SOM target aarch64** (Orange Pi 5B): chạy `mkddc-core` ≥1 giờ dưới tải, thu `max_exec_ns`, phân bố jitter, overrun count | `tools/` script đo + `docs/00_management/evidence/` | Cần board | Số WCET thật để chốt `WatchdogSec` (M-05) và budget task (MS-03) | Log có timestamp + histogram jitter; so sánh với `scan_ms` đã cấu hình | **P1** |
| 16 | **V-05** Xác minh **systemd RT capability trên target**: khẳng định `SCHED_FIFO 80` và `mlockall` thực sự hiệu lực, không rơi vào nhánh `WARN ... (degraded)` | `packaging/systemd/mkddc-core.service`, script kiểm tra | Cần board | RT thật sự bật trên target, không phải giả định | Trên target: `chrt -p $(pidof mkddc-core)` cho `SCHED_FIFO prio 80`; `grep VmLck /proc/<pid>/status` > 0; journal **không** có dòng `rt.sched_fifo_fail`/`rt.mlockall_fail` | **P1** |
| 17 | **V-06** Dựng **HIL rig** với MCU thật: UART 921600, đo `IO_RESP` round-trip, đo **200 ms safe timeout bằng thiết bị** (oscilloscope/logic analyzer) | `docs/00_management/evidence/hil/` | Cần board + MCU | Evidence G4 | Đo timestamp thật cho safe timeout; xác nhận `HANDSHAKE_RESP` cap `0x000D`; xác nhận `IO_RESP` 74/80 byte đúng endian | **P2** |
| 18 | **V-07** **Fault-injection suite** theo Design §7.3/§9.3: UART disconnect, frame sai CRC/LEN/SEQ, ADC loss, DAC/relay fault, watchdog reset, SHM stale, overrun nhân tạo | `tools/fault_injection/` (mới) | V-06 | Chứng minh safe-state và recovery hoạt động thật, không chỉ trên unit test | Mỗi kịch bản: AO về safe, DO open, alarm đúng code, recovery đúng; lưu log evidence | **P2** |

### Chặng ⑦ — Cổng quyết định

| Thứ tự | Microtask | Điều kiện đầu vào | Kết quả đầu ra | Mức ưu tiên |
|--------|-----------|-------------------|----------------|-------------|
| 19 | **C0.15 go/no-go** — review toàn bộ C0.1–C0.14 + evidence V-01..V-07, ra quyết định chính thức | **B-01..B-05 đã đóng** + V-01..V-07 có evidence | `PASS` hoặc `FAIL` có ghi lý do. Chỉ khi `PASS` mới mở chặng ⑧ | **P1** |

### Chặng ⑧ — Tích hợp production (KHÓA cho tới khi C0.15 PASS)

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 20 | **M-09** Wire `StCyclicRuntime` vào `ScanLoop` | `services/core/main.cpp`, `graph/scan_loop.{hpp,cpp}` | **B-01..B-05 đóng VÀ C0.15 = PASS** (§14.1) | ST chạy thật trong `mkddc-core` | `ScanLoop.StProgramExecutesInScan`; integration: deploy ST hỏng → core không crash, giữ package cũ; **đo lại jitter trên target** trước/sau, không được xấu đi | **P2** |
| 21 | **M-10** BE Go gọi `mkddc-st-validate` với timeout + parse JSON (đóng TD-02) | `web/backend/` | M-01, M-02 xong | BE validate được ST source | Test Go: exit 0/1/2, timeout, stdout không phải JSON → lỗi rõ ràng, không panic | **P2** |

### Chặng ⑨ — Sau tích hợp

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 22 | **M-11** ST RETAIN + cold/warm start | `st/st_retain.{hpp,cpp}` (mới) | MS-08, M-02 | Retain record có CRC, atomic write, reject corrupt | Test cold start, warm start, retain corrupt, layout mismatch | **P3** |
| 23 | **M-12** Package signature/integrity (thay FNV-1a bằng SHA-256 + chữ ký) | `st/st_artifact.cpp`, loader | MS-06, M-02 | Loader reject package giả mạo | Test chữ ký hợp lệ/không hợp lệ/thiếu | **P3** |
| 24 | **M-13** ST stdlib mở rộng (arith, `SEL`, `TON`, `CASE`) | `st/st_stdlib.*`, `st/st_parser.cpp` | MS-02 | Ngôn ngữ đủ dùng thực tế | Test từng function + typecheck | **P3** |

**Đường găng (critical path) cho một kỹ sư làm liên tục:** `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 12 → 13 → 14` rồi dừng chờ board cho `15 → 16 → 17 → 18`, sau đó `11 → 19 → 20 → 21`. Các mục `9`, `22`, `23`, `24` chạy song song được khi có người thứ hai.

---

## 18. Final PM Conclusion

### Kết luận tổng thể: `FW_SOM_IMPLEMENTATION_BLOCKED`

### 18.1 Bốn trạng thái tách riêng — đây mới là bức tranh đúng

Một nhãn duy nhất không mô tả được tình trạng thật của FW SOM. Phải đọc bốn cờ:

| Cờ | Giá trị | Diễn giải |
|---|---|---|
| `EXISTING_FW_SOM_BASELINE` | **STABLE** | `mkddc-iobus` + `mkddc-core` hiện hành ổn định, build sạch `-Werror`, 477/477 test, 0 skip, cppcheck 0 error. **Không có finding nào chặn việc tiếp tục vận hành và bảo trì baseline này.** Đừng đọc nhãn `BLOCKED` ở trên thành "hệ thống hiện tại có vấn đề" |
| `FW_SOM_ST_HOST_SLICE` | **COMPLETED** | Lát cắt host-only theo `FW-SOM-ST-001` đã giao đúng phạm vi được phê duyệt, có bằng chứng thật: chương trình ST demo bắt buộc chạy được, 61 test ST pass. **Deliverable này đã xong, không nợ gì** |
| `PRODUCTION_ST_INTEGRATION` | **BLOCKED** | Cấm wire `StCyclicRuntime` vào `ScanLoop`. Chặn bởi B-01, B-02, B-03 — và theo §14.1 còn cần B-04, B-05 đóng cùng `C0.15 = PASS` |
| `C1_PLUS_OPENING` | **BLOCKED** | Cấm mở C1–C10. Chặn bởi B-02 (không có artifact contract để build/deploy), B-04 (MS-01/MS-03 chưa có SPEC), B-05 (C0.15 chưa chạy) |

**Kết luận tổng thể lấy giá trị `FW_SOM_IMPLEMENTATION_BLOCKED`** vì cả hai hướng *đi tiếp* đều đang bị chặn. Nhãn này nói về **khả năng mở rộng**, không nói về chất lượng phần đã có.

### 18.2 Điều kiện gỡ chặn

> Chưa được wire ST vào `ScanLoop`, và chưa được mở C1+, cho tới khi **toàn bộ B-01 → B-05 đóng** VÀ **`C0.15` cho kết quả PASS**.

| Blocker | Gỡ bằng | Nằm ở chặng |
|---|---|---|
| B-01 — `F-01` parser segfault | M-01 | ① |
| B-02 — `F-02` chưa có typed IR/artifact contract | MS-01 → M-02 | ③ → ④ |
| B-03 — `F-03` allocation trong scan path | M-03 (sau M-02) | ④ |
| B-04 — MS-01/MS-03 chưa có SPEC | MS-02 → MS-01 → MS-03 | ③ |
| B-05 — C0.15 chưa chạy | C0.15 sau khi có evidence V-01..V-07 | ⑦ |
| B-07 — không có evidence đối kháng/target | V-01..V-07 | ⑥ |

Lưu ý quan trọng: **đóng B-01 một mình không đủ.** Đây là hiểu nhầm dễ xảy ra nhất, vì `F-01` là finding nổi bật nhất trong báo cáo này.

### 18.3 Nhận định PM

Đây không phải dự án "làm ẩu rồi báo xong". Tài liệu C0/C1–C10 tự cảnh báo rất rõ ("Không suy diễn từ ba PR này rằng C1 đã Go"), `st_artifact.hpp` tự khai báo hash không phải mật mã, `INTERFACES.md` ghi rõ "chưa nối scan loop sản xuất". Mức độ trung thực của tài liệu ở đây **cao hơn mức trung bình** và làm review này dễ hơn nhiều.

Vấn đề thật nằm ở hai chỗ:

1. **Ngoại lệ CTO cho code chạy trước C0 đã tạo ra 4 hạng mục `CODE_WITHOUT_SPEC`.** Code ST tồn tại trong production `services/core` trong khi C0.4/C0.6/C0.7/C0.10 đều `Chưa bắt đầu`. Nợ này phải trả trước C1, không phải sau.

2. **Không có tầng kiểm soát nào có thể bắt được `F-01`.** 477 test đều kiểm đường đi đúng; không có ASan, không có UBSan, không có fuzzing, không có phép đo nào trên target. Một lỗi crash hạng CRITICAL sống sót qua toàn bộ quy trình review và merge — đó là lỗi của **quy trình verification**, không phải của người viết code.

**Hai đề nghị quy trình:**

- Bổ sung vào Definition of Done: mọi component nhận input từ bên ngoài **phải có ít nhất một test đối kháng** (input quá lớn / quá sâu / sai định dạng) chứng minh component từ chối có kiểm soát thay vì crash.
- Bổ sung ASan + UBSan thành **job CI bắt buộc** (V-01, V-02) — chi phí thấp, làm được ngay, và sẽ bắt được đúng lớp lỗi vừa lọt lưới.

---

**Rev** 1.1 | 2026-07-28 — Đổi kết luận tổng thể sang `FW_SOM_IMPLEMENTATION_BLOCKED`; tách 4 cờ trạng thái theo phạm vi (§1.1, §16, §18.1); sắp lại §17 theo dependency thành 9 chặng (M-01 → docs → MS-02/MS-01/MS-03 → M-02+M-03 → M-04/M-05 → verification gates → C0.15 → M-09 → BE integration); tách safety policy khỏi `CoreMetrics` thành `OverrunMonitor`/`TaskHealthMonitor` trong `safety/` (F-04, M-04); cấm kick watchdog giữa scan, chỉ kick sau cycle thành công và chốt `WatchdogSec` từ đo trên target (F-12, M-05); thêm §8.5 khoảng trống verification + blocker B-07 + microtask V-01..V-07 (ASan, UBSan, fuzzing, WCET/jitter target, systemd RT capability, HIL, fault-injection) + MI-13..MI-18; thêm §14.1 quy tắc gating B-01..B-05 + C0.15 PASS.
· 1.0 | 2026-07-28 — Tạo mới. Review toàn bộ source `services/core` + `services/iobus`, 9 tài liệu SPEC/design/plan, build + ctest + cppcheck thật, 12 finding (1 CRITICAL, 2 HIGH, 4 MEDIUM, 5 LOW/DOC/GOV), 30 dòng traceability, 15 microtask.
