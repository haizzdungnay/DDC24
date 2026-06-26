# Graph Schema (`graph.json`) & Deploy Contract — MK-DDC-24

> **Document ID:** IF-GRAPH-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-26
> **Trạng thái:** Draft amendment — §10 Protocol node catalog thêm mới, chờ owner approve
> 📘 **Đọc cùng:** [PRODUCT_DEFINITION](../../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md) ·
> [SW_RUNTIME_EXECUTION_MODEL](../software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) ·
> [SW_COMPONENT_LIBRARY](../software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) · [ADR-004](../../adr/ADR-004-component-based-runtime.md)

> ⚠️ `graph.json` là **artifact deploy** của Rev A (thay `.kxp` FBD/ST). `mkddc-web`
> sinh/import nó, validator kiểm, `mkddc-core` biên dịch thành execution plan rồi chạy.

---

## 1. Tổng quan luồng

```
Web (form/import) ──► graph.json ──► Validator (4 check) ──► POST /deploy
        └────────────────────────────────────────────────────────┘
                                  ▼
            mkddc-core: parse → topo-sort → execution plan → scan loop
```

## 2. Cấu trúc top-level

```json
{
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1001, "name": "AHU01_DDC", "scan_ms": 1000 },
  "io_map":    { "...": "..." },
  "modbus":    { "...": "..." },
  "nodes":     [ /* component instances */ ],
  "links":     [ /* wires */ ],
  "meta":      { "created": "2026-06-08T10:00:00+07:00", "author": "engineer", "rev": 3 }
}
```

| Field | Bắt buộc | Ý nghĩa |
|-------|:---:|---------|
| `schema_version` | ✓ | Khớp version engine hỗ trợ; mismatch → reject |
| `device.scan_ms` | ✓ | Chu kỳ scan (Rev A: 1000; min 500) |
| `device.bacnet_device_id` | ✓ | Device instance cho BACnet server |
| `io_map` | ✓ | Khai báo kênh IO onboard dùng trong graph |
| `modbus` | ✗ | Khai báo device/point Modbus |
| `nodes` | ✓ | Danh sách component instance |
| `links` | ✓ | Danh sách wire `from`→`to` |

## 3. `nodes` — component instance

```json
{
  "id": "pid1",
  "type": "PID",
  "params": { "kp": 2.0, "ki": 0.5, "kd": 0.0, "out_lo": 0, "out_hi": 100, "direction": "reverse" },
  "power_on": { "out": 0.0 }
}
```

- `id` — duy nhất trong graph (`^[a-z][a-z0-9_]{0,31}$`).
- `type` — tên component, phải có trong [SW_COMPONENT_LIBRARY](../software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).
- `params` — tham số tĩnh, kiểu & range theo contract từng component.
- `power_on` — giá trị output an toàn lúc khởi động/khôi phục (bắt buộc với node có
  output ra AO/DO; validator ép). Xem execution model §safe-state.

Mỗi node có **port** đặt tên (`node_id.port`), ví dụ `pid1.pv`, `pid1.sp`, `pid1.out`.

## 4. `links` — wire

```json
{ "from": "scale1.out", "to": "pid1.pv" }
```

