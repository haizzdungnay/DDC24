# Power Supply Design — MK-DDC-24 Carrier Board

> **Document:** HW-DES-04-PWR | Rev 1.5 | 2026-07-22
> **Status:** **BLOCKED — not released for schematic/layout** until PWR-5V, PWR-3V3, PWR-SURGE, and AO compliance evidence in `HW_DOC_REVIEW_CLOSURE_PLAN.md` is approved

---

## 1. Tổng quan

Nguồn đầu vào duy nhất: **24 VAC hoặc 24 VDC ±20%** (19.2V – 28.8V).
Carrier board tự tạo tất cả các rail nội bộ từ nguồn này.

---

## 2. Power Rails Yêu cầu

| Rail | Điện áp | Dòng max | Tải chính |
|------|:-------:|:--------:|---------|
| **+5V** | 5.0V ±2% | **TBD; current upper-bound allocation 4.51A** | Radxa CM3, relay, 3.3V regulator input, +15V converter input, RS-485/logic |
| **+3.3V** | 3.3V ±1% | 1.1A | MCU STM32, 2× ADS131M08, UI protection, DIP SW |
| **+1.8V** | 1.8V ±1% | 200mA | ADS131M08 DVDD, spare |
| **+15V** | 15V ±2% | 200mA | AO op-amp rail (dùng 4 AO op-amp TLV4110) |
| **+5V_RELAY** | 5.0V ±5% | 400mA | Relay coil ×4 (100mA/relay) |

> **Ghi chú:** CM3 tự tạo 1.8V, 1.1V, 0.9V nội bộ từ PMIC. Carrier chỉ cần cấp 5V.
> The 1.1A +3.3V allocation must include the input current of the carrier-board +1.8V LDO; if it does not, add that reflected load before freezing the +5V calculation.

---

## 3. Stage 1 — Input Protection & Rectification

### 3.1 Input (24VAC/VDC ±20%)

```
24VAC/VDC ──[F1, TBD]──[Bridge, TBD]──[coordinated TVS/MOV/filter, TBD]──┬── DC_RAW
                                                               │
                                                           [C1 bulk, voltage/ripple TBD]
                                                               │
                                                              GND
```

| Linh kiện | Giá trị / Model | Chức năng |
|-----------|----------------|---------|
| **F1** | Preliminary polyfuse/fuse; rating TBD from inrush and fault study | Bảo vệ ngắn mạch; must coordinate with bridge, TVS, wiring, and source |
| **Bridge rectifier** | THT or SMD part selected by loss, surge, creepage, thermal, and assembly review | Đổi AC → DC; package style alone is not a safety defect |
| **TVS/MOV/filter** | **Not selected** | Select from actual standoff, breakdown, clamp at test current, pulse energy, regulator abs max, and IEC 61000-4-5 target; a part-number voltage is not its clamp voltage |
| **C1** | Capacitance/ripple TBD; working voltage selected above rectified max plus derating | Bulk cap, giảm ripple sau rectifier |
| **C2** | Value/working voltage TBD from surge and HF filter review | HF bypass |

**DC_RAW normal range:** 24VAC +/-20% produces approximately 27.2–40.7V peak before bridge drop (`Vrms * sqrt(2)`), while 24VDC +/-20% produces 19.2–28.8V. Ripple, diode drop, no-load mains tolerance, and surge margin must be added in the final calculation.

**Normal Stage-2 operating range:** at least 19.2–40.7V before ripple/derating. The selected regulator, bulk capacitor, TVS/MOV, and bridge must then be rated against the coordinated transient clamp with project margin; the old 19–33V assumption is invalid for 28.8VAC input.

Legacy Rev 1.3 named `GBU4J` and `P6KE33A` without a released coordination calculation. Those names are not approved Rev A parts. THT versus SMD bridge selection is an MFG/HW trade-off and may be closed by documented approval; surge coordination cannot.

---

## 4. Stage 2 — DC/DC: Tạo +5V

The previous 3A `LM2596HVS-5.0` solution is **rejected for Rev A release** because the current upper-bound +5V allocation is greater than 3A. No replacement IC is frozen yet.

```
DC_RAW ──[input filter]──[selected industrial buck]──[output filter]──+5V
              │                     │                       │
        surge/fault study      switch loop/layout       load-step target
```

