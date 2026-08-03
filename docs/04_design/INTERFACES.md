# Interface Contracts

**ID:** IF-SPEC-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-03 (đăng ký interface proposal Modbus RTU Point v2)

## Programming Rev A — trạng thái interface

Product authority là
[Product Spec Programming Rev A](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md).
Programming chỉ nhận Local Physical I/O, Virtual Point và Modbus RTU Point;
ngôn ngữ chỉ gồm ST/FBD; cycle time chỉ gồm 1 s/5 s/30 s. Modbus TCP và
BACnet/IP trong các interface product-wide bên dưới không phải Programming
Point Rev A.

Hai interface requirement đang có hiệu lực là `IF-REQ-PROG-001` cho I/O Mapping
và `IF-REQ-PROG-002` cho Revision/Deployment/Activation/Rollback/Online Monitor.
Shape API, schema, IPC, package và process allocation cho chúng chưa được thiết
kế trong nhiệm vụ này. Nội dung ST/IR bên dưới được giữ như As-Built của
development component host-only; nó không phải Programming interface production
được phê duyệt và không chứng minh Programming đã implement.

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

### Modbus RTU Point runtime/config proposal v2 — In Review

Contract hiện hành `kx_ext_point_t` là As-Built v1: identity 24 byte, `float`
value, quality ba mức và không mang sample timestamp/config revision. Nó chưa
đáp ứng `IF-REQ-MBRTU-001..004` hoặc phần Modbus của `IF-REQ-PROG-001`.

[DDD-SW-MBRTU-POINT-001](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
đề xuất version/magic mới với stable `point_id`, typed `double` value,
GOOD/STALE/OFFLINE/BAD + reason, producer timestamp, sequence/generation và
config revision/checksum. Config/write dùng reliable correlated IPC; telemetry
snapshot có sequence. Address canonical là protocol data address zero-based.

Proposal đang `In Review`; không reinterpret ABI v1 và không sửa machine-readable
OpenAPI/source trước khi ADR-024 được Accepted. Programming I/O Mapping vẫn chưa
được thiết kế đầy đủ; chỉ source-side Point Catalog contract được đưa ra review.

**Ngoại lệ duy nhất — nối field vào CUỐI `kx_plc_shm_t`.** Consumer đọc PLC SHM
bằng offset cứng và kiểm độ dài theo ngữ nghĩa **min-length**
(`web/backend/core_client.go`: `len(data) < kxPlcShmMinLen`), nên nối thêm vào
cuối giữ nguyên mọi offset cũ và binary cũ vẫn đọc đúng — **không đổi magic**.
Đổi thứ tự, kiểu hoặc kích thước field cũ vẫn là ABI change đầy đủ. Ràng buộc
này được khoá bằng test `BacnetObjTableAbi.*` (đối chiếu trực tiếp các hằng
offset copy từ `core_client.go`).

### Runtime health (PLC SHM, WRITER = core)

| Field | Ý nghĩa |
|---|---|
| `rt_sched_policy` | Giá trị `SCHED_*` **thật**, đo bằng `sched_getscheduler()` sau khi đã cố đặt |
| `rt_sched_priority` | Ưu tiên RT thật đang chạy; 0 khi không phải RT |
| `rt_mlock_ok` | 1 = `mlockall` thành công |
| `rt_degraded` | 1 = **không** đạt cấu hình RT mong đợi → Web/BE phải hiển thị cảnh báo |

Lý do tồn tại: cảnh báo RT trước đây chỉ log một dòng lúc khởi động rồi cuộn
khỏi journal, nên `mkddc-core` đã chạy nhiều ngày ở `SCHED_OTHER` thay vì
`SCHED_FIFO 80` mà không ai biết (evidence:
`docs/07_records/test-evidence/fw-som/2026-07-28-watchdog-target.md`). Suy giảm
im lặng phải quan sát được **liên tục**, không chỉ tại một thời điểm.

Core đo trạng thái **thật** thay vì tin vào mã trả về của `pthread_setschedparam`:
trên hệ có `CONFIG_RT_GROUP_SCHED` + cgroup v2, systemd có thể đã ép policy về
`SCHED_OTHER` trước khi process chạy, nên lời gọi thành công hay thất bại đều
không nói lên trạng thái cuối cùng.

## AO boundary

AO ở core/iobus boundary là giá trị vật lý V hoặc mA theo electrical mode đã được MCU acknowledge. BACnet/config engineering range được convert đúng một lần trước boundary. Non-finite/out-of-range bị reject.

## As-Built development component — ST validate gateway host-only

Nguồn As-Built: `services/core/st/st_*.{hpp,cpp}`. Đây là contract của một
component được test độc lập trên host trong cây `services/core`; không phải
contract Programming production, không gắn vào scan loop sản xuất và không có
bằng chứng target/HIL. Tên service Programming trong tài liệu cũ không được dùng
để suy ra process đã tồn tại. Nếu Backend gọi CLI này để validate, kết quả vẫn
chỉ là validation component, không phải Deployment, Activation hoặc runtime
Program production.

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

**Subset ST của component As-Built:** mô tả chi tiết ở
[`ST_SUBSET_SPEC_MK-DDC-24_VI.md`](../02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md)
(kiểu `BOOL`/`INT`/`REAL`/`TIME`, số học đầy đủ + `MOD`, `XOR`, `ELSIF`, chú
thích, `VAR`/`VAR RETAIN`, 10 hàm chuẩn, Function Block `TON`/`TOF`/`R_TRIG`/
`F_TRIG`). Đây không phải tập data type/library Product đã phê duyệt cho
Programming Rev A; phần đó còn mở tại OD-PROG-002 và OD-PROG-005. Component
host chưa có `CASE`, vòng lặp, POU do người dùng định nghĩa, LD/SFC.

## As-Built development component — Typed IR artifact host-only

Nguồn thực thi: `services/core/st/st_ir.hpp`, đặc tả đầy đủ ở
[`TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md`](../02_design/software/TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md).

**Trạng thái As-Built 2026-08-03:** source có loader/artifact component
`MKDDCIR1` được test trên host. `mkddc-core` production chưa được chứng minh đã
nạp và thực thi artifact này trong control path thật; Backend chưa được chứng
minh đã hoàn tất vòng đời Project/Revision/Deployment. Vì vậy mô tả dưới đây
chỉ là contract component hiện hữu, không phải quyết định Programming Design.

| Hạng mục | Giá trị |
|---|---|
| Magic | `MKDDCIR1` |
| `schema_version` | 1 |
| `compiler_profile` | `0x0001` (`MKDDC_ST_BASE_A0`) |
| `target_abi` | `0x00000F01` |
| Toàn vẹn | SHA-256 toàn file + chữ ký Ed25519 trên digest |
| Kích thước tối đa | 1 MiB |
| Mã lỗi trả BE | `IR-E-001` … `IR-E-015` |

**Bất biến bắt buộc:** mọi lỗi load đều **giữ nguyên package đang chạy** —
không có mã lỗi nào dẫn tới trạng thái "không có chương trình nào chạy" nếu
trước đó đã có chương trình chạy. Bất biến "không có parser trong
`mkddc-core`" được bảo đảm ở mức **link** (`st_compiler_lib` tách khỏi
`core_lib`) và kiểm lại bằng symbol check trong CI.

