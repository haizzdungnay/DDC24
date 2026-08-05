# Modbus RTU — REST/WebSocket API Specification DDC-24 Rev A

**ID:** ICD-API-MBRTU-001
**Phiên bản:** 0.2
**Trạng thái:** Active (Phê duyệt 2026-08-05 theo Tờ trình `DDC24-MBRTU-REQ-APPROVE-2026-08-05`)
**Ngày:** 2026-08-05
**Quyết định đã ký áp dụng:** Đ-01, Đ-04, Đ-05, Đ-06
**Đối chiếu source tại:** `feat/modbus-rtu-track-a` / `eade4e5`
**Base path:** `/api/v1`
**Xác thực:** JWT Bearer (WebSocket dùng token trong subprotocol)
**Trace:** `IF-REQ-MBRTU-003`, `IF-REQ-MBRTU-004`, `SEC-REQ-MBRTU-001`,
[DDD-BE-MBRTU-001](../software/MODBUS_RTU_BE_DESIGN.md)

> Đây là **đặc tả đề xuất**. `contracts/openapi/openapi.yaml` (v1.11.0) là As-Built
> và hiện chỉ có 9 route CRUD/diagnostics. Không sửa OpenAPI machine-readable trước
> khi ADR-024 được Accepted (`INTERFACES.md`). Sai khác ở §8.

## 1. Tổng quan endpoint

| # | Method + Path | Quyền | Idempotent | Mục đích |
|---|---|---|---|---|
| 1 | `GET /modbus/config` | viewer | có | active + candidate + revision + checksum + apply_state |
| 2 | `POST /modbus/config/validate` | admin | có | validate candidate, không side effect |
| 3 | `PUT /modbus/config/candidate` | admin | qua `operation_id` | ghi toàn bộ candidate |
| 4 | `DELETE /modbus/config/candidate` | admin | có | huỷ candidate |
| 5 | `POST /modbus/config/apply` | admin | qua `operation_id` | apply và chờ ACK từ iobus |
| 6 | `POST /modbus/config/rollback` | admin | qua `operation_id` | về last-known-good |
| 7 | `GET /modbus/buses` | viewer | có | **capability manifest** + trạng thái từng bus. Rev A trả đúng 1 phần tử (Đ-01); FE dùng để chỉ hiển thị cổng có thật (D-14) |
| 8 | `GET /modbus/devices` | viewer | có | danh sách device + runtime status |
| 9 | `POST /modbus/devices` | admin | qua `operation_id` | tạo device vào candidate |
| 10 | `PUT /modbus/devices/{id}` | admin | qua `operation_id` | sửa device trong candidate |
| 11 | `DELETE /modbus/devices/{id}` | admin | qua `operation_id` | xoá device khỏi candidate |
| 12 | `POST /modbus/devices/{id}/enabled` | admin | qua `operation_id` | enable/disable |
| 13 | `POST /modbus/devices/{id}/test-connection` | operator | không | test giao tiếp thật |
| 14 | `GET /modbus/points` | viewer | có | danh sách point (lọc theo device) |
| 15 | `POST /modbus/points` | admin | qua `operation_id` | tạo point vào candidate |
| 16 | `PUT /modbus/points/{id}` | admin | qua `operation_id` | sửa point trong candidate |
| 17 | `DELETE /modbus/points/{id}` | admin | qua `operation_id` | xoá point khỏi candidate |
| 18 | `GET /modbus/mapping` | viewer | có | trạng thái ánh xạ vào Point Database |
| 19 | `POST /modbus/import` | admin | qua `operation_id` | import CSV/JSON vào candidate |
| 20 | `GET /modbus/export` | viewer | có | export CSV/JSON |
| 21 | `POST /modbus/commission/read` | operator | không | đọc thử register |
| 22 | `POST /modbus/commission/write` | admin | qua `request_id` | ghi thử register |
| 23 | `GET /modbus/diagnostics` | viewer | có | counters bus/device/point |
| 24 | `GET /modbus/overview` | viewer | có | KPI tổng hợp |
| 25 | `GET /modbus/events` | viewer | có | sự kiện giao tiếp gần đây |
| 26 | `WS /ws/monitor` | viewer | — | point stream (dùng chung, lọc `kind=modbus_rtu`) |

