# 02 — SOURCE CODE REVIEW REPORT — MK-DDC-24

> **Ngày review:** 2026-06-19
> **Reviewer:** PM + QA/QC (AI-assisted)
> **Branch:** `docs/cor-009-010-board-deploy-runbook-update`
> **Commit:** `01fcb259a074bf4519c75389c66253ec899de077`
> **Người review code:** AI-assisted (toàn bộ source files được phân tích tĩnh)

---

## 1. Thông tin repository

| Hạng mục | Giá trị |
|----------|---------|
| **Tên repository** | `MK-DDC-24` (DDC-PROJECT) |
| **Branch reviewed** | `docs/cor-009-010-board-deploy-runbook-update` (HEAD) |
| **Commit hash** | `01fcb259a074bf4519c75389c66253ec899de077` |
| **Main branch** | `main` at `bcfd3d0` (17 PR merged) |
| **Ngày review** | 2026-06-19 |
| **Cách build** | `cmake -S services -B build/services && cmake --build build/services -j` |
| **Môi trường** | Linux (Debian 12 / PREEMPT_RT target), GCC 13+, CMake ≥ 3.16, GoogleTest 1.14.0 |
| **Test** | `ctest --test-dir build/services` (hoặc build riêng core/iobus) |

---

## 2. Cấu trúc source code

### 2.1 Cấu trúc thư mục

```
DDC-PROJECT/
├── services/                  # Source code chính (C++)
│   ├── CMakeLists.txt         # Build tổng (core + iobus)
│   ├── core/                  # mkddc-core (32 files, ~100 KB)
│   │   ├── main.cpp           # Entry: RT, shm, scan loop, signal
│   │   ├── scan_loop.*        # Scan 1s pipeline (10 bước)
│   │   ├── graph_runtime.*    # Component graph engine (23 type)
│   │   ├── priority_resolver.* # 6-level priority (fire→default)
│   │   ├── safe_state.*       # Safety fallback (T1-T7)
│   │   ├── web_ipc.*          # UNIX socket JSON command
│   │   ├── bacnet_objtable.*  # Publish to plc_shm
│   │   ├── state_snapshot.*   # Persist counter state
│   │   └── tests/             # 11 test files
│   └── iobus/                 # mkddc-iobus (9 subdirs, ~60 files)
│       ├── main.cpp           # Entry: config, UART, poll 100Hz
│       ├── iop/               # Protocol layer (5 modules)
│       ├── io/                # Scaling + cache (3 modules)
│       ├── bacnet/            # BACnet/IP logic (7 modules + tests)
│       ├── fieldbus/          # Modbus RTU master (7 modules + tests)
│       ├── bridge/            # Core↔iobus bridge (2 modules)
│       ├── config/            # Config parser (1 module)
│       ├── diagnostics/       # Metrics + alarm (2 modules)
│       ├── platform/          # RT + systemd (2 modules)
│       └── tests/             # 8 test files
├── shared/                    # Contract headers (frozen)
│   ├── iop_protocol.h         # FW↔SOM IOP protocol (8.9 KB)
│   ├── mkddc_shm.h            # Shared memory layout (6.9 KB)
│   └── kinexus_shm.h          # Legacy alias (deprecated)
├── tools/                     # Dev/test tools
│   ├── fake_mcu/              # PTY MCU simulator
│   ├── shm_dump_io/           # SHM dump utility
│   ├── integration_test/      # Integration test scripts
│   └── test_*.sh/py           # E2E test scripts
├── packaging/                 # Deployment
│   ├── install.sh             # Install script
│   └── systemd/               # 6 systemd unit files
├── build/                     # Build artifacts (pre-built)
├── examples/                  # 3 domain demo configs
│   ├── hvac-mini/
│   ├── pump-water/
│   └── energy-gateway/
├── hardware-design/           # HW schematic (8 subdirs)
├── infra/ci/                  # CI configuration
└── .github/workflows/         # 2 CI workflows
```

### 2.2 Đánh giá cấu trúc

