# Config File Schema — MK-DDC-24
## D-5 — cấu hình `/data/config/*.conf` (JSON)

> **Document ID:** ICD-CONFIG-MK-DDC-24-VI
> **Phiên bản:** 1.5 | 2026-07-02 (§4a: thêm `alarm_settings.conf` entity-list per ADR-013) · 1.4 | 2026-06-30 (§3: ao[] mở rộng per ADR-012 — thêm name/units/min_pv/max_pv; §3.1: bảng sensor_type→BACnet Units enum đầy đủ per ADR-011) · 1.3 | 2026-06-29 (§3: mkddc-iobus consumes EasySet UI u0-u7 từ `io_config.conf`) · 1.2 | 2026-06-17 (§5: bacnet.conf thêm `bind_interface`; §5b: fieldbus.conf thêm `rs485.device` bắt buộc + table đầy đủ) · 1.1 | 2026-06-11 · 📘 [README](../../01_specs/README.md)
> **Trace:** `SW_ARCH §5`, `SW-IDE-010..015`, `IDE-020..025`

> Tất cả file cấu hình là **JSON**, nằm ở `/data/config/`, do `mkddc-web` ghi, các service đọc. Mỗi file có **JSON Schema** (validate khi ghi). Dưới đây: schema rút gọn + **ví dụ thật**.

**Owner / reader / reload từng file (chuẩn duy nhất):**

| File | Writer | Reader (service) | Reload khi đổi |
|------|--------|------------------|-----------------|
| `device.conf` | mkddc-web | mkddc-iobus (BACnet), mkddc-core | SIGHUP iobus |
| `network.conf` | mkddc-web | mkddc-web (áp hệ thống) | apply ngay (netplan/networkd) |
| `io_config.conf` | mkddc-web | **mkddc-iobus** (scale + SET_AO_CFG) | SIGHUP iobus (re-handshake AO cfg) |
| `io_safe_state.conf` | mkddc-web | **mkddc-core** (relinquish default + safe-state) | SIGHUP core |
| `alarm_settings.conf` | mkddc-web | **mkddc-core** (Phase 2 loader/evaluator) | SIGHUP core after Phase 2; Phase 1 is contract-only |
| `bacnet.conf` | mkddc-web | mkddc-iobus | restart iobus |
| `fieldbus.conf` | mkddc-web | mkddc-iobus | restart iobus |
| `mqtt.conf` | mkddc-web | (Rev B+ agent) | — |
| `users.conf` | mkddc-web | mkddc-web | apply ngay |
| `iobus.conf` (xem [06 §4](../../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md)) | dev/provisioning | mkddc-iobus | restart iobus |

> ⚠️ **RECONCILE (2026-06-08).** Phần **logic điều khiển** (component nodes/links) nay nằm ở
> [`graph.json`](GRAPH_SCHEMA_MK-DDC-24_VI.md) (nguồn-chuẩn) thay cho program FBD/ST. File config
> ở đây giữ vai trò device/IO/BACnet/Modbus/system; "Web IDE ghi" nay là `mkddc-web` (Go, form/JSON).
> Khi io_map/modbus trùng lặp giữa hai tài liệu, **nguồn-chuẩn cấu trúc = GRAPH_SCHEMA**.

---

## 1. `device.conf` — danh tính BACnet
**Schema (rút gọn):**
```json
{
  "type": "object",
  "required": ["device_id", "device_name"],
  "properties": {
    "device_id":   {"type":"integer","minimum":1,"maximum":4194302},
    "device_name": {"type":"string","maxLength":64},
    "description": {"type":"string"},
    "location":    {"type":"string"}
  }
}
```
**Ví dụ:**
```json
{ "device_id": 1001, "device_name": "FCU-Zone-3F-A", "location": "Tang 3 - khu A" }
```
> Nếu file không tồn tại → dùng DIP SW1–SW7 (1–127) đọc qua CM3 GPIO (SW-BAC-006).

## 2. `network.conf` — mạng (Ethernet + WiFi, northbound IP)
```json
{ "eth": {
    "mode": "dhcp",            // "dhcp" | "static"
    "ip": "192.168.1.50", "netmask": "255.255.255.0",
    "gateway": "192.168.1.1", "dns": ["8.8.8.8"] },
  "wifi": {
    "enabled": false,
    "ssid": "", "psk": "",     // WPA2/WPA3
    "mode": "dhcp" },
  "hostname": "mk-ddc-24-fcu3a" }
```
> Lên BMS/cloud (BACnet/IP, MQTT, REST) đi qua Ethernet hoặc WiFi (đều là IP).

