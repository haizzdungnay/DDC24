# DDC Services Code Analysis Report

## 1. Mục tiêu báo cáo

Phạm vi báo cáo này là source code trong thư mục `services/` của dự án.

Mục tiêu:

- Giúp đọc nhanh kiến trúc hiện tại của `services/`
- Hiểu ranh giới trách nhiệm giữa các service
- Chỉ ra luồng dữ liệu và luồng điều khiển chính
- Tìm các gap kỹ thuật, gap chức năng, gap test, và rủi ro vận hành

Ngày cập nhật gần nhất: `2026-06-12`

## 2. Kết luận nhanh

Code `services/` đang chia khá sạch thành 2 service độc lập:

- `services/iobus`: tầng giao tiếp MCU/UART, poll IO, scale tín hiệu, ghi shared memory IO
- `services/core`: tầng logic điều khiển, quality, priority, safe-state, web IPC, publish PLC/BACnet shared memory

Điểm tốt:

- Boundary giữa `iobus` và `core` rõ
- Dùng shared contract trong `shared/`, không copy schema lung tung
- Có test unit/integration khá tốt cho phần protocol, scaling, seqlock, safe-state, priority
- Build và test hiện tại đều xanh

Điểm cần chú ý:

- 3 finding lớn của bản rà soát trước đã được fix: `late-attach` của `core`, `release` cho virtual point, và degrade quality cho `AO`
- Test coverage đã tăng rõ: thêm test cho `web_ipc`, `iobus_config`, `io_cache`
- Vẫn còn module stub ở `graph_runtime` và `bacnet_objtable`
- Parser JSON vẫn là parser tự chế, dễ mỏng ở biên input
- Có residual risk mới quanh race khi `iobus` re-attach SHM trong lúc `core` vẫn đang ghi output

## 2.1 Cập nhật sau thay đổi mới

Sau khi rà lại code mới, các điểm sau đã được xử lý so với báo cáo trước:

- `core` đã tự re-attach `kx_io_shm` trong `ScanLoop`, không còn chốt `nullptr` vĩnh viễn ở `OutputWriter`
- `release` cho `AV/BV/MSV` đã có semantics riêng `release_virtual()`, không còn ghi đè `value`
- `AO` quality giờ degrade theo `fault/stale`, không còn kẹt `GOOD`
- `iobus` đã thêm test cho config parser và `IoCache`
- `core` đã thêm test socket-level cho `web_ipc`
- Tài liệu safety `07 §5` đã được viết lại thành safety spec đầy đủ (lớp safety, trigger matrix implemented/planned, recovery rule) — hết lẫn lộn giữa behavior đã implement và planned (xem mục 7.5)

Kết luận cập nhật:

- Báo cáo cũ không còn đúng ở 4 finding lớn trên
- Các fix mới nhìn chung hợp lý và đã được khóa bằng test
- Tuy nhiên vẫn còn 2 rủi ro kỹ thuật đáng theo dõi, nêu ở mục gap cập nhật bên dưới

## 3. Cấu trúc thư mục `services/`

```text
services/
├── CMakeLists.txt
├── core/
│   ├── main.cpp
│   ├── scan_loop.*
│   ├── iobus_reader.*
│   ├── point_table.*
│   ├── point_quality.*
│   ├── priority_resolver.*
│   ├── safe_state.*
│   ├── output_writer.*
│   ├── web_ipc.*
│   ├── graph_runtime.*
│   ├── bacnet_objtable.*
│   └── tests/
└── iobus/
    ├── main.cpp
    ├── config/
    ├── iop/
    ├── io/
    ├── bridge/
    ├── diagnostics/
    ├── platform/
    └── tests/
```

## 4. Kiến trúc tổng thể

### 4.1 `iobus` làm gì

`iobus` là service gần phần cứng nhất.

Nó chịu trách nhiệm:

- Mở UART tới MCU
- Handshake theo IOP protocol
- Poll `GET_IO` theo chu kỳ
- Parse frame, kiểm CRC, kiểm SEQ, retry/timeout
- Scale raw input thành engineering value
- Ghi snapshot vào `kx_io_shm`
- Đọc `ao_setpoint[]` và `do_cmd[]` do `core` ghi rồi gửi `SET_AO` / `SET_DO` xuống MCU
- Quản lý các trạng thái `NORMAL_POLL`, `FAULT`, `SAFE_STATE`, `RECONNECT`

`iobus` không được quyết định logic relay hay output cuối. Nó là tầng vận chuyển và thực thi lệnh vật lý.

### 4.2 `core` làm gì

`core` là service điều khiển mức logic.

Nó chịu trách nhiệm:

- Đọc `kx_io_shm` bằng seqlock reader
- Đưa IO vào `PointTable`
- Tính quality và stale/fault state
- Nhận lệnh manual từ `web_ipc`
- Resolve output theo priority 6 mức
- Áp `safe_state` khi fault/stale
- Ghi `ao_setpoint[]` và `do_cmd[]` vào shared memory IO
- Publish point ra `kx_plc_shm`

`core` không mở UART và không parse protocol MCU.

## 5. Luồng dữ liệu chính

### 5.1 Input path

```text
MCU
  -> UART / IOP protocol
  -> iobus::IopClient
  -> iobus::IoCache
  -> /dev/shm/mkddc_io_shm
  -> core::IobusReader
  -> core::PointTable
  -> core::PointQuality
```

### 5.2 Output path

```text
Web IPC / Logic / Schedule / BACnet
  -> core::PriorityResolver
  -> core::SafeState
  -> core::OutputWriter
  -> /dev/shm/mkddc_io_shm (ao_setpoint[] / do_cmd[])
  -> iobus::CoreBridge
  -> iobus::OutputCommand
  -> iobus::IopClient::set_do/set_ao
  -> MCU
```

### 5.3 Monitoring / external publish

```text
core::PointTable
  -> core::BacnetObjTable
  -> /dev/shm/mkddc_plc_shm
```

## 6. Phân tích `iobus`

### 6.1 Entry point và startup flow

`services/iobus/main.cpp` có flow khá rõ:

1. Parse CLI
2. Load config
3. Attach/tạo `kx_io_shm`
4. Mở alarm socket nếu có
5. Set realtime + `mlockall` nếu được
6. Mở UART
7. Handshake MCU
8. `RESET_IO`
9. `SET_AO_CFG` nếu AO có kênh `4-20mA`
10. Vào vòng poll định kỳ

Đây là flow tương đối chuẩn cho service phần cứng.

### 6.2 Các module chính

#### `iop/`

Lõi protocol MCU:

- `iop_crc.*`: CRC16 cho frame
- `iop_frame.*`: build frame + feed parser
- `iop_parser.*`: parse payload `IO_RESP`, `DIAG_RESP`
- `iop_port.*`: bọc UART/FD
- `iop_client.*`: API mức transaction cho handshake, get_io, set_do, set_ao, reset, diag

Đây là phần được test kỹ nhất trong `iobus`.

#### `io/`

- `io_scaling.*`: scale raw sang engineering value, convert AO engineering sang raw
- `io_cache.*`: creator và writer duy nhất của `kx_io_shm`

`IoCache` là điểm rất quan trọng vì nó là boundary với toàn bộ hệ thống còn lại.

#### `bridge/`

- `core_bridge.*`: đọc field output từ shared memory do `core` sở hữu
- `output_command.*`: chỉ gửi `SET_DO` / `SET_AO` khi output đổi, chặn spam khi MCU trả `ERR_SAFE_STATE`

Thiết kế này tốt vì giữ toàn bộ ownership UART trong một thread/service.

#### `platform/`

- `realtime.*`: `SCHED_FIFO`, `mlockall`
- `systemd_notify.*`: `READY=1`, `WATCHDOG=1`

