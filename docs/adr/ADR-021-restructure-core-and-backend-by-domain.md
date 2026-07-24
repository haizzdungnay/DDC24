# ADR-021: Tổ chức lại `services/core` và `web/backend` theo domain (không đổi hành vi)

- Date: 2026-07-24
- Owner: Phạm Đình Chương — Project Engineering Owner / CTO
- Status: **Accepted cho Phase A** (`services/core`) — owner đã duyệt cấu trúc cây thư mục
  2026-07-24, bắt đầu thực thi kèm baseline test/runtime trước và sau. **Phase B
  (`web/backend`) vẫn Proposed** — chưa duyệt, chưa thực thi, làm sau khi Phase A merge + xanh.
- Related: `services/iobus/` (pattern tổ chức domain đã chạy thật trong CI, dùng làm mẫu),
  `.github/workflows/build-and-test.yml` (job `som-services`, `web-backend`)

## Vấn đề (1 câu)

`services/core` (30 file C++) và `web/backend` (90 file Go) nằm phẳng, không chia domain —
trong khi `services/iobus` (service anh em cùng vai trò) đã chia domain rõ ràng. Restructure
thuần tổ chức code, **không đổi API, không đổi hành vi runtime**.

---

## Phase A — `services/core`

### Hiện trạng (phẳng)

```
services/core/
├── CMakeLists.txt
├── main.cpp                    ← entry point mkddc-core
├── json_min.hpp
├── st_parser.{cpp,hpp}         ┐
├── st_semantic.{cpp,hpp}       │
├── st_runtime.{cpp,hpp}        │
├── st_stdlib.{cpp,hpp}         │  ST language (parser → semantic → runtime)
├── st_artifact.{cpp,hpp}       │
├── st_io_map.{cpp,hpp}         │
├── st_cyclic_runtime.{cpp,hpp} │
├── st_trace.{cpp,hpp}          │
├── st_diagnostic.hpp           │
├── st_program.hpp              │
├── st_validate_main.cpp        ┘  ← entry point mkddc-st-validate
├── graph_runtime.{cpp,hpp}     ┐
├── point_table.{cpp,hpp}       │
├── point_quality.{cpp,hpp}     │  Component graph + point data model
├── runtime_point_snapshot.{cpp,hpp} │
├── state_snapshot.{cpp,hpp}    │
├── clock_snapshot.hpp          │
├── scan_loop.{cpp,hpp}         ┘
├── alarm_runtime.{cpp,hpp}     ┐  Alarm
├── alarm_primitives.hpp        ┘
├── bacnet_objtable.{cpp,hpp}      BACnet object table
├── schedule_runtime.{cpp,hpp}     Scheduler
├── safe_state.{cpp,hpp}        ┐  Safe-state / fail-safe
├── safe_state_config.{cpp,hpp} ┘
├── web_ipc.{cpp,hpp}           ┐
├── iobus_reader.{cpp,hpp}      │  Giao tiếp core ↔ iobus / core ↔ web backend
├── output_writer.{cpp,hpp}     │
├── priority_resolver.{cpp,hpp} │
├── config_reload.{cpp,hpp}     ┘
├── core_metrics.{cpp,hpp}         Metrics/diagnostics
└── tests/                         24 file test — TẤT CẢ nằm chung 1 thư mục phẳng
    ├── test_st_runtime.cpp
    ├── test_graph_runtime.cpp
    ├── test_alarm_runtime.cpp
    └── ... (21 file khác)
```

### Đề xuất (chia domain, mirror `services/iobus/`)