## 3. `io_config.conf` — loại sensor mỗi kênh UI + mode AO
```json
{
  "ui": [
    {"ch":1, "type":"NTC10k",   "unit":"degC"},
    {"ch":2, "type":"PT1000",   "unit":"degC"},
    {"ch":3, "type":"dry",      "unit":"bool", "invert":false, "enabled":true},
    {"ch":4, "type":"4-20mA",   "unit":"percent", "scale_lo":0, "scale_hi":100},
    {"ch":5, "type":"0-10V",    "unit":"ppm",     "scale_lo":0, "scale_hi":2000},
    {"ch":6, "type":"2-10V",    "unit":"degC",    "name":"Supply Temp", "range_mult":3},
    {"ch":7, "type":"potentiometer", "unit":"percent", "filter_samples":3, "sensor_cal":0, "math_func":0}
  ],
  "ao": [
    {"ch":1, "mode":"0-10V"},
    {"ch":2, "mode":"4-20mA"}
  ]
}
```
- `type` ∈ `none|0-10V|2-10V|4-20mA|PT100|PT1000|NTC10k|NTC20k|dry|potentiometer|light|pulse`.
- `ui[].name` không bắt buộc, kiểu string, dùng làm nhãn authoring UI.
- `ui[].note` không bắt buộc, kiểu string, dùng làm ghi chú riêng từng AI trong Summary.
- `ui[].enabled` không bắt buộc, kiểu bool, bật/tắt kênh ở lớp authoring UI.
- `ui[].invert` không bắt buộc, kiểu bool, dùng cho dry contact direct/reversed.
- `ui[].range_mult` không bắt buộc, kiểu int 0..5, dùng cho dải đo EasySet AI.
- `ui[].filter_samples` không bắt buộc, kiểu int 0..100, số mẫu lọc EasySet u5.
- `ui[].sensor_cal` không bắt buộc, kiểu number -12.7..12.8, hiệu chuẩn cảm biến EasySet u6.
- `ui[].math_func` không bắt buộc, kiểu int 0..3, hàm toán EasySet u7.
**AO fields (2026-06-30, ADR-012 — BACnet AO object alignment):**

```json
"ao": [
  {"ch":1, "name":"CHILLED WATER VALVE", "mode":"0-10V",  "units":"percent", "min_pv":0.0, "max_pv":100.0},
  {"ch":2, "name":"SUPPLY FAN SPEED",    "mode":"4-20mA", "units":"percent", "min_pv":0.0, "max_pv":100.0},
  {"ch":3, "mode":"0-10V"},
  {"ch":4, "mode":"4-20mA"}
]
```

| Field | Required | Default | BACnet property | Notes |
|-------|:--------:|---------|----------------|-------|
| `ch` | ✅ | — | Object_Identifier (instance) | 1..4 |
| `mode` | ✅ | `"0-10V"` | — | `"0-10V"` \| `"4-20mA"` → SET_AO_CFG |
| `name` | ✗ | `"AO{ch}"` | Object_Name | ≤64 chars |
| `units` | ✗ | auto (từ mode) | Units | xem bảng sensor_type→Units §3.1 bên dưới |
| `min_pv` | ✗ | `0.0` | Min_Pres_Value | engineering unit, ≤ max_pv |
| `max_pv` | ✗ | `10.0` (V) / `20.0` (mA) | Max_Pres_Value | engineering unit |

- `ao.mode` ∈ `0-10V|4-20mA` → **mkddc-iobus** gửi `SET_AO_CFG` xuống MCU (mode đã áp dụng ghi vào `kx_io_shm.ao_mode[]`).
- `ao.units` absent → auto-derive: `"0-10V"` → `volts` (BACnet 5), `"4-20mA"` → `milliamperes` (BACnet 2).
- `ao.name`/`units`/`min_pv`/`max_pv` đọc bởi **mkddc-core** (`bacnet_objtable.cpp`) để populate BACnet AO properties.
- Engineering conversion: `raw_u16 = clamp((eng - min_pv)/(max_pv - min_pv), 0, 1) × 65535`.

### 3.1 Bảng `sensor_type` → BACnet Units (cho UI/AI Reliability và AO config)

