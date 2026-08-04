# Modbus RTU — End-to-End Interface Specification DDC-24 Rev A

**ID:** ICD-IF-MBRTU-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Ngày:** 2026-08-04
**Chủ quản đề xuất:** System/Software Architect
**Trace:** `IF-REQ-MBRTU-001..004`, `SYS-REQ-MBRTU-001`,
[DDD-DM-MBRTU-001](../software/MODBUS_RTU_DATA_MODEL.md),
[ICD-API-MBRTU-001](MODBUS_RTU_API_SPEC.md)

> **Nguyên tắc chi phối tài liệu này:** FE, BE và FW-SOM **không được** định nghĩa
> ba mô hình Modbus Point khác nhau. Mỗi interface bên dưới phải biểu diễn đúng
> mô hình canonical ở `DDD-DM-MBRTU-001`; mọi biến dạng phải là phép chiếu tường
> minh, có tên và có luật chuyển đổi.

## 1. Luồng cấu hình (xuống)

```text
┌──────────────┐  1. PUT candidate (base_revision, operation_id)
│  FE (React)  │─────────────────────────────────────────────────┐
└──────────────┘                                                 │
                                                                 ▼
                                              ┌──────────────────────────────┐
                                              │ mkddc-web — Configuration    │
                                              │ Authority                    │
                                              │  validate → stage → journal  │
                                              └───────────────┬──────────────┘
                                     2. ApplyConfig{rev, checksum, payload}
                                        UDS reliable, correlated, bounded
                                                              ▼
                                              ┌──────────────────────────────┐
                                              │ mkddc-iobus — control thread │
                                              │  parse → build generation G+1│
                                              │  swap tại ranh giới txn      │
                                              └───────┬──────────────┬───────┘
                                     3. ACK{applied_revision, checksum, bus_open}
                                                      │              │
                                            ┌─────────▼──┐   ┌───────▼─────┐
                                            │ BusWorker  │   │ BusWorker   │
                                            │ RS485-1    │   │ RS485-2     │
                                            └─────┬──────┘   └──────┬──────┘
                                        4. serial open + poll schedule
                                                  ▼                 ▼
                                            ┌──────────┐      ┌──────────┐
                                            │ RS-485 A │      │ RS-485 B │
                                            └────┬─────┘      └────┬─────┘
                                                 ▼                 ▼
                                          Modbus slave 1..16  Modbus slave 1..16
```

Chỉ khi bước 3 trả ACK khớp checksum thì `mkddc-web` mới chuyển active sang revision
mới. Restart service **không** phải ACK.

## 2. Luồng dữ liệu (lên)

```text
Modbus slave
   │ 1. response frame (FC01/02/03/04)
   ▼
BusWorker — decode + scale/offset + range check
   │ 2. Sample{point_id, typed value, quality, reason, mono_ns, utc_ms}
   ▼
SampleCache (iobus)
   │ 3. ExtSnapshot v2 {magic, schema_version, sequence, generation,
   │                    config_revision, config_checksum, producer_boot_id,
   │                    generated_mono_ns, generated_utc_ms, samples[]}
   │    UDS SOCK_DGRAM → /run/mkddc/fieldbus.sock
   ▼
mkddc-core — nạp ở ĐẦU scan
   │ 4. PointTable[EXT] canonical (value, quality, reason, timestamp, source)
   ▼
plc_shm (mmap + seqlock)  ─────┐
   │ 5a. core UDS /run/mkddc/core.sock (JSON request/response)
   ▼                           ▼
mkddc-web ────────────────────┘
   │ 6. REST /api/v1/modbus/*, /api/v1/points
   │ 7. WebSocket /api/v1/ws/monitor (sequence + config_revision)
   ▼
FE (React) — hiển thị, không suy diễn
```

## 3. Luồng lệnh ghi

```text
FE (Admin)  ──POST /modbus/commission/write {request_id, point_id, value, confirm}──►
mkddc-web   ── kiểm quyền, type, range, quality, base_revision, rate limit ──►
            ── UDS reliable, correlated ──►
mkddc-core  ── PriorityResolver → SafeState → quyết định nguồn thắng ──►
            ── WriteRequest{request_id, point_id, config_revision, value, deadline} ──►
mkddc-iobus ── BusWorker hàng đợi bounded → FC05/06/16 → (readback) ──►
            ── WriteResult{request_id, accepted|applied|rejected|timeout, exception, readback} ──►
mkddc-core  ── cập nhật last_write, không tự lặp lại ──►
mkddc-web   ── audit + response cho FE
```

