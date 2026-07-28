# FW SOM — Source, SPEC và Implementation Status Review

> **Document ID:** REV-FWSOM-STATUS-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Người thực hiện:** PM kỹ thuật (review độc lập)
> **Phạm vi:** `services/core`, `services/iobus`, `shared/`, `packaging/systemd` + toàn bộ tài liệu SPEC/design/ADR/plan liên quan FW SOM
> **Commit review:** `7fff012` trên nhánh `docs/fw-som-st-scope-and-vi-rule` (nền `origin/main` = `8f2f330`)
> **Kết luận:** `FW_SOM_READY_WITH_FIXES` — xem §18

---

## 1. Executive Summary

FW SOM hiện là **hai process C++17 chạy trên SOM Linux**: `mkddc-iobus` (chủ IOP/UART tới STM32, Modbus, BACnet) và `mkddc-core` (point table, priority arbitration, graph runtime, safe-state, alarm, schedule, IPC tới Web/HMI). Cộng thêm một binary CLI phụ `mkddc-st-validate`.

**Baseline kỹ thuật xanh và đo được thật** (không lấy từ tài liệu):

| Hạng mục | Kết quả đo 2026-07-28 |
|---|---|
| Configure + build `services/` (`-Wall -Wextra -Werror`, BACNET=ON, MODBUS=ON) | **exit 0, 0 lỗi** |
| `ctest` toàn bộ | **477/477 PASS, 0 FAIL, 0 SKIP** (2.34 s) |
| `cppcheck` (warning/performance/portability) trên `core/{st,graph,safety,ipc}` | **0 error**, 8 note mức performance/portability, **0 note trong `st/`** |
| Thư viện transport thật | `libmodbus 3.1.10` (pkg-config), `bacnet-stack` BACDL_BIP=ON, protocol revision 19 |

**Nhưng "xanh" không đồng nghĩa "sẵn sàng đi tiếp".** Review này tìm thấy 3 vấn đề chặn việc mở rộng, và 1 mâu thuẫn governance:

1. **Lỗi crash đã repro** — ST parser đệ quy không giới hạn độ sâu, segfault với input hợp lệ về kích thước (§10, F-01).
2. **Runtime thực thi AST parse trực tiếp từ source text**, trong khi thiết kế §4/§7.2 cấm rõ điều này và bắt buộc phải có typed IR + loader validation (§10, F-02).
3. **Cấp phát heap trong scan execution path**, trong khi §7.2 ghi "không allocation ... trong scan execution" (§10, F-03).
4. **Governance lệch:** cả **15/15 workstream C0 đều `Chưa bắt đầu`**, nhưng code ST đã merge vào production `services/core`. Đây là hệ quả có chủ ý của ngoại lệ CTO ngày 2026-07-24, nhưng hậu quả là 4 hạng mục rơi vào trạng thái `CODE_WITHOUT_SPEC` (§11, §13).

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
| T-10 | ST parser + semantic (subset REAL/BOOL/IF/CMP/bool/LIMIT) | Design §7.1, C0.4 | [st_parser.cpp](services/core/st/st_parser.cpp), [st_semantic.cpp](services/core/st/st_semantic.cpp) | `StRuntime` 23, `StValidateCli` 6 | **PARTIAL** | **F-01** crash đệ quy; C0.4 chưa có SPEC | Fix M-01, viết C0.4 |
| T-11 | Typed IR có schema/version, loader reject magic/ABI/hash/limit | Design §4, §7.2, C0.6 | **KHÔNG TỒN TẠI** — [st_program.hpp:47-80](services/core/st/st_program.hpp#L47-L80) là AST con trỏ, không serialize | — | **CODE_WITHOUT_SPEC** | **F-02** runtime chạy AST parse từ source text | M-02 + viết C0.6 |
| T-12 | Không allocation trong scan execution | Design §7.2 | Vi phạm: [st_runtime.cpp:167-173](services/core/st/st_runtime.cpp#L167-L173) `std::map` mỗi cycle | — | **PARTIAL** | **F-03** | M-03 |
| T-13 | Multi-task scheduler: task set, priority, period, watchdog budget từ manifest | Design §7.3, C0.7 | Chỉ 1 cyclic loop cứng, period từ `graph.json` [main.cpp:160-173](services/core/main.cpp#L160-L173) | `ScanLoop` | **NOT_STARTED** | **F-05** | Viết C0.7 trước khi code |
| T-14 | Overrun: đo, alarm, ngưỡng lặp → chuyển safe theo config | Design §7.3, §10 | Đo + log có: [core_metrics.cpp:13-15](services/core/diagnostics/core_metrics.cpp#L13-L15); **không có ngưỡng→safe, không có alarm** | `CoreMetrics` | **PARTIAL** | **F-04** | M-04 |
| T-15 | RETAIN, cold/warm start, migration, CRC retain record | Design §7.4 | **KHÔNG TỒN TẠI** trong `st/` (grep `retain\|persist` chỉ ra 1 dòng comment) | — | **NOT_STARTED** | **F-06** | Sau C0.2/C0.6 |
| T-16 | Persistence graph state (không phải ST RETAIN) | 22 plan COR-010 | [state_snapshot.cpp](services/core/graph/state_snapshot.cpp) atomic tmp+rename, version=1 | `StateSnapshot` 8 | DONE | — | Giữ |
| T-17 | io_map binding typed variable ↔ physical point | Design §8, C0.10 | [st_io_map.cpp](services/core/st/st_io_map.cpp) validator thuần | `StIoMap` 12 | **PARTIAL** | Chưa có file `io_map.json`, chưa CRUD, chưa consumer | C2/BE |
| T-18 | Validate gateway CLI, JSON shape ổn định, exit code | INTERFACES.md §"validate gateway" | [st_validate_main.cpp](services/core/st/st_validate_main.cpp) | `StValidateCli` 6 | **PARTIAL** | **F-01** phá vỡ chính contract "luôn 1 dòng JSON" | M-01 |
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
| FW SOM ↔ BE SOM (ST validate) | CLI `mkddc-st-validate --source <path>`, 1 dòng JSON, exit 0/1/2 | [INTERFACES.md:42-109](docs/04_design/INTERFACES.md#L42-L109) | **IMPLEMENTED nhưng CHƯA CÓ CONSUMER** | `StValidateCli` 6 test. grep `mkddc-st-validate` trong `*.go`/`*.ts` → **0 caller**. Contract bị **F-01** phá vỡ |
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
| MI-04 | Overrun threshold → safe state + alarm code | NOT_STARTED | MS-03 |
| MI-05 | Multi-task scheduler | NOT_STARTED | MS-03 |
| MI-06 | ST RETAIN + cold/warm start | NOT_STARTED | MS-08 |
| MI-07 | Package signature/integrity | NOT_STARTED | MS-06 |
| MI-08 | `io_map.json` storage + CRUD | NOT_STARTED | BE (C2) |
| MI-09 | Trace persist + publish ra ngoài process | NOT_STARTED | C1+ |
| MI-10 | Wire `StCyclicRuntime` vào `ScanLoop` | NOT_STARTED | **Bị chặn bởi M-01, M-02, M-03** |
| MI-11 | BE Go gọi `mkddc-st-validate` | NOT_STARTED | M-01 phải xong trước |
| MI-12 | ST stdlib mở rộng (arith, `SEL`, `TON`, `CASE`) | NOT_STARTED | MS-02 |

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
| **B-01** | **F-01** — parser segfault | Chặn MI-10 (wire vào scan loop) và MI-11 (BE gọi CLI). Wire vào `mkddc-core` khi chưa fix = một deploy ST hỏng làm chết process điều khiển | **CHẶN CỨNG** |
| **B-02** | **F-02** — chưa có typed IR/artifact contract | Chặn C1+ (`mkddc-program-service` không có gì để build/deploy), chặn F-07 | **CHẶN CỨNG cho C1+** |
| **B-03** | **F-03** — allocation trong scan path | Chặn MI-10: không được đưa allocation vào vòng RT SCHED_FIFO 80 | **CHẶN CỨNG cho MI-10** |
| **B-04** | **MS-01/MS-03** — C0.6, C0.7 chưa có SPEC | Chặn MI-01, MI-04, MI-05 | CHẶN THIẾT KẾ |
| **B-05** | C0.15 go/no-go chưa chạy | Chặn chính thức toàn bộ C1–C10 | CHẶN QUY TRÌNH |
| **B-06** | Không có board/HIL evidence | Chặn G4 (I/O/MCU gate) | Ngoài scope code |

**Không phải blocker:** build, test, lint, transport library — tất cả đã xanh và verify được.

---

## 15. Recommended Fixes

Xem bảng microtask §17. Tóm tắt ưu tiên:

1. **P0 — M-01:** depth limit trong parser. Nhỏ, độc lập, gỡ B-01 ngay.
2. **P0 — M-03:** pre-allocate execution context. Độc lập với IR, gỡ B-03.
3. **P1 — M-04:** overrun → alarm + ngưỡng → safe state. Đóng khoảng cách với §10.
4. **P1 — M-02:** typed IR + loader validation. Cần MS-01 trước; đây là việc lớn nhất.
5. **P2 — M-05..M-06:** watchdog doc/test, C0 SPEC.
6. **P2 — M-07..M-08:** sửa 3 tài liệu lỗi thời (rẻ, làm ngay được).

---

## 16. Implementation Readiness

| Câu hỏi | Trả lời |
|---|---|
| Lát cắt "chạy ST tối thiểu trên SOM host runtime" (`FW-SOM-ST-001`) đã xong chưa? | **Rồi.** Chương trình demo bắt buộc trong C1–C10 plan §0.1 đã chạy thật, 61 test ST pass, build/CTest evidence có |
| Có đủ điều kiện tiếp tục implement **trong lát cắt host-only** không? | **Có, sau khi fix M-01 và M-03** |
| Có đủ điều kiện **wire ST vào production scan loop** không? | **Chưa.** B-01, B-03 phải đóng trước |
| Có đủ điều kiện mở **C1+** không? | **Chưa.** B-02, B-04, B-05 |
| Baseline kỹ thuật có ổn định để làm tiếp không? | **Có.** 477/477, 0 skip, `-Werror` sạch, cppcheck 0 error |

---

## 17. Next Implementation Plan

| Thứ tự | Microtask | File/module tác động | Điều kiện đầu vào | Kết quả đầu ra | Cách kiểm thử | Mức ưu tiên |
|--------|-----------|----------------------|-------------------|----------------|--------------|-------------|
| 1 | **M-01** Thêm depth counter cho recursive descent. Trường `int depth_` trong parser; tăng/giảm ở `parse_expr`, `parse_stmt_list`; vượt ngưỡng → trả `StDiagnostic` code mới `ST-SYN-002` (nesting quá sâu) kèm line/column. Ngưỡng tạm **64** (đủ rộng cho chương trình thật, đủ hẹp để không tràn stack); ghi rõ trong comment là giá trị tạm chờ MS-02 | `st/st_parser.cpp`, `st/st_parser.hpp`, `st/st_diagnostic.hpp` | Không | Parser không bao giờ segfault; CLI luôn trả 1 dòng JSON | Test mới `StParser.DeepNestingRejectedNotCrash`: source 12000 ngoặc → `parse_st_program()` trả false, code `ST-SYN-002`. Test CLI `StValidateCli.DeepNestingExitsOneWithJson`: exit 1, stdout parse được JSON. Chạy lại repro thủ công 20000 ngoặc | **P0** |
| 2 | **M-03** Pre-allocate execution context. Thêm struct `StExecContext` giữ `std::vector<StValue>` cho input/output + bảng chỉ số `name → slot` dựng **một lần** tại `activate()`. `execute()` chỉ ghi vào vector đã cấp, không tạo `std::map` mới. Thay `view.find(name)` bằng tra chỉ số đã resolve tại semantic phase | `st/st_runtime.cpp`, `st/st_runtime.hpp`, `st/st_program.hpp`, `st/st_semantic.cpp` | M-01 xong (tránh xung đột merge trong cùng file) | `execute()` không cấp phát heap; O(1) truy cập biến | Test `StRuntime.ExecuteDoesNotAllocate`: override `operator new` đếm allocation trong test binary, chạy 1000 cycle → count == 0. Giữ nguyên 23 test `StRuntime` hiện có phải pass | **P0** |
| 3 | **M-04** Overrun → alarm + ngưỡng → safe state. Thêm `overrun_consecutive_` và `overrun_threshold_` (cấu hình từ `io_safe_state.conf`) vào `CoreMetrics`; thêm trigger `overrun_exceeded` vào `SafeState::apply()`; thêm alarm code `E4xx` vào `AlarmRuntime` | `diagnostics/core_metrics.{hpp,cpp}`, `safety/safe_state.{hpp,cpp}`, `safety/safe_state_config.cpp`, `alarm/alarm_runtime.cpp` | MS-03 duyệt ngưỡng mặc định | Overrun lặp N lần → AO safe/DO open + alarm | Test `CoreMetrics.ConsecutiveOverrunTriggersThreshold`; `SafeState.OverrunThresholdForcesSafe`; test reset counter khi scan trở lại bình thường | **P1** |
| 4 | **M-05** Ghi + test hành vi watchdog khi scan chậm | `packaging/systemd/mkddc-core.service`, `docs/04_design/INTERFACES.md`, `docs/03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md` | Không | Ghi rõ quan hệ `WatchdogSec` ↔ `scan_ms` max; cân nhắc nâng `WatchdogSec` lên 5 hoặc kick giữa scan | Test tích hợp: chạy core với `--scan-ms 2000`, xác nhận không bị systemd kill trong 60 s | **P1** |
| 5 | **MS-01** Viết C0.6 Typed IR spec: magic, schema version, target ABI, encoding instruction, bảng constant, giới hạn tài nguyên, danh sách luật reject của loader | `docs/07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` §C0.6 + tài liệu schema mới | Design §7.2 | SPEC đủ để implement M-02 | Review bởi Architect; đối chiếu từng dòng luật reject §7.2 | **P1** |
| 6 | **MS-02** Viết C0.4 ST subset grammar EBNF + bảng giới hạn (độ sâu, số biến, số statement, độ dài định danh) | C0 plan §C0.4 | M-01 đã cho số liệu thực nghiệm về ngưỡng | Grammar chính thức; chốt ngưỡng depth thay giá trị tạm của M-01 | Đối chiếu grammar với `st_parser.cpp` từng luật; cập nhật ngưỡng M-01 nếu khác 64 | **P1** |
| 7 | **MS-03** Viết C0.7 Deterministic scheduler model: task set, priority, period, per-task watchdog budget, overrun policy | C0 plan §C0.7 | MS-01 | SPEC đủ để implement M-06 | Review Architect + SOM Backend Lead | **P1** |
| 8 | **M-02** Implement typed IR: serializer từ AST → IR, loader validate (magic/version/ABI/limit/binding), `activate()` đổi chữ ký sang nhận **artifact bytes** thay vì source text. Compiler CLI sinh artifact | `st/st_ir.{hpp,cpp}` (mới), `st/st_runtime.{hpp,cpp}`, `st/st_artifact.{hpp,cpp}`, `st/st_validate_main.cpp` | MS-01 duyệt | Runtime không còn parse source; đúng Design §4/§7.2 | Test round-trip AST→IR→execute cho toàn bộ 23 case `StRuntime` hiện có; test loader reject từng luật §7.2 (magic sai, version sai, vượt limit, binding sai type) | **P1** |
| 9 | **M-06** Implement multi-task scheduler theo MS-03 | `st/st_scheduler.{hpp,cpp}` (mới), `st/st_cyclic_runtime.cpp` | MS-03, M-02 | Task set với priority/period/budget | Test task order deterministic, per-task overrun, priority preemption | **P2** |
| 10 | **M-09** Wire `StCyclicRuntime` vào `ScanLoop` | `services/core/main.cpp`, `graph/scan_loop.{hpp,cpp}` | **M-01, M-02, M-03 đều xong** | ST chạy thật trong `mkddc-core` | Test `ScanLoop.StProgramExecutesInScan`; test integration: deploy ST hỏng → core không crash, giữ package cũ; đo jitter trước/sau | **P2** |
| 11 | **M-10** BE Go gọi `mkddc-st-validate` với timeout + parse JSON | `web/backend/` | M-01 xong | BE validate được ST source | Test Go: exit 0/1/2, timeout, stdout không phải JSON → lỗi rõ ràng | **P2** |
| 12 | **M-07** Sửa `INTERFACES.md`: path `services/core/st/st_*`, cập nhật mô tả sau khi M-02 đổi kiến trúc | `docs/04_design/INTERFACES.md` | Không (phần path làm ngay được) | Doc khớp code | Đối chiếu từng path bằng `ls` | **P2** |
| 13 | **M-08** Cập nhật `32_DEV_TEAM_NEXT_ACTION.md` (226→477 test, MOD-012/BAC-012 đã có thư viện thật) và C1–C10 plan (468→477) | `docs/03_implementation/32_DEV_TEAM_NEXT_ACTION.md`, `docs/07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md` | Không | Doc khớp kết quả đo | Chạy lại `ctest`, đối chiếu số | **P2** |
| 14 | **M-11** ST RETAIN + cold/warm start | `st/st_retain.{hpp,cpp}` (mới) | MS-08, M-02 | Retain record có CRC, atomic write, reject corrupt | Test cold start, warm start, retain corrupt, layout mismatch | **P3** |
| 15 | **M-12** Package signature/integrity (thay FNV-1a bằng SHA-256 + chữ ký) | `st/st_artifact.cpp`, loader | MS-06, M-02 | Loader reject package giả mạo | Test chữ ký hợp lệ/không hợp lệ/thiếu | **P3** |

**Thứ tự khuyến nghị cho một kỹ sư làm liên tục:** 1 → 2 → 4 → 12 → 13 (nhóm P0 + doc rẻ, không phụ thuộc ai) → 3 (cần MS-03) → 5,6,7 (SPEC) → 8 → 9 → 10 → 11 → 14 → 15.

---

## 18. Final PM Conclusion

### `FW_SOM_READY_WITH_FIXES`

**Diễn giải chính xác của kết luận này — đọc cả 3 vế:**

1. **Lát cắt đã được phê duyệt (`FW-SOM-ST-001`, host-only) đã HOÀN THÀNH và có bằng chứng thật.** Chương trình ST demo bắt buộc chạy được, 61 test ST pass, build sạch với `-Werror`, ctest 477/477, cppcheck 0 error. Không có gì phải nghi ngờ về chất lượng nền runtime substrate — scan loop deterministic, seqlock snapshot, arbitration, safe-state, atomic activation đều implement đúng và có test.

2. **Được phép tiếp tục implement trong phạm vi host-only, SAU KHI đóng M-01 và M-03.** Hai fix này nhỏ, độc lập, không cần chờ tài liệu nào — làm được ngay.

3. **KHÔNG được wire ST vào production scan loop, và KHÔNG được mở C1+, cho tới khi:**
   - B-01 (`F-01` parser segfault) đóng — nếu không, một deploy ST hỏng sẽ giết `mkddc-core`;
   - B-03 (`F-03` allocation trong scan path) đóng — nếu không, đưa allocation vào vòng `SCHED_FIFO 80`;
   - B-02 (`F-02` chưa có typed IR) và B-04 (MS-01/MS-03) đóng — nếu không, C1 không có artifact contract để build/deploy;
   - B-05 (C0.15 go/no-go) chạy chính thức.

**Nhận định PM:** đây không phải dự án "làm ẩu rồi báo xong". Tài liệu C0/C1–C10 tự cảnh báo rất rõ ("Không suy diễn từ ba PR này rằng C1 đã Go"), `st_artifact.hpp` tự khai báo hash không phải mật mã, `INTERFACES.md` ghi rõ "chưa nối scan loop sản xuất". Mức độ trung thực của tài liệu ở đây **cao hơn mức trung bình** và làm review này dễ hơn nhiều.

Vấn đề thật nằm ở chỗ khác: **ngoại lệ CTO cho code chạy trước C0 đã tạo ra 4 hạng mục `CODE_WITHOUT_SPEC` và một lỗi crash mà không tầng kiểm soát nào bắt được** — vì test suite chỉ test đường đi đúng, không test input đối kháng. Đề nghị bổ sung một tiêu chí vào Definition of Done cho mọi component nhận input từ bên ngoài: **phải có ít nhất một test đối kháng (input quá lớn / quá sâu / sai định dạng) chứng minh component từ chối có kiểm soát thay vì crash.**

---

**Rev** 1.0 | 2026-07-28 — Tạo mới. Review toàn bộ source `services/core` + `services/iobus`, 9 tài liệu SPEC/design/plan, build + ctest + cppcheck thật, 12 finding (1 CRITICAL, 2 HIGH, 4 MEDIUM, 5 LOW/DOC/GOV), 30 dòng traceability, 15 microtask.