| UI `type` / AO `units` string | BACnet Units label | BACnet enum |
|-------------------------------|-------------------|:-----------:|
| `NTC10k`, `NTC20k`, `PT100`, `PT1000` | `degrees_celsius` | 62 |
| `0-10V`, `"volt"` | `volts` | 5 |
| `2-10V` | `volts` | 5 |
| `4-20mA`, `"milliampere"` | `milliamperes` | 2 |
| `potentiometer` | `percent` | 98 |
| `light` | `watts_per_square_meter` | 182 |
| `pulse` | `pulses` | 195 |
| `dry` | `no_units` | 95 |
| `none` / `UNKNOWN` | `no_units` | 95 (+ `CONFIGURATION_ERROR` Reliability) |
| `"percent"` | `percent` | 98 |
| `"degC"` | `degrees_celsius` | 62 |
| `"Pa"` | `pascals` | 53 |
| `"RPM"` | `revolutions_per_minute` | 104 |
| `"ppm"` | `parts_per_million` | 96 |
| `"no_units"` | `no_units` | 95 |

> **Mapping authority:** ADR-011 (Reliability), ADR-012 (AO config). Implementation: `bacnet_objtable.cpp`.

> 2026-06-29 implementation note: `mkddc-iobus` consumes EasySet UI `u0..u7` from `io_config.conf`: `type`, `scale_lo/scale_hi`, `range_mult`, `unit`, `filter_samples`, `sensor_cal`, and `math_func`. `ui[].name/note` stay web metadata.

> 2026-06-30 ADR-011 note: `mkddc-iobus` also writes live raw input into `kx_io_shm.ui_raw[]` with `ui_raw_unit[][]`. `0-10V`/`2-10V`/NTC/potentiometer/light use raw unit `"V"`, `4-20mA` uses `"mA"`, and `dry`/`pulse`/`none`/disabled channels use empty raw unit so web omits raw V/mA. Dry-contact engineering value is boolean 0/1 for ON/OFF display.

## 4. `io_safe_state.conf` — giá trị an toàn khi lỗi
```json
{
  "ao": [ {"ch":1,"safe":0.0}, {"ch":2,"safe":4.0} ],   // V hoặc mA tùy mode
  "do": [ {"ch":1,"safe":"open"}, {"ch":2,"safe":"open"} ]
}
```
> Không cấu hình → mặc định AO 0V/4mA, DO open (IOP-SPEC §6.3).
> **Quan hệ chốt (2026-06-12):** file này cấu hình **relinquish default mức 6** của
> priority resolver (07 §4). Safety ACTION khi fault/stale (07 §5.3) CỐ ĐỊNH 0V/4mA/open
> ở cả 3 lớp (MCU/iobus/core), KHÔNG đổi theo file này — config sai không thể làm
> hệ mất đường về safe. Loader: `services/core/safe_state_config.*` (fail-fast khi JSON hỏng).

## 4a. `alarm_settings.conf` — alarm entity list (ADR-013)

> Phase 1 contract-only: `mkddc-web` đã có đường lưu file, nhưng `mkddc-core` hiện chưa load/evaluate file này. Phase 2/3 phải thêm loader boot/SIGHUP và expand entity→per-source branch trước khi alarm runtime active.

**Schema (rút gọn):**
```json
{
  "type": "array",
  "maxItems": 64,
  "items": {
    "type": "object",
    "required": ["id", "label", "enabled", "alarmType", "sources", "priority", "delayS", "params"],
    "properties": {
      "id": {"type": "string", "pattern": "^ALM-[A-Za-z0-9_-]+$", "maxLength": 64},
      "label": {"type": "string", "maxLength": 96},
      "enabled": {"type": "boolean"},
      "alarmType": {"type": "integer", "enum": [0, 1, 2, 3, 4, 5, 6, 7]},
      "sources": {
        "type": "array",
        "minItems": 1,
        "maxItems": 16,
        "items": {
          "type": "object",
          "required": ["kind", "channel", "pointId"],
          "properties": {
            "kind": {"type": "string", "enum": ["UI", "AO", "DO"]},
            "channel": {"type": "integer", "minimum": 1},
            "pointId": {"type": "string", "pattern": "^(UI|AO|DO)-[0-9]{2}$"}
          }
        }
      },
      "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
      "delayS": {"type": "number", "minimum": 0},
      "publishBacnet": {"type": "boolean", "default": false},
      "notificationClass": {"type": "integer", "minimum": 1, "maximum": 4},
      "params": {"type": "object"}
    }
  }
}
```

