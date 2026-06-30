# EMC Risk Assessment — MK-DDC-24 (QCVN 9:2012 / IEC 61326-1)

> **Document ID:** CR-QCVN-D1-EMC-RISK | Rev 1.2 | 2026-06-30
> **Dự án:** MK-DDC-24 — BACnet IoT Controller  
> **Tiêu chuẩn áp dụng:** QCVN 9:2012 / IEC 61326-1 (Industrial Class A)  
> **Phạm vi:** Carrier board v1.x, Radxa CM3 compute module, DIN-rail enclosure

---

## 1. Mô tả Hệ thống

MK-DDC-24 là bộ điều khiển BACnet IoT dùng cho tòa nhà thông minh, gồm:

| Module | Chức năng | TDP / Dòng |
|--------|-----------|-----------|
| Radxa CM3 (RK3566) | Compute — BACnet/IP, Linux, HMI | ~4W full load |
| Final power converters | 24VAC/VDC → 5V/3.3V/+15V | TBD; PWR evidence gate open |
| STM32G0B1 MCU | I/O processor — ADC, DAC, UI mode, relays | ~0.2W provisional |
| ADS131M08 ADC ×2 | 16-ch universal input measurement | TBD final rail budget |
| DAC8554 ×4 | 4-ch analog output 0-10V/4-20mA | ~50mW |
| ULN2003A + Relay ×4 | DO — relay SPDT 5A | ~0.5W coil |
| Ethernet PHY (on CM3) | 100/1000Base-T BACnet/IP | ~0.5W |

**PCB:** 4-layer, 148×88mm, continuous GND plane L2.  
**Vỏ:** DIN-rail ABS V0 (tùy chọn nhôm).

---

## 2. Risk Assessment Matrix

### 2.1 Đánh giá Mức Rủi ro

| Mức | Ý nghĩa | Hành động |
|-----|---------|----------|
| **C** (Critical) | Fail test → không đạt chứng nhận | Bắt buộc mitigation |
| **H** (High) | Rủi ro fail cao | Ưu tiên mitigation |
| **M** (Medium) | Có thể pass nhưng cần verification | Theo dõi trong test |
| **L** (Low) | Thiết kế đã có mitigation tốt | Chấp nhận được |

---

### 2.2 Bảng Risk Assessment

| ID | Nguồn nhiễu | Tần số / Đặc tính | Công suất | Coupling Path | Đường/Vùng nhạy | Risk | Mitigation Hiện có | Risk Sau Mit. |
|----|------------|-------------------|-----------|---------------|----------------|------|--------------------|--------------|
| **NR-01** | Final +5V/+3.3V/+15V converters | Frequency/dv-dt TBD by selected parts | TBD | Conducted + radiated | UI analog input, ADC measurement, RS-485 | **H** | Select/freeze converters; vendor loop layout, filters, return paths and thermal evidence required | **H** until evidence |
| **NR-02** | RK3566 CPU clock | 1.8GHz, 64MHz, 100MHz (RGMII) | 4W | Radiated (traces, B2B connector) | RS-485, UI analog, TFT SPI | **H** | • CM3 shielding (heatsink + bottom GND pour)<br>• GND plane L2<br>• Via stitching xung quanh CM3 | **M** |
| **NR-03** | MIPI DSI — CM3 → TFT (HMI) | High-speed differential | Interface dependent | Radiated (traces/connector) | RS-485 A/B, USB, UI | **M** | Controlled impedance, continuous return, connector/ESD strategy, near-field scan | **M** until layout/test |
| **NR-04** | SPI3 — MCU → 2× ADS131M08 | 4MHz nominal | 3.3V CMOS | Radiated + Conducted | ADC measurement accuracy | **M** | Short traces, per-device CS/DRDY, series damping if validated, continuous GND | **M** until prototype measurement |
| **NR-05** | Ethernet RGMII | 25MHz ref clock, harmonics ≥250MHz | 1.8V/3.3V | Radiated (traces up to 100mm) | — (self-contained) | **M** | • Impedance 50Ω ±10%<br>• Length matching ±0.5mm<br>• Magnetics RJ-45 HR911105A (integrated CM choke)<br>• GND plane L2 liên tục | **L** |
| **NR-06** | Crystal 8MHz (MCU + CM3) | 8MHz fundamental + odd harmonics | ~10µW | Radiated (trace loop) | ADC, RTC, UI | **L** | • Load cap 12pF đúng spec<br>• GND guard ring quanh crystal<br>• Trace ngắn (<10mm) | **L** |
| **NR-07** | Crystal 4.096MHz (ADC) | 4.096MHz + harmonics | ~5µW | Radiated | ADC measurement | **L** | • GND guard ring<br>• Cùng cụm MCU | **L** |
| **NR-08** | Relay switching (×4 SPDT) | DC arc, ≤5A inductive | 250VAC/5A | Conducted (power line) + Radiated (arc) | All I/O, RS-485, power supply | **M** | • +5V_RELAY cách ly qua ferrite bead 600Ω<br>• Snubber RC (recommended)<br>• Copper clearance ≥3.2mm | **L** |
| **NR-09** | Final bridge/bulk/regulator input stage | 50/60Hz ripple + switching transients | TBD | Conducted (DC rail) | UI analog, ADC | **M** | Bridge, bulk capacitor and regulator are not frozen; calculate ripple/loss and measure | **M** until evidence |
| **NR-10** | 24VAC/VDC power input (external) | External conducted noise/surge | — | Conducted (power cable) | Entire system | **H** | Fuse/bridge/TVS/MOV/filter coordination and surge test are open P0 evidence items | **H** until evidence |