Nguồn logic nội bộ (graph/schedule) đi vào cùng điểm `PriorityResolver`, không có
đường tắt xuống iobus. Đây là cơ chế duy nhất chống nhiều nguồn cùng ghi.

## 4. Interface matrix

| # | Producer | Consumer | Interface | Data | Frequency | Timeout | Error handling |
|---|---|---|---|---|---|---|---|
| I-01 | FE | mkddc-web | REST `PUT /modbus/config/candidate` (HTTPS/HTTP + JWT) | candidate đầy đủ + `base_revision` + `operation_id` | theo thao tác người dùng | 10 s client | 409 `REVISION_CONFLICT` / 422 `VALIDATION_FAILED`; không ghi gì khi lỗi |
| I-02 | FE | mkddc-web | REST `POST /modbus/config/apply` | `base_revision`, `operation_id` | theo thao tác | 30 s client, 10 s server→iobus | 504 `APPLY_TIMEOUT` ⇒ client phải re-fetch state, không tự kết luận |
| I-03 | mkddc-web | mkddc-iobus | UDS **SOCK_STREAM** `/run/mkddc/fieldbus-ctl.sock`, framed length-prefix, versioned | `ApplyConfig{revision, checksum, payload}` | mỗi lần apply | 10 s | REJECT có reason; timeout ⇒ web ghi `unknown` và reconcile bằng `GetStatus` |
| I-04 | mkddc-iobus | mkddc-web | cùng socket I-03, response | `ACK{applied_revision, checksum, bus_open_state}` | mỗi lần apply | — | mismatch checksum ⇒ web coi là REJECT |
| I-05 | mkddc-web | mkddc-iobus | UDS I-03 | `TestConnection`, `CommissionRead`, `CommissionWrite` | theo thao tác, có rate limit | 5 s | trả kết quả có thẩm quyền; không suy diễn ở web |
| I-06 | mkddc-iobus | file system | đọc `fieldbus.conf` + `profiles/*.json` | cấu hình | lúc start và khi apply | — | parse lỗi ⇒ `CONFIG_ERROR`, giữ generation cũ, không exit |
| I-07 | Modbus slave | mkddc-iobus | RS-485 half-duplex, Modbus RTU, CRC-16 | frame FC01/02/03/04/05/06/16 | theo `poll_interval_ms` mỗi device | `timeout_ms` mỗi attempt, `retry_count` lần | timeout/CRC/exception ⇒ counter + quality; hết retry ⇒ nhường bus |
| I-08 | mkddc-iobus | mkddc-core | UDS **SOCK_DGRAM** `/run/mkddc/fieldbus.sock` | `ExtSnapshot v2` (§5) | mỗi vòng poll của bus, tối đa 10 Hz | non-blocking | drop chấp nhận được; `sequence` phát hiện drop/reorder; core dùng snapshot cũ ⇒ `sample_age` tăng ⇒ STALE |
| I-09 | mkddc-core | mkddc-iobus | UDS **SOCK_STREAM** (I-03 hoặc socket riêng), correlated | `WriteRequest` | theo lệnh | `deadline` trong request | queue đầy ⇒ `QUEUE_FULL`; không replay |
| I-10 | mkddc-iobus | mkddc-core | cùng kênh I-09 | `WriteResult` | theo lệnh | — | `timeout` **không** được coi là thành công |
| I-11 | mkddc-core | mkddc-web | mmap `/dev/shm/mkddc_plc_shm` + seqlock | Point Table gồm `ext[]` | web đọc theo request | — | seq lẻ/không ổn định ⇒ đọc lại; magic sai ⇒ lỗi rõ |
| I-12 | mkddc-core | mkddc-web | UDS `/run/mkddc/core.sock` JSON | point snapshot, command | theo request | 2 s | lỗi ⇒ 503, không trả dữ liệu giả |
| I-13 | mkddc-web | FE | REST `GET /modbus/*` | config, device, point, mapping, diagnostics, overview | polling 5 s (cấu hình được) | 10 s | 503 `TELEMETRY_UNAVAILABLE` ⇒ FE hiện `unknown` |
| I-14 | mkddc-web | FE | WebSocket `/api/v1/ws/monitor` | point event có `sequence`, `config_revision` | đẩy khi đổi | ping 30 s | reconnect ⇒ FE lấy snapshot mới trước delta |
| I-15 | mkddc-web | audit sink | log/audit store | actor, action, target, old/new, correlation | mỗi mutation/write | — | ghi thất bại ⇒ mutation vẫn phải fail-closed nếu là write |
| I-16 | platform manifest | mkddc-web, mkddc-iobus | file read-only | capability RS485-1/RS485-2 → device node | lúc start | — | thiếu capability ⇒ bus `unavailable`, không đoán path |