**io_map validation component** (`st_io_map.hpp`, chưa có file
`io_map.json`/CRUD production): mỗi biến
`VAR_INPUT`/`VAR_OUTPUT` phải có đúng 1 binding; `direction` phải khớp
input/output khai báo; `type` phải khớp; `point_id` phải đúng dạng
`PREFIX-NN` với `PREFIX ∈ {UI,DI,AO,DO}` (physical point); range (nếu có) chỉ áp dụng cho `REAL`,
`range_min < range_max`. Trả về TẤT CẢ lỗi tìm thấy trong 1 lần gọi (khác
parser/semantic fail-fast), vì io_map thường có nhiều dòng độc lập.

Component này chưa bao phủ Virtual Point hoặc Modbus RTU Point nên không đáp
ứng `IF-REQ-PROG-001`. DI cũng không phải Local Physical I/O baseline nếu phần
cứng/SKU không công bố capability. Không được mở rộng allowlist bằng Modbus TCP
hoặc BACnet/IP để lấp khoảng trống.

**Cyclic runtime + trace component** (`st_cyclic_runtime.hpp`, `st_trace.hpp`,
host-only — chưa nối production `mkddc-iobus`/STM32): activation request áp dụng
CHỈ tại đầu cycle kế tiếp (không giữa lúc execute() đang chạy), fail thì
package cũ tiếp tục. Metric quan sát được: `cycle_count`, `overrun_count`
(exec vượt budget), `exec_fault_count`, `last_exec_ns`, `max_exec_ns`.
`StTraceEvent` kind: `VALIDATE_RESULT`, `ACTIVATION_RESULT`, `RUNTIME_FAULT`,
`OVERRUN`, `ROLLBACK` — giữ trong `StTraceLog` (bounded ring buffer, in
process, chưa persist). Cycle component host không chứng minh cycle time 1 s,
5 s hoặc 30 s trên production target, cũng không đóng Activation/Rollback,
RETAIN hay Online Monitor requirement.