| Tiêu chí | Đánh giá | Ghi chú |
|----------|:--------:|---------|
| Cấu trúc thư mục rõ ràng | ✅ | Rất rõ: services/core, services/iobus, shared, tools, packaging |
| Module tách hợp lý | ✅ | Iobus: 9 sub-module riêng (iop/io/bacnet/fieldbus/bridge/config/diagnostics/platform). Core: flat nhưng module rõ |
| Phân lớp rõ ràng | ✅ | 3-process model: iobus (HW) → core (logic) → web (UI). Boundary sạch qua SHM |
| Code thử nghiệm/lab lẫn code chính | ✅ | Tách riêng: `tools/`, `examples/`, `build_*_check/`. Không lẫn |
| File thừa / code chết | ⚠️ | `shared/kinexus_shm.h` (legacy alias 449 bytes). `build_core_check/`, `build_iobus_check/` (build artifacts) |
| Config nhạy cảm | ✅ | Không có secrets, passwords, API keys trong repo. `.gitignore` hợp lý |

---

## 3. Tình trạng build/run

### 3.1 Kiểm tra thực tế

| Kiểm tra | Kết quả | Bằng chứng |
|----------|:-------:|-----------|
| Build `mkddc-core` | ✅ Pass | Binary 1.5 MB at `build/core/mkddc-core` (2026-06-13) |
| Build `mkddc-iobus` | ✅ Pass | Binary 365 KB at `build/iobus/mkddc-iobus` (2026-06-13) |
| Build `fake_mcu` | ✅ Pass | Binary 100 KB at `build/iobus/fake_mcu` |
| Build `shm_dump_io` | ✅ Pass | Binary 28 KB at `build/iobus/shm_dump_io` |
| Build `core_tests` | ✅ Pass | Binary 4.1 MB at `build/core/core_tests` |
| Build `iobus_tests` | ✅ Pass | Binary 2.4 MB at `build/iobus/iobus_tests` |
| Build `mkddc-web` | ❌ N/A | **Không có source code web/** |
| Build firmware | ❌ N/A | **Không có source code fw/** |
| Chạy local (service) | ✅ | Chạy được (cần SHM hoặc degraded mode) |
| Docker | ❌ N/A | Không có Dockerfile |
| Dependency lỗi | ✅ Không | GTest auto-fetch. BACnet/Modbus optional (OFF by default) |
| Hướng dẫn setup | ✅ | `GETTING_STARTED_DEV.md`, `16_QUICK_START_SOM_DEV.md`, `13_BRINGUP_GUIDE.md` |

### 3.2 Build command

```bash
# Build toàn bộ
cmake -S services -B build/services && cmake --build build/services -j

# Build riêng
cmake -S services/iobus -B build/iobus && cmake --build build/iobus -j
cmake -S services/core  -B build/core  && cmake --build build/core  -j

# Build với BACnet/Modbus
cmake -S services/iobus -B build/iobus -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_MODBUS=ON

# Test
ctest --test-dir build/services --output-on-failure
```

---

## 4. Tình trạng chức năng

| Module / Feature | Có trong docs | Có trong code | Chạy được | Ghi chú |
|-----------------|:------------:|:------------:|:---------:|---------|
| IOP Protocol (CRC/Frame/Parser) | ✅ | ✅ | ✅ | 12 CRC vector pass, frame build/parse, parser IO/Diag |
| IOP Client (Handshake/GET_IO/SET_*/RESET) | ✅ | ✅ | ✅ | Full state machine (NORMAL/FAULT/SAFE/RECONNECT) |
| IO Scaling (NTC/PT100/0-10V/4-20mA) | ✅ | ✅ | ✅ | Steinhart-Hart, CVD, linear scale |
| IO Cache (SHM writer seqlock) | ✅ | ✅ | ✅ | Creator + writer duy nhất cho io_shm |
| Output Command (SET_DO/SET_AO dedupe) | ✅ | ✅ | ✅ | Chỉ gửi khi thay đổi, safe-state block |
| Scan Loop (1s RT, SCHED_FIFO) | ✅ | ✅ | ✅ | Absolute-time, 10-step pipeline |
| Graph Runtime (23 component types) | ✅ | ✅ | ✅ | Topo sort, multi-output, PID, timer, counter... |
| Priority Resolver (6 mức) | ✅ | ✅ | ✅ | fire/safety → BMS → schedule → logic → manual → default |
| Safe-State (T1-T7 triggers) | ✅ | ✅ | ✅ | IOP fault, stale, graph bad, no-graph |
| Point Quality (good/uncertain/bad) | ✅ | ✅ | ✅ | Degrade theo fault/stale/flags |
| Web IPC (UNIX socket JSON) | ✅ | ✅ | ✅ | accepted/rejected/overridden + audit log |
| Config Reload (SIGHUP) | ✅ | ✅ | ✅ | Atomic swap graph, fail→keep old |
| State Snapshot (persist counters) | ✅ | ✅ | ✅ | 60s dirty + shutdown + reload |
| BACnet Object Table (core→plc_shm) | ✅ | ✅ | ✅ | Priority array, reliability, COV |
| BACnet Server (bacnet-stack) | ✅ | ✅ | ⚠️ | Logic compiled, need bacnet-stack lib for real server |
| BACnet COV/Alarm/Priority | ✅ | ✅ | ⚠️ | Logic + unit test pass, need integration |
| Modbus RTU Master | ✅ | ✅ | ⚠️ | Logic compiled, need libmodbus for real RS-485 |
| Modbus Device Profile/Codec | ✅ | ✅ | ✅ | Profile parse, register codec, poll scheduler |
| Fieldbus ext cache → core | ✅ | ✅ | ✅ | UNIX datagram IPC (kx_ext_snapshot_msg_t) |
| Systemd integration | ✅ | ✅ | ✅ | Unit files, install script, sd_notify |
| **mkddc-web (REST + React UI)** | ✅ | ❌ | ❌ | **0 dòng code. Chỉ có docs (ADR-006/007, openapi.yaml)** |
| **Firmware MCU (STM32G0B1RB)** | ✅ | ❌ | ❌ | **0 dòng code. Chỉ có docs (FW_ARCH, FW_REQ, pinout)** |
| **Login JWT / RBAC** | ✅ | ❌ | ❌ | Web chưa có |
| **Graph deploy via web** | ✅ | ❌ | ❌ | Web chưa có |

