# Thiết kế chi tiết Modbus RTU Point — DDC-24 Rev A

**ID:** DDD-SW-MBRTU-POINT-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Chủ quản đề xuất:** System Engineering / Fieldbus
**Ngày:** 2026-08-03
**Decision package:** ADR-024 — Proposed
**Nguồn yêu cầu:** `SYS-REQ-004`, `SYS/SWR/IF/SEC/NFR-REQ-MBRTU-*`,
`SWR-REQ-PROG-004..005`, `IF-REQ-PROG-001`
**As-Built đối chiếu:**
[DDC24-MODBUS-RTU-POINT-AS-BUILT-2026-08-03](../../07_records/reviews/MODBUS_RTU_POINT_AS_BUILT_REPORT.md)

**Phân rã theo layer (In Review 2026-08-04):** tài liệu này vẫn là design authority
tổng. Chi tiết từng layer nằm tại [Data Model](MODBUS_RTU_DATA_MODEL.md) ·
[UI/UX](../../04_uiux/MODBUS_RTU_UI_UX_DESIGN.md) · [FE](MODBUS_RTU_FE_DESIGN.md) ·
[BE](MODBUS_RTU_BE_DESIGN.md) · [FW-SOM](MODBUS_RTU_FW_SOM_DESIGN.md) ·
[API](../interfaces/MODBUS_RTU_API_SPEC.md) ·
[Interface](../interfaces/MODBUS_RTU_INTERFACE_SPEC.md) ·
[Verification](../../05_verification/MODBUS_RTU_VERIFICATION_PLAN.md) ·
[Traceability](../../07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md) ·
[Open Decisions](../../00_governance/MODBUS_RTU_OPEN_DECISIONS.md).
Khi có xung đột giữa tài liệu này và một tài liệu layer, **tài liệu này thắng**
cho tới khi cả bộ được duyệt cùng nhau.

## 1. Mục đích và ranh giới

Tài liệu này đề xuất thiết kế production cho **Modbus RTU Point** trước khi mở
Programming Design. Nó trả lời cách hình thành, cấu hình, poll, ghi, truyền qua
runtime, giám sát và kiểm chứng một Modbus RTU Point.

Tài liệu này **không**:

- tạo Project/Program API, ST/FBD Editor hoặc Program Runtime;
- thiết kế Deployment/Activation/Rollback của Program;
- nối Modbus TCP Point hoặc BACnet/IP Point vào Programming;
- coi source/simulator hiện hữu là production evidence;
- là Implementation Plan hoặc phê duyệt cho phép sửa source.

Khi được phê duyệt, hồ sơ này là design authority của Modbus RTU Point. Cho tới
lúc đó, trạng thái `In Review` chỉ là phương án để Product/System/Fieldbus/HW/QA
review. Programming Design sau này chỉ được tham chiếu Point Catalog ổn định từ
thiết kế này; không được tự mở một đường Modbus khác.

## 2. Kết luận thiết kế đề xuất

1. Mô hình chuẩn gồm `ModbusRTUBus → ModbusRTUDevice → ModbusRTUPoint`.
2. DDC là master duy nhất; hai bus logic `RS485-1` và `RS485-2` độc lập.
3. `mkddc-web` sở hữu cấu hình/persistence/revision; `mkddc-iobus` sở hữu bus,
   poll, codec, quality và diagnostics runtime; `mkddc-core` sở hữu Point Table,
   arbitration và đường lệnh có thẩm quyền; FE chỉ là client.
4. Point dùng `point_id` ổn định, không dùng ext slot, tag hoặc địa chỉ register
   làm identity.
5. Runtime contract phải giữ `data_type`, giá trị typed, quality bốn trạng thái,
   timestamp của mẫu và config revision. Contract float/slot hiện tại không đủ.
6. Config apply là giao dịch candidate → validate → stage → iobus ACK → active;
   không coi restart service thành công là ACK cấu hình.
7. Ghi Coil/Holding Register dùng request/result có correlation, idempotency và
   optional readback; không dùng `dirty` flag không có ACK làm contract cuối.
8. Không tự ghi `default_value`, `safe_value` hoặc lệnh cũ sau reconnect/reboot.
9. `MODBUS_RTU_POINT_READY` chỉ được đổi thành `YES` sau real-RS485/HIL,
   recovery, provenance và acceptance hai bus đúng Product baseline.