Endpoint 9–12 và 15–17 là **đường tắt tiện dụng**: chúng sửa candidate, **không**
apply. Chỉ endpoint 5 mới apply. Đây là khác biệt lớn nhất so với As-Built.

## 2. Quy ước chung

### 2.1 Header

| Header | Chiều | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `Authorization: Bearer <jwt>` | request | có | xác thực |
| `If-Match: "<revision>"` | request mutation | có (hoặc `base_revision` trong body) | optimistic concurrency |
| `X-Operation-Id: <uuid>` | request mutation | có (hoặc `operation_id` trong body) | idempotency |
| `ETag: "<revision>"` | response | có với config | revision hiện tại |
| `X-Correlation-Id` | cả hai | có | ghép log/audit |

### 2.2 Envelope lỗi

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Cấu hình Modbus RTU không hợp lệ.",
    "correlation_id": "8f2c1a04-…",
    "revision": 42,
    "details": [
      { "path": "devices[1].slave_id", "code": "SLAVE_ID_DUPLICATE",
        "message": "Slave ID 3 đã được VFD-03 dùng trên RS485-1.",
        "conflict": { "device_id": "VFD-03", "bus_id": "rs485-1" } }
    ]
  }
}
```

### 2.3 Mã lỗi và HTTP status

| `code` | HTTP | Khi nào |
|---|---:|---|
| `VALIDATION_FAILED` | 422 | cấu hình không hợp lệ |
| `REVISION_CONFLICT` | 409 | `base_revision` ≠ active |
| `ID_CONFLICT` | 409 | `operation_id` lặp với payload khác |
| `NOT_FOUND` | 404 | device/point không tồn tại |
| `BUS_UNAVAILABLE` / `PORT_UNAVAILABLE` | 409 | bus không có capability |
| `IOBUS_REJECTED` | 409 | iobus từ chối apply |
| `APPLY_TIMEOUT` | 504 | không nhận ACK trong deadline |
| `ROLLBACK_FAILED` | 500 | không phục hồi được LKG |
| `DEVICE_OFFLINE` | 409 | commissioning tới device không phản hồi |
| `WRITE_REJECTED` | 409 | write vi phạm policy/type/range/quality |
| `CAPACITY_EXCEEDED` | 422 | vượt 64 point / 32 device / 1 MiB |
| `RATE_LIMITED` | 429 | vượt hạn mức commissioning |
| `TELEMETRY_UNAVAILABLE` | 503 | iobus chưa publish |
| `FORBIDDEN` | 403 | thiếu quyền |

**Không** dùng 200 kèm `"result":"error"`. Không dùng 500 cho lỗi người dùng.

## 3. Config transaction

### 3.1 `GET /modbus/config`

```json
{
  "active":   { "revision": 42, "checksum": "9f3a…", "buses": [ … ], "devices": [ … ], "points": [ … ] },
  "candidate": { "revision": 43, "checksum": "b71c…", "buses": [ … ], "devices": [ … ], "points": [ … ] },
  "apply_state": {
    "state": "idle",
    "last_operation_id": "…", "last_result": "success",
    "last_applied_at": "2026-08-04T03:12:44.120Z",
    "iobus_applied_revision": 42, "iobus_checksum": "9f3a…",
    "iobus_config_in_sync": true
  },
  "last_known_good": { "revision": 41, "checksum": "44de…" },
  "capacity": { "max_devices_per_bus": 16, "max_devices": 32, "max_points": 64 }
}
```

`apply_state.state ∈ {idle, staging, applying, unknown, failed}`.
`iobus_config_in_sync=false` là tín hiệu bắt buộc FE phải hiển thị cảnh báo.

### 3.2 `PUT /modbus/config/candidate`

Request:

```json
{
  "base_revision": 42,
  "operation_id": "1b2f…",
  "buses":   [ { "bus_id": "rs485-1", "enabled": true, "baud_rate": 19200, "parity": "N", "stop_bits": 1, "offline_probe_ms": 5000 } ],
  "devices": [ … ],
  "points":  [ … ]
}
```

Response `200`:

```json
{ "candidate": { "revision": 43, "checksum": "b71c…" },
  "warnings": [ { "path": "buses[0]", "code": "BUS_UTILIZATION_HIGH", "message": "Ước tính 58 % tải bus." } ],
  "diff": { "devices_added": 1, "devices_changed": 0, "devices_removed": 0,
            "points_added": 4, "points_changed": 2, "points_removed": 0 } }