**Ví dụ:**
```json
[
  {
    "id": "ALM-001",
    "label": "Supply air temperature",
    "enabled": true,
    "alarmType": 1,
    "sources": [
      {"kind": "UI", "channel": 1, "pointId": "UI-01"},
      {"kind": "UI", "channel": 2, "pointId": "UI-02"}
    ],
    "priority": "high",
    "delayS": 10,
    "publishBacnet": true,
    "notificationClass": 1,
    "params": {"hh": 32, "h": 28, "l": 16, "ll": 12, "hysteresis": 0.5}
  },
  {
    "id": "ALM-002",
    "label": "Pump runtime",
    "enabled": true,
    "alarmType": 3,
    "sources": [{"kind": "DO", "channel": 1, "pointId": "DO-01"}],
    "priority": "medium",
    "delayS": 0,
    "publishBacnet": false,
    "params": {"runtimeHours": 2000}
  }
]
```

**Alarm type contract:**

| `alarmType` | Name | Status | Required `params` |
|-------------|------|--------|-------------------|
| 0 | disabled | ACTIVE no-op | `{}` |
| 1 | high_low_input | ACTIVE | `hh`, `h`, `l`, `ll`, optional `hysteresis` |
| 2 | setpoint_deviation | DEFERRED | `setpoint`, `deviationHigh`, `deviationLow` |
| 3 | runtime_hours | ACTIVE | `runtimeHours` |
| 4 | fan_state_supervision | DEFERRED | `expectedState` |
| 5 | digital_output_supervision | DEFERRED | `expectedState` |
| 6 | analog_output_supervision | DEFERRED | `expectedValue`, `tolerance` |
| 7 | pi_sequence_supervision | DEFERRED | `sequence` |

**Validation / semantics:**

- `id` unique trong file; `sources[].pointId` phải khớp `kind` và `channel`.
- `alarmType=1`: khi `enabled=true`, validate `hh >= h >= l >= ll`.
- `alarmType=3`: `runtimeHours >= 0`.
- Chỉ ACTIVE type (`0`, `1`, `3`) được `enabled=true` cho tới khi core hook của type DEFERRED được triển khai.
- Multi-source = evaluate từng source riêng, entity state = OR; threshold/params dùng chung cho mọi source. Source cần threshold riêng phải tách alarm entity.
- Tối đa 64 alarm entity nội bộ; tối đa 16 source/entity.
- BACnet Event Enrollment cap = 8: chỉ tối đa 8 enabled entity được `publishBacnet=true`; alarm còn lại local/API-only.
- Không đổi SHM v4 cho contract này. Core expose alarm qua API/core channel; nếu cần alarm array trong SHM thì phải có ADR/version bump riêng.
- Migration Phase 2 tự động từ format cũ per-point: `pointId` → `id="ALM-"+normalized(pointId)`, `sources[0]`, `alarmType=1`, `params={hh,h,l,ll}`; không silent drop row lỗi.

## 5. `bacnet.conf` — BACnet/IP (chỉ IP — ARCH-R010)
```json
{
  "bip": {
    "enabled": true,
    "udp_port": 47808,
    "bind_interface": "eth0",
    "bbmd": null,
    "foreign_device": null
  }
}
```
| Field | Bắt buộc | Mặc định | Ý nghĩa |
|-------|----------|----------|---------|
| `bip.enabled` | ✅ | — | `true`/`false` — bật/tắt BACnet/IP stack |
| `bip.udp_port` | không | 47808 | UDP port; thường giữ nguyên 47808 |
| `bip.bind_interface` | không | `""` (all) | Tên NIC cụ thể để bind (vd `"eth0"`, `"wlan0"`). Chuỗi rỗng = bind all interfaces. **Khuyến nghị đặt tường minh** để tránh listen WAN. |
| `bip.bbmd` | không | null | BBMD address table (khi DDC trong mạng khác BMS); `null` = không dùng BBMD |
| `bip.foreign_device` | không | null | FD registration BBMD IP+TTL; `null` = không đăng ký |

> ⚠ Đã **bỏ `mstp` và `rs485_mode`** (MS/TP loại bỏ). BACnet chỉ chạy BACnet/IP qua Ethernet/WiFi. RS-485 cấu hình ở `fieldbus.conf` (§5b).
> Thêm `bind_interface` 2026-06-17: bắt buộc chỉ rõ interface theo yêu cầu security (plan 24 §1).