```
services/core/
├── CMakeLists.txt
├── main.cpp                       ← giữ ở root: entry point mkddc-core
├── json_min.hpp                   ← giữ ở root: tiện ích dùng chéo hầu hết module
│
├── st/                             "ngôn ngữ ST": parser → semantic → runtime
│   ├── st_parser.{cpp,hpp}
│   ├── st_semantic.{cpp,hpp}
│   ├── st_runtime.{cpp,hpp}
│   ├── st_stdlib.{cpp,hpp}
│   ├── st_artifact.{cpp,hpp}
│   ├── st_io_map.{cpp,hpp}
│   ├── st_cyclic_runtime.{cpp,hpp}
│   ├── st_trace.{cpp,hpp}
│   ├── st_diagnostic.hpp
│   ├── st_program.hpp
│   ├── st_validate_main.cpp       ← entry point mkddc-st-validate
│   └── tests/  (5 file: test_st_runtime, test_st_stdlib, test_st_io_map,
│                test_st_cyclic_runtime, test_st_validate_cli)
│
├── graph/                          Component graph + point data model
│   ├── graph_runtime.{cpp,hpp}
│   ├── point_table.{cpp,hpp}
│   ├── point_quality.{cpp,hpp}
│   ├── runtime_point_snapshot.{cpp,hpp}
│   ├── state_snapshot.{cpp,hpp}
│   ├── clock_snapshot.hpp
│   ├── scan_loop.{cpp,hpp}
│   └── tests/  (6 file: test_graph_runtime, test_graph_protocol,
│                test_point_quality, test_runtime_point_snapshot,
│                test_state_snapshot, test_scan_loop)
│
├── alarm/
│   ├── alarm_runtime.{cpp,hpp}
│   ├── alarm_primitives.hpp
│   └── tests/  (test_alarm_runtime)
│
├── bacnet/
│   ├── bacnet_objtable.{cpp,hpp}
│   └── tests/  (test_bacnet_objtable)
│
├── schedule/
│   ├── schedule_runtime.{cpp,hpp}
│   └── tests/  (test_schedule_runtime)
│
├── safety/
│   ├── safe_state.{cpp,hpp}
│   ├── safe_state_config.{cpp,hpp}
│   └── tests/  (test_safe_state, test_safe_state_config)
│
├── ipc/                             Giao tiếp core ↔ iobus / core ↔ web backend
│   ├── web_ipc.{cpp,hpp}
│   ├── iobus_reader.{cpp,hpp}
│   ├── output_writer.{cpp,hpp}
│   ├── priority_resolver.{cpp,hpp}
│   ├── config_reload.{cpp,hpp}
│   └── tests/  (5 file: test_web_ipc, test_iobus_reader, test_output_writer,
│                test_priority_resolver, test_config_reload)
│
└── diagnostics/
    ├── core_metrics.{cpp,hpp}
    └── tests/  (test_core_metrics)
```

**Cơ chế:** `git mv` + sửa `#include "x.hpp"` → `#include "st/x.hpp"` (v.v.) + sửa list source
trong `CMakeLists.txt` (đúng cách `services/iobus/CMakeLists.txt` đang liệt kê
`bacnet/bacnet_config.cpp`). Cơ học, build báo lỗi ngay nếu sai — rủi ro thấp.

---

## Phase B — `web/backend` (làm sau khi Phase A xanh)

### Hiện trạng (phẳng)

```
web/backend/               tất cả ~90 file .go khai báo "package main"
├── main.go
├── historian_*.go          (17 file: query, store, archive, cache, migration,
│                             policy, recovery, retention, rollback, scheduler...)
├── alarms.go, alarmhistory.go, alarmsettingsapi.go, alarmsettingsstore.go
├── virtualpoint*.go        (3 file: virtualpoint, sampler, scheduler)
├── auth.go, users.go, audit.go
├── networkapi.go, netcfg_client.go
├── config*.go              (config, configapi, configstore, pointconfig)
├── scheduleapi.go, schedulestore.go
├── system.go, capacity_{unix,windows}.go, time*.go, reload*.go, os_*.go,
│   directory_sync_*.go, file_owner_*.go, maintenance_cli.go
├── hmi_broker.go, hmi_audit_store.go
├── dto.go, points.go, pointchannel.go, point_namespace.go, http.go, ws.go,
│   core_client.go, sampler.go, runtime_snapshot.go, commissioning.go,
│   historyapi.go, pointtags.go
└── *_test.go                mỗi file trên có test đi kèm 1:1
```

### Đề xuất (chia `internal/` package theo domain)