Quy tắc:
- `from` là **output port**, `to` là **input port**.
- Một input port nhận **đúng 1 wire** (validator check #1/#2).
- Kiểu dữ liệu hai đầu phải khớp (`float`/`bool`/`int`); mismatch → validator fail
  (Rev A: chỉ float/bool/int, không unit-type).

## 5. `io_map` — IO onboard

```json
"io_map": {
  "ai": [ { "node": "ai1", "channel": 0, "sensor": "ntc10k", "unit": "degC" } ],
  "ao": [ { "node": "ao1", "channel": 0, "mode": "0-10V", "limit_lo": 0, "limit_hi": 100 } ],
  "di": [ { "node": "di1", "channel": 0, "invert": false } ],
  "do": [ { "node": "do1", "channel": 0 } ]
}
```

`channel` ánh xạ tới IOP/MCU theo `SWFW_INTERFACE_SPEC`. `sensor`/`mode` hợp lệ theo HW.

## 6. `modbus` — field/expansion

```json
"modbus": {
  "rtu": [
    { "bus": 1, "baud": 9600, "slave": 5, "poll_ms": 1000,
      "points": [ { "node": "vfd_hz_r", "fc": 4, "addr": 100, "type": "u16", "scale": 0.1, "fallback": 0 } ] }
  ],
  "tcp": [ { "host": "192.168.1.50", "unit": 1, "poll_ms": 1000, "points": [ "..." ] } ]
}
```

- `bus`: 1=RS485-1, 2=RS485-2. `fc`: Modbus function code.
- `fallback` **bắt buộc** cho point đọc (validator check #4) — giá trị dùng khi stale.
- Mỗi Modbus point map tới một node `Modbus_*` để vào graph.

## 7. REST deploy contract (`mkddc-web` ↔ `mkddc-core`)

| Method | Endpoint | Ý nghĩa |
|--------|----------|---------|
| `POST` | `/api/v1/graph/validate` | Chạy validator, trả list lỗi (không deploy) |
| `POST` | `/api/v1/graph/deploy` | Validate → nạp graph → core build plan → áp dụng atomically |
| `GET`  | `/api/v1/graph/active` | Lấy graph đang chạy |
| `POST` | `/api/v1/graph/rollback` | Quay về graph trước (giữ N bản) |
| `GET`  | `/api/v1/runtime/status` | Scan time p99, overrun count, node-state health |

Deploy **atomic**: core chỉ chuyển sang plan mới khi build xong; lỗi build → giữ plan cũ,
trả lỗi. Chi tiết schema REST: [REST_API_OPENAPI](REST_API_OPENAPI_MK-DDC-24_VI.md) (Phase 3).

## 8. Ví dụ tối thiểu (AI→Scale→PID→AO)

```json
{
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1001, "name": "AHU01", "scan_ms": 1000 },
  "io_map": {
    "ai": [ { "node": "ai1", "channel": 0, "sensor": "ntc10k", "unit": "degC" } ],
    "ao": [ { "node": "ao1", "channel": 0, "mode": "0-10V", "limit_lo": 0, "limit_hi": 100 } ]
  },
  "nodes": [
    { "id": "ai1",  "type": "AI_Input", "params": { "channel": 0 } },
    { "id": "sp1",  "type": "Setpoint", "params": { "default": 24.0 } },
    { "id": "pid1", "type": "PID", "params": { "kp": 2.0, "ki": 0.5, "kd": 0, "out_lo": 0, "out_hi": 100, "direction": "reverse" }, "power_on": { "out": 0 } },
    { "id": "ao1",  "type": "AO_Output", "params": { "channel": 0, "limit_lo": 0, "limit_hi": 100 }, "power_on": { "in": 0 } }
  ],
  "links": [
    { "from": "ai1.out", "to": "pid1.pv" },
    { "from": "sp1.out", "to": "pid1.sp" },
    { "from": "pid1.out", "to": "ao1.in" }
  ]
}
```

## 9. Quan hệ với `CONFIG_SCHEMA`

`CONFIG_SCHEMA_MK-DDC-24_VI.md` mô tả config tổng (IO/BACnet/Modbus/system). `graph.json`
là **phần logic điều khiển** (nodes/links) cộng tham chiếu io_map/modbus. Trong Rev A,
io_map & modbus có thể nằm trong graph.json hoặc tách file config; **nguồn-chuẩn cấu trúc
field = tài liệu này**; `CONFIG_SCHEMA` được cập nhật để trỏ về đây (Phase 3).

---

## 10. Protocol node type catalog (Rev A — 5 types)

> Đây là contract **validator** cho Protocol component. Mỗi `node.type` trong bảng này phải
> khớp chính xác (case-sensitive). Params được validator kiểm trước khi `graph_runtime.build_plan()`.
> Nguồn chuẩn: [SW_COMPONENT_LIBRARY §8](../software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).

### 10.1 `Modbus_RTU_Read`

| Param | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|-------|------|----------|-----------|-------|
| `bus` | int | ✓ | 1 hoặc 2 | Cổng RS-485 (1=RS485-1, 2=RS485-2) |
| `slave` | int | ✓ | 1–247 | Địa chỉ slave Modbus RTU |
| `fc` | int | ✓ | 1,2,3,4 | Function code đọc |
| `addr` | int | ✓ | 0–65535 | Địa chỉ register/coil |
| `type` | string | ✓ | `"bool"`,`"u16"`,`"s16"`,`"u32"`,`"s32"`,`"f32"` | Kiểu dữ liệu register |
| `scale` | float | ✗ | — | Hệ số nhân (default 1.0) |
| `fallback` | float | ✓ | — | Giá trị dùng khi stale/quality BAD |

Ports: `out:float` (sau scale).

Quality propagation:
- ext_cache quality = GOOD → `out` = `raw × scale`.
- ext_cache quality = BAD hoặc stale > poll_ms × 3 → `out` = `fallback`; quality BAD lan downstream.

Validator rule: `fallback` là **bắt buộc** (kiểm check #4 hiện tại trong GRAPH_SCHEMA §6).

### 10.2 `Modbus_RTU_Write`

| Param | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|-------|------|----------|-----------|-------|
| `bus` | int | ✓ | 1 hoặc 2 | Cổng RS-485 |
| `slave` | int | ✓ | 1–247 | Địa chỉ slave |
| `fc` | int | ✓ | 5,6,15,16 | Function code ghi |
| `addr` | int | ✓ | 0–65535 | Địa chỉ register/coil |
| `type` | string | ✓ | `"bool"`,`"u16"`,`"s16"`,`"u32"`,`"s32"`,`"f32"` | Kiểu dữ liệu |
| `scale` | float | ✗ | — | Hệ số nhân nghịch (graph_value / scale → raw) |

Ports: `in:float` (đầu vào từ graph — bắt buộc wired).

Behavior: mỗi scan, nếu `in` thay đổi (hoặc lần đầu), đẩy vào write-queue của `fieldbus`
qua `fieldbus.sock`. Không có output port; node là **sink**. Không cần `power_on`.

Validator rule: `in` port phải được wire (đúng 1 source); không có `fallback` (write-only).

### 10.3 `Modbus_TCP_Read`

| Param | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|-------|------|----------|-----------|-------|
| `host` | string | ✓ | IP hoặc hostname | Địa chỉ server Modbus TCP |
| `port` | int | ✗ | 1–65535 (default 502) | TCP port |
| `unit` | int | ✓ | 1–247 | Unit ID (Modbus TCP slave address) |
| `fc` | int | ✓ | 1,2,3,4 | Function code đọc |
| `addr` | int | ✓ | 0–65535 | Địa chỉ register/coil |
| `type` | string | ✓ | `"bool"`,`"u16"`,`"s16"`,`"u32"`,`"s32"`,`"f32"` | Kiểu dữ liệu |
| `scale` | float | ✗ | — | Hệ số nhân (default 1.0) |
| `fallback` | float | ✓ | — | Giá trị khi stale/disconnect |

Ports: `out:float`.

Quality propagation: giống `Modbus_RTU_Read` — stale = TCP connection lost hoặc poll timeout.
Kết nối TCP do `modbus_tcp` module trong mkddc-iobus quản lý (xem SW_FIELDBUS_DESIGN §12).

### 10.4 `BACnet_AV`

| Param | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|-------|------|----------|-----------|-------|
| `instance` | int | ✓ | 0–4194302 | BACnet Analog Value instance number |
| `name` | string | ✓ | — | Object Name (unique trong device) |
| `writable` | bool | ✗ | true/false (default false) | Cho phép WriteProperty từ BMS |
| `units` | int | ✗ | BACnet Engineering Units code | Đơn vị (default 95 = no-units) |
| `min_pres_value` | float | ✗ | — | Min_Pres_Value (optional) |
| `max_pres_value` | float | ✗ | — | Max_Pres_Value (optional) |

Ports: `in:float?` (optional — nếu wire thì push setpoint vào AV), `out:float` (Present_Value hiện tại).

Behavior:
- Nếu `writable=true` và có `in` wire: `in` → AV Present_Value ở mức 5 (graph). BMS WriteProperty
  ở mức 3 có thể override (xem priority resolver).
- `out` = AV Present_Value sau priority resolution.
- Dùng cho điểm ảo (setpoint từ BMS/HMI). **Không** dùng cho AI/AO/BI/BO (phát sinh tự động từ io_map).

Validator rule: `instance` phải unique trong graph; `name` phải unique.

### 10.5 `BACnet_BV`

| Param | Kiểu | Bắt buộc | Ràng buộc | Mô tả |
|-------|------|----------|-----------|-------|
| `instance` | int | ✓ | 0–4194302 | BACnet Binary Value instance number |
| `name` | string | ✓ | — | Object Name |
| `writable` | bool | ✗ | true/false (default false) | Cho phép WriteProperty từ BMS |

Ports: `in:bool?` (optional), `out:bool`.

Behavior: tương tự `BACnet_AV` nhưng kiểu bool. Active/Inactive state.

---

### 10.6 Quy tắc validator chung cho Protocol nodes

1. `Modbus_RTU_Read`, `Modbus_TCP_Read`: `fallback` **bắt buộc** — validator reject nếu thiếu.
2. `Modbus_RTU_Write`: `in` port phải được wire — validator reject node không có source.
3. `BACnet_AV`/`BACnet_BV`: `instance` không được trùng với nhau và không trùng AI/BI/AO/BO/AV/BV đã sinh từ io_map.
4. `Modbus_TCP_Read`: tham chiếu `host` phải khớp một entry trong `modbus.tcp[]` của graph.json (validator check #5 — mới, thêm cùng COR-011).
5. `Modbus_RTU_Read/Write`: tham chiếu `bus` + `slave` phải khớp entry trong `modbus.rtu[]` (validator check #6 — mới).

### 10.7 Ví dụ Protocol node trong graph.json

```json
{
  "nodes": [
    {
      "id": "vfd_hz",
      "type": "Modbus_RTU_Read",
      "params": { "bus": 1, "slave": 5, "fc": 3, "addr": 100, "type": "u16", "scale": 0.1, "fallback": 0.0 }
    },
    {
      "id": "vfd_cmd",
      "type": "Modbus_RTU_Write",
      "params": { "bus": 1, "slave": 5, "fc": 6, "addr": 200, "type": "u16", "scale": 0.1 }
    },
    {
      "id": "chiller_sp",
      "type": "BACnet_AV",
      "params": { "instance": 1, "name": "ChillerSetpoint", "writable": true, "units": 62 }
    },
    {
      "id": "tcp_sensor",
      "type": "Modbus_TCP_Read",
      "params": { "host": "192.168.1.50", "unit": 1, "fc": 3, "addr": 0, "type": "f32", "scale": 1.0, "fallback": 0.0 }
    }
  ]
}
```

---

> **Rev** 1.1 | 2026-06-26 — Thêm §10 Protocol node type catalog (5 types: Modbus_RTU_Read/Write,
> Modbus_TCP_Read, BACnet_AV/BV) với validator contract; xem SW_COMPONENT_LIBRARY §8 và COR-011.