## 5b. `fieldbus.conf` — RS-485 Modbus RTU **master** (thiết bị phụ)
```json
{
  "rs485": { "device": "/dev/ttyS3", "baud": 19200, "parity": "N", "stop": 1 },
  "poll_default_ms": 1000,
  "slaves": [
    { "addr": 10, "profile": "kinexus-io-ext-8di8do", "poll_ms": 500,  "name": "EXT-1" },
    { "addr": 11, "profile": "kinexus-remote-hmi",     "poll_ms": 1000, "name": "HMI-2" },
    { "addr": 20, "profile": "generic-power-meter",    "poll_ms": 2000, "name": "Meter-A" }
  ]
}
```
| Field | Bắt buộc | Mặc định | Ý nghĩa |
|-------|----------|----------|---------|
| `rs485.device` | ✅ | — | Đường dẫn serial port RS-485 (vd `/dev/ttyS3`, `/dev/ttyUSB0`). **Bắt buộc** — không hardcode trong code. |
| `rs485.baud` | ✅ | — | Baud rate: 9600/19200/38400/57600/115200 |
| `rs485.parity` | không | `"N"` | `"N"` / `"E"` / `"O"` |
| `rs485.stop` | không | 1 | 1 hoặc 2 stop bits |
| `poll_default_ms` | không | 1000 | Poll interval mặc định cho slave không khai báo `poll_ms` |
| `slaves[].addr` | ✅ | — | Địa chỉ Modbus slave (1–247) |
| `slaves[].profile` | ✅ | — | Profile ID (tìm trong `/usr/share/kinexus/profiles/` hoặc `/data/config/profiles/`) |
| `slaves[].poll_ms` | không | `poll_default_ms` | Poll interval riêng cho slave này |
| `slaves[].name` | ✅ | — | Tên slave; dùng làm prefix trong ext point name (`EXT-<name>.<point>`) |

> `profile` trỏ tới template register-map (xem [D-2 §3](MODBUS_REGISTER_MAP_MK-DDC-24_VI.md)). Thêm slave = thêm 1 phần tử; đổi baud hoặc device cần restart `mkddc-iobus`.
> Field `device` thêm 2026-06-17: bắt buộc chỉ rõ serial port để không hardcode trong code (plan 25 §4 gap closed).

## 6. `mqtt.conf`
```json
{
  "enabled": true,
  "broker": "tls://broker.example.com:8883",
  "client_id": "mk-ddc-24-1001",
  "topic_prefix": "kinexus/1001",
  "tls": { "ca":"/data/certs/ca.pem", "cert":null, "key":null, "insecure": false },
  "qos": 1, "retain_last_value": true
}
```
> Chỉ chấp nhận `tls://` (8883). `mqtt://` (1883) bị từ chối trừ khi admin bật cờ tin cậy nội bộ (SEC-020).

## 7. `users.conf` — tài khoản (mật khẩu hash bcrypt)
```json
{
  "users": [
    {"username":"admin","role":"admin","pw_bcrypt":"$2b$12$...."},
    {"username":"tech","role":"operator","pw_bcrypt":"$2b$12$...."},
    {"username":"guest","role":"viewer","pw_bcrypt":"$2b$12$...."}
  ]
}
```
> `role` ∈ `admin|operator|viewer` (CHỐT Rev A — ma trận quyền:
> [08 §1.1](../../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md); role "engineer"
> cũ không còn). **KHÔNG** lưu mật khẩu plaintext (SW-IDE-021). Hash bcrypt cost ≥ 12.

## 8. Quy tắc chung
- Mọi file UTF-8, có khoá `"_schema_version"` để migrate.
- Ghi atomic (ghi `*.tmp` rồi `rename`) tránh hỏng khi mất điện — vì vậy file tồn tại
  nhưng JSON hỏng = deploy/đĩa lỗi thật, KHÔNG phải trạng thái bình thường.
- File nhạy cảm (`users.conf`, `certs/`) quyền 600, owner đúng service.

**Policy lỗi config (chuẩn duy nhất — khớp [06 §4](../../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md); thay câu cũ "lỗi → default, không crash"):**

| Tình huống | Hành vi service đọc | Lý do |
|------------|---------------------|-------|
| Thiếu file | dùng default built-in toàn bộ; log WARN | thiết bị mới chưa provision là bình thường |
| JSON sai cú pháp | **fail-fast** (exit ≠ 0, systemd restart) + log ERROR + alarm | file được ghi atomic nên hỏng = sự cố thật; không đoán mò config |
| Thiếu field lẻ | default field đó; log WARN `field=..` | schema mở rộng dần |
| Field sai kiểu / unknown enum (vd `sensor_type` lạ) | **disable đơn vị liên quan** (kênh đó quality=BAD / slave đó bỏ qua) + log ERROR + alarm; service VẪN chạy | lỗi cục bộ không được hạ cả service |
| Giá trị ngoài range | clamp về biên + log WARN | vận hành tiếp an toàn |

## 9. Trace REQ
`SW_ARCH §5`, `IDE-020..025`, `SW-IDE-010..015`, `RTU-002`, `MB-010`.

---
**Rev** 1.4 | 2026-06-30
