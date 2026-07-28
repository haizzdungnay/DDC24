# Interface Contracts

**ID:** IF-SPEC-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-28 (M-01: giới hạn tài nguyên parser + diagnostic `ST-LIM-*`/`ST-SYN-002`; sửa path sau ADR-021)

## Kinexus-IOP v2

Nguồn thực thi: `shared/iop_protocol.h`.

| Contract | Giá trị hiện hành |
|---|---|
| UART | 921600 baud |
| `GET_IO` cadence | 2 ms / 500 Hz |
| response timeout | 3 ms |
| retry tối đa | 3 |
| link fault | 20 ms |
| reconnect | 5 s |
| handshake timeout | 1000 ms |
| MCU no-poll safe timeout | 200 ms |
| `IO_RESP` payload/frame | 74 / 80 bytes |
| Rev A capability | `0x000D`: UI16 + AO4 + DO4 |

Frame, enum, CRC và packed layout không được sao chép sang implementation khác bằng magic numbers; consumer phải include/generate từ contract chung và có static assertions.

## Shared memory ABI

Nguồn thực thi: `shared/mkddc_shm.h`.

- IO: `/dev/shm/mkddc_io_shm`; PLC: `/dev/shm/mkddc_plc_shm`.
- Magic hiện hành: `0x4B584404`.
- Capacity: UI16, reserved optional DI8, AO4, DO4, AV32, BV16, MSV8, extension64.
- Iobus ghi I/O state/reliability; core ghi AO setpoint/DO command và sở hữu PLC SHM.
- Writer dùng sequencing contract; reader phải phát hiện inconsistent snapshot.

Mọi thay đổi field, alignment hoặc semantic unit là ABI change: đổi magic, cập nhật tất cả consumer và layout tests, rebuild/deploy đồng bộ.

## AO boundary

AO ở core/iobus boundary là giá trị vật lý V hoặc mA theo electrical mode đã được MCU acknowledge. BACnet/config engineering range được convert đúng một lần trước boundary. Non-finite/out-of-range bị reject.

## FW SOM IEC programming — validate gateway (host-only, no target/HIL evidence)

Nguồn thực thi: `services/core/st/st_*.{hpp,cpp}`. Đây là contract của một component
đọc lập test trong `services/core` (`mkddc-core`) — KHÔNG phải
`mkddc-program-service`/`mkddc-program-core` (ADR-020, chưa triển khai, C1+).
Không gắn vào scan loop sản xuất; BE gọi component này như 1 CLI riêng.

**CLI:** `mkddc-st-validate --source <path>` — argv cố định, source luôn qua
file path (không bao giờ đưa source text vào argv/shell), input đọc tối đa
64 KiB. BE tự set timeout khi spawn subprocess; CLI không tự chờ vô hạn.

| Exit code | Ý nghĩa |
|---|---|
| 0 | `ok=true` — source hợp lệ |
| 1 | `ok=false` vì lỗi ST thật (syntax/semantic) — CLI chạy đúng, source sai |
| 2 | lỗi usage/IO phía CLI (thiếu argv, không đọc được file, file quá lớn) |

Output: đúng 1 dòng JSON ra stdout, shape cố định dù ok=true/false:

```json
{
  "ok": false,
  "diagnostics": [
    {"severity":"error","code":"ST-SEM-001","message":"...",
     "sourceId":"","line":8,"column":8,"length":1}
  ],
  "symbols": [{"name":"SupplyTemp","direction":"input","type":"REAL"}],
  "artifactHash": "3F2A9C1B7E4D5061",
  "compilerVersion": "fwsom-st-0.2.0",
  "irSchemaVersion": 1
}
```

`artifactHash` = FNV-1a 64-bit hex của source text — **hash nội dung, KHÔNG
phải hash mật mã học**; dùng để so sánh 2 lần build cùng input có ra cùng kết
quả không, không dùng cho chữ ký/integrity chống giả mạo. `diagnostics[]`
hiện luôn ≤1 phần tử (parser/semantic fail-fast ở lỗi đầu tiên) nhưng field
là mảng để BE/FE không cần đổi shape khi sau này hỗ trợ multi-diagnostic.
Diagnostic code ổn định — xem `st_diagnostic.hpp` (`ST-LEX-*`, `ST-SYN-*`,
`ST-SEM-*`, `ST-LIM-*`, `ST-IOMAP-*`, `ST-CLI-*`); FE/BE map theo code, không
parse `message` (tiếng Anh, có thể đổi câu chữ).

**Giới hạn tài nguyên (M-01, nguồn thực thi `services/core/st/st_limits.hpp`).**
Parser tự kiểm mọi giới hạn dưới đây, không phụ thuộc caller đã kiểm hộ hay
chưa. Vượt giới hạn luôn trả diagnostic có code ổn định — **không bao giờ
segfault/abort/stdout rỗng**:

| Giới hạn | Giá trị | Code khi vượt |
|---|---|---|
| Kích thước source | 64 KiB | `ST-LIM-001` (qua CLI: `ST-CLI-TOOLARGE`, exit 2) |
| Số token | 32768 | `ST-LIM-002` |
| Số biến | 512 | `ST-LIM-003` |
| Số statement | 4096 | `ST-LIM-004` |
| Độ dài identifier | 64 ký tự | `ST-LIM-005` |
| Độ sâu biểu thức | 32 | `ST-SYN-002` |
| Độ sâu statement (IF lồng) | 16 | `ST-SYN-002` |
| Số diagnostic trả về | 64 | `ST-LIM-006` ở phần tử cuối |

`ST-SYN-002` tách riêng khỏi `ST-SYN-001` vì đây không phải "viết sai cú pháp"
mà là "vượt giới hạn tài nguyên" — BE nên báo user đơn giản hoá chương trình,
không phải đi tìm lỗi gõ. Tương tự, `ST-LIM-*` tách khỏi `ST-SYN-*` để BE phân
biệt "chương trình sai" với "chương trình quá lớn".

`ST-LIM-006` luôn là **phần tử cuối** của `diagnostics[]` khi danh sách bị cắt;
BE thấy code này thì biết còn lỗi chưa hiển thị, không được kết luận "hết lỗi".

Bảo đảm bắt buộc của CLI với mọi input, kể cả đối kháng: exit code luôn thuộc
`{0, 1, 2}`, stdout luôn là **đúng một dòng JSON** parse được với đủ 6 field.
Verify bằng `st/tests/test_st_limits.cpp` và nhóm test đối kháng trong
`st/tests/test_st_validate_cli.cpp` (fork+execv binary thật).

**Ngôn ngữ ST hỗ trợ (không được suy diễn thêm từ đây):** `PROGRAM`/
`VAR_INPUT`/`VAR_OUTPUT` với kiểu `REAL`/`BOOL`; assignment `:=`; so sánh
`>`,`>=`,`<`,`<=`,`=`,`<>`; boolean `AND`/`OR`/`NOT`; ngoặc đơn; gọi hàm
chuẩn — hiện chỉ `LIMIT(MN, IN, MX): REAL`; `IF..THEN..ELSE..END_IF`. Chưa
có: arithmetic, `CASE`, loop, `FUNCTION_BLOCK` instance/state (nên `TON`
CHƯA implement — cần kiểu `TIME` + dot-member access, xem `st/st_stdlib.hpp`),
`SEL`, LD/SFC.

**io_map validation** (`st_io_map.hpp`, chưa có file `io_map.json`/CRUD
thật — đó là việc của BE khi có storage layer, xem C2): mỗi biến
`VAR_INPUT`/`VAR_OUTPUT` phải có đúng 1 binding; `direction` phải khớp
input/output khai báo; `type` phải khớp; `point_id` phải đúng dạng
`PREFIX-NN` với `PREFIX ∈ {UI,DI,AO,DO}` (physical point — `AV/BV/MSV`
binding chưa thuộc phạm vi này); range (nếu có) chỉ áp dụng cho `REAL`,
`range_min < range_max`. Trả về TẤT CẢ lỗi tìm thấy trong 1 lần gọi (khác
parser/semantic fail-fast), vì io_map thường có nhiều dòng độc lập.

**Cyclic runtime + trace** (`st_cyclic_runtime.hpp`, `st_trace.hpp`, host-only
— chưa nối `mkddc-iobus`/STM32 thật, xem C9): activation request áp dụng
CHỈ tại đầu cycle kế tiếp (không giữa lúc execute() đang chạy), fail thì
package cũ tiếp tục. Metric quan sát được: `cycle_count`, `overrun_count`
(exec vượt budget), `exec_fault_count`, `last_exec_ns`, `max_exec_ns`.
`StTraceEvent` kind: `VALIDATE_RESULT`, `ACTIVATION_RESULT`, `RUNTIME_FAULT`,
`OVERRUN`, `ROLLBACK` — giữ trong `StTraceLog` (bounded ring buffer, in
process, chưa persist) tới khi `mkddc-program-service` có audit storage
thật.

## Web/API

Nguồn thực thi: `web/backend/http.go` và validator/schema liên quan. Route groups hiện hành gồm auth/me/users; system status/network/config; points và WebSocket; alarms; commissioning; history/trends; schedules; alarm settings. Hồ sơ này không freeze danh sách route chi tiết; OpenAPI hoặc route tests, nếu phát hành, phải sinh/verify từ code.

### Network API — implemented baseline versus target

Source hiện tại của `PUT /api/v1/network` chỉ validate cơ bản rồi ghi riêng lẻ `network.conf`, `device.conf`, `bacnet.conf`. `dispatchReload(system|restart-iobus)` đi vào `applySystem()` nhưng implementation trả `applied=false` với warning `pending B7`; frontend hiện không phân biệt kết quả này. GET network ưu tiên IP desired trong file và `bmsLink` chỉ được suy ra từ IP/enabled/port, nên không phải active-kernel/BACnet health authority.

