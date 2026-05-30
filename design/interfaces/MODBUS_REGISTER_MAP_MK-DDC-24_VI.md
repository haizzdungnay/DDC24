# Modbus RTU Master / Expansion Bus — MK-DDC-24
## Interface Control Document — D-2 (cập nhật ARCH-R010)

> **Document ID:** ICD-MODBUS-MK-DDC-24-VI
> **Phiên bản:** 2.0 | 2026-05-30
> **Trạng thái:** Draft — chờ SW Lead ký (DR-2)
> 📘 [spec/README](../../spec/README.md) · Trace: `RTU-001..008`, `SW-MOD-001..011` · Triển khai: [SW_FIELDBUS_DESIGN](../software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md)

> ⚠ **THAY ĐỔI LỚN (2026-05-30, ARCH-R010):** Phiên bản 1.0 của tài liệu này mô tả DDC là **Modbus slave** phục vụ BMS — **đã huỷ**. Đúng mô hình: **DDC là Modbus RTU MASTER** trên RS-485, đi **poll thiết bị phụ** (downstream). Northbound lên BMS dùng BACnet/IP + MQTT + REST (xem [D-3](BACNET_PICS_EPICS_MK-DDC-24_VI.md), [D-4](REST_API_OPENAPI_MK-DDC-24_VI.md)).

---

## 1. Vai trò & phạm vi

```
        BMS / Cloud  ◄── BACnet/IP · MQTT · REST (Ethernet/WiFi)
              ▲
        ┌─────┴─────┐
        │ MK-DDC-24 │  ◄── MASTER
        └─────┬─────┘
   RS-485 │ Modbus RTU (DDC = master, poll)
   ┌──────┼───────────────┬───────────────┐
   ▼      ▼               ▼               ▼
 [I/O ext]  [Remote HMI]  [Power meter]  [VFD/3rd-party]   ◄── SLAVE
```

DDC làm **Modbus RTU master**: chủ động đọc/ghi các **thiết bị phụ (slave)** trên cùng 1 bus RS-485. Mục tiêu: **mở rộng số điểm I/O, gắn màn hình phụ, tích hợp thiết bị Modbus bên thứ 3** — theo **khung mở (device profile)** để thêm loại mới chỉ bằng cấu hình.

## 2. Thông số bus
| Tham số | Giá trị |
|---------|---------|
| Vai trò DDC | **Master** (duy nhất trên bus) |
| Vật lý | RS-485 2 dây + GND, MAX13487E (HW_SPEC §9) |
| Baud | 9.6k / 19.2k / 38.4k / 57.6k / 115.2k |
| Frame | 8N1 / 8E1 / 8O1 (cấu hình) |
| Số slave | ≥ 16 (khuyến nghị ≤ 32/segment) |
| Địa chỉ slave | 1–247 |
| Function codes (master phát) | FC03, FC04 (đọc) · FC06, FC16 (ghi) · FC01/02/05/15 (tuỳ profile) |
| Chu kỳ poll | cấu hình/slave (mặc định 1s); vòng poll tổng có ngân sách thời gian |
| Timeout/slave | mặc định 300ms, retry 2 lần → đánh dấu offline |

## 3. Device Profile — khung mở (cốt lõi)

Mỗi loại thiết bị phụ được mô tả bằng một **profile** (file JSON/template), KHÔNG hard-code. Thêm thiết bị mới = thêm 1 profile.

```jsonc
// profile ví dụ: kinexus_io_ext_8di8do.json
{
  "profile_id": "kinexus-io-ext-8di8do",
  "vendor": "Kinexus",
  "description": "Module mở rộng 8 DI + 8 DO",
  "default_baud": 19200,
  "points": [
    // đọc 8 DI từ Discrete Inputs (FC02) địa chỉ 0..7
    {"name":"DI", "count":8, "fc":2, "addr":0, "type":"bool",
     "map_to":"shm.ext.di"},
    // ghi 8 DO ra Coils (FC15) địa chỉ 0..7
    {"name":"DO", "count":8, "fc":15, "addr":0, "type":"bool",
     "writable":true, "map_to":"shm.ext.do"},
    // đọc trạng thái module (Input Reg FC04)
    {"name":"STATUS", "count":1, "fc":4, "addr":100, "type":"uint16",
     "map_to":"shm.ext.status"}
  ]
}
```

