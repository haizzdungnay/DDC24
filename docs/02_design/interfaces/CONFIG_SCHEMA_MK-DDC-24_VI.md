# Config File Schema — MK-DDC-24
## D-5 — cấu hình `/data/config/*.conf` (JSON)

> **Document ID:** ICD-CONFIG-MK-DDC-24-VI
> **Phiên bản:** 2.3 | 2026-07-22 (ADR-017: desired `network.conf` tách khỏi active kernel state; historian/time/namespace updates 2.2..1.9 retained) · 2.2 | 2026-07-21 (§4h: physical rolling-prune engine code-local, activation guard) · 2.1 | 2026-07-20 (§4h: retention theo interval) · 2.0 | 2026-07-18 (`time.conf`) · 1.9 | 2026-07-15 (§3/§8: unique display names + historian.conf per-point start policy) · 1.8 | 2026-07-22 (ADR-017 network authority) · 📘 [README](../../01_specs/README.md)
> **Trace:** `SW_ARCH §5`, `SW-IDE-010..015`, `IDE-020..025`

> Tất cả file cấu hình là **JSON**, nằm ở `/data/config/`, do `mkddc-web` ghi, các service đọc. Mỗi file có **JSON Schema** (validate khi ghi). Dưới đây: schema rút gọn + **ví dụ thật**.

**Owner / reader / reload từng file (chuẩn duy nhất):**

| File | Writer | Reader (service) | Reload khi đổi |
|------|--------|------------------|-----------------|
| `device.conf` | mkddc-web | mkddc-iobus (BACnet), mkddc-core | SIGHUP iobus |
| `network.conf` | mkddc-web | mkddc-web (desired config); target `mkddc-netcfg` activate Linux | **Hiện tại chỉ lưu file, apply pending B7**; target stage/apply/confirm/rollback |
| `io_config.conf` | mkddc-web | **mkddc-iobus** (scale + SET_AO_CFG) | SIGHUP iobus (re-handshake AO cfg) |
| `io_safe_state.conf` | mkddc-web | **mkddc-core** (relinquish default + safe-state) | SIGHUP core |
| `virtual_points.conf` | mkddc-web | **mkddc-web** (points overlay, VP runtime/alarms/schedules; diagnostic VP log only) | apply ngay |
| `historian.conf` | mkddc-web | **mkddc-web** (per-point database logging policy/capacity) | apply ngay qua atomic policy revision |
| `alarm_settings.conf` | mkddc-web | **mkddc-core** (Phase 2 loader/evaluator) | SIGHUP core after Phase 2; Phase 1 is contract-only |
| `bacnet.conf` | mkddc-web | mkddc-iobus | restart iobus |
| `fieldbus.conf` | mkddc-web | mkddc-iobus | restart iobus |
| `time.conf` | mkddc-web | mkddc-web + Linux time service | apply timezone/NTP/manual-time trước atomic commit |
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

**Phân biệt bắt buộc:** `network.conf` là desired/pending configuration, không phải bằng chứng IP đang active. Active address phải đọc từ kernel hoặc SOM network authority. Source hiện tại chưa có netplan/networkd/polkit applier: `PUT /api/v1/network` ghi file nhưng `applySystem()` trả `applied=false`. Không được hiển thị `Applied`, `Online` hoặc new IP như runtime truth chỉ vì file đã ghi thành công.

Target ADR-017 sử dụng transaction `stage → apply → awaiting_confirmation → confirm`; nếu không confirm hoặc health fail trong tối đa 120 s thì rollback last-known-good. Local HMI chỉ expose Ethernet IPv4 static/DHCP, subnet và gateway. Wi-Fi credential, DNS nâng cao, routing/VLAN/firewall và BACnet identity/port không thuộc local-panel scope.