```

Không có side effect lên runtime. Ghi candidate **bền vững** (khôi phục được sau restart web).

### 3.3 `POST /modbus/config/apply`

Request: `{ "base_revision": 43, "operation_id": "77aa…" }`

Response `200` (ACK):

```json
{ "result": "success", "revision": 43, "checksum": "b71c…",
  "iobus_applied_revision": 43, "applied_at": "2026-08-04T03:20:11.004Z",
  "warnings": [], "bus_open": { "rs485-1": "open", "rs485-2": "unavailable" } }
```

Response `409 IOBUS_REJECTED`:

```json
{ "error": { "code": "IOBUS_REJECTED", "message": "iobus từ chối cấu hình.",
    "revision": 42,
    "details": [ { "path": "buses[1].port_ref", "code": "BUS_UNAVAILABLE",
                   "message": "RS485-2 không mở được: No such device." } ] } }
```

Response `504 APPLY_TIMEOUT`: client **không được** kết luận thất bại; phải
`GET /modbus/config` lại để đọc `apply_state`.

Hợp đồng ACK: apply thành công nghĩa là iobus đã parse cấu hình, mở đúng các bus
enabled, dựng xong map device/point trong generation mới và publish đúng
revision/checksum. **Không** nghĩa là mọi slave online.

### 3.4 `POST /modbus/config/rollback`

`{ "operation_id": "…", "target_revision": 41 }` — chỉ chấp nhận `target_revision`
bằng `last_known_good.revision`. Kết quả dùng chung schema với apply.

## 4. Device

### 4.1 `GET /modbus/devices`

```json
[
  { "device_id": "MTR-01", "name": "Đồng hồ điện tầng 1", "enabled": true,
    "rs485_port": "rs485-1", "slave_id": 1,
    "baud_rate": 19200, "data_bits": 8, "parity": "N", "stop_bits": 1,
    "poll_interval_ms": 1000, "timeout_ms": 300, "retry_count": 2,
    "stale_after_ms": 3000, "offline_after_ms": 6000, "verify_write": true,
    "connection_status": "ONLINE",
    "last_success_at": "2026-08-04T03:41:02.881Z",
    "last_error": null,
    "config_revision": 42 }
]
```

`baud_rate`/`data_bits`/`parity`/`stop_bits` là **dẫn xuất read-only** từ bus
(data model §4). Gửi lên giá trị khác bus ⇒ `SERIAL_MISMATCH`.

Query: `?bus_id=`, `?enabled=`, `?status=`.

### 4.2 `POST /modbus/devices/{id}/test-connection`

Request: `{ "register_type": "holding_register", "address": 0, "timeout_ms": 1000 }`

Response `200`:

```json
{ "result": "reachable", "elapsed_ms": 21, "raw": 1234,
  "attempts": 1, "retries": 0, "checked_at": "2026-08-04T03:44:10.002Z" }
```

Response `409 DEVICE_OFFLINE`:

```json
{ "error": { "code": "DEVICE_OFFLINE", "message": "Thiết bị không phản hồi.",
  "details": [ { "code": "TIMEOUT", "message": "Hết 1000 ms, 3 lần thử." } ] } }
```

Không tạo revision, không xuất hiện trong diff, có audit `commission.test_connection`.

## 5. Point và mapping

### 5.1 `GET /modbus/points`

Trả cấu hình point (§5.1–5.3 data model). Query `?device_id=`, `?register_type=`,
`?include_runtime=true`.

Với `include_runtime=true`, mỗi point thêm:

```json
"runtime": { "value": 1234.5, "raw_value": 12345,
  "quality": "GOOD", "quality_reason": null,
  "timestamp": "2026-08-04T03:41:02.881Z",
  "sample_age_ms": 412, "communication_status": "ONLINE",
  "config_revision": 42 }