## 3. Finding P0 phải xử lý tại review

Product baseline hiện yêu cầu **hai Modbus RTU master**. Tuy nhiên hồ sơ phần
cứng đang kiểm soát chỉ mô tả một đường `CM3 UART4 → một transceiver → một
connector RS-485`. Source hiện tại cũng chỉ tạo một `ModbusMaster` với một
`rs485.device`.

Thiết kế software vẫn giữ đúng Product baseline bằng hai `bus_id`, nhưng không
được gán path `/dev/ttyS*` giả định. HW/Platform phải cung cấp capability manifest
được duyệt cho cả `RS485-1` và `RS485-2`, hoặc Product phải thay đổi baseline qua
quy trình decision. Không được đóng gate bằng USB-RS485 tạm nếu đó không phải
cấu hình sản phẩm phát hành.

## 4. Kiến trúc và quyền sở hữu

```text
React Device/Point Manager
          │ REST: candidate/revision/operation_id
          ▼
mkddc-web ── authority cấu hình, RBAC, audit, persistence
          │ UDS config transaction: validate/apply/status/rollback
          ▼
mkddc-iobus
  ├─ BusWorker RS485-1 ── device scheduler ── libmodbus RTU
  └─ BusWorker RS485-2 ── device scheduler ── libmodbus RTU
          │ typed sample snapshot + diagnostics + applied revision
          ▼
mkddc-core ── canonical Point Table ── REST/WebSocket monitor
          │
          └─ command request/result ──► iobus write queue ──► slave
```

| Trạng thái/chính sách | Owner duy nhất | Consumer |
|---|---|---|
| Candidate, active config, revision, checksum, audit | `mkddc-web` | FE, iobus |
| Mapping logical port → device node/capability | deployment/platform manifest | web, iobus |
| Serial handle, scheduler, codec, poll state | `mkddc-iobus` | core, web |
| Runtime value, quality reason, sample timestamp, counters | `mkddc-iobus` | core |
| Canonical Point Table và command arbitration | `mkddc-core` | web, Programming sau này |
| Form, table, diagnostics presentation | FE | người dùng |

Bất biến kiến trúc:

- mất Web/FE không dừng poll hoặc local control;
- Web/FE không mở UART, không ghi SHM và không ghi register trực tiếp;
- mỗi bus chỉ có một master worker và tối đa một transaction đang phát trên dây;
- lỗi một bus không chặn IOP UART, bus còn lại hoặc core scan;
- Modbus RTU không đi qua STM32/IOP; nó đi từ SOM tới transceiver RS-485;
- HMI là ngoài scope cấu hình sâu của hồ sơ này.

## 5. Mô hình miền

### 5.1 `ModbusRTUBus`

| Field | Kiểu/rule | Ý nghĩa |
|---|---|---|
| `bus_id` | enum bất biến: `rs485-1`, `rs485-2` | identity logic, không phải `/dev/ttyS*` |
| `port_ref` | enum capability: `RS485-1`, `RS485-2` | Platform map sang device node đã allowlist |
| `enabled` | bool | bật bus |
| `baud` | 9600/19200/38400/57600/115200 | chung cho mọi device trên bus |
| `parity` | `N/E/O` | chung cho bus |
| `data_bits` | cố định `8` | không cho UI sửa |
| `stop_bits` | `1/2` | chung cho bus |
| `offline_probe_ms` | 1000..60000 | chu kỳ thử lại device OFFLINE |

Không cho user nhập path tùy ý trong production. USB-RS485 chỉ được dùng trong
lab profile có provenance riêng. Hai bus không được map tới cùng device node.

### 5.2 `ModbusRTUDevice`

| Field | Kiểu/rule | Ý nghĩa |
|---|---|---|
| `device_id` | server-generated, bất biến, 1..23 ASCII | identity device |
| `display_name` | UTF-8, 1..64 | tên hiển thị |
| `bus_id` | tham chiếu bus tồn tại | chọn RS485-1/2 |
| `slave_id` | 1..247, unique trong bus | địa chỉ slave |
| `enabled` | bool | device tham gia scheduler |
| `poll_ms` | 100..60000 | deadline poll khi online |
| `timeout_ms` | 20..5000 | timeout mỗi attempt |
| `retry` | 0..3 | số retry sau attempt đầu |
| `stale_after_ms` | ≥ `poll_ms + timeout_ms` | tuổi mẫu chuyển STALE |
| `offline_after_ms` | > `stale_after_ms` | tuổi mẫu chuyển OFFLINE |
| `verify_write` | bool, mặc định `true` | readback sau write khi register đọc được |