Không có interface nào cho phép FE, HMI hoặc BACnet ghi thẳng xuống iobus.

## 5. Contract runtime `ExtSnapshot v2`

Đây là **đề xuất thay thế** `kx_ext_snapshot_msg_t` v1. Thay contract này là ABI
change đầy đủ: magic mới, version mới, static assertion mới, rebuild và deploy đồng bộ.

### 5.1 Header

| Field | Kiểu | Ý nghĩa |
|---|---|---|
| `magic` | `uint32` | giá trị mới, khác `KX_EXT_SNAP_MAGIC` v1 (`0x45585401`) |
| `schema_version` | `uint16` | `2` |
| `message_size` | `uint16` | kích thước thực tế, cho phép reject sớm |
| `sequence` | `uint64` | tăng đơn điệu cho mỗi snapshot của một producer |
| `generation` | `uint32` | thế hệ cấu hình trong iobus |
| `config_revision` | `uint64` | revision mà producer đang chạy |
| `config_checksum` | `uint8[32]` | SHA-256 của cấu hình đang chạy |
| `producer_boot_id` | `uint8[16]` | đổi sau mỗi lần iobus khởi động ⇒ consumer biết counter reset |
| `generated_mono_ns` | `uint64` | thời điểm tạo snapshot |
| `generated_utc_ms` | `uint64` | thời điểm tạo snapshot (hiển thị) |
| `sample_count` | `uint16` | số phần tử hợp lệ |

### 5.2 Sample

| Field | Kiểu | Ý nghĩa |
|---|---|---|
| `point_id` | `char[24]` | NUL-terminated; **identity duy nhất** |
| `device_id` | `char[24]` | |
| `bus_id` | `uint8` | `1` = RS485-1, `2` = RS485-2 |
| `data_type` | `uint8` | enum khớp data model |
| `value` | `double` | engineering value sau scale/offset |
| `raw_value` | `int64` | raw trước scale (phục vụ commissioning/diagnostics) |
| `quality` | `uint8` | `GOOD/STALE/OFFLINE/BAD/CONFIG_ERROR` |
| `quality_reason` | `uint8` | enum reason |
| `modbus_exception` | `uint8` | `0` nếu không có |
| `sample_mono_ns` | `uint64` | thời điểm sample **thành công** gần nhất |
| `sample_utc_ms` | `uint64` | như trên, để hiển thị |
| `access_mode` | `uint8` | `read` / `read_write` |
| `connection_status` | `uint8` | trạng thái device tại thời điểm snapshot |

`double` thay `float` vì `float` không giữ đủ chính xác cho `uint32` (>2^24) và làm
sai giá trị năng lượng/lưu lượng. Slot index chỉ là vị trí cache trong một
`generation`, **không** phải identity.

### 5.3 Luật tương thích

- Consumer đọc magic + `schema_version` trước; không khớp ⇒ **từ chối rõ ràng** và
  báo lỗi health, tuyệt đối không reinterpret byte.
- `message_size` nhỏ hơn header ⇒ drop và đếm `malformed_snapshot`.
- Không áp dụng quy tắc "append-only" của `kx_plc_shm_t` cho message này: semantic
  của `value` và `quality` đã đổi, nên bắt buộc đổi magic.
- Đổi contract yêu cầu coordinated deploy iobus + core (+ web nếu đọc trực tiếp).

## 6. Contract config/write IPC

| Thuộc tính | Yêu cầu |
|---|---|
| Transport | Unix domain **SOCK_STREAM**, length-prefixed frame |
| Version | trường `protocol_version` ở mỗi request; mismatch ⇒ reject có mã |
| Bounded | kích thước frame tối đa 1 MiB; vượt ⇒ reject, không cấp phát theo header |
| Correlation | mọi request có `request_id`/`operation_id`; response mang lại đúng ID |
| Timeout | mọi request có deadline; hết deadline ⇒ kết quả `timeout`, **không** `success` |
| Peer credential | kiểm `SO_PEERCRED` (uid/gid); từ chối peer ngoài allowlist |
| Idempotency | trùng ID + trùng payload ⇒ trả kết quả cũ; trùng ID + khác payload ⇒ `ID_CONFLICT` |
| Strict schema | field lạ ⇒ reject (không bỏ qua âm thầm) |

Datagram fire-and-forget **chỉ** được dùng cho telemetry snapshot (I-08), nơi
snapshot mới thay hoàn toàn snapshot cũ. Config và write **không** được dùng datagram.