---

## 5. Chất lượng code

| Tiêu chí | Đánh giá | Chi tiết |
|----------|:--------:|---------|
| **Readability** | ✅ Tốt | Comment tiếng Việt + tiếng Anh. Tên biến/hàm rõ nghĩa. Mỗi file có doc header với reference tới docs. |
| **Maintainability** | ✅ Tốt | Module tách rõ, dependency injection qua struct pointer. Không có global state (ngoại trừ `g_shutdown`). |
| **Error handling** | ✅ Tốt | Fail-fast ở boot (config hỏng → exit 1). Degraded mode ở runtime (thiếu SHM → chạy với quality=BAD). Retry + timeout rõ ràng. |
| **Logging** | ✅ Tốt | fprintf(stderr) theo format `LEVEL module.action key=value`. Audit log cho security-sensitive operations. |
| **Configuration** | ✅ Tốt | Config file JSON, CLI override, SIGHUP reload. Có validation + fail-fast. |
| **Naming convention** | ✅ Tốt | snake_case cho C/C++. Prefix `kx_`/`KX_` cho shared contract. Prefix `Iop`/`Io` cho module. |
| **Security basic** | ⚠️ Chấp nhận được | Audit log có. Port 1883 chặn. Nhưng JSON parser tự chế (rủi ro input injection). Không có auth trong C++ layer (đúng design — auth ở web layer). |
| **Performance risk** | ✅ Thấp | SCHED_FIFO + mlockall + absolute-time sleep. Seqlock cho SHM (không block). 100Hz poll stable. |
| **Coupling giữa module** | ✅ Thấp | Core↔Iobus chỉ qua SHM (io_shm, plc_shm). Core↔Web qua UNIX socket. Fieldbus→Core qua datagram socket. |
| **Khả năng mở rộng** | ✅ Tốt | Graph runtime extensible (add component type). Modbus device profile extensible. BACnet object auto-register. |

