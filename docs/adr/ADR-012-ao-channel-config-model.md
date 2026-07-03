# ADR-012: AO Channel Configuration Model (BACnet AO Object Aligned)

- **Date:** 2026-06-30
- **Owner:** Solution Architect / Dev SOM
- **Status:** Accepted
- **Related:** ADR-011 (Reliability mapping), CONFIG_SCHEMA §3, ASHRAE 135-2020 §12.4 (Analog Output Object)
- **Blocks:** IOB-AO-001..004, BAC-003 (AO object properties)

---

## Context

BACnet ASHRAE 135-2020 §12.4 quy định Analog Output (AO) object **required writable properties**:
- `Present_Value` (commandable, Priority Array)
- `Units` — engineering unit (BACnet Appendix B enum)
- `Min_Pres_Value` — giới hạn dưới engineering range
- `Max_Pres_Value` — giới hạn trên engineering range
- `Relinquish_Default` — giá trị khi tất cả 16 priority null

Hiện tại `io_config.conf` chỉ lưu `{"ch": N, "mode": "0-10V|4-20mA"}`. Thiếu:
- `name` → BACnet `Object_Name` mặc định là "AO1".."AO4" (không có ý nghĩa engineering)
- `units` → `Units` property báo cáo sai (hoặc mặc định `no_units`)
- `min_pv` / `max_pv` → BTL test tool kiểm tra `Min_Pres_Value` / `Max_Pres_Value`
- Engineering scale → FE/HMI không thể hiển thị "65% valve" thay vì "6.5V"

`Relinquish_Default` đã được config trong `io_safe_state.conf` (đúng, giữ nguyên).
`Priority_Array` đã implement trong priority resolver (đúng, giữ nguyên).

---

## Decision

### 1. Mở rộng `ao[]` trong `io_config.conf`

```json
"ao": [
  {
    "ch": 1,
    "name": "CHILLED WATER VALVE",
    "mode": "0-10V",
    "units": "percent",
    "min_pv": 0.0,
    "max_pv": 100.0
  },
  {
    "ch": 2,
    "name": "SUPPLY FAN SPEED",
    "mode": "4-20mA",
    "units": "percent",
    "min_pv": 0.0,
    "max_pv": 100.0
  }
]
```

**Field spec:**

| Field | Type | Required | Default | BACnet property |
|-------|------|:--------:|---------|----------------|
| `ch` | int 1..4 | ✅ | — | Object_Identifier instance |
| `name` | string ≤64 | ✗ | `"AO{ch}"` | Object_Name |
| `mode` | `"0-10V"` \| `"4-20mA"` | ✅ | `"0-10V"` | (drives Units if `units` absent) |
| `units` | BACnet Units string (xem §3) | ✗ | auto từ `mode` | Units |
| `min_pv` | float | ✗ | `0.0` | Min_Pres_Value |
| `max_pv` | float | ✗ | `10.0` (V) / `20.0` (mA) | Max_Pres_Value |

### 2. `units` string → BACnet Units enum mapping

| `units` string | BACnet Units enum | BACnet enum value |
|---------------|------------------|:-----------------:|
| `"percent"` | `percent` | 98 |
| `"volt"` | `volts` | 5 |
| `"milliampere"` | `milliamperes` | 2 |
| `"degC"` | `degrees_celsius` | 62 |
| `"Pa"` | `pascals` | 53 |
| `"RPM"` | `revolutions_per_minute` | 104 |
| `"no_units"` | `no_units` | 95 |
| *(absent)* | auto: `volts` (0-10V) / `milliamperes` (4-20mA) | 5 / 2 |

### 3. Auto-derive `units` khi không config

```
if ao[i].units absent:
    ao[i].mode == "0-10V"   → units = "volt"   (BACnet 5)
    ao[i].mode == "4-20mA"  → units = "milliampere" (BACnet 2)
```

### 4. Engineering ↔ Raw conversion (FE/HMI display)

```
raw_u16 = clamp((eng - min_pv) / (max_pv - min_pv), 0.0, 1.0) × 65535
eng     = (raw_u16 / 65535) × (max_pv - min_pv) + min_pv
```

Conversion này chạy ở **iobus** (ghi SHM) và **bacnet_objtable** (đọc SHM → BACnet Present_Value).

### 5. `Relinquish_Default` — không đổi

Giá trị safe state vẫn config trong `io_safe_state.conf`:
```json
{"ao": [{"ch":1,"safe":0.0}, {"ch":2,"safe":4.0}]}
```
Đây là **Relinquish_Default** của Priority Array level 16 (mức 6 của resolver).
Không move sang `io_config.conf` để tránh confusion giữa "output range" và "safe state".

---

## Consequences

**Phải làm:**
- `services/iobus/config/iobus_config.hpp`: thêm `AoChannelConfig { name, units_str, min_pv, max_pv }`.
- `services/iobus/config/iobus_config.cpp`: parse `ao[].name/units/min_pv/max_pv`.
- `services/core/bacnet_objtable.cpp`: map `AoChannelConfig` → AO object `Units`, `Min_Pres_Value`, `Max_Pres_Value`.
- `services/core/bacnet_objtable.cpp`: engineering conversion raw_u16 ↔ eng float dùng `min_pv`/`max_pv`.
- `CONFIG_SCHEMA_MK-DDC-24_VI.md`: document AO fields + units table.
- `BACNET_PICS_EPICS`: xác nhận AO `Units` writable = No (derived from config, not BACnet write).
- BTL test matrix: thêm AO Object_Name, Units, Min/Max_Pres_Value test cases.

**Không thay đổi:**
- `io_safe_state.conf` — Relinquish_Default giữ nguyên.
- Priority Array logic trong `priority_resolver.cpp`.
- IOP `SET_AO` command format (raw u16, không đổi).
- `kx_io_shm_t.ao_raw[]` — vẫn là raw DAC value.

**Rủi ro thấp:**
- Nếu `io_config.conf` không có `ao[]`: backward compat → default `name="AO{N}"`, `units=auto`, `min_pv=0`, `max_pv=10/20`.
- Parser phải fail-soft (không crash khi thiếu field tùy chọn).