---

### 2.3 Đường/Vùng Nhạy (Sensitive Circuits)

| ID | Đường | Loại | Nguy cơ nhiễu chính | Mitigation |
|----|-------|------|-------------------|------------|
| **SC-01** | UI1–UI16 input | Analog / auxiliary dry — 0-10V / NTC / 4-20mA | NR-01, NR-02, NR-09 | Final per-channel TVS/current limiting/filter/front-end must be frozen and tested; do not treat candidate parts as verified |
| **SC-02** | 2× ADS131M08 measurement | Analog — ΔΣ ADC 24-bit | NR-01, NR-04 | Short SPI/return paths, per-device bypass, continuous reference plane; verify clock/noise on prototype |
| **SC-03** | Optional DI1–DI8 isolated module | Digital 24VDC | NR-01, NR-08 | Not populated base SKU; separate schematic/protection/isolation and EMC evidence required |
| **SC-04** | RS-485 A/B | Differential — Modbus RTU | NR-02, NR-03, NR-05 | • TVS SMAJ6.5A mỗi line<br>• Ferrite bead 600Ω@100MHz<br>• 120Ω matched pair<br>• Isolation gap ≥3mm |
| **SC-05** | DAC8554 AO output | Analog — 0-10V / 4-20mA | NR-01, NR-08 | • Boost +15V rail riêng (op-amp)<br>• Output filtering (RC)<br>• GND plane L2 |
| **SC-06** | USB-C / USB-A | High-speed digital | NR-02, NR-05 | • PRTR5V0U2X ESD array<br>• CC resistors 5.1kΩ (UFP)<br>• Differential pair routing |
| **SC-07** | TFT MIPI DSI (HMI) | High-speed differential | NR-02 | Controlled impedance, continuous return, connector/ESD strategy and near-field scan required |

---

## 3. Phân tích Chi tiết — Nguồn nhiễu chính

### 3.1 Final DC/DC Converters (NR-01)

**Đặc tính nhiễu:**
- Switching frequency, edge rate, peak current and magnetics depend on the selected +5V/+3.3V/+15V parts.
- Treat conducted/radiated spectrum as unknown until the designs and layouts are frozen.

**Coupling path:**
- **Conducted:** Ripple trên VCC_5V rail → ảnh hưởng CM3, MCU, ADS131M08
- **Radiated:** Từ inductor và trace power → UI analog input (PCB top-left gần UI terminals)

**Mitigation:**
- Follow each selected regulator reference layout and minimize hot loops.
- Keep continuous return paths and separate switch nodes/magnetics from UI/ADC routing.
- Verify with load-step, near-field and conducted-emission measurements.

### 3.2 RK3566 CPU (NR-02)