### Compiler flags
- `-Wall -Wextra -Werror` — strict warnings, tốt.
- C++17 — phù hợp embedded Linux.

---

## 6. Technical debt

| ID | Vấn đề | Mức độ | Ảnh hưởng | Đề xuất xử lý |
|:--:|--------|:------:|-----------|---------------|
| TD-001 | JSON parser tự chế (`json_min.hpp`, config parsers) — không xử lý escape, duplicate key, depth limit | **High** | Rủi ro bảo mật (CWE-20 input validation), rủi ro parse sai config | Thay bằng nlohmann/json hoặc RapidJSON |
| TD-002 | Race condition khi iobus re-attach SHM: `memset()` toàn bộ → core ghi output giữa save/restore → lost update | **High** | Mất lệnh output khi iobus restart | Dùng cờ/version để phối hợp hoặc semaphore |
| TD-003 | `IopPort::write()` map mọi `EAGAIN` thành `NOT_OPEN` → state machine hiểu nhầm TX congestion = port hỏng | **Medium** | Recovery path có thể reconnect không cần thiết | Phân biệt EAGAIN vs NOT_OPEN error code |
| TD-004 | `shared/kinexus_shm.h` legacy alias vẫn còn trong repo | **Low** | Nhầm lẫn cho dev mới | Xóa hoặc chuyển thành `#include "mkddc_shm.h"` |
| TD-005 | Build artifacts trong repo (`build/`, `build_core_check/`, `build_iobus_check/`) | **Low** | Repo lớn không cần thiết | Thêm vào `.gitignore` |
| TD-006 | Thiếu structured logging (hiện dùng fprintf) — khó parse/aggregate | **Medium** | Khó monitor production | Chuẩn hóa JSON log hoặc syslog format |
| TD-007 | `graph_runtime.cpp` có 700+ dòng — module quá lớn | **Low** | Khó maintain khi thêm component type | Tách component implementations ra file riêng |

---

## 7. Kết luận source code

### Code có thể dùng tiếp không?
**CÓ** — code SOM (core + iobus) chất lượng tốt, kiến trúc đúng hướng.

### Phần nào dùng được?
- ✅ **Toàn bộ `services/core/`** — scan loop, graph runtime, priority, safe-state, web IPC, state snapshot
- ✅ **Toàn bộ `services/iobus/`** — IOP protocol, IO cache, scaling, output command, BACnet logic, Modbus logic
- ✅ **`shared/`** — contract frozen, compile cross FW+SOM
- ✅ **`tools/`** — fake_mcu, shm_dump, test scripts
- ✅ **`packaging/`** — systemd units, install script

### Phần nào cần refactor?
- ⚠️ JSON parser tự chế → thay thư viện chuẩn
- ⚠️ SHM attach race condition → thêm coordination mechanism
- ⚠️ IopPort error semantics → phân biệt EAGAIN vs NOT_OPEN

### Phần nào cần viết mới?
- ❌ **`web/` (mkddc-web)** — Go backend + React frontend: ~5.000-10.000 dòng code ước tính
- ❌ **`fw/` (firmware MCU)** — STM32 FreeRTOS: ~8.000-15.000 dòng code ước tính

### Phần nào thiếu test?
- SHM restart race condition (concurrency test)
- IopPort EAGAIN edge case
- End-to-end 3-layer safety
- BACnet integration với bacnet-stack thật
- Modbus integration với libmodbus thật

### Phần nào có rủi ro cao?
- JSON parser tự chế (security + correctness)
- SHM lost update khi restart chồng nhau
- Chưa kiểm tra được E2E trên board thật (firmware chưa có)
