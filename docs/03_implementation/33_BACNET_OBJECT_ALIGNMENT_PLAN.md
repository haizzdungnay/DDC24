# 33 — BACnet Object Model Alignment Implementation Plan

> **Document ID:** PLAN-BAC-ALIGN-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-30
> **Status:** Approved (owner: Solution Architect 2026-06-30)
> **Purpose:** Plan chi tiết cho Phase 4.6 — BACnet Reliability + AO config alignment với ASHRAE 135-2020
> **Authority docs:** ADR-011, ADR-012, PICS/EPICS Rev 1.2, CONFIG_SCHEMA Rev 1.4
> **Gate:** Tất cả task DONE → close BAC-012 → schedule BTL lab
> **Trace:** BAC-013, BAC-014, BAC-015, IOB-AO-001, IOB-AO-002, IOB-AO-003 trong 11_TASK_CHECKLIST

---

## 1. Bối cảnh và vấn đề cần giải quyết

Phân tích live board data (2026-06-30) phát hiện 4 gap phải fix trước BTL certification:

| Gap | Vấn đề | Tác động BTL |
|-----|--------|-------------|
| G-01 | PICS chỉ có 5 Reliability values; thiếu CONFIGURATION_ERROR + COMMUNICATION_FAILURE | BTL test tool fail khi inject type=none hoặc IOP fault |
| G-02 | `type=none` → KX_Q_BAD nhưng không distinguish với sensor fault | BTL không verify được chính xác loại fault |
| G-03 | AO object_name="AO1" (generic), Units=no_units, Min/Max_Pres_Value absent | BTL test AO required properties fail |
| G-04 | io_config.conf `ao[]` không có name/units/min_pv/max_pv fields | AO object không có engineering context |

**Root cause:**
- `kx_reliability_t` chưa tồn tại — chỉ có `kx_quality_t` (3-level quá thô cho BACnet)
- `AoChannelConfig` struct chưa có fields BACnet cần

---

## 2. Scope

**IN scope (Phase 4.6):**
- `shared/mkddc_shm.h`: thêm `kx_reliability_t` enum + `ui_reliability[]`
- `services/iobus/io/io_scaling.cpp`: compute reliability per fault
- `services/core/bacnet_objtable.cpp`: map kx_reliability_t → BACnet Reliability
- `services/iobus/config/iobus_config.hpp/cpp`: parse AoChannelConfig
- `services/core/bacnet_objtable.cpp`: AO property population + eng conversion
- `data/config/io_config.conf` template: cập nhật với AO fields

**OUT of scope:**
- AO Reliability (COMMUNICATION_FAILURE khi IOP fault) — covered by BAC-015
- FW-IOP-008/009 (IO_RESP fault_flags byte) — separate FW task, không block SOM-side
- FE display engineering AO values — defer HMI Rev B

---

## 3. Task Dependency và Timeline

```
BAC-013: shared/mkddc_shm.h kx_reliability_t
    │
    ├──→ BAC-014: io_scaling.cpp compute reliability
    │        │
    │        └──→ BAC-015: bacnet_objtable reliability map (gate BTL)
    │
IOB-AO-001: iobus_config parse AoChannelConfig
    │
    └──→ IOB-AO-002: bacnet_objtable AO properties
             │
             └──→ IOB-AO-003: AO eng conversion (board smoke)
```

Estimate:
| Task | Effort | Prereq |
|------|:------:|--------|
| BAC-013 | 2h | — |
| IOB-AO-001 | 3h | — |
| BAC-014 | 4h | BAC-013 |
| IOB-AO-002 | 3h | IOB-AO-001, BAC-013 |
| BAC-015 | 4h | BAC-013, BAC-014 |
| IOB-AO-003 | 3h | IOB-AO-002 |
| **BTL pre-test R-01..R-11 + AO-01..AO-11** | 4h | BAC-015, IOB-AO-003 |
| **Tổng** | ~23h | |

---

## 4. Chi tiết implementation

### 4.1 BAC-013: `shared/mkddc_shm.h`