#### `diagnostics/`

- metric counter
- alarm publisher qua Unix socket

### 6.3 Điểm mạnh của `iobus`

- State machine của `IopClient` và main loop tương đối rõ
- Retry/timeout/CRC/SEQ xử lý hợp lý
- Shared memory write có seqlock
- `OutputCommand` có idempotent behavior, tránh spam lệnh output không đổi
- Có fake MCU test và tool `shm_dump_io` cho dev

### 6.4 Gap và rủi ro trong `iobus`

#### Gap 1. Preserve field của `core` khi `iobus` re-attach vẫn còn cửa race

Bug wipe thẳng `ao_setpoint[]/do_cmd[]` đã được fix: `IoCache::attach()` giờ đọc lại field của `core` trước khi init rồi restore sau đó.

Tuy nhiên vẫn còn residual risk:

- `services/iobus/io/io_cache.cpp` vẫn `memset()` toàn bộ shared memory trong lúc `core` có thể còn đang map và tiếp tục ghi `ao_setpoint[]/do_cmd[]`
- `services/core/output_writer.cpp` không kiểm `magic`, chỉ cần còn con trỏ `shm` là vẫn ghi
- Vì vậy một write mới của `core` xảy ra giữa pha `save` và pha `restore` của `iobus` có thể bị mất và bị ghi đè bởi snapshot cũ

Nói ngắn: fix mới giải quyết “wipe sạch”, nhưng chưa giải quyết triệt để race “lost update khi restart chồng nhau”.

#### Gap 2. Config parser là parser JSON tối thiểu tự chế

`services/iobus/config/iobus_config.cpp` không dùng thư viện JSON thật, mà parse chuỗi bằng `find`, `strtoul`, cắt substring.

Rủi ro:

- Dễ lỗi ở escape string, format lạ, duplicate key
- Sai số hành vi khi file config được format khác kỳ vọng
- Khó mở rộng schema về sau

Điểm cộng là code có chủ đích fail-fast với JSON hỏng rõ ràng.

#### Gap 3. Test parser/config đã được bổ sung

Finding này đã được xử lý.

Hiện đã có test riêng cho `load_config()` bao phủ:

- Parse config hợp lệ
- File thiếu
- Field thiếu
- JSON malformed
- Sensor type lạ
- Override baud dev-mode

#### Gap 4. `IopPort::write()` đang gộp nghẽn TX tạm thời thành lỗi `NOT_OPEN`

Code mới tránh busy-spin khi `write()` gặp `EAGAIN` bằng cách `poll(POLLOUT)` tối đa khoảng 50ms rồi trả `-1`.

Điểm còn hở:

- `IopClient::transact()` hiện map mọi `port_.write() < 0` thành `IopResult::NOT_OPEN`
- Nhưng `EAGAIN` kéo dài không nhất thiết có nghĩa là FD đã đóng
- Điều này có thể làm state machine diễn giải “TX nghẽn tạm thời” thành “port hỏng/mất kết nối”

Đây chưa chắc là bug đã lộ ngay, nhưng là semantics đáng review kỹ vì ảnh hưởng behavior recovery.

## 7. Phân tích `core`

### 7.1 Entry point và scan flow

`services/core/main.cpp` khởi tạo theo flow:

1. Parse CLI
2. Set realtime + `mlockall`
3. Attach `kx_io_shm` với retry
4. Mở `web_ipc`
5. Load `graph_runtime`
6. Tạo `PriorityResolver`, `SafeState`, `OutputWriter`
7. Attach `kx_plc_shm`
8. Chạy `ScanLoop`

`ScanLoop::step()` có order cố định rất tốt:

1. Read IO snapshot
2. Update point table + quality
3. Bỏ qua modbus cache ở Rev A
4. Drain web command
5. Execute graph
6. Resolve priority
7. Apply safe-state
8. Write output
9. Publish BACnet object table
10. Update metrics