```

Point chưa có mẫu: `"runtime": { "value": null, "quality": "BAD",
"quality_reason": "NOT_INITIALIZED", "timestamp": null }`. Server **không** trả `0`.

### 5.2 `GET /modbus/mapping`

```json
{ "summary": { "total": 24, "valid": 21, "warning": 1, "error": 2 },
  "entries": [
    { "point_id": "MB-3C77A180", "device_id": "VFD-03", "tag_name": "AHU1.Speed",
      "ddc_point_id": "MB-3C77A180", "data_type": "int16",
      "status": "error",
      "issues": [ { "code": "TAG_DUPLICATE",
                    "message": "Tag đang thuộc UI-05.",
                    "conflict": { "point_id": "UI-05", "path": "io.ui[4].tag" } } ] } ] }
```

`status ∈ {valid, warning, error}`. FE chặn lưu khi còn `error` (UX §5.2).

## 6. Commissioning

### 6.1 `POST /modbus/commission/read`

Request: `{ "point_id": "MB-7F2A1C09", "base_revision": 42 }`
hoặc dạng ad-hoc: `{ "device_id": "MTR-01", "register_type": "holding_register",
"address": 100, "data_type": "float32", "byte_order": "big", "word_order": "high_low" }`

Response `200`:

```json
{ "result": "ok", "raw_value": 12345, "value": 1234.5, "unit": "kWh",
  "elapsed_ms": 21, "read_at": "2026-08-04T03:47:55.113Z" }
```

Không thay đổi cấu hình. Rate limit 5 req/phút/người dùng ⇒ `429 RATE_LIMITED`.

### 6.2 `POST /modbus/commission/write`

Request:

```json
{ "request_id": "b4d1…", "point_id": "MB-7F2A1C09",
  "base_revision": 42, "value": 1300.0, "confirm": true,
  "expected_current_value": 1234.5, "deadline_ms": 3000 }
```

- `confirm` **phải** là `true`, ngược lại `422 VALIDATION_FAILED`.
- `expected_current_value` là tuỳ chọn; nếu có và lệch quá dung sai ⇒ `WRITE_REJECTED`
  với `code: STATE_CHANGED` (bảo vệ chống ghi vào giá trị đã đổi từ lúc người dùng xem).

Response `200`:

```json
{ "result": "applied", "request_id": "b4d1…",
  "written_raw": 13000, "readback_raw": 13000, "readback_value": 1300.0,
  "elapsed_ms": 34, "written_at": "2026-08-04T03:48:31.556Z" }
```

`result ∈ {accepted, applied, rejected, timeout}`:

| Giá trị | Ý nghĩa |
|---|---|
| `accepted` | đã nhận vào hàng đợi ghi, chưa có xác nhận từ slave (chỉ dùng khi `deadline_ms` quá ngắn) |
| `applied` | slave đã ACK; kèm readback nếu `verify_write` |
| `rejected` | bị từ chối kèm lý do; **không** có byte nào lên dây, hoặc slave trả exception |
| `timeout` | không xác định được kết quả — **không được** hiển thị là thành công |

Response `409 WRITE_REJECTED` `details[].code ∈ {READ_ONLY, QUALITY_NOT_GOOD,
OUT_OF_RANGE, TYPE_MISMATCH, REVISION_STALE, DEVICE_EXCEPTION, QUEUE_FULL, STATE_CHANGED}`.
Với `DEVICE_EXCEPTION`, phải kèm `"modbus_exception": 2` và tên chuẩn.

**Không replay:** cùng `request_id` + cùng payload trả kết quả đã lưu; khác payload
⇒ `ID_CONFLICT`. Sau device reconnect/iobus restart, request cũ **không** được gửi lại.

## 7. Diagnostics, overview và stream

### 7.1 `GET /modbus/diagnostics`

```json
{ "producer_boot_id": "4f2c…", "counters_since": "2026-08-04T06:12:03Z",
  "config_revision": 42,
  "buses": [
    { "bus_id": "rs485-1", "open_state": "open",
      "baud_rate": 19200, "parity": "N", "stop_bits": 1,
      "tx_frames": 128430, "rx_frames": 128002,
      "crc_errors": 0, "timeout_errors": 12,
      "scheduler_overruns": 3, "utilization_estimate_pct": 38,
      "reconnect_count": 0, "last_error": null },
    { "bus_id": "rs485-2", "open_state": "unavailable",
      "tx_frames": null, "rx_frames": null, "crc_errors": null,
      "timeout_errors": null, "scheduler_overruns": null,
      "utilization_estimate_pct": null, "reconnect_count": null,
      "last_error": { "code": "PORT_UNAVAILABLE", "message": "No such device", "at": "…" } } ],
  "devices": [
    { "device_id": "VFD-03", "bus_id": "rs485-1", "slave_id": 3,
      "connection_status": "DEGRADED",
      "request_count": 42100, "success_count": 41900, "error_count": 200,
      "timeout_errors": 180, "crc_errors": 18, "exception_errors": 2,
      "exception_codes": { "2": 2 },
      "retry_attempts": 210, "consecutive_errors": 3,
      "last_success_at": "…", "sample_age_ms": 124000,
      "poll_duration_last_ms": 24, "poll_duration_max_ms": 310,
      "reconnect_count": 4 } ],
  "points": [
    { "point_id": "MB-3C77A180", "quality": "BAD", "quality_reason": "DECODE_ERROR",
      "decode_errors": 2, "range_errors": 0,
      "last_write": { "request_id": "…", "result": "applied", "at": "…" } } ] }