**Trường của một point trong profile:**
| Trường | Ý nghĩa |
|--------|---------|
| `name` | tên điểm |
| `count` | số điểm liên tiếp |
| `fc` | function code đọc/ghi |
| `addr` | địa chỉ thanh ghi gốc trong slave |
| `type` | bool / int16 / uint16 / int32 / uint32 / float32 |
| `scale`, `offset` | đổi giá trị: `eng = raw*scale + offset` |
| `writable` | DDC có ghi xuống không |
| `byte_order` | AB / BA / ABCD / CDAB (cho 32-bit) |
| `map_to` | đích trong shared memory / biến PLC |

## 4. Cấu hình bus & slave (`fieldbus.conf` — xem [D-5](CONFIG_SCHEMA_MK-DDC-24_VI.md))
```json
{
  "rs485": { "baud": 19200, "parity": "N", "stop": 1 },
  "poll_default_ms": 1000,
  "slaves": [
    { "addr": 10, "profile": "kinexus-io-ext-8di8do", "poll_ms": 500, "name": "EXT-1" },
    { "addr": 11, "profile": "kinexus-remote-hmi",     "poll_ms": 1000, "name": "HMI-2" },
    { "addr": 20, "profile": "generic-power-meter",    "poll_ms": 2000, "name": "Meter-A" }
  ]
}
```

## 5. Profile chuẩn đi kèm (plug-and-play)
| Profile | Thiết bị | Điểm chính |
|---------|----------|-----------|
| `kinexus-io-ext-8di8do` | module mở rộng 8DI/8DO | DI×8, DO×8, status |
| `kinexus-io-ext-4ui4ao` | module mở rộng 4UI/4AO | UI×4 (int16 ×100), AO×4, status |
| `kinexus-remote-hmi` | màn hình phụ | đọc các giá trị DDC publish ra HR; ghi nút bấm |
| `generic-power-meter` | đồng hồ điện bên thứ 3 | V, I, P, kWh (float32, byte_order cấu hình) |
| `generic-modbus` | thiết bị bất kỳ | người dùng tự khai báo point |

## 6. Tích hợp vào hệ thống
- Điểm đọc từ slave → ghi vào **shared memory vùng mở rộng** → PLC, BACnet, MQTT, HMI dùng như I/O ảo.
- Map sang BACnet: điểm mở rộng có thể expose thành object AV/BV/AI bổ sung (cấu hình).
- Ghi: PLC/BMS đặt giá trị → `kinexus-fieldbus` ghi xuống slave (FC06/16) ở vòng poll kế.

## 7. Xử lý lỗi
| Tình huống | Hành động |
|-----------|-----------|
| Slave timeout/CRC | retry 2 lần → đánh dấu **offline**, điểm = "bad quality" |
| Slave offline | alarm **E302** (warning); tiếp tục poll để phát hiện online lại |
| Tỉ lệ lỗi bus > 10% | alarm **E303** (error), gợi ý kiểm tra dây/termination |
| Profile sai/không khớp | log + bỏ qua slave đó, không crash |

## 8. Ví dụ giao dịch (master phát)
**Đọc 8 DI của EXT-1 (addr 10, FC02, từ 0, qty 8):**
`TX: 0A 02 0000 0008 <CRC>` → `RX: 0A 02 01 <byte DI> <CRC>`

**Ghi DO1..8 của EXT-1 = pattern (addr 10, FC15, từ 0, qty 8):**
`TX: 0A 0F 0000 0008 01 <byte> <CRC>` → `RX: 0A 0F 0000 0008 <CRC>`

## 9. Trace REQ
`RTU-001..008`, `SW-MOD-001..011`, `FR-024`, `FR-025`, `PRD UC-06`.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 2.0 | 2026-05-30 | SW Lead | **Viết lại theo ARCH-R010:** từ "DDC Modbus slave" → "DDC Modbus RTU **master** / expansion bus" với device profile. |
| 1.0 | 2026-05-30 | SW | (huỷ) Modbus slave register map phục vụ BMS |