Đây là pipeline rõ ràng, dễ debug, dễ maintain.

### 7.2 Các module chính

#### `iobus_reader.*`

Reader của `kx_io_shm` qua seqlock. Phần này được test tốt, có kiểm torn read.

#### `point_table.*`

Lớp trạng thái point trung tâm.

Chứa:

- AI, BI, AO, BO
- AV, BV, MSV virtual point

Thiết kế tốt ở chỗ không cho ghi trực tiếp AO/BO vật lý ngoài priority path.

#### `point_quality.*`

Tính quality theo:

- `iop_status`
- `fault_flags`
- stale `ts_ns`

#### `priority_resolver.*`

Resolve output theo 6 mức priority. Đây là module tốt, rõ mục đích và test khá đủ.

#### `safe_state.*`

Nếu IO fault/stale thì ép output về trạng thái an toàn:

- AO về `0V` hoặc `4mA` theo mode
- DO về `open`

Trigger thực tế trong code hiện chỉ có 2 nhóm:

- `iop_status = FAULT/SAFE`
- shm stale: `ts_ns` không tăng quá 3 scan (`PointQuality::is_stale()`)

Hai trigger graph-based (`ui_quality=BAD` trên kênh graph đang dùng, chưa có graph hợp lệ) là **planned Rev A.1**, chưa có trong code vì `graph_runtime` còn stub. Chi tiết đối chiếu xem mục 7.5.

#### `web_ipc.*`

Server Unix stream socket nhận JSON-line command cho manual commissioning.

#### `graph_runtime.*`

Hiện là stub no-op.

#### `bacnet_objtable.*`

Hiện publish dữ liệu point ra `kx_plc_shm`, nhưng mới ở mức stub một phần.

### 7.3 Điểm mạnh của `core`

- Ownership output rõ: chỉ `core` quyết định output logic
- Priority model sạch, test được
- Safe-state được tách rõ khỏi priority resolver
- Dùng absolute-time sleep trong scan loop, tránh drift
- Test cho stale/fault/seqlock tương đối tốt

### 7.4 Gap và rủi ro trong `core`

#### Gap 1. `late-attach` của `core` đã được xử lý

Finding này đã được fix.

Hiện tại:

- `ScanLoop` tự thử `reader.attach()` mỗi scan khi chưa attached
- `OutputWriter` không còn giữ `shm*` cố định, mà lấy mapping động qua `IobusReader`
- Đã có test `LateAttachRecoversOutputPath`

Gap này có thể xem là đã đóng.

#### Gap 2. Semantics `release` cho `AV/BV/MSV` đã được xử lý

Finding này đã được fix.

Hiện tại:

- `PointTable` có `release_virtual()` riêng
- `release` không còn ghi đè `value`, chỉ nhả `source` về `DEFAULT`
- `respond_accepted()` trả `applied_value` đúng nghĩa sau release
- Đã có test socket-level cho `AV` và `DO`

#### Gap 3. Quality cho `AO` đã được degrade đúng theo fault/stale

Finding này đã được fix.

Hiện tại `point_quality.cpp` đã degrade cả `AO` như `BO`, và test mới đã khóa:

- `IopFaultMakesAllBad`
- `AoDegradesOnStale`

#### Gap 4. `graph_runtime` đang là stub hoàn toàn

`graph_runtime.cpp` hiện:

- `load()` luôn báo stub
- `execute()` no-op

Hệ quả:

- Priority level cho local logic chưa có nguồn dữ liệu thật
- `core` hiện mới chủ yếu phục vụ manual command + safe-state + publish

Đây là gap roadmap lớn nhất về chức năng.

#### Gap 5. `bacnet_objtable` mới publish một phần contract

`bacnet_objtable.cpp` hiện mới ghi:

- `value`
- `quality`
- `scan_count`
- `scan_overrun`

