# EMC & Thermal Design Notes - MK-DDC-24

> **Document:** HW-DES-07-EMC | Rev 1.4 | 2026-06-30
> **Standards basis:** IEC 61326-1, IEC 61010-1
> **UI Rev A:** 16 UI analog channels, protection/front-end before low-voltage mux/buffer

---

## Revision History

| Rev | Date | Changes |
|-----|------|---------|
| 1.0 | 2026-05-27 | Initial EMC/thermal notes |
| 1.1 | 2026-06-23 | DI to UI migration |
| 1.2 | 2026-06-23 | Phase 1-2 refresh |
| 1.3 | 2026-06-23 | UI architecture review: remove REF200/RTD Rev A assumptions, dry contact auxiliary only, protection matrix aligned to HW-DES-03-UI |
| 1.4 | 2026-06-30 | Added port-by-port provisional immunity levels, evidence fields, and power/AO/relay thermal coverage |

---

## 1. Applicable EMC/Safety Standards

| Standard | Scope | Target |
|----------|-------|--------|
| IEC 61326-1 | Measurement/control EMC | Industrial/Class A basis |
| IEC 61000-4-2 | ESD immunity | Level 4 target: 8kV contact, 15kV air |
| IEC 61000-4-4 | EFT/burst | Industrial pre-compliance target |
| IEC 61000-4-5 | Surge | Port-dependent target |
| IEC 61010-1 | Electrical safety | Creepage/clearance basis |
| CISPR 11 | Emissions | Class A basis |

### 1.1 Provisional immunity target matrix

These are Rev A **engineering pre-compliance targets**, not a certificate or a substitute for the compliance owner's final test plan. Final applicability, coupling network, cable length, source impedance, polarity, dwell, and performance criterion must be approved before formal testing.

| Port | IEC 61000-4-2 ESD | IEC 61000-4-4 EFT | IEC 61000-4-5 surge | Provisional performance criterion |
|---|---|---|---|---|
| Enclosure/user-accessible metal | +/-8kV contact, +/-15kV air | N/A | N/A | No damage; no unsafe state; temporary UI disturbance only if recorded/recovered |
| 24VAC/VDC power | +/-8kV contact at accessible terminal surfaces | +/-2kV via CDN | +/-1kV line-line, +/-2kV line-to-PE/chassis where applicable | No damage or data loss; controlled reset only if the approved criterion permits and outputs enter safe state |
| UI/AO/DO field terminals | +/-8kV contact, +/-15kV air | +/-1kV capacitive clamp for long field cables | +/-1kV common-mode target; differential test set by circuit/load class | No damage; analog error/fault flagged; outputs never exceed safe command |
| RS-485 A/B/COM/shield | +/-8kV contact, +/-15kV air | +/-1kV capacitive clamp | +/-1kV common-mode target | Communication may retry; no latch-up/damage; automatic recovery and E303 diagnostics |
| Ethernet/USB | +/-8kV contact, +/-15kV air | Per applicable cable/port setup | Per shielded-port applicability | Link may recover automatically; no corruption or damage |

Every test record must identify port, injection point, polarity, level, repetitions/duration, cable/termination, operating mode, performance criterion, observed reset/fault, and post-test functional result.

---

## 2. PCB EMC Rules

| Area | Rule |
|------|------|
| Ground | L2 continuous reference plane; no slots under high-speed or ADC paths |
| Power input | MOV/TVS/fuse strategy with short surge return path |
| UI terminals | TVS/PTC/fusible/protection nearest connector |
| UI front-end | Field transient return kept out of ADC reference return |
| Low-voltage mux/buffer | Route only conditioned nodes; keep away from terminal surge paths |
| SPI3 ADC | Short traces, series damping, no relay/DC-DC coupling |
| RS-485 | TVS at connector, controlled return and isolation as selected |
| Relay | Clearance/creepage and no copper fill below contact traces |

---

## 3. UI Protection and EMC Strategy

| Port/event | Rev A mitigation | Review requirement |
|------------|------------------|--------------------|
| 0-10V tied to 24VDC | Terminal TVS/PTC, divider, low-voltage clamp | Calculate current and component power |
| 4-20mA tied to 24VDC | PTC/fusible element + TVS/clamp before 49.9R shunt path | Calculate pre-trip/post-trip current and shunt/TVS power |
| NTC short to GND | Pull-up current-limited | Firmware `UIx_SHORT` |
| NTC short to 24V | Terminal protection before low-voltage node | Firmware fault/overrange |
| Dry contact long cable | ESD/RC/debounce; clean dry contact only | No industrial DI claim |
| ESD at UI terminal | TVS closest to terminal | Verify return path |
| EFT/surge basic | TVS/RC/ferrite as required by test level | Pre-compliance test required |
| Reverse polarity | Bidirectional TVS or steering/current limit | Verify no mux/ADC damage |
| Open wire | Bias/diagnostic method where supported | Firmware status or documented limitation |

TMUX1208 or any equivalent low-voltage analog switch is protected by design because it is placed only after the field signal is scaled/clamped into the local analog voltage domain.

---

## 4. Thermal Notes

| Component/group | Thermal consideration |
|-----------------|-----------------------|
| Radxa CM3 | Heatsink and enclosure airflow remain dominant thermal issue |
| LM2596 / DC-DC | Copper area and thermal vias required |
| ADS131M08 x2 | Low dissipation, keep away from heat sources for drift/noise |
| 49.9R shunts | 24mA overrange is about 28.7mW each; still verify grouped heating |
| UI protection parts | 24V miswire and surge tests define transient/steady heating |
| Op-amp buffers | Include quiescent current and temperature drift in budget |
| Mode latch chain | Low current; place away from precision analog nodes where possible |
| +5V main converter | Loss/Tj at 19.2–40.7V normal input, worst load and max ambient; load-step and thermal-soak evidence required |
| +3.3V converter | Loss/Tj at 1.1A allocation plus transient response during ADC/mode-latch activity |
| +15V AO converter | Switch/inductor/diode temperature at all AO channels full-scale and 500-ohm load |
| DAC/AO drivers | Headroom and temperature during voltage/current sweeps, short and max load |
| Relay driver/coils/suppression | All coils energized plus repeated inductive-load switching |

---

## 5. EMC Pre-Compliance Checklist

- [ ] UI terminal ESD tested on representative and worst-case channels.
- [ ] 24V miswire tests performed with current limit and thermal observation.
- [ ] SPI3 emissions checked around 4.096MHz/ADC clock and harmonics.
- [ ] Mode latch switching does not inject measurable glitches into ADC input nodes.
- [ ] RS-485 and Ethernet ports pass basic ESD/surge pre-checks.
- [ ] Relay switching does not disturb UI low-voltage nodes beyond accepted transient status.
- [ ] Dry contact long-cable test documented as auxiliary/non-isolated behavior.
- [ ] Optional isolated DI, if fitted, has separate EMC/isolation evidence.

---

## 6. Certification Readiness Notes

Rev A documentation must not claim:

- PT100/PT1000 industrial accuracy through the Universal Input path.
- Dry contact through UI as isolated DI.
- TMUX1208 field-voltage tolerance.
- Final analog accuracy without signed error budget and calibration data.

---

**Document ID:** HW-DES-07-EMC | Rev 1.4 | 2026-06-30