```
web/backend/
├── cmd/server/main.go       entry point mỏng, gọi vào internal/app
│
└── internal/
    ├── historian/           tất cả historian_*.go + trendstore.go + test
    ├── alarms/               alarms, alarmhistory, alarmsettingsapi/store,
    │                         virtualpoint_alarms
    ├── auth/                 auth, users, audit
    ├── network/               networkapi, netcfg_client
    ├── config/                config, configapi, configstore, pointconfig
    ├── schedule/              scheduleapi, schedulestore
    ├── virtualpoint/          virtualpoint, virtualpoint_sampler, virtualpoint_scheduler
    ├── system/                system, capacity_*, time*, reload*, os_*,
    │                         directory_sync_*, file_owner_*, maintenance_cli
    │                         (giữ nguyên cặp build-tag _unix/_windows cùng package)
    ├── hmi/                   hmi_broker, hmi_audit_store
    └── app/                   dto, points, pointchannel, point_namespace, http, ws,
                              core_client, sampler, runtime_snapshot, commissioning,
                              historyapi, pointtags
                              ← "hub": dùng chéo nhiều domain, khả năng cao phải ở
                                lại 1 package trung tâm để tránh import cycle
```

**⚠️ Khác Phase A ở điểm quan trọng:** ranh giới `internal/app` (file hub) và việc symbol nào
cần export (viết hoa) **chưa chốt cứng** — sẽ xác nhận bằng `go build`/`go vet` khi thực thi
từng package, không đoán trước. Thứ tự thực thi: tách package **lá trước** (`hmi`, `network` —
ít phụ thuộc chéo nhất) **rồi mới đến hub** (`historian`, `config` — lớn/trung tâm nhất). Nếu
gặp import cycle 2 chiều thật sự không giải được → dừng, báo cáo, không ép cấu trúc.

---

## Consequences

| | Được | Rủi ro |
|---|---|---|
| **Phase A** | Đồng bộ với `services/iobus`, dễ định vị code theo domain | Diff lớn dù không đổi logic — review theo từng domain, không gộp 1 PR |
| **Phase B** | Domain tách biệt, giảm rủi ro 1 domain vô tình đụng domain khác (hiện tại mọi symbol visible toàn cục vì cùng `package main`) | CI job `web-backend` hiện **chỉ chạy `go build`, KHÔNG chạy `go test`/`go vet`** → phải tự chạy `go test ./...` cục bộ mỗi bước, CI không bắt hộ regression test |

## Trạng thái thực thi

**Phase A — DONE 2026-07-24.** Cả 8 domain (`st/`, `graph/`, `alarm/`, `bacnet/`, `schedule/`,
`safety/`, `ipc/`, `diagnostics/`) đã chuyển đúng theo cây đã duyệt ở trên, tuần tự từng domain
(`git mv` + sửa `#include` + sửa `CMakeLists.txt` + build/ctest ngay sau mỗi domain — không gộp
1 lượt). Xem `COR-012` trong `11_TASK_CHECKLIST.md`.

Verify trước/sau (cùng lệnh, chạy cả 2 lần):

| Kiểm tra | Trước restructure | Sau restructure |
|---|---|---|
| `cmake --build build/services` (clean, BACnet+Modbus ON) | 0 lỗi | 0 lỗi |
| `ctest --test-dir build/services --parallel 4` | 471/471 pass | 471/471 pass |
| `tools/test_safety_e2e.sh` (3 lớp safety) | PASS cả 3 lớp | PASS cả 3 lớp |
| `tools/test_reload_e2e.sh` (SIGHUP A-F) | PASS A-F | PASS A-F |
| `tools/integration_test/advanced_stack_test.sh` (Group A-E) | PASS=18 FAIL=0 SKIP=4 | PASS=18 FAIL=0 SKIP=4 (cùng tập SKIP) |

Không có regression. `main.cpp` diff chỉ đổi `#include` path, không đổi logic (xác nhận bằng
`git diff services/core/main.cpp`).

**Phase B — vẫn Proposed.** `web/backend` chưa động vào file nào — làm sau, là quyết định riêng.