Chưa thấy publish đầy đủ các phần BACnet-oriented như:

- priority array chi tiết
- relinquish default
- reliability mapping chi tiết

Nghĩa là interface publish đã có, nhưng semantics BACnet chưa hoàn thiện.

#### Gap 6. `web_ipc` là stub commissioning, chưa phải control plane hoàn chỉnh

Hạn chế hiện tại:

- Chỉ nhận `source = "manual"`
- JSON parser vẫn là parser tự chế
- Response mới ở mức `accepted/rejected`
- Chưa có trạng thái `overridden`, `effective source`, hay audit sâu hơn

Cho commissioning là đủ, cho production-grade control plane thì chưa đủ.

### 7.5 Chuỗi safety ba lớp — đối chiếu code và tài liệu

Safety của hệ không nằm riêng ở `core::SafeState` mà trải trên 3 lớp. Đối chiếu code thực tế:

| Lớp | Phát hiện | Quyết định + thực thi | Code |
|-----|-----------|----------------------|------|
| MCU FW | mất `GET_IO` > 200ms (`IOP_SAFE_TIMEOUT_MS`) | MCU tự về safe trên phần cứng, NACK `ERR_SAFE_STATE` cho mọi `SET_*` | spec `shared/iop_protocol.h` + FW |
| `iobus` | >100ms (`IOP_FAULT_TIMEOUT_MS`) không `IO_RESP` hợp lệ | `FAULT → RESET_IO(0x05) → SAFE_STATE`, ghi `iop_status` vào shm; `output_command` ngừng gửi khi bị NACK safe | `iobus/main.cpp`, `bridge/output_command.cpp` |
| `core` | `iop_status=FAULT/SAFE` hoặc stale >3 scan | ghi đè `OutputCmd` sau priority resolver: AO→0V/4mA, DO→open | `core/safe_state.cpp`, `core/point_quality.cpp` |

Nhận xét theo góc QA/QC:

- Ba lớp hội tụ cùng một safety action (AO 0V/4mA, DO open) nên không có xung đột giá trị khi nhiều lớp cùng can thiệp; lớp MCU là lớp thắng cuối cùng vì chạm phần cứng.
- Recovery ở lớp `core` là tức thời, không hysteresis; chống chập chờn dựa vào state machine của `iobus` (`SAFE_STATE → RECONNECT → handshake` lại mới trả `NORMAL`). Đây là thiết kế chấp nhận được ở Rev A nhưng cần ghi nhận là quyết định có chủ đích.
- Tài liệu `07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md` §5 trước đây trộn trigger đã implement với trigger planned (graph-based). Đã được viết lại ngày `2026-06-12` thành safety spec đầy đủ: bảng lớp safety, trigger matrix implemented/planned (T1–T7), safety action, recovery rule. Doc và code hiện khớp nhau.
- Phần safety đã implement đều có test khóa: `IopFaultForcesSafeOutputs`, `SafeStatusAlsoTriggers`, `StaleShm4ScansForcesSafe`, `RecoveryReturnsControlToResolver` (core) và integration `fake_mcu --timeout`, NACK safe-state (iobus).

Phần safety còn thiếu (gắn với roadmap, không phải bug):

- Trigger T6/T7 (graph BAD, no-graph) chờ `graph_runtime` — khi implement phải cập nhật trigger matrix 07 §5.2 và thêm test vào `test_safe_state.cpp`
- Chưa có test end-to-end 3 lớp cùng lúc (rút UART thật → đo cả MCU safe lẫn core safe trong cùng kịch bản)

## 8. Đối chiếu test coverage

### 8.1 `iobus`

Đã có test cho:

- CRC vector chuẩn
- Build/parse frame
- Parser IO/diag payload
- IO scaling
- Output command dedupe/retry/safe-state block
- Integration `IopClient` với fake MCU qua PTY

Đây là coverage mạnh cho tầng protocol.

