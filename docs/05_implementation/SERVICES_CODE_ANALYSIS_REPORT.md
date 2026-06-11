# DDC Services Code Analysis Report

## 1. Mục tiêu báo cáo

Phạm vi báo cáo này là source code trong thư mục `services/` của dự án.

Mục tiêu:

- Giúp đọc nhanh kiến trúc hiện tại của `services/`
- Hiểu ranh giới trách nhiệm giữa các service
- Chỉ ra luồng dữ liệu và luồng điều khiển chính
- Tìm các gap kỹ thuật, gap chức năng, gap test, và rủi ro vận hành

Ngày phân tích: `2026-06-11`

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

- Có một số bug hành vi thật ở nhánh `release` của virtual point
- Có rủi ro recovery khi `core` khởi động trước `iobus` quá lâu
- Một số module vẫn là stub, nên hệ thống chưa hoàn chỉnh về mặt chức năng cuối
- Parser JSON đang là parser tự chế, dễ mỏng ở biên input

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

#### Gap 1. Restart `iobus` có thể wipe field do `core` sở hữu trong SHM

Trong `services/iobus/io/io_cache.cpp`, `IoCache::attach()` đang `memset()` toàn bộ `kx_io_shm_t` mỗi lần attach.

Hệ quả:

- Nếu `iobus` restart riêng, các field `ao_setpoint[]` / `do_cmd[]` có thể bị reset về 0
- Trong khi đó đây là field do `core` sở hữu về mặt logic
- Hệ thống có thể tự về 0 output trong một khoảng ngắn trước khi `core` scan và ghi lại

Mức độ: trung bình đến cao, tùy yêu cầu continuity output.

#### Gap 2. Config parser là parser JSON tối thiểu tự chế

`services/iobus/config/iobus_config.cpp` không dùng thư viện JSON thật, mà parse chuỗi bằng `find`, `strtoul`, cắt substring.

Rủi ro:

- Dễ lỗi ở escape string, format lạ, duplicate key
- Sai số hành vi khi file config được format khác kỳ vọng
- Khó mở rộng schema về sau

Điểm cộng là code có chủ đích fail-fast với JSON hỏng rõ ràng.

#### Gap 3. Chưa có test riêng cho config parser

Phần `iobus` test nhiều, nhưng không thấy test cho `load_config()`.

Điểm thiếu:

- Parse config hợp lệ
- Config thiếu field
- JSON malformed
- Sensor type lạ
- AO mode lạ

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

#### Gap 1. `core` không re-attach nếu `iobus` lên trễ quá lâu

`main.cpp` retry attach `kx_io_shm` trong 30 giây. Sau đó nó vẫn tiếp tục chạy degraded.

Vấn đề là sau khi thoát khỏi đoạn retry đó:

- `reader` không có logic re-attach trong `ScanLoop`
- `OutputWriter` được tạo từ `reader.shm()` tại thời điểm khởi tạo
- Nếu lúc đó `reader.shm()` là `nullptr`, writer có thể bị vô hiệu vĩnh viễn

Hệ quả:

- Nếu `core` lên trước `iobus`, và `iobus` lên sau mốc 30 giây, hệ thống có thể không tự phục hồi đúng

Đây là gap vận hành đáng ưu tiên.

#### Gap 2. Bug thật ở `release` cho `AV/BV/MSV`

`web_ipc` cho phép `op = "release"` với point không phải AI/BI.

Nhưng trong `ScanLoop`:

- `AO` và `BO` có nhánh `release` riêng qua resolver
- `AV/BV/MSV` lại luôn đi vào `set_virtual(cmd.point, cmd.value, ...)`

Với lệnh `release`, `cmd.value` không mang ý nghĩa release thật.

Hệ quả:

- `release AV/BV/MSV` không release trạng thái nào cả
- Có thể vô tình ghi giá trị không mong muốn vào virtual point

Đây là bug hành vi thật, không chỉ là thiếu tính năng.

#### Gap 3. Quality cho `AO` không được degrade theo fault/stale

`point_quality.cpp` hiện chỉ set quality cho:

- AI
- BI
- BO

Không có nhánh cho AO.

Trong khi `point_table.cpp` đang set AO quality mặc định là `GOOD` mỗi scan.

Hệ quả:

- Khi `iobus` fault hoặc stale, `AO` vẫn có thể hiện `GOOD`
- Lớp BACnet/web đọc `AO` có thể hiểu sai sức khỏe điểm

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

Trong lần phân tích này:

- `iobus`: `33/33` test pass
- `core`: `27/27` test pass

Nghĩa là phần code đang ổn trong phạm vi test đã viết.

### 8.4 Những vùng chưa có test rõ ràng

Chưa thấy test riêng cho:

- `iobus_config.cpp`
- `web_ipc.cpp`
- behavior `core` khi `iobus` attach trễ sau 30 giây
- restart `iobus` khi `core` đang chạy và SHM đang có lệnh output
- semantics `release` cho virtual point
- publish detail trong `bacnet_objtable`

## 9. Danh sách gap ưu tiên

### Ưu tiên cao

1. Sửa bug `release` cho `AV/BV/MSV`
2. Thêm cơ chế re-attach/recover cho `core` khi `iobus` lên muộn
3. Chốt lại policy ownership khi `iobus` recreate/reset `kx_io_shm`

### Ưu tiên trung bình

4. Bổ sung quality handling cho `AO`
5. Viết test cho `web_ipc` và `iobus_config`
6. Thay parser JSON tự chế bằng parser chuẩn hoặc thu hẹp contract input chặt hơn

### Ưu tiên roadmap

7. Implement `graph_runtime`
8. Hoàn thiện semantics publish của `bacnet_objtable`
9. Nâng `web_ipc` từ stub commissioning lên interface điều khiển đầy đủ hơn

## 10. Đề xuất hướng làm tiếp

### Giai đoạn 1. Fix correctness

- Fix `release` virtual point
- Fix late-attach / re-attach cho `core`
- Thêm test tái hiện 2 case trên

### Giai đoạn 2. Fix robustness

- Rà soát lại `IoCache::attach()` để tránh reset nhầm field do `core` sở hữu
- Bổ sung test restart service
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