| Requirement | Acceptance |
|---|---|
| **Input operating range** | Covers at least 19.2–40.7V normal range plus ripple, tolerance, derating, and approved margin to the coordinated surge clamp |
| **Output rating** | `I_rated >= I_5V_worst / 0.85`; with current 4.51A allocation this requires **>=5.31A continuous** or a reduced, evidence-backed load allocation |
| **Thermal** | Tj at max ambient and worst input/load remains within datasheet limit with project derating; measured prototype temperature required |
| **Transient** | CM3 load step plus relay/AO switching remains inside 5.0V tolerance; startup/inrush does not trip F1 or collapse DC_RAW |
| **Components** | Inductor, switch/diode, capacitors, and PCB copper selected from the chosen regulator design, not copied from the rejected LM2596 circuit |

**Release targets:** efficiency and loss calculated at min/nom/max input; ripple <50mVpp at the final worst-case load; >=15% continuous-current headroom.

---

## 5. Stage 3 — Tạo +3.3V và +1.8V

### 5.1 +3.3V từ +5V

`AMS1117-3.3` is **rejected for Rev A release**. At the 1.1A rail allocation its idealized dissipation would be `(5.0 - 3.3) * 1.1 = 1.87W` before thermal margin, which is not an acceptable undocumented SOT-223 design.

```
+5V ──[selected >=1.5A synchronous buck]── +3.3V
                  │
          [vendor-calculated L/C network]
```

| Tham số | Giá trị |
|---------|---------|
| Input/output | 5.0V to 3.3V, 1.1A final allocation plus margin |
| Continuous rating | >=1.5A and >=15% above final worst-case current |
| Efficiency target | >=85% at representative/full load; actual loss curve recorded |
| Thermal acceptance | Calculated and measured Tj <=100C at max ambient/worst load, or stricter selected-part/project limit |
| Transient acceptance | 3.3V remains in tolerance during ADC/mode-latch activity and upstream 5V load steps |

### 5.2 +1.8V từ +3.3V

**IC:** XC6206P182 (LDO, 200mA, dropout 250mV)

---

## 6. Stage 4 — Boost +15V (dành cho AO op-amp)

`MT3608`/`SX1308` module-class solutions are **rejected for production release**. Select an industrial converter with controlled sourcing, documented protection, and a vendor reference design. Final part is TBD.

```
+5V ──[selected boost converter]── +15V_AO
          │                            │
   calculated switch/L/diode      low-ESR bulk + ceramic
```

| Thông số | Giá trị |
|---------|---------|
| **Input** | 5V |
| **Output** | 15V ±2% |
| **Dòng** | 200mA (4 kênh AO, mỗi kênh ~40mA op-amp) |
| **Ripple** | < 30mVpp |

Required evidence: min/nom/max input efficiency, switch/inductor/diode stress, startup/short behavior, loop stability, thermal result, and AO compliance sweep. The current +15V architecture does not release the 600-ohm/20mA claim; see `IO_AO_CIRCUIT.md`.

> +15V dùng làm rail dương cho op-amp AO output TLV4110. Rail âm không cần (AO chỉ output 0–10V dương).

---

## 7. Relay Power (+5V_RELAY)

- Lấy từ +5V chính
- Tách bằng ferrite bead 600Ω@100MHz để cô lập nhiễu relay bounce
- 4 relay coil: 5V DC, ~80mA mỗi relay → tổng 320mA

---

## 8. Power Sequencing

```
24VAC/VDC ON
  └─► DC_RAW (immediate)
        └─► +5V (DC/DC, ~5ms startup)
              ├─► +3.3V (buck, startup per selected IC)
              │     └─► +1.8V (LDO, < 0.5ms)
              ├─► +15V (Boost, ~3ms)
              └─► CM3 Power (PWR_EN từ CM3 PMIC, sau khi +5V ổn định)
                    └─► CM3 Boot (~25-30s đến Debian ready)
                          └─► STM32 nRESET release (CM3 GPIO, sau boot)
```

> **STM32 được phép reset từ CM3** — đảm bảo CM3 boot hoàn chỉnh trước khi MCU release và bắt đầu I/O.

---

## 9. LED Power Indicator

| LED | Rail giám sát | Cách đấu |
|-----|-------------|---------|
| **POWER (xanh lá)** | +5V | Resistor 1kΩ từ +5V → LED → GND |
| **3V3 OK** | +3.3V | Test point, không LED (tiết kiệm không gian) |

---

## 10. Power Budget Tổng thể

