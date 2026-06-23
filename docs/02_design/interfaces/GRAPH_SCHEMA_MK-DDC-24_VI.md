# Graph Schema (`graph.json`) & Deploy Contract — MK-DDC-24

> **Document ID:** IF-GRAPH-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-08
> **Trạng thái:** Approved (Owner 2026-06-08)
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
  "ai": [ { "node": "ai1", "channel": 0, "mode": "0-10V", "unit": "degC" } ],
  "ao": [ { "node": "ao1", "channel": 0, "mode": "0-10V", "limit_lo": 0, "limit_hi": 100 } ],
  "di": [ { "node": "di1", "channel": 0, "invert": false } ],
  "do": [ { "node": "do1", "channel": 0 } ]
}
```

`channel` ánh xạ tới IOP/MCU theo `SWFW_INTERFACE_SPEC`. `sensor`/`mode` hợp lệ theo HW.
- **`ai.mode`**: nhận `"0-10V"` hoặc `"2-10V"` (hiện schema mới chỉ định nghĩa `ao.mode`). `2-10V` là live-zero (range hữu dụng 2–10V ↔ 0–100% EU).

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
    "ai": [ { "node": "ai1", "channel": 0, "mode": "0-10V", "unit": "degC" } ],
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
