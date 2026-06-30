# ADR-011: BACnet Reliability ↔ KX_Quality Mapping

- **Date:** 2026-06-30
- **Owner:** Solution Architect / Dev SOM
- **Status:** Accepted
- **Related:** ADR-012 (AO config model), PICS/EPICS §4.1, ASHRAE 135-2020 §12.4 Table 12-4
- **Blocks:** BAC-008 (Reliability/Status_Flags map implementation), IOB-REL-001..005

---

## Context

`kx_quality_t` trong `shared/mkddc_shm.h` hiện có 3 giá trị thô: `KX_Q_GOOD=0`, `KX_Q_UNCERTAIN=1`, `KX_Q_BAD=2`.

BACnet ASHRAE 135-2020 §12.4 Table 12-4 định nghĩa **Reliability** enum với 16 giá trị chi tiết. BTL test tool (BACnet Protocol Tester) kiểm tra **từng** giá trị Reliability cụ thể — không thể chỉ gửi `UNRELIABLE_OTHER` cho mọi fault.

Gap hiện tại:
1. PICS (§4.1) chỉ liệt kê 5 Reliability values: `NO_FAULT_DETECTED / OVER_RANGE / UNDER_RANGE / OPEN_LOOP / SHORTED_LOOP` — **thiếu** `CONFIGURATION_ERROR` và `COMMUNICATION_FAILURE`.
2. `type=none` → `KX_Q_BAD` nhưng không distinguish với sensor fault → BTL không verify được.
3. IOP timeout (`iop.fault > 5s`) → không map rõ sang `COMMUNICATION_FAILURE`.
4. `KX_Q_UNCERTAIN` không có Reliability value rõ ràng.

---

## Decision

### 1. Thêm `kx_reliability_t` enum vào `shared/mkddc_shm.h`

```c
typedef enum {
    KX_REL_RELIABLE              = 0,   /* NO_FAULT_DETECTED (BACnet 0)       */
    KX_REL_OVER_RANGE            = 1,   /* OVER_RANGE (BACnet 2)              */
    KX_REL_UNDER_RANGE           = 2,   /* UNDER_RANGE (BACnet 3)             */
    KX_REL_OPEN_LOOP             = 3,   /* OPEN_LOOP — 4-20mA wire break (4)  */
    KX_REL_SHORTED_LOOP          = 4,   /* SHORTED_LOOP — 4-20mA short (5)   */
    KX_REL_CONFIGURATION_ERROR   = 5,   /* CONFIGURATION_ERROR (8)            */
    KX_REL_COMMUNICATION_FAILURE = 6,   /* COMMUNICATION_FAILURE (12)         */
    KX_REL_UNRELIABLE_OTHER      = 7,   /* UNRELIABLE_OTHER (7) — catch-all   */
} kx_reliability_t;
```

### 2. Mapping `sensor fault → kx_reliability_t`

| Trigger | `kx_reliability_t` | BACnet Reliability | ASHRAE 135 §12.4 |
|---------|-------------------|--------------------|-----------------|
| Sensor type = `none` hoặc `UNKNOWN` | `CONFIGURATION_ERROR` | 8 | Table 12-4 |
| 4-20mA < 3.5 mA | `OPEN_LOOP` | 4 | §12.4.3 |
| 4-20mA > 21.0 mA | `SHORTED_LOOP` | 5 | §12.4.3 |
| 0-10V > 11.0 V hoặc < -0.2 V | `OVER_RANGE` | 2 | §12.4.2 |
| 2-10V < 1.8 V | `UNDER_RANGE` | 3 | §12.4.2 |
| NTC/PT100/PT1000 out of physical range | `OVER_RANGE` / `UNDER_RANGE` | 2 / 3 | |
| IOP không respond > 5s | `COMMUNICATION_FAILURE` | 12 | §12.4.12 |
| ADC hardware fault (`ADC1_FAULT`/`ADC2_FAULT`) | `COMMUNICATION_FAILURE` | 12 | |
| `KX_Q_UNCERTAIN` (dữ liệu stale < 4 scan) | `UNRELIABLE_OTHER` | 7 | |
| `KX_Q_GOOD` — tất cả check pass | `RELIABLE` | 0 | |

### 3. `kx_quality_t` vẫn giữ nguyên — `kx_reliability_t` là field bổ sung

`kx_quality_t` (3-level) dùng cho logic nội bộ (safe-state trigger, alarm threshold).
`kx_reliability_t` (8-level) dùng cho BACnet Reliability property và log chi tiết.

Rule cứng:
- `KX_Q_GOOD` ↔ `KX_REL_RELIABLE` — 1-1 mapping, không exception.
- `KX_Q_BAD` → một trong các `kx_reliability_t` khác RELIABLE (tùy fault type).
- `KX_Q_UNCERTAIN` → `KX_REL_UNRELIABLE_OTHER` (không map sang BAD trong BACnet).

### 4. SHM layout change

Thêm `ui_reliability[KX_N_UI]` (`uint8_t[16]`) vào `kx_plc_shm_t` (hoặc `kx_io_shm_t`).
Location: ngay sau `ui_quality[KX_N_UI]`.
Backward compat: magic version không đổi (field thêm vào cuối struct phần mở rộng).

---

## Consequences

**Phải làm (gate BTL):**
- `shared/mkddc_shm.h`: thêm `kx_reliability_t` + `ui_reliability[]` field.
- `services/iobus/io/io_scaling.cpp`: `ui_to_eng()` trả thêm `kx_reliability_t*` out-param.
- `services/core/bacnet_objtable.cpp` (`BAC-008`): map `kx_reliability_t` → BACnet Reliability enum value.
- PICS/EPICS: bổ sung `CONFIGURATION_ERROR (8)` và `COMMUNICATION_FAILURE (12)` vào Reliability list.
- BTL test matrix: thêm test case per fault type.

**Không thay đổi:**
- Quality state machine (safe-state trigger, alarm) — vẫn dùng `kx_quality_t`.
- IPC protocol (`core.sock`) — quality field không đổi.
- `KX_Q_GOOD=0` encoding — không rename.

**Rủi ro:**
- SHM struct size tăng 16 byte — cần recompile đồng bộ iobus + core + web.
- Nếu board chạy old iobus + new core (hoặc ngược lại): reliability field garbage → cần version guard trong `bacnet_objtable.cpp`.