## 3. `io_config.conf` — loại sensor mỗi kênh UI + mode AO
```json
{
  "ui": [
    {"ch":1, "tag":"room temp", "type":"NTC10k", "unit":"degC"},
    {"ch":2, "tag":"return temp", "type":"PT1000", "unit":"degC"},
    {"ch":3, "tag":"fan proof", "type":"dry", "unit":"bool", "invert":false, "enabled":true}
  ],
  "ao": [
    {"ch":1, "tag":"valve command", "mode":"0-10V", "name":"CHILLED WATER VALVE"},
    {"ch":2, "tag":"fan speed", "mode":"4-20mA", "name":"SUPPLY FAN SPEED"}
  ],
  "do": [
    {"ch":1, "tag":"fan enable", "name":"Supply fan enable"}
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

### 3.0 Global point tag UI/AO/DO/VP (ADR-019, Phase A)

- Physical tags are immutable canonical hardware identifiers: `UI-01..UI-16`, `AO-01..AO-04`, and `DO-01..DO-04`. A new VP receives the lowest free `VPn` tag; its tag may later change only when it remains globally unique against all physical and virtual tags.
- Every point exposes one unique global programming `channel`: UI uses `1..16`, AO `17..20`, DO `21..24`, and `VPn` uses `24+n` (`25..488`). Physical hardware `ch` remains unchanged inside `io_config.conf`. Deleting a VP releases its `VPn` slot, so a later VP may reuse the same global channel.
- Virtual Points use `tag` as their only user-facing name. Legacy `items[].label` is discarded on normalization and omitted from new API/config writes. Canonical IDs such as `VP1` remain internal keys for runtime, history, alarms, schedules and API calls, but UI surfaces display the current tag instead.
- `ui[].tag`, `ao[].tag`, `do[].tag`, `virtual_points.conf.items[].tag` là **technical tag bắt buộc** sau migration; tách khỏi display `name`/`label` và AO BACnet `Object_Name`.
- Namespace local trong một controller, gồm UI-01..UI-16, AO-01..AO-04, DO-01..DO-04 và mọi VP đã tạo, kể cả VP `enabled=false`.
- Canonical display: trim đầu/cuối, collapse run ASCII space thành một space, dài 1..64 byte, pattern `^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$`.
- Comparison key tính tại backend: ASCII lowercase của canonical display; không persist/client-submit key. `Fan 1`, `fan 1`, ` fan   1 ` cùng một key và xung đột.
- Canonical/legacy point-ID syntax (`UI/AI/DI/BI/AO/DO/BO/VP/AV/BV/MSV` + numeric suffix, separator/leading-zero theo parser) được reserve. Point chỉ được dùng fallback canonical ID của chính nó.
- Physical point luôn giữ reservation. VP disabled vẫn giữ reservation. Xóa VP giải phóng tag sau commit.
- DO metadata (`ch`, `tag`, optional `name`) nằm trong `io_config.conf.do[]`; safe state vẫn chỉ nằm ở `io_safe_state.conf.do[]`.
- Migration legacy chọn: tag hợp lệ đang có; nếu thiếu thì dùng `name`/`label` chỉ khi hợp lệ, không reserved sai owner và unique; còn lại dùng canonical ID. Mọi member của một nhóm display duplicate cùng fallback canonical ID, không first-wins, không auto-suffix. Migration validate toàn candidate trước atomic write, tạo report và không ghi đè display field.
- Flat-file phase enforce trên mọi approved API writer bằng một serialization boundary chung. Direct filesystem edit chưa được bảo vệ; generation seal/activate sẽ là authority cuối theo ADR-015. Không có atomic swap tag xuyên hai file trong flat-file mode.

### 3.0a Global display-name namespace UI/AO/DO/VP (ADR-019 v1.1)

- `ui[].name`, `ao[].name`, `do[].name` là display name/label cho physical points. Chúng không thay `tag`, nhưng phải unique trong một namespace riêng trên cùng scope UI-01..16, AO-01..04 và DO-01..04. VP không còn Label riêng và dùng Tag làm display.
- Canonical display: trim đầu/cuối, collapse mọi whitespace run thành một ASCII space, dài 1..64 Unicode code point, cấm control character. Backend tính `nameKey` bằng Unicode lowercase của canonical display; client không submit/persist key.
- Name có thể giống technical tag vì hai namespace độc lập. AO `name` tiếp tục là BACnet `Object_Name`; uniqueness mới không đổi mapping BACnet.
- Sau migration, name/label là required. Legacy blank được gán canonical ID (`UI-01`, `AO-01`, `DO-01`, `VP1`).
- Legacy duplicate có nội dung không bị auto-suffix/first-wins: giữ display hiện tại, báo `namespace_conflicted`, runtime/read/history vẫn chạy; chỉ mutation rename một member sang name unique và làm giảm conflict được phép qua.
- Rename không đổi canonical ID, historian generation hoặc deployed graph binding. Xóa VP giải phóng name/tag reservation sau commit nhưng history theo canonical ID + generation vẫn giữ tới hết retention.

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

## 4. `virtual_points.conf` — backend-owned Virtual Points

`virtual_points.conf` is the only source of truth for created VP points. Uncreated
AV/BV/MSV slots are not shown by `/points`, Monitoring, Trends, or history.
Legacy `AV` IDs are accepted as aliases and normalized to `VP`.

**Capacity:**
- Total VP: 464.
- Non-logged VP: 256.
- Logged VP: 128 at 1s.
- Fast trend VP: 64 at 100ms.
- Ultra-fast diagnostic VP: 16 at 10ms; ring/diagnostic retention only.

**Schema (rút gọn):**
```json
{
  "type": "object",
  "required": ["items"],
  "properties": {
    "items": {
      "type": "array",
      "maxItems": 464,
      "items": {
        "type": "object",
        "required": ["id", "tag", "label", "signalType", "enabled", "writable", "logEnabled"],
        "properties": {
          "id": {"type": "string", "pattern": "^(VP|AV)[-_]?0*([1-9]|[1-9][0-9]|[1-3][0-9]{2}|4[0-5][0-9]|46[0-4])$"},
          "tag": {"type": "string", "minLength": 1, "maxLength": 64, "pattern": "^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$"},
          "label": {"type": "string", "maxLength": 64},
          "signalType": {"type": "string", "enum": ["boolean", "integer", "float", "string", "datetime"]},
          "enabled": {"type": "boolean"},
          "writable": {"type": "boolean"},
          "logEnabled": {"type": "boolean"},
          "logIntervalMs": {"type": "integer", "enum": [1000, 100, 10]},
          "retentionS": {"type": "integer", "minimum": 0},
          "value": {},
          "unit": {"type": "string", "enum": ["", "percent", "degC", "Pa", "ppm"]},
          "displayMin": {"type": "number", "minimum": -50, "maximum": 205, "default": 0},
          "displayMax": {"type": "number", "minimum": -50, "maximum": 205, "default": 100},
          "rangeMultiplier": {"type": "integer", "minimum": 0, "maximum": 5, "default": 0},
          "filterSamples": {"type": "integer", "minimum": 0, "maximum": 100, "default": 3},
          "sensorCal": {"type": "number", "minimum": -12.7, "maximum": 12.8, "default": 0},
          "mathFunction": {"type": "integer", "minimum": 0, "maximum": 3, "default": 0},
          "note": {"type": "string"}
        }
      }
    }
  }
}
```

**Validation / semantics:**
- `signalType=string|datetime` cannot be logged or charted.
- Trends/history list only created, enabled, `logEnabled=true` VP with `boolean|integer|float`.
- Schedules can write only created, enabled, writable `integer|float` VP.
- Alarms can source only created, enabled numeric `integer|float` VP.
- Tier limits are enforced independently: `logEnabled=false <= 256`, `1000ms <= 128`, `100ms <= 64`, `10ms <= 16`.
- 10ms logging retention is capped to diagnostic/ring duration; do not use permanent SD-card logging for 10ms data.
- UI authoring mirrors the existing Inputs Wizard for metadata: `u0=signalType`, `u1=displayMin`, `u2=displayMax`, `u3=rangeMultiplier`, `u4=unit`, `u5=filterSamples`, `u6=sensorCal`, `u7=mathFunction`. Units must come from the fixed EasySet list, not free text.

## 4h. `historian.conf` — per-point database historian policy (ADR-018)

`historian.conf` là authority cấu hình cho database logging. Hot cache 48 giờ và cửa sổ archive rolling do `retentionDays` chọn là hai tier độc lập; VP diagnostic `logEnabled/logIntervalMs/retentionS` trong `virtual_points.conf` không được reinterpret thành policy này.

```json
{
  "_schema_version": 1,
  "revision": 7,
  "historian_budget_bytes": 2147483648,
  "wal_reserve_bytes": 134217728,
  "migration_reserve_bytes": 268435456,
  "required_free_space_bytes": 536870912,
  "points": [
    {
      "pointId": "UI-01",
      "generation": 1,
      "dbLoggingEnabled": true,
      "dbInterval": "15s",
      "retentionDays": 180,
      "hotCacheEnabled": true,
      "hotCacheHours": 48,
      "startAtUtc": "2026-07-16T02:00:00Z"
    }
  ]
}
```

**Validation / semantics:**

- Scope database historian: UI-01..16, AO-01..04, DO-01..04 và created numeric/boolean VP; optional DI ngoài scope amendment này.
- `dbInterval` ∈ `1s|3s|5s|15s|30s|1m|3m|5m|15m|30m|60m`. UI có thể hiển thị `60m` thành `1h`, nhưng wire/config canonical là `60m`.
- `retentionDays` là số ngày rolling được chọn trong khoảng `1..max(interval)`. Nếu patch bỏ qua field này, backend giữ giá trị hiện tại nếu còn hợp lệ; policy mới mặc định dùng maximum của interval.
- Maximum Rev A: `1s=30`, `3s=60`, `5s=90`, `15s=180`, `30s=365`, `1m=730`, `3m=1095`, `5m=1460`, `15m=1825`, `30m=2555`, `60m=3650` ngày. Đây là product cap deterministic; capacity thực tế vẫn phải qua benchmark codec/eMMC.
- Với interval `1s|3s|5s`, raw fine-resolution chỉ nằm trong bounded RAM tail; archive dài hạn lưu aggregate 15 giây. Ví dụ `1s + 30 ngày` không có nghĩa giữ raw 1 giây suốt 30 ngày.
- `startAtUtc` là RFC3339 UTC kết thúc `Z`. `null` trong API update nghĩa là backend gán server time khi commit; persisted active policy luôn có timestamp cụ thể.
- Khi bật, explicit `startAtUtc` phải `>= serverNowUtc` tại lúc commit. Quá khứ bị reject; browser clock không có authority.
- Policy state dẫn xuất: disabled=`off`; enabled và trước start=`scheduled`; enabled và tới giờ=`recording`. Không persist state thứ hai.
- Policy sống qua restart và tiếp tục tới khi admin tắt. Restart sau giờ start lấy mẫu ở boundary kế tiếp và ghi gap; không backfill/hold-last giả.
- Disable không xóa cache hoặc database history. Rename tag/name không đổi `pointId`/generation. Xóa VP giữ history tới hết retention; recreate cùng ID phải tăng generation.
- `retentionDays` nhỏ hơn maximum được phép. Physical rolling-prune engine đã code-local; dữ liệu cũ hơn cửa sổ trở thành eligible sau khi v2 writer được activate và filesystem commit point được reconcile. Activation guard giữ shadow/readiness mode không xóa history. `hotCacheHours` mặc định 48 và cache removal không xóa DB policy/history.
- Rev A yêu cầu `hotCacheEnabled=true` và `hotCacheHours=48` khi bật DB; các giá trị khác bị reject tới khi direct-to-archive mode được thiết kế.
- Full batch validate revision, generation, namespace, interval, capacity, budget/free space trước atomic commit. Failure giữ revision cũ active; empty policy không auto-all.

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
            "kind": {"type": "string", "enum": ["UI", "AO", "DO", "VP"]},
            "channel": {"type": "integer", "minimum": 1},
            "pointId": {"type": "string", "pattern": "^((UI|AO|DO)-[0-9]{2}|(VP|AV)-?[0-9]{1,3})$"}
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

- `id` unique trong file; `sources[].pointId` phải khớp `kind` và `channel`. Với `kind=VP`, `pointId` phải trỏ tới created Virtual Point `VP1..VP464`.
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

## 5c. `time.conf` — timezone, NTP và system time

```json
{
  "timezone": "Asia/Ho_Chi_Minh",
  "ntp_enabled": true,
  "ntp_servers": ["pool.ntp.org"],
  "system_time": "",
  "revision": 2
}
```

- `timezone` là IANA timezone có trên target; không nhận abbreviation.
- `ntp_servers` chứa 1..4 hostname/IP hợp lệ khi NTP bật.
- `system_time` chỉ là command one-shot RFC3339 có offset khi NTP tắt; backend xóa field này
  trước khi persist để reboot không đặt lại giờ cũ.
- `revision` tăng sau mỗi apply+commit thành công. PUT gửi `baseRevision`; stale revision trả 409.
- Backend đọc Chrony status không đặc quyền; mutation gọi root helper service qua Unix socket
  `0660 root:mkddc`. Helper có bounded capabilities, strict-validate lại payload, dùng argv cố định
  và không ghép shell command từ input; web giữ `NoNewPrivileges=true`.
- Scan/delay/runtime timer dùng monotonic clock. UTC wall clock chỉ dùng timestamp; timezone dùng
  cho lịch địa phương và hiển thị.

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
**Rev** 2.2 | 2026-07-21 — physical rolling-prune engine code-local với activation guard fail-closed; execution vẫn inactive trước cutover. · **Rev** 2.1 | 2026-07-20 — historian rolling retention theo interval, selected `retentionDays`, maximum map và archive-fold caveat; physical prune vẫn activation-gated. · **Rev** 2.0 | 2026-07-18 — thêm `time.conf` production contract, one-shot manual time, revision và clock-domain rules theo Plan 44. · **Rev** 1.9 | 2026-07-15 — ADR-018/019 amendments: independent unique display-name namespace, blank/conflict migration, `historian.conf` per-point database policy, 11 intervals, immediate/future UTC start, persistent scheduled/recording semantics and 48-hour hot cache. · **Rev** 1.8 | 2026-07-15 — ADR-019 Phase A: separate controller-local unique technical tags for UI/AO/DO/VP, deterministic legacy migration, DO metadata location, flat-file/generation authority boundary. · 1.7 | 2026-07-09 · 1.4 | 2026-06-30

Trạng thái: ĐÃ duyệt 2026-07-15 — contract amendment historian + global tag/name; implementation/test vẫn theo Plans 42/43.