**Thêm vào sau `kx_quality_t`:**
```c
typedef enum {
    KX_REL_RELIABLE              = 0,
    KX_REL_OVER_RANGE            = 1,
    KX_REL_UNDER_RANGE           = 2,
    KX_REL_OPEN_LOOP             = 3,
    KX_REL_SHORTED_LOOP          = 4,
    KX_REL_CONFIGURATION_ERROR   = 5,
    KX_REL_COMMUNICATION_FAILURE = 6,
    KX_REL_UNRELIABLE_OTHER      = 7,
} kx_reliability_t;
```

**Thêm vào `kx_plc_shm_t` struct sau `ui_quality[KX_N_UI]`:**
```c
uint8_t ui_reliability[KX_N_UI];  /* kx_reliability_t per channel */
```

⚠️ SHM size thay đổi → recompile iobus + core + web đồng bộ trước khi restart.

### 4.2 BAC-014: `services/iobus/io/io_scaling.cpp`

`ui_to_eng()` signature mở rộng:
```cpp
float ui_to_eng(uint16_t raw, SensorType type,
                float scale_lo, float scale_hi,
                kx_quality_t* q_out,
                kx_reliability_t* r_out);  // NEW
```

Mapping trong switch/if chain:
```cpp
case SensorType::NONE:
    *q_out = KX_Q_BAD;
    *r_out = KX_REL_CONFIGURATION_ERROR;
    return 0.0f;

// 4-20mA:
float ma = raw_to_ma(raw);
if (ma < 3.5f)  { *q_out = KX_Q_BAD; *r_out = KX_REL_OPEN_LOOP; }
else if (ma > 21.0f) { *q_out = KX_Q_BAD; *r_out = KX_REL_SHORTED_LOOP; }
else { *q_out = KX_Q_GOOD; *r_out = KX_REL_RELIABLE; }

// IOP timeout path (gọi từ main.cpp khi iop_fault_ticks > IOP_FAULT_THRESHOLD):
void mark_all_iop_fault(kx_plc_shm_t* shm) {
    for (int i = 0; i < KX_N_UI; i++) shm->ui_reliability[i] = KX_REL_COMMUNICATION_FAILURE;
}
```

### 4.3 IOB-AO-001: `services/iobus/config/iobus_config.hpp`

```cpp
struct AoChannelConfig {
    int ch = 0;
    std::string name;        // BACnet Object_Name; default "AO{ch}"
    std::string units_str;   // "percent"|"volt"|"milliampere"|...; default auto
    float min_pv = 0.0f;     // BACnet Min_Pres_Value
    float max_pv = 10.0f;    // BACnet Max_Pres_Value (10V default)
};

struct IobusConfig {
    // ... existing ...
    std::array<AoChannelConfig, KX_N_AO> ao_channels;  // NEW
};
```

Parser: `nlohmann/json` parse `ao[].name/units/min_pv/max_pv`; fail-soft nếu missing fields.

### 4.4 IOB-AO-002: `services/core/bacnet_objtable.cpp`

```cpp
// units_str → BACnet Units enum
static int units_str_to_bacnet(const std::string& s) {
    if (s == "percent")      return 98;
    if (s == "volt")         return 5;
    if (s == "milliampere")  return 2;
    if (s == "degC")         return 62;
    if (s == "Pa")           return 53;
    if (s == "RPM")          return 104;
    if (s == "ppm")          return 96;
    return 95; // no_units
}
// AO auto-derive units:
static int ao_auto_units(AoMode mode) {
    return (mode == AoMode::MA4_20) ? 2 : 5;
}
```

### 4.5 IOB-AO-003: Engineering conversion

```cpp
// Write AO PV (engineering → raw u16):
uint16_t ao_eng_to_raw(float eng, const AoChannelConfig& cfg) {
    float norm = (eng - cfg.min_pv) / (cfg.max_pv - cfg.min_pv);
    if (norm < 0.0f) norm = 0.0f;
    if (norm > 1.0f) norm = 1.0f;
    return static_cast<uint16_t>(norm * 65535.0f);
}
// Read AO PV (raw u16 → engineering):
float ao_raw_to_eng(uint16_t raw, const AoChannelConfig& cfg) {
    return (raw / 65535.0f) * (cfg.max_pv - cfg.min_pv) + cfg.min_pv;
}
```