Serial format thuộc Bus, không lặp trên từng Device. Trùng `slave_id` chỉ bị
cấm trong cùng bus; cùng ID trên hai bus là hợp lệ.

### 5.3 `ModbusRTUPoint`

| Field canonical | Authority/rule |
|---|---|
| `point_id` | BE sinh một lần, bất biến, 1..23 ASCII; rename/reorder không đổi |
| `tag_name` | BE/Core namespace, Unicode NFC + so sánh case-fold; unique toàn Local/Virtual/Modbus RTU |
| `display_name` | metadata từ BE, 1..64 UTF-8 |
| `device_id` | tham chiếu Device tồn tại |
| `data_type` | `bool/int16/uint16/int32/uint32/float32` |
| `unit` | metadata engineering, tối đa 16 ký tự |
| `value` | runtime read-only, typed; không lấy từ localStorage |
| `quality` | `GOOD/STALE/OFFLINE/BAD` |
| `timestamp` | UTC của lần sample thành công; không đổi khi chỉ quality xấu đi |
| `read_write` | `read` hoặc `read_write` |
| `source` | hằng `modbus_rtu` |
| `default_value` | cùng data type; chỉ dùng khởi tạo/hiển thị khi chưa có sample, quality vẫn BAD |
| `safe_value` | cùng data type; chỉ là policy input cho core, fieldbus không tự ghi |

Thuộc tính register:

| Field | Rule |
|---|---|
| `register_type` | `coil/discrete_input/input_register/holding_register` |
| `address` | protocol data address **zero-based**, 0..65535 |
| `byte_order` | `big/little`; không áp dụng cho bit |
| `word_order` | `high_low/low_high`; chỉ có nghĩa với 32-bit |
| `scale` | finite, khác 0 |
| `offset` | finite |
| `engineering_min/max` | optional, finite và min < max |
| `enabled` | bool |

UI có thể hiển thị reference kiểu `40001`, nhưng persistence/API luôn lưu
`address` zero-based và phải ghi rõ convention cạnh field. Các range register
của hai Point enabled không được overlap trong cùng `(device, register_type)`;
alias chỉ được hỗ trợ sau một decision riêng.

`RETAIN` không phải thuộc tính của Modbus RTU Point. RETAIN thuộc Variable của
Programming. Last-known-value cache cũng không được gọi là RETAIN.

## 6. Register và codec

| Register type | Read FC | Write FC | Data type hợp lệ |
|---|---:|---:|---|
| Coil | 01 | 05 | bool |
| Discrete Input | 02 | — | bool |
| Input Register | 04 | — | int16/uint16/int32/uint32/float32 |
| Holding Register | 03 | 06 cho 16-bit; 16 cho 32-bit | int16/uint16/int32/uint32/float32 |

Quy tắc codec:

- 16-bit tiêu thụ một register; 32-bit tiêu thụ hai register;
- read: `engineering = raw × scale + offset`;
- write: `raw = (engineering - offset) / scale`, kiểm range trước khi encode;
- integer write làm tròn nearest, ties away from zero; reject nếu sai số sau
  round vượt 0,5 LSB hoặc vượt range raw/engineering;
- reject NaN, infinity, scale bằng 0, count sai, địa chỉ tràn và type không hợp lệ;
- Modbus exception response là lỗi transaction, không phải một sample GOOD;
- batch read tối đa 2000 bit hoặc 125 register theo giới hạn protocol.

Batch chỉ gộp Point cùng device + function code có range liền kề. Không đọc
qua gap mặc định vì một số slave có side effect hoặc reject vùng không khai báo.

## 7. Poll scheduler hai bus

Mỗi bus có một worker độc lập, dùng monotonic clock và deadline tuyệt đối.
Trong một bus, scheduler dùng earliest-deadline-first có round-robin khi cùng
deadline. Một device OFFLINE chuyển sang probe chậm để không làm đói device tốt.

State device:

```text
DISABLED
   └─enable→ INITIALIZING
INITIALIZING ─success→ ONLINE
ONLINE ─sample quá stale_after_ms→ DEGRADED
DEGRADED ─sample quá offline_after_ms→ OFFLINE
OFFLINE ─probe success→ ONLINE
mọi state ─config/codec invalid→ CONFIG_ERROR
```

Admission validation phải tính tải bus từ baud, request/response size, số block
và poll period. Cấu hình bị từ chối nếu tải nominal ước tính vượt 70% hoặc một
transaction với retry không thể hoàn tất trong `poll_ms`. Scheduler phải đo
deadline miss/overrun thực tế; không được âm thầm kéo dài poll period.

Retry chỉ áp dụng cho transaction lỗi hiện tại. Sau khi hết retry, scheduler
nhường bus cho device khác. Không tạo busy loop và không dùng một timeout của
device lỗi để chặn bus còn lại.

## 8. Quality và timestamp

| Điều kiện | Quality | Value/timestamp |
|---|---|---|
| sample decode/range hợp lệ | GOOD | cập nhật value + timestamp sample |
| chưa quá `stale_after_ms` sau một lỗi | giữ GOOD, diagnostics ghi lỗi | giữ sample gần nhất |
| tuổi mẫu ≥ `stale_after_ms` | STALE | giữ last-known value/timestamp |
| tuổi mẫu ≥ `offline_after_ms` hoặc port mất | OFFLINE | giữ last-known value/timestamp |
| config/codec/range/non-finite invalid | BAD | không publish value mới |
| chưa từng có sample | BAD, reason `NOT_INITIALIZED` | `default_value`, timestamp null |

`quality_reason` phải phân biệt tối thiểu `NOT_INITIALIZED`, `CONFIG_ERROR`,
`DECODE_ERROR`, `OUT_OF_RANGE`, `TIMEOUT`, `CRC_ERROR`, `PORT_DOWN`,
`DEVICE_EXCEPTION` và `WRITE_FAILED`. UI không được suy diễn quality chỉ từ
`online` hoặc `consecutive_errors`.

Sample contract mang cả `sample_mono_ns` để đánh stale ổn định và
`sample_utc_ms` để API/WS hiển thị. Khi đồng hồ hệ thống chưa synchronized,
quality dữ liệu không tự đổi nhưng health phải báo `time_sync=false`.

## 9. Runtime/IPC contract v2

Ext slot hiện tại chỉ có `name[24]`, `float value`, quality ba mức và không có
sample timestamp/config revision. Thiết kế production dùng message v2 có header:

```text
magic, schema_version, message_size, sequence,
config_revision, config_checksum, producer_boot_id,
sample_count, generated_mono_ns, generated_utc_ms
```

Mỗi sample có:

```text
point_id[24], device_id[24], bus_id,
data_type, double value,
quality, quality_reason,
sample_mono_ns, sample_utc_ms,
read_write, online
```

Lý do dùng `double`: giữ chính xác mọi int32/uint32 và vẫn mang engineering
value sau scale; `float` hiện tại làm mất chính xác một phần uint32. Slot index
chỉ là cache location trong một config generation, không phải identity.

Runtime sample iobus → core có thể tiếp tục dùng UDS datagram vì snapshot mới
thay snapshot cũ, nhưng phải có sequence/generation để phát hiện drop/reorder.
Command/write và config transaction phải dùng UDS reliable có correlation,
bounded frame, timeout và peer credential; không dùng datagram fire-and-forget.

Thay contract v1 cần version/magic mới, static assertion, cập nhật mọi producer/
consumer, reject mismatch và coordinated deploy. Không reinterpret byte v1 như
v2 và không dựa vào quy tắc append-only nếu semantic field cũ đã thay đổi.

## 10. Point Catalog, REST và WebSocket

Point Catalog do BE/Core cung cấp cho mọi consumer, gồm đúng canonical Point
Model ở mục 5. I/O Mapping của Programming sau này chỉ tham chiếu `point_id` và
không được nhúng register address/slot.

API design đề xuất:

| Method/path | Quyền | Hành vi |
|---|---|---|
| `GET /api/v1/modbus/config` | viewer | active/candidate/revision/checksum/apply state |
| `POST /api/v1/modbus/config/validate` | admin | validate toàn candidate, không side effect |
| `PUT /api/v1/modbus/config/candidate` | admin | ghi candidate với `base_revision` + `operation_id` |
| `POST /api/v1/modbus/config/apply` | admin | yêu cầu iobus apply và chờ authoritative result |
| `POST /api/v1/modbus/config/rollback` | admin | phục hồi last-known-good |
| `GET /api/v1/modbus/diagnostics` | viewer | bus/device/point diagnostics thật |
| `POST /api/v1/modbus/commission/read` | operator/admin | test read có TTL/rate limit, không sửa config |
| `POST /api/v1/modbus/commission/write` | admin | test write có confirm, audit và result |
| `POST /api/v1/modbus/import` | admin | import vào candidate, cùng validator |
| `GET /api/v1/modbus/export` | admin | export schema/revision/checksum, không secret |

CRUD Device/Point hiện hữu có thể được giữ để tương thích, nhưng mutation phải
chỉ sửa candidate. Người dùng bấm Apply một lần cho một revision đầy đủ; không
restart iobus sau từng keystroke/CRUD.

Mọi mutation dùng optimistic concurrency (`base_revision` hoặc `If-Match`) và
`operation_id` idempotent. Error result có code ổn định, tối thiểu:
`REVISION_CONFLICT`, `VALIDATION_FAILED`, `PORT_UNAVAILABLE`,
`IOBUS_REJECTED`, `APPLY_TIMEOUT`, `ROLLBACK_FAILED`, `DEVICE_OFFLINE`,
`WRITE_REJECTED`.

WebSocket point event gồm `sequence`, `config_revision`, `point_id`, typed
`value`, `quality`, `quality_reason`, `timestamp`, `source=modbus_rtu`. Reconnect
phải lấy snapshot mới trước khi nhận delta; FE không replay mutation.

## 11. Giao dịch cấu hình atomic

```text
ACTIVE rev N
  → save CANDIDATE với base_revision=N
  → BE validate schema/cross-reference/tag/address/load/capability
  → durable STAGE rev N+1 + checksum + journal
  → iobus parse/open workers/build slot map trong generation mới
  → iobus ACK(applied revision/checksum) hoặc REJECT(reason)
  → ACK: BE chuyển manifest active sang N+1
  → REJECT/TIMEOUT: iobus giữ/reopen N; BE giữ active N và đánh candidate failed
```

Checksum là SHA-256 của canonical JSON không chứa field checksum. Stage, journal,
manifest và last-known-good phải ghi temp → fsync file → rename → fsync directory.
Sau crash/power loss, BE đối chiếu journal với applied revision từ iobus; không
được tự kết luận N+1 active chỉ vì file tồn tại.

ACK apply nghĩa là:

- schema/profile parse thành công;
- hai bus enabled mở đúng capability/serial format;
- device/point map không tràn capacity;
- workers chạy generation mới;
- iobus publish đúng revision/checksum.

ACK không đồng nghĩa mọi slave online. Connectivity của slave được phản ánh bằng
quality/diagnostics sau apply.

## 12. Write path và hành vi an toàn

```text
authoritative caller
  → core: RBAC/policy/type/range/read_write/quality validation
  → ModbusWriteRequest(request_id, point_id, revision, typed value, deadline)
  → iobus: resolve point_id trong active generation
  → FC05/FC06/FC16
  → optional readback
  → ModbusWriteResult(accepted/applied/rejected/timeout, raw exception)
  → core/audit/UI nhận kết quả có thẩm quyền
```

Rule bắt buộc:

- read-only, STALE/OFFLINE/BAD, revision cũ, non-finite hoặc out-of-range bị reject;
- duplicate `request_id` + cùng payload trả cùng kết quả; khác payload trả
  `ID_CONFLICT`;
- queue bounded; đầy queue trả lỗi, không drop im lặng;
- write timeout không được báo success;
- device reconnect/reboot/iobus restart không tự replay write cũ;
- không tự ghi `default_value` hoặc `safe_value` khi communication loss;
- `safe_value` chỉ được dùng khi core/Programming policy đã được phê duyệt gửi
  một request mới trong active revision;
- write audit gồm actor, point_id, revision, requested value, result, exception,
  thời gian và correlation ID.

## 13. Diagnostics và health

Tối thiểu phải có:

| Cấp | Metrics/state |
|---|---|
| Bus | port capability, open state, baud/parity/stop, tx/rx frame, CRC, timeout, scheduler overrun, utilization estimate, reconnect, last error |
| Device | online state, poll success/error, consecutive error, retry, last success, sample age, latency last/max, exception code counters |
| Point | quality/reason, last sample, decode/range error, last write request/result/readback |
| Config | candidate/active/applied revision + checksum, apply state, last rollback |