```

`null` nghĩa là **unknown**, không phải 0. FE hiển thị `unknown`.

### 7.2 `GET /modbus/overview`

```json
{ "devices": { "total": 12, "online": 9, "offline": 2, "fault": 1, "disabled": 0 },
  "buses": [ { "bus_id": "rs485-1", "open_state": "open", "device_count": 8,
               "online_count": 7, "poll_latency_p50_ms": 24, "poll_latency_p95_ms": 61,
               "timeout_errors": 12, "crc_errors": 0, "utilization_estimate_pct": 38 } ],
  "config": { "active_revision": 42, "candidate_revision": 43, "in_sync": true } }
```

### 7.3 WebSocket

Dùng lại `/api/v1/ws/monitor`. Message point cho Modbus RTU:

```json
{ "type": "point", "sequence": 918233, "config_revision": 42,
  "point_id": "MB-7F2A1C09", "kind": "modbus_rtu", "source": "modbus_rtu",
  "value": 1234.5, "data_type": "float32",
  "quality": "GOOD", "quality_reason": null,
  "timestamp": "2026-08-04T03:41:02.881Z" }
```

Quy tắc reconnect: client **phải** lấy snapshot mới (`GET /modbus/points?include_runtime=true`)
trước khi áp delta; server không replay delta cũ. `sequence` cho phép phát hiện drop.

### 7.4 `GET /modbus/events`

```json
[ { "at": "2026-08-04T03:41:02.881Z", "bus_id": "rs485-1", "device_id": "MTR-01",
    "event": "DEVICE_ONLINE", "detail": "OFFLINE → ONLINE", "severity": "info" } ]