## 7. Một mô hình Point — ba phép chiếu hợp lệ

| Lớp | Biểu diễn | Ràng buộc |
|---|---|---|
| Canonical | `DDD-DM-MBRTU-001` §5 | nguồn chân lý |
| Wire iobus↔core | `ExtSnapshot v2` sample (§5.2) | tập con có kiểu cố định; **không** thêm field ngữ nghĩa mới |
| REST/WS | JSON `ModbusRTUPoint` + `runtime` | tên field khớp canonical 1:1; không đổi tên, không rút gọn |
| FE TypeScript | `ModbusRTUPoint` trong `shared/types.ts` | **sinh ra hoặc kiểm tra** theo OpenAPI; không định nghĩa field riêng |
| Profile iobus | `profiles/<device>.json` | **artifact dẫn xuất**, không phải mô hình; sinh bởi BE, không sửa tay |

Kiểm chứng bắt buộc: một test cross-language so sánh danh sách field của
canonical ↔ OpenAPI ↔ TypeScript ↔ struct C++, và fail khi lệch.

### 7.1 Bảng ánh xạ tên field

| Canonical | REST/WS JSON | C++ sample | TypeScript |
|---|---|---|---|
| `point_id` | `point_id` | `point_id[24]` | `point_id` |
| `device_id` | `device_id` | `device_id[24]` | `device_id` |
| `register_type` | `register_type` | *(không truyền — cấu hình)* | `register_type` |
| `register_address` | `register_address` | *(không truyền)* | `register_address` |
| `data_type` | `data_type` | `data_type` | `data_type` |
| `access_mode` | `access_mode` | `access_mode` | `access_mode` |
| `value` | `runtime.value` | `value` (double) | `runtime.value` |
| `quality` | `runtime.quality` | `quality` | `runtime.quality` |
| `quality_reason` | `runtime.quality_reason` | `quality_reason` | `runtime.quality_reason` |
| `timestamp` | `runtime.timestamp` | `sample_utc_ms` | `runtime.timestamp` |

> **Sai khác As-Built cần đóng:** TypeScript hiện dùng `read_write`, Go dùng
> `ReadWrite`/`read_write`, còn tài liệu này dùng `access_mode`. Phải chọn **một**
> tên. Đề xuất giữ `access_mode` cho contract mới và ghi `read_write` là alias
> deprecated trong một vòng version. Quyết định: `OD-MBRTU-010`.

## 8. Ranh giới lỗi

| Lỗi | Không được lan tới |
|---|---|
| Slave không trả lời | bus còn lại, IOP, core scan, web |
| CRC lỗi liên tục | quality của Point trên device khác |
| Cổng RS485 chết | bus còn lại, IOP, core scan |
| Cấu hình Modbus sai | runtime đang chạy (giữ generation cũ) |
| iobus crash | core control local (core tiếp tục với snapshot cũ → STALE → OFFLINE) |
| core crash | poll của iobus (vẫn chạy, snapshot bị drop) |
| web crash | poll và control local |
| FE mất kết nối | mọi thứ phía server |

`PR-MBRTU-011` được thoả mãn khi tất cả các ô trên có test chứng minh.

## 9. Sai khác so với interface As-Built

| ID | Đặc tả | As-Built | Mức |
|---|---|---|---|
| F-IF-01 | `ExtSnapshot v2` typed + sequence + revision | v1: `magic`, `points[64]` với `float`, quality 3 mức, không timestamp | P0 |
| F-IF-02 | write qua stream reliable có result | `plc_shm.ext[].dirty/setpoint`, không kênh kết quả | P0 |
| F-IF-03 | config apply qua UDS có ACK | `systemctl restart mkddc-iobus` | P0 |
| F-IF-04 | commissioning IPC | không tồn tại | P0 |
| F-IF-05 | `bus_id` trong mọi contract | không có khái niệm bus trong contract | P0 |
| F-IF-06 | một tên field xuyên bốn lớp | `read_write` vs `access_mode`; `name` ext vs `point_id` | P1 |
| F-IF-07 | test cross-language so khớp field | không có | P1 |
| F-IF-08 | timestamp của producer | BE gán `time.Now()` | P0 |
| F-IF-09 | capability manifest cho cổng | FE nhập `/dev/ttyS3` tự do, BE chỉ kiểm độ dài ≤128 | P0 |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo interface spec end-to-end: hai luồng, interface matrix 16 dòng, contract v2, phép chiếu Point và gap As-Built |