Đây là finding đang mở, không phải hành vi mục tiêu. Cho tới khi các task network hoàn tất, thay đổi qua Web chỉ được gọi là **saved desired configuration**, không được gọi là IP đã apply. OpenAPI hiện hành mô tả route đã implement; API transaction mới chỉ được publish sau khi BE team map đầy đủ sang contract SOM bên dưới và có contract tests.

### SOM network authority contract — implemented v1; target acceptance pending

Authority dùng line-delimited JSON version 1 qua `/run/mkddc-netcfg/netcfg.sock`, frame tối đa 8192 byte, socket `0660` trong runtime directory riêng `root:mkddc 0750`; peer credential allowlist chỉ cho broker/service account đã phê duyệt. Schema authority: `shared/netcfg_protocol_v1.schema.json`.

Action allowlist:

| Action | Ý nghĩa | Side effect |
|---|---|---|
| `status` | trả active kernel state, pending transaction và last-known-good metadata | không |
| `validate` | validate candidate và chạy preflight không activate | không |
| `stage` | persist candidate + backup last-known-good, cấp transaction ID | durable write |
| `apply` | activate transaction đã stage, bắt đầu rollback deadline | network change |
| `confirm` | xác nhận đường mới hoạt động, commit và bỏ IP cũ | commit |
| `rollback` | phục hồi last-known-good, explicit hoặc automatic | network change |

Request tối thiểu có `version`, `requestId`, `action`, optional `transactionId` và candidate `{interface, mode, ipv4, netmask, gateway}`. Response có cùng `requestId`, `result`, stable `reasonCode`, `transactionId`, `state`, `rollbackRemainingS`, `active`, `pending` và message. State machine:

```text
idle → staged → applying → awaiting_confirmation → confirmed
                     └──────────────► rolling_back → rolled_back
                     └──────────────► failed
```

Ràng buộc contract:

- chỉ Ethernet IPv4 `static|dhcp` là Rev A local-HMI scope; interface phải nằm trong allowlist deployment;
- helper validate IP/netmask/gateway, network/broadcast/multicast/loopback, route consistency và duplicate address probe trước apply;
- `requestId` và transaction transition phải idempotent; state transition sai trả stable reject, không silent retry;
- deadline dùng monotonic clock trong runtime và journal đủ dữ liệu để boot recovery; tối đa 120 s;
- response/log không chứa credential; actor/role do broker audit, helper log peer UID + transaction ID + config hash;
- HMI không kết nối socket này trực tiếp. Broker phải map action có Service/Admin session và audit trước/sau mutation.

## HMI

Target hiện hành: KD024QVFIA073-02-C021B, controller JD9852, MIPI DSI một lane, touch FT5436 qua I²C, DRM/KMS `/dev/dri/card0` và sáu GPIO buttons. ILI9341/SPI không thuộc baseline.

### Local command contract — host implemented, target acceptance pending

HMI đọc telemetry từ SHM nhưng mọi mutation dùng Unix-domain IPC versioned qua local auth/audit broker; đây không phải HTTP, browser hay Web HMI. Contract v1 dùng line-delimited JSON tại `/run/mkddc/hmi-api.sock`, frame tối đa 8192 byte, socket mode `0660`, kiểm tra `SO_PEERCRED` và optional UID allowlist.

Request gồm `version=1`, `requestId`, `action`, optional opaque `token`, `pointId`, `alarmId`, `mode`, finite `value`, `reason`, `ttlS`, `transactionId`, `candidate`; login dùng `username/password`. Action allowlist thêm `network_status`, `network_validate`, `network_stage`, `network_apply`, `network_confirm`, `network_rollback` ngoài command/alarm actions. Unknown field/version/action bị reject.

Response gồm cùng `requestId`, `result`, stable `reasonCode` và optional `point`; point chứa authoritative value/source priority và `overrideExpiresInS`. Duplicate `requestId` có cùng payload trả cached response; cùng ID khác payload bị reject `ID_CONFLICT`.

Broker sở hữu authentication, role/policy validation và durable audit. Core sở hữu arbitration/interlock/safe-state/effective output và monotonic override TTL. HMI chỉ render response; local point DB không được dùng làm authorization source. Nếu broker/core không sẵn sàng trong deadline, mutation bị kết thúc bằng lỗi rõ và Control chuyển read-only, không blind replay. Không thay SHM layout cho contract này. Schema authority: `shared/hmi_protocol_v1.schema.json`.

Network actions đã thuộc HMI protocol v1 và broker chỉ map chúng sang SOM network authority, không map sang core hay cho phép payload command tùy ý. `network_status` là read-only; validate/stage/apply/confirm/rollback yêu cầu Admin, có audit và request-id cache. HMI unit bị chặn trực tiếp khỏi `netcfg.sock`.

## Detailed design

BACnet PICS/EPICS, configuration schema, graph schema, Modbus map, REST/OpenAPI và SOM/MCU interface được điều hướng tại [Interface Detailed Design Index](../02_design/interfaces/README.md).