## Web/API

Nguồn thực thi: `web/backend/http.go` và validator/schema liên quan. Route groups hiện hành gồm auth/me/users; system status/network/config; points và WebSocket; alarms; commissioning; history/trends; schedules; alarm settings. Hồ sơ này không freeze danh sách route chi tiết; OpenAPI hoặc route tests, nếu phát hành, phải sinh/verify từ code.

### Network API — implemented baseline versus target

`PUT /api/v1/network` chỉ lưu cấu hình dịch vụ BACnet, Wi-Fi và field hostname tương thích;
các field Ethernet là compatibility shadow read-only và field hostname này không đổi hostname
hệ điều hành. Mọi thay đổi Ethernet/DNS đi qua `GET /api/v1/network/transaction` và
`POST /api/v1/network/transaction/{action}`. GET status cho session xác thực
(`viewer|operator|admin`); POST mutation chỉ dành cho `admin`. Aggregate `GET /api/v1/network` vẫn phục vụ dữ liệu trang Network và
không thay thế authority trạng thái kernel.

API transaction phân biệt ba nguồn trạng thái: `active` là trạng thái kernel hiện tại, `configured` là profile đã lưu trong NetworkManager, và `pending` là candidate của giao dịch đang chờ. Không được suy diễn active IP, carrier hoặc mode từ `network.conf` hay từ candidate đã lưu.

### SOM network authority contract — implemented v1; target acceptance pending

Authority dùng line-delimited JSON version 1 qua `/run/mkddc-netcfg/netcfg.sock`, frame tối đa
8192 byte, socket `0660` trong runtime directory riêng `root:mkddc 0750`; peer credential
allowlist chỉ cho broker/service account đã phê duyệt. Protocol strict từ chối unknown field ở
request, candidate và object `dns`, unknown version/action và payload sai theo action. Schema
authority: `shared/netcfg_protocol_v1.schema.json`.

Action allowlist:

| Action | Ý nghĩa | Side effect |
|---|---|---|
| `status` | trả active kernel state, pending transaction và last-known-good metadata | không |
| `validate` | validate candidate và chạy preflight không activate | không |
| `stage` | persist candidate + backup last-known-good, cấp transaction ID | durable write |
| `apply` | activate transaction đã stage, bắt đầu rollback deadline | network change |
| `confirm` | xác nhận đường mới hoạt động, commit và bỏ IP cũ | commit |
| `rollback` | phục hồi last-known-good, explicit hoặc automatic | network change |

Request tối thiểu có `version`, `requestId`, `action`, optional `transactionId` và candidate
`{interface, mode, ipv4, netmask, gateway, dns?}`. `dns` có shape
`{mode:"auto"|"manual",servers:string[]}`; thiếu `dns` bảo toàn DNS profile hiện tại, `auto`
chỉ hợp lệ cùng DHCP với list rỗng, `manual` yêu cầu 1..4 IPv4 canonical duy nhất. Response có
cùng `requestId`, `result`, stable `reasonCode`, `transactionId`, `state`,
`rollbackRemainingS`, `active`, optional `configured`, `pending`, exact `capabilities` và
`management`. Capability luôn gồm `dns` và `management-hostname`; `management` là
`{hostname,mdnsName,stable}` chỉ đọc. `reasonCode` cấp response mô tả kết quả request hoặc
transition của giao dịch; `active.reasonCode` là mã sức khỏe interface độc lập. `active` luôn
có `adminUp`, `carrier`, `reasonCode`, `dnsServers`; `configured` là profile NetworkManager đã
lưu và không khẳng định profile đó đang active. Ví dụ status khi Ethernet administratively up
nhưng chưa có carrier:

```json
{
  "version": 1,
  "requestId": "status-1",
  "result": "accepted",
  "reasonCode": "OK",
  "state": "idle",
  "active": {
    "interface": "end1",
    "link": "down",
    "adminUp": true,
    "carrier": false,
    "reasonCode": "NO_CARRIER",
    "mode": "unknown",
    "ipv4": "",
    "prefixLength": 0,
    "gateway": "",
    "dnsServers": []
  },
  "configured": { "interface": "end1", "mode": "dhcp" },
  "capabilities": ["dns", "management-hostname"],
  "management": {
    "hostname": "mkddc-ddc24-001",
    "mdnsName": "mkddc-ddc24-001.local",
    "stable": true
  }
}
```