Counter dùng uint64 và gắn `producer_boot_id`/start time để consumer biết reset.
Health endpoint phải kiểm core, iobus, SHM/IPC, hai bus và applied revision. Thiếu
telemetry phải hiển thị `unknown/unavailable`, không quy về 0 hoặc online.

## 14. Security và vận hành

- viewer: xem config active, Point và diagnostics;
- operator: commissioning read; không sửa config;
- admin: candidate/validate/apply/rollback/import/export và commissioning write;
- mọi mutation có audit trước/sau, không log credential;
- production port path là allowlist từ capability manifest;
- không có raw arbitrary-function-code endpoint;
- import giới hạn kích thước, strict schema, từ chối unknown field ở contract
  version đang dùng;
- config backup/restore phải giữ schema version, revision, checksum và migration
  result;
- package/release phải ghi version, Git commit, build time, checksum và toolchain;
  target phải truy được binary iobus/web/core cùng contract version.

## 15. Capacity và giới hạn Rev A đề xuất

| Hạng mục | Giới hạn review |
|---|---:|
| Bus logic | 2 |
| Device được support/verify | 16 mỗi bus, 32 tổng |
| Slave ID | 1..247, unique mỗi bus |
| Modbus RTU Point | 64 tổng ở Rev A |
| ID | 23 byte ASCII + NUL trong IPC |
| Read bit block | 2000 bit |
| Read register block | 125 register |
| Pending write | 64 toàn hệ, bounded |
| Config payload | 1 MiB |

64 Point là giới hạn compatibility của hiện trạng, không phải capacity vĩnh viễn.
Nếu Product yêu cầu cao hơn, phải có sizing, memory/timing test và contract
version mới; không silently truncate.

## 16. Verification và acceptance

### 16.1 Automated/host — supporting evidence

- strict config/schema, namespace, overlap, capacity và admission validation;
- codec golden vectors cho mọi type/endian/scale/offset và negative values;
- scheduler fairness, retry/offline probe, two-bus fault isolation;
- quality/timestamp state machine bằng fake clock;
- config transaction crash points, stale revision, rollback, corrupted files;
- typed IPC v2 layout/magic/version/sequence và cross-language fixtures;
- write idempotency/ACK/readback/timeout/exception/no-replay;
- REST RBAC/audit/import/export/WS snapshot-reconnect;
- simulator độc lập cho FC01/02/03/04/05/06/16 và fault injection.

Host/simulator pass không đóng real-hardware gate.

### 16.2 Target/RS485/HIL — release evidence bắt buộc

| ID | Scenario bắt buộc | Acceptance chính |
|---|---|---|
| MBRTU-HIL-01 | Resolve và mở RS485-1 + RS485-2 của production hardware | đúng capability/device node; không dùng adapter lab thay thế |
| MBRTU-HIL-02 | Mọi baud/parity/stop được hỗ trợ trên cả hai bus | read ổn định, waveform/auto-direction không cắt frame |
| MBRTU-HIL-03 | Đọc Coil/Discrete/Input/Holding với mọi data type/endian | value typed/scale/timestamp đúng golden device |
| MBRTU-HIL-04 | Ghi Coil/Holding 16/32-bit + readback | authoritative result đúng, không false-success |
| MBRTU-HIL-05 | CRC lỗi, timeout, sai slave/baud/parity, rút/đảo dây | counter/reason và GOOD→STALE→OFFLINE đúng deadline |
| MBRTU-HIL-06 | Hai bus đồng thời; một bus fault | bus tốt và IOP/core control không gián đoạn |
| MBRTU-HIL-07 | 16 slave/bus theo capacity đã duyệt | không starvation; poll deadline/overrun đạt limit |
| MBRTU-HIL-08 | iobus/core/web crash + systemd restart | phục hồi có health, không replay write |
| MBRTU-HIL-09 | reboot/power-cycle giữa stage/apply/ACK | chỉ N hoặc N+1 active rõ; rollback đúng, không config lai |
| MBRTU-HIL-10 | rename/reorder/import config và reboot | point_id/value không swap slot; tag unique |
| MBRTU-HIL-11 | target provenance và coordinated ABI mismatch | fail rõ; truy binary đúng commit/checksum |
| MBRTU-HIL-12 | soak 24 giờ với tải được duyệt | 0 crash, 0 identity swap, 0 uncontrolled write; thống kê poll kèm raw log |