---

## 5. Test Plan

### 5.1 Unit tests (target: iobus_tests + core_tests)

| Test | File | Expected |
|------|------|---------|
| R-01..R-09: reliability fault-inject | `test_io_scaling.cpp` | kx_reliability_t per ADR-011 table |
| R-10, R-11: reliability recovery | `test_io_scaling.cpp` | KX_REL_RELIABLE sau recovery |
| AO parse explicit | `test_iobus_config.cpp` | name/units/min_pv/max_pv populated |
| AO parse default (no ao[]) | `test_iobus_config.cpp` | name="AO1", units=5(volts), max=10 |
| AO units mapping | `test_bacnet_objtable.cpp` | units_str→BACnet enum 8 values |
| AO conversion boundary | `test_bacnet_objtable.cpp` | 0%, 50%, 100% → raw → eng round-trip |

### 5.2 BTL pre-test (on board via bacnet-tools)

Sau khi unit test pass, chạy trên board Orange Pi 5B:
```bash
# R-02: set UI-01 type=none → expect CONFIGURATION_ERROR (10)
ssh SOM-DDC-24 "echo '{\"ui\":[{\"ch\":1,\"type\":\"none\"}]}' > /data/config/io_config.conf && kill -HUP $(pidof mkddc-iobus)"
readprop <device-id> analog-input 1 reliability --mac <board_ip>:47808

# AO-03: set ao[1].units=percent → expect Units=98
readprop <device-id> analog-output 1 units --mac <board_ip>:47808
```

Checklist R-01..R-11 và AO-01..AO-11 tại [BTL test matrix](../../00_management/evidence/certification/bacnet-object-property-test-matrix.md) §14.1/§14.2.

---

## 6. Definition of Done (Phase 4.6)

- [x] BAC-013: `kx_reliability_t` + `ui_reliability[]` implemented; build clean iobus+core
- [x] BAC-014: reliability mapping/recovery unit tests pass (iobus_tests)
- [ ] BAC-015: BTL R-01..R-11 tất cả PASS trên board
- [x] IOB-AO-001: explicit/default/invalid AoChannelConfig test cases pass
- [x] IOB-AO-002: AO Units/Name/Min/Max trả đúng qua local UDP ReadProperty
- [ ] IOB-AO-003: local fake-MCU conversion pass; Orange Pi AO measurement remains
- [x] PICS/EPICS Rev 1.2 (corrected 2026-07-01)
- [x] CONFIG_SCHEMA Rev 1.4 (corrected 2026-07-01)
- [x] SW_REQUIREMENTS Rev 2.1 (corrected 2026-07-01)
- [x] FW_REQUIREMENTS Rev 2.1 (updated 2026-06-30)
- [x] BTL matrix Rev 1.1 (corrected 2026-07-01)
- [x] ADR-011 + ADR-012 Status: Accepted (corrected 2026-07-01)
- [ ] BAC-012 closed sau khi tất cả trên Done
- [ ] BTL lab scheduled

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|:---------:|:------:|-----------|
| SHM recompile sync — board chạy mixed old/new binary | Medium | High | Restart cả iobus + core cùng lúc sau deploy; add version guard trong bacnet_objtable |
| `io_scaling.cpp` signature change breaks existing callers | Medium | Medium | Grep tất cả callers trước khi merge; unit test coverage bắt buộc |
| BTL test tool phiên bản không hỗ trợ CONFIGURATION_ERROR (10) | Low | High | Verify với BACnet Protocol Tester v26.1-v2 trước BTL lab |
| AO engineering conversion mismatch với DAC hardware | Low | Medium | Board smoke test với oscilloscope; verify tại 0%, 50%, 100% |

---

**Trace:** `ADR-011`, `ADR-012`, `BAC-013..015`, `IOB-AO-001..003`, `SW-IOP-012..013`, `SW-BAC-009..011`, `FW-IOP-008..009`
**Next step:** Implement BAC-013 (iobus_config.hpp + mkddc_shm.h) — có thể làm song song với IOB-AO-001.