`active.reasonCode` dùng allowlist `OK|INTERFACE_NOT_FOUND|KERNEL_STATE_UNAVAILABLE|ADMIN_DOWN|NO_CARRIER|NO_ACTIVE_ADDRESS`. `link=up` chỉ khi interface administratively up và có carrier; ví dụ `adminUp=true`, `carrier=false` phải trả `link=down`, `active.reasonCode=NO_CARRIER`. State machine:

```text
idle → staged → applying → awaiting_confirmation → confirmed
                     └──────────────► rolling_back → rolled_back
                     └──────────────► failed
```

Ràng buộc contract:

- chỉ Ethernet IPv4 `static|dhcp` là Rev A local-HMI scope; interface phải nằm trong allowlist deployment;
- helper validate IP/netmask/gateway, network/broadcast/multicast/loopback, route consistency và duplicate address probe trước apply;
- `requestId` và transaction transition phải idempotent; state transition sai trả stable reject, không silent retry;
- DNS là một phần của cùng journal/confirm/rollback với IPv4; không có đường ghi DNS riêng;
- management hostname chỉ đọc trong authority, không xuất hiện trong candidate; chỉ provision
  bằng `packaging/configure-web-hostname.sh` sau preflight/backup;
- deadline dùng monotonic clock trong runtime và journal đủ dữ liệu để boot recovery; tối đa 120 s;
- response/log không chứa credential; actor/role do broker audit, helper log peer UID + transaction ID + config hash;
- HMI không kết nối socket này trực tiếp. Broker chỉ map mutation khi session role Admin và audit trước/sau; Service chỉ là surface.

## HMI

Target hiện hành: KD024QVFIA073-02-C021B, controller JD9852, MIPI DSI một lane, touch FT5436 qua I²C, DRM/KMS `/dev/dri/card0` và sáu GPIO buttons. ILI9341/SPI không thuộc baseline.

### Local command contract — host implemented, target acceptance pending

HMI đọc telemetry từ SHM nhưng mọi mutation dùng Unix-domain IPC versioned qua local auth/audit broker; đây không phải HTTP, browser hay Web HMI. Contract v1 dùng line-delimited JSON tại `/run/mkddc/hmi-api.sock`, frame tối đa 8192 byte, socket mode `0660`, kiểm tra `SO_PEERCRED` và optional UID allowlist.

Request gồm `version=1`, `requestId`, `action`, optional opaque `token`, `pointId`, `alarmId`, `mode`, finite `value`, `reason`, `ttlS`, `transactionId`, `candidate`; login dùng `username/password`. Action allowlist thêm `network_status`, `network_validate`, `network_stage`, `network_apply`, `network_confirm`, `network_rollback` ngoài command/alarm actions. Unknown field/version/action bị reject.

Response gồm cùng `requestId`, `result`, stable `reasonCode` và optional `point`; point chứa authoritative value/source priority và `overrideExpiresInS`. Duplicate `requestId` có cùng payload trả cached response; cùng ID khác payload bị reject `ID_CONFLICT`.

Broker sở hữu authentication, role/policy validation và durable audit. Core sở hữu arbitration/interlock/safe-state/effective output và monotonic override TTL. HMI chỉ render response; local point DB không được dùng làm authorization source. Nếu broker/core không sẵn sàng trong deadline, mutation bị kết thúc bằng lỗi rõ và Control chuyển read-only, không blind replay. Không thay SHM layout cho contract này. Schema authority: `shared/hmi_protocol_v1.schema.json`.

Network actions đã thuộc HMI protocol v1 và broker chỉ map chúng sang SOM network authority,
không map sang core hay cho phép payload command tùy ý. `network_status` là read-only;
validate/stage/apply/confirm/rollback yêu cầu role Admin, có audit và request-id cache. Service
là tên surface HMI, không phải role hoặc nguồn cấp quyền. HMI không expose DNS/management
hostname editor và unit bị chặn trực tiếp khỏi `netcfg.sock`.

## Detailed design

BACnet PICS/EPICS, configuration schema, graph schema, Modbus map, REST/OpenAPI và SOM/MCU interface được điều hướng tại [Interface Detailed Design Index](../02_design/interfaces/README.md).