Mỗi record ghi hardware revision, wiring, termination/bias, slave model/firmware,
binary identity, config revision/checksum, tool/instrument, stimulus, raw logs,
acceptance limit, result, operator, reviewer và artifact SHA-256.

## 17. Sai khác As-Built cần đóng sau khi design được duyệt

| As-Built hiện tại | Design target | Mức |
|---|---|---|
| một `rs485.device`/một master | hai BusWorker theo hai capability thật | P0 |
| serial config lặp trên Device | serial config thuộc Bus | P0 |
| hardware controlled draft chỉ có UART4/một connector | Product baseline hai bus có schematic/BOM/device-node evidence | P0 |
| ext value `float`, slot/name là identity thực tế | typed `double` + stable `point_id` + generation | P0 |
| quality ba mức, FE có chỗ suy diễn | GOOD/STALE/OFFLINE/BAD + reason từ authority | P0 |
| ext sample không mang timestamp/config revision | producer timestamp + revision/checksum/sequence | P0 |
| restart iobus được coi là apply | iobus authoritative ACK + crash journal | P0 |
| `setpoint/dirty` không có result/readback | request/result reliable + no-replay | P0 |
| simulator host đã pass | real two-bus RS485/HIL chưa có | P0 |
| diagnostics uint32, ghép theo slave address | uint64 + boot ID + bus/device stable identity | P1 |

Đây là gap list, không phải Implementation Plan.

## 18. Nội dung cần reviewer quyết định

| ID | Đề xuất cần duyệt | Owner đề xuất | Khuyến nghị | Trạng thái |
|---|---|---|---|---|
| DR-MBRTU-001 | Giữ Product baseline hai RS485 master và freeze phần cứng tương ứng, hay đổi Product | Product + HW + Platform | Giữ hai; HW phải chứng minh hai path production | OPEN |
| DR-MBRTU-002 | Bus là resource riêng, Device tham chiếu bus | System + Fieldbus | Approve | OPEN |
| DR-MBRTU-003 | Address canonical zero-based | Fieldbus + API | Approve | OPEN |
| DR-MBRTU-004 | Quality/timestamp state machine mục 8 | Product + Core + Fieldbus | Approve | OPEN |
| DR-MBRTU-005 | Typed runtime IPC v2 và coordinated ABI migration | Core + Fieldbus + Web | Approve | OPEN |
| DR-MBRTU-006 | Atomic apply phải chờ iobus revision/checksum ACK | System + Web + Fieldbus | Approve | OPEN |
| DR-MBRTU-007 | Reliable write result/readback; cấm blind replay/safe auto-write | Controls + Fieldbus + Safety review | Approve | OPEN |
| DR-MBRTU-008 | Capacity 2 bus, 16 device/bus, 64 Point tổng | Product + Performance + QA | Approve có load measurement | OPEN |
| DR-MBRTU-009 | RBAC commissioning: read operator, write/config admin | Product + Security | Approve | OPEN |

OD-PROG-007 và OD-PROG-008 chỉ được đóng phần Modbus RTU sau khi các quyết định
trên được Accepted và requirement/interface/verification đồng bộ. Việc duyệt
hồ sơ này không tự đóng các open decision khác của Programming.

## 19. Gate

```text
MODBUS_RTU_DESIGN_DOCUMENTED = YES
MODBUS_RTU_DESIGN_REVIEW_READY = YES
MODBUS_RTU_DESIGN_APPROVED = NO
MODBUS_RTU_IMPLEMENTATION_CONFORMS_TO_DESIGN = NO
MODBUS_RTU_REAL_HARDWARE_VERIFIED = NO
MODBUS_RTU_POINT_READY = NO
READY_TO_ENTER_PROGRAMMING_DESIGN = NO
```

Điều kiện đổi hai dòng cuối thành `YES`: ADR-024 Accepted; DR-MBRTU-001..009
được quyết định; P0 gap mục 17 đóng bằng source + test; MBRTU-HIL-01..12 có
evidence được reviewer phê duyệt; target provenance truy được về commit sạch.

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-03 | In Review | Tạo design package đầy đủ để review trước Programming Design |