| Load | Rail | Typical | Max | Notes |
|------|------|--------:|----:|-------|
| Radxa CM3 | 5V | 800mA | 2.5A | Load depends on CPU/peripherals |
| STM32G0B1 | 3.3V | 20mA | 50mA | Realtime I/O controller |
| ADS131M08 x2 | 3.3V | 60mA | 100mA | 2 ADC devices |
| UI op-amp buffers | 3.3V | TBD | TBD | Select final part before release |
| UI mode latch chain | 3.3V | <10mA est. | TBD | 6x shift/latch devices, no 120mA GPIO-enable assumption |
| UI pull-ups/excitation | VREF_UI/3.3V | TBD | TBD | Depends on selected NTC/dry-contact excitation |
| RS-485 MAX13487E | 3.3V | 20mA | 50mA | Transceiver side |
| LEDs | 3.3V | 20mA | 20mA | User indicators |
| AO op-amp/output section | 15V | 40mA | 80mA | Final AO design dependent |
| Relay coil x4 | 5V | 320mA | 400mA | All relays energized |
| JD9852 panel logic | VCI/IOVCC TBD | TBD | TBD | Use controlled module datasheet and final logic rails |
| TFT backlight driver input | 5V or selected rail | TBD | TBD | Constant-current driver, LED string current and efficiency required |
| FT5436 touch | VDD/VDDIO TBD | TBD | TBD | Include I2C pull-up current and logic-level compatibility |

Power budget is not released until the final UI op-amp, mode latch, VREF_UI,
protection components and complete HMI panel/backlight/touch loads are selected in
schematic/BOM. The existing 4.513 A upper bound does not include a frozen HMI load
and therefore must be recomputed before converter selection.

### 10.1 +5V source upper-bound calculation

The +5V converter must supply direct 5V loads and the input power of downstream 3.3V/+15V converters. Do not divide output current by efficiency without also accounting for the voltage ratio.

| Contribution at +5V source | Calculation | Upper-bound current |
|---|---:|---:|
| CM3 | allocated max | 2.500A |
| Relay rail | allocated max | 0.400A |
| +3.3V rail reflected to +5V | `3.3V * 1.1A / (5V * 0.90)` | 0.807A |
| +15V AO rail reflected to +5V | `15V * 0.2A / (5V * 0.85)` | 0.706A |
| Other direct 5V loads/reserve | provisional | 0.100A |
| **Current upper-bound total** | sum | **4.513A** |

At this allocation, 3A is invalid and even a 5A converter has only 9.7% current margin. The closure choices are:

1. Freeze measured/derived per-load maxima and reduce `I_5V_worst` with defensible simultaneity rules; or
2. Select a converter with `I_rated >= I_5V_worst / 0.85` (currently >=5.31A continuous).

After choosing the converter, calculate 24V input current as `Pout / (Vin * efficiency)` and revalidate F1, bridge, connector, copper, bulk capacitance, and enclosure temperature.

### 10.2 Required thermal/load evidence

- [ ] Spreadsheet lists typical/max voltage and current for every load and its source rail.
- [ ] Regulator loss/Tj calculation covers min/nom/max input, max ambient, tolerance, and copper area.
- [ ] Prototype load-step capture covers CM3 peak plus all relays and AO full-scale.
- [ ] 30-minute and thermal-soak measurements include +5V converter, 3.3V converter, +15V converter, bridge/TVS, inductors, AO drivers, and relay driver.
- [ ] Evidence links are recorded in `hw_design_review/HW_DOC_REVIEW_CLOSURE_PLAN.md` before status changes to `CLOSED_EVIDENCE`.

## 11. UI Rev A Power Changes

| Previous assumption | Rev A correction |
|---------------------|------------------|
| PB4-PB11 used as UI_EN with up to 120mA GPIO load | Removed. Per-channel mode latch uses serial control and low current. |
| 16x REF200/current-source RTD path | Removed from Rev A UI because RTD is not supported. |
| UI protection listed as fixed 5mA/channel | Must be recalculated from actual PTC/TVS/clamp/front-end design. |
| Dry contact replaces DI | False. Dry contact is auxiliary and not isolated. |

## Revision History

| Rev | Ngay | Thay doi |
|-----|------|----------|
| 1.0 | 2026-05-27 | Initial power design |
| 1.1 | 2026-06-23 | DI to UI migration |
| 1.2 | 2026-06-23 | Phase 1-2 power budget refresh |
| 1.3 | 2026-06-23 | UI architecture review: mode latch, buffers, RTD removed, power budget reopened pending final schematic |
| 1.4 | 2026-06-30 | Rejected undersized/thermal-risk legacy regulators, added power tree selection gates and 4.513A upper-bound +5V calculation |
| 1.5 | 2026-07-22 | Added missing HMI panel/backlight/touch loads and reopened the 5V total pending controlled display data. |

---

**Document ID:** HW-DES-04-PWR | Rev 1.5 | 2026-07-22