**Đặc tính nhiễu:**
- Quad-A55 @ 1.8GHz — clock harmonics dải rộng
- B2B connector (CON1/CON2) nhiều tín hiệu tốc độ cao
- DDR4 2GB: bus 3200MT/s (EMI tiềm ẩn từ routing B2B)

**Coupling path:**
- **Radiated:** Từ CM3 module → RS-485, UI (vị trí top-center PCB)
- **Conducted:** Qua B2B connector → carrier board traces

**Mitigation:**
- Heatsink (55×40mm) + thermal pad → giảm nhiệt → giảm noise floor
- GND plane L2 liên tục bên dưới CM3
- Via GND stitching perimeter CM3 footprint
- L3 power plane separation

---

## 4. Tổng hợp Mitigation

| Hạng mục | Trạng thái | Bằng chứng / Ghi chú |
|----------|-----------|---------------------|
| 4-layer PCB continuous GND | Requirement | Verify in KiCad/layout and return-current review |
| Grounding/net-tie scheme | Controlled draft | `GROUNDING_SCHEME.md`; verify in schematic/layout |
| Decoupling capacitors | Requirement | Verify selected values/placement in annotated schematic/BOM |
| TVS all applicable ports | BLOCKED | Final parts and clamp/leakage/pulse coordination pending |
| Ferrite/filter networks | BLOCKED | Values/placement and measurement pending |
| 24V input filter | BLOCKED | Final topology and safety component selection pending |
| MOV + TVS surge protection | BLOCKED | PWR-SURGE calculation and pre-compliance test missing |
| Optional isolated DI | N/A base SKU | Separate optional-SKU schematic/evidence required |
| RS-485 isolation | Controlled draft | Final isolator + isolated power + spacing evidence pending |
| ESD arrays USB/SD | Requirement | Verify final part, clamp and placement in schematic/BOM/layout |
| Relay coil filtering | Requirement | Verify final bead/filter and bounce/inductive-load behavior |
| Clearance/creepage relay HV | BLOCKED | Verify from selected safety basis, KiCad layout and manufacturing drawing |
| Digital-interface damping/routing | Requirement | Validate MIPI DSI, ADC SPI and UART routing/termination from final layout |

---

## 5. Rủi ro Tồn đọng & Khuyến nghị

| ID | Rủi ro | Mức | Khuyến nghị |
|----|--------|-----|------------|
| **R-01** | CM3 module không có shield riêng (chỉ heatsink) | **M** | Nếu radiated emission fail → xem xét shield can hoặc chuyển vỏ nhôm (tăng shielding 10–20dB) |
| **R-02** | Converter magnetics/switch nodes couple into UI | **H** | Freeze parts/layout; review return paths and near-field pre-scan before lab. |
| **R-03** | ESD air ±15kV (L4) — khe hở vỏ DIN-rail | **M** | Test ESD tại tất cả khe hở vỏ (khe tản nhiệt CM3, USB, RJ-45). Xem xét gasket nếu fail. |
| **R-04** | Relay không có RC snubber trong schematic | **L** | Thêm snubber RC (100Ω + 10nF) song song contact relay nếu quan sát nhiễu khi switching |
| **R-05** | Conducted emission from unfrozen converters | **H** | Pre-compliance with suitable LISN/AMN after final parts and input filter are frozen. |
| **R-06** | MIPI DSI high-speed path/connector | **M** | Controlled-impedance/return review and near-field scan on the final display path. |

---

## 6. Kết luận

- Tổng số **10 nguồn nhiễu** (NR) đã xác định, **7 đường nhạy** (SC) đã đánh giá.
- Tất cả rủi ro có mitigation sau thiết kế đều ở mức **L** (Low) hoặc **M** (Medium).
- Không có rủi ro Critical tồn đọng.
- Thiết kế PCB, ESD protection, filtering, isolation đáp ứng yêu cầu IEC 61326-1 Class A.
- Cần **pre-compliance scan** trước khi gửi lab để giảm rủi ro (mục §5).
- Khuyến nghị dùng **vỏ nhôm** nếu radiated emission không pass với vỏ ABS.

---

**Document ID:** CR-QCVN-D1-EMC-RISK | Rev 1.1 | 2026-06-04  
**Next:** CR-QCVN-D2-EMC-TESTPLAN — EMC Test Plan per IEC 61326-1