```

`event ∈ {DEVICE_ONLINE, DEVICE_OFFLINE, DEVICE_DEGRADED, CONFIG_ERROR,
BUS_OPEN, BUS_DOWN, CONFIG_APPLIED, CONFIG_ROLLBACK, WRITE_APPLIED, WRITE_REJECTED}`.
Buffer vòng, tối thiểu 200 sự kiện, không persist qua restart (ghi rõ trong response header).

## 8. Sai khác so với OpenAPI/route As-Built

**Đối chiếu lại tại `eade4e5` (2026-08-05).** As-Built vẫn là **đúng 9 route**
(`http.go`), không thay đổi trong Track A — Track A không đụng contract theo thiết kế.

Chín route As-Built và quyền thật của chúng:

| Method + Path | Quyền As-Built |
|---|---|
| `GET /api/v1/modbus/devices` | `RoleViewer` |
| `POST /api/v1/modbus/devices` | `RoleAdmin` |
| `PUT /api/v1/modbus/devices/{id}` | `RoleAdmin` |
| `DELETE /api/v1/modbus/devices/{id}` | `RoleAdmin` |
| `GET /api/v1/modbus/points` | `RoleViewer` |
| `POST /api/v1/modbus/points` | `RoleAdmin` |
| `PUT /api/v1/modbus/points/{id}` | `RoleAdmin` |
| `DELETE /api/v1/modbus/points/{id}` | `RoleAdmin` |
| `GET /api/v1/modbus/diagnostics` | `RoleViewer` |

Ma trận quyền này **khớp Đ-04** cho phần CRUD và đọc. Phần còn thiếu là nhóm
`operator` (test connection, đọc thử) vì các endpoint đó chưa tồn tại.

| ID | Đặc tả | As-Built tại `eade4e5` | Mức |
|---|---|---|---|
| F-API-01 | 26 REST/WS endpoint | 9 endpoint | P0 |
| F-API-02 | CRUD ghi candidate | CRUD ghi active + restart iobus, trả `modbusMutationResponse.apply` | P0 |
| F-API-03 | `If-Match`/`base_revision` | không có | P0 |
| F-API-04 | `X-Operation-Id` idempotency | không có | P0 |
| F-API-05 | mã lỗi ổn định + `details[].path/code` | `writeValidationErrors` có `path`/`message`, không có `code` chuẩn hoá | P1 |
| F-API-06 | `GET /modbus/config` với apply_state | chỉ `GET /system/config/fieldbus` (admin) | P1 |
| F-API-07 | commissioning read/write/test-connection | không có | P0 — **bắt buộc theo Đ-06** |
| F-API-08 | import/export | không có | P1 — **bắt buộc theo Đ-06** (import CSV; export CSV + JSON) |
| F-API-09 | overview/events/buses/mapping | không có | P1. `GET /modbus/buses` giữ nguyên trong spec dù Rev A một bus: nó là nơi FE lấy **capability manifest** để không mời người dùng chọn cổng không tồn tại (D-14) |
| F-API-10 | diagnostics có `bus_id`, `null=unknown`, boot id | diagnostics phẳng theo slave, `uint32`, không boot id, không bus | P1 |
| F-API-11 | point runtime có `sample_age_ms`, `config_revision`, `quality_reason` | `PointDTO` có `quality` 4 chuỗi, `UpdatedAt` là giờ đọc SHM của BE | P0 |
| F-API-12 | WS message có `sequence` + `config_revision` | point stream hiện không mang hai field này | P1 |
| **F-API-13** | Device response mang `offline_after_errors` và Bus mang `offline_probe_ms` | hai field **không có** trong `ModbusRTUDevice`/response, dù iobus đã đọc được từ file | **P1 mới** — cặp với F-BE-19/F-BE-20 |
| **F-API-14** | `retry` được mô tả đúng là **số lần phát lại** `0..3` | contract chưa cập nhật mô tả; `openapi.yaml` v1.11.0 vẫn mang ngữ nghĩa cũ | **P1 mới** — Đ-05 đã đổi ngữ nghĩa ở code và UI nhưng **chưa** ở contract machine-readable |

> **F-API-14 đáng chú ý.** Track A đã sửa ngữ nghĩa `retry` ở FW (`fieldbus_config.hpp`),
> BE (`domain.go`) và FE (tooltip "Số lần phát lại"), nhưng `contracts/openapi/openapi.yaml`
> **không được sửa** vì `INTERFACES.md` cấm đụng contract machine-readable trước khi
> ADR-024 Accepted. Kết quả: contract hiện mô tả sai hành vi thật. Đây là mâu thuẫn
> có thật giữa hai tài liệu Active và được ghi vào `OD-MBRTU-018` — nó **chặn**
> `MODBUS_RTU_INTERFACES_SYNCHRONIZED = YES`.

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo API spec 25 REST endpoint + WS, mã lỗi ổn định, idempotency và gap OpenAPI |
| 0.2 | 2026-08-05 | In Review | Đối chiếu lại với `eade4e5`. **Thay thế:** (a) §1 endpoint 7 `GET /modbus/buses` đổi mô tả "trạng thái hai bus" → capability manifest, Rev A một bus (Đ-01); (b) §8 liệt kê đầy đủ 9 route As-Built kèm quyền thật và đối chiếu với Đ-04; (c) thêm **F-API-13** (thiếu `offline_after_errors`/`offline_probe_ms` trong contract) và **F-API-14** (OpenAPI mô tả sai ngữ nghĩa `retry` sau Đ-05) |