### 8.2 `core`

Đã có test cho:

- `IobusReader` seqlock consistency
- `PointQuality`
- `PriorityResolver`
- `SafeState`
- `ScanLoop`

Đây là coverage mạnh cho control pipeline cơ bản.

### 8.3 Kết quả build/test hiện tại

Trong lần cập nhật này:

- `iobus`: `42/42` test pass
- `core`: `34/34` test pass

Nghĩa là phần code đang ổn trong phạm vi test đã viết.

### 8.4 Những vùng chưa có test rõ ràng

Chưa thấy test riêng cho:

- race thật khi `iobus` restart đồng thời `core` vẫn đang ghi output
- `iop_port.cpp` cho case `EAGAIN/POLLOUT` kéo dài trên UART/PTY
- publish detail trong `bacnet_objtable`
- `graph_runtime` ngoài stub/no-op
- kịch bản safety end-to-end 3 lớp (rút UART thật → kiểm cả MCU safe lẫn `core` safe trong một lần chạy)

## 9. Danh sách gap ưu tiên

### Ưu tiên cao

1. Giải quyết race còn lại khi `iobus` re-attach SHM trong lúc `core` vẫn đang ghi output
2. Rà lại semantics lỗi của `iop_port::write()` khi TX bị `EAGAIN` kéo dài
3. Chốt cơ chế đồng bộ ownership khi restart service chồng nhau

### Ưu tiên trung bình

4. Thay parser JSON tự chế bằng parser chuẩn hoặc thu hẹp contract input chặt hơn
5. Bổ sung test concurrency/restart path thật, không chỉ test tuần tự
6. Rà lại recovery/logging quanh `core <-> iobus` lifecycle

### Ưu tiên roadmap

7. Implement `graph_runtime` — kèm theo đó là 2 trigger safety planned T6/T7 (graph BAD, no-graph) trong 07 §5.2 và test tương ứng trong `test_safe_state.cpp`
8. Hoàn thiện semantics publish của `bacnet_objtable`
9. Nâng `web_ipc` từ stub commissioning lên interface điều khiển đầy đủ hơn
10. Thêm kịch bản test safety end-to-end 3 lớp (MCU + `iobus` + `core`) trong integration test plan

## 10. Đề xuất hướng làm tiếp

### Giai đoạn 1. Fix correctness còn lại

- Sửa race `IoCache::attach()` với `OutputWriter`
- Quyết định rõ handshake/cờ phối hợp khi `iobus` restart trên SHM đang dùng
- Sửa hoặc test hóa semantics `EAGAIN` trong `IopPort::write()`

### Giai đoạn 2. Fix robustness

- Bổ sung test restart service đồng thời thật hơn
- Rà soát lại `IoCache::attach()` để tránh lost update khi preserve field của `core`
- Bổ sung logging recovery path rõ hơn

### Giai đoạn 3. Mở rộng chức năng

- Implement `graph_runtime`
- Hoàn thiện `bacnet_objtable`
- Chuẩn hóa config / command parsing bằng thư viện JSON đáng tin cậy

## 11. Tổng kết

`services/` hiện tại có nền khá tốt về chia lớp và ownership:

- `iobus` lo phần giao tiếp vật lý, protocol, scale, publish IO snapshot
- `core` lo quyết định logic, quality, priority, safe-state, publish point logic

Đây là kiến trúc đúng hướng và dễ mở rộng.

Các vấn đề lớn hiện tại không nằm ở phần protocol cơ bản, vì phần đó đã có test khá mạnh. Gap lớn hơn nằm ở:

- recovery path giữa hai service
- stub chưa hoàn thiện ở `core`
- một vài bug/edge case ở command semantics và shared-memory lifecycle

Nếu xử lý tốt 3 nhóm này, codebase sẽ tiến từ mức “khung service chạy ổn” sang mức “runtime đủ chắc để tích hợp hệ thống thật”.
