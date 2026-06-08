# EMC Risk Assessment — MK-DDC-24 (QCVN 9:2012 / IEC 61326-1)

> **Document ID:** CR-QCVN-D1-EMC-RISK | Rev 1.1 | 2026-06-04  
> **Dự án:** MK-DDC-24 — BACnet IoT Controller  
> **Tiêu chuẩn áp dụng:** QCVN 9:2012 / IEC 61326-1 (Industrial Class A)  
> **Phạm vi:** Carrier board v1.x, Radxa CM3 compute module, DIN-rail enclosure

---

## 1. Mô tả Hệ thống

MK-DDC-24 là bộ điều khiển BACnet IoT dùng cho tòa nhà thông minh, gồm:

| Module | Chức năng | TDP / Dòng |
|--------|-----------|-----------|
| Radxa CM3 (RK3566) | Compute — BACnet/IP, Linux, HMI | ~4W full load |
| LM2596 DC/DC | 24VAC/VDC → 5V/3A | ~2.5W @ 3A |
| LDO 3.3V/1A | 5V → 3.3V (CM3, MCU, logic) | ~0.3W |
| STM32G0B1 MCU | I/O processor — ADC, DAC, DI, relays | ~0.2W |
| ADS131M08 ADC | 8-ch universal input measurement | ~15mW |
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
| **NR-01** | LM2596 DC/DC switching | ~150kHz, square wave, dv/dt lớn | 2.5W | Conducted (power rail) + Radiated (inductor stray field) | UI analog input, ADC measurement, RS-485 | **H** | • 470µF low-ESR output cap<br>• GND plane L2<br>• Power routing ưu tiên L4<br>• Thermal vias under SOT-223 | **M** |
| **NR-02** | RK3566 CPU clock | 1.8GHz, 64MHz, 100MHz (RGMII) | 4W | Radiated (traces, B2B connector) | RS-485, UI analog, TFT SPI | **H** | • CM3 shielding (heatsink + bottom GND pour)<br>• GND plane L2<br>• Via stitching xung quanh CM3 | **M** |
| **NR-03** | SPI0 — CM3 → TFT (HMI) | 20–40MHz, 80mm trace | 3.3V CMOS | Radiated (traces) | RS-485 A/B, USB, UI | **M** | • Series R 33Ω trên CLK/MOSI<br>• GND return path L2<br>• Top-layer routing L1 | **L** |
| **NR-04** | SPI3 — MCU → ADS131M08 (ADC) | 4MHz, 50mm trace | 3.3V CMOS | Radiated + Conducted | ADC measurement accuracy | **M** | • Series R 33Ω trên CLK<br>• Cùng cụm PCB (MCU + ADC)<br>• GND plane L2 | **L** |
| **NR-05** | Ethernet RGMII | 25MHz ref clock, harmonics ≥250MHz | 1.8V/3.3V | Radiated (traces up to 100mm) | — (self-contained) | **M** | • Impedance 50Ω ±10%<br>• Length matching ±0.5mm<br>• Magnetics RJ-45 HR911105A (integrated CM choke)<br>• GND plane L2 liên tục | **L** |
| **NR-06** | Crystal 8MHz (MCU + CM3) | 8MHz fundamental + odd harmonics | ~10µW | Radiated (trace loop) | ADC, RTC, UI | **L** | • Load cap 12pF đúng spec<br>• GND guard ring quanh crystal<br>• Trace ngắn (<10mm) | **L** |
| **NR-07** | Crystal 4.096MHz (ADC) | 4.096MHz + harmonics | ~5µW | Radiated | ADC measurement | **L** | • GND guard ring<br>• Cùng cụm MCU | **L** |
| **NR-08** | Relay switching (×4 SPDT) | DC arc, ≤5A inductive | 250VAC/5A | Conducted (power line) + Radiated (arc) | All I/O, RS-485, power supply | **M** | • +5V_RELAY cách ly qua ferrite bead 600Ω<br>• Snubber RC (recommended)<br>• Copper clearance ≥3.2mm | **L** |
| **NR-09** | Bridge rectifier GBU4J | 50/60Hz AC ripple, diode switching noise | — | Conducted (DC rail) | UI analog, ADC | **M** | • TVS P6KE33A<br>• Bulk cap sau bridge<br>• LM2596 rejects line-frequency ripple | **L** |
| **NR-10** | 24VAC/VDC power input (external) | External conducted noise | — | Conducted (mains cable) | Entire system | **H** | • CM choke 3.5mH + Y-cap 10nF/1kV<br>• MOV SIOV-S14K275<br>• TVS P6KE33A + GBU4J<br>• Polyfuse F1 2A | **M** |

---

### 2.3 Đường/Vùng Nhạy (Sensitive Circuits)

| ID | Đường | Loại | Nguy cơ nhiễu chính | Mitigation |
|----|-------|------|-------------------|------------|
| **SC-01** | UI1–UI8 analog input | Analog — 0-10V / NTC / 4-20mA | NR-01, NR-02, NR-09 | • TVS SMAJ15A mỗi kênh<br>• Ferrite bead 600Ω + 100nF mỗi kênh<br>• R_fuse 100Ω series<br>• Star ground point |
| **SC-02** | ADS131M08 ADC measurement | Analog — ΔΣ ADC 24-bit | NR-01, NR-04 | • 4MHz SPI — trace ngắn (50mm)<br>• AVDD/DVDD bypass riêng (10µF+100nF)<br>• GND plane L2<br>• 8MHz crystal riêng (hoặc MCO) |
| **SC-03** | DI1–DI8 opto-isolated input | Digital 24VDC | NR-01, NR-08 | • Opto PC817 (galvanic isolation)<br>• TVS P6KE36A mỗi kênh<br>• D1 BAT85 clamping |
| **SC-04** | RS-485 A/B | Differential — Modbus RTU | NR-02, NR-03, NR-05 | • TVS SMAJ6.5A mỗi line<br>• Ferrite bead 600Ω@100MHz<br>• 120Ω matched pair<br>• Isolation gap ≥3mm |
| **SC-05** | DAC8554 AO output | Analog — 0-10V / 4-20mA | NR-01, NR-08 | • Boost +15V rail riêng (op-amp)<br>• Output filtering (RC)<br>• GND plane L2 |
| **SC-06** | USB-C / USB-A | High-speed digital | NR-02, NR-05 | • PRTR5V0U2X ESD array<br>• CC resistors 5.1kΩ (UFP)<br>• Differential pair routing |
| **SC-07** | TFT SPI0 (HMI) | Digital SPI 20-40MHz | NR-02 | • Series R 33Ω<br>• GND return path L2<br>• Top-layer routing |

---

## 3. Phân tích Chi tiết — Nguồn nhiễu chính

### 3.1 LM2596 DC/DC Converter (NR-01)

**Đặc tính nhiễu:**
- Tần số switching: ~150kHz (internal oscillator)
- dV/dt fast-switching edges → broadband noise đến vài MHz
- Stray magnetic field từ inductor (dòng đỉnh ~3A)

**Coupling path:**
- **Conducted:** Ripple trên VCC_5V rail → ảnh hưởng CM3, MCU, ADS131M08
- **Radiated:** Từ inductor và trace power → UI analog input (PCB top-left gần UI terminals)

**Mitigation:**
- Output cap 470µF low-ESR bypass switching ripple
- 4-layer PCB: power plane L3, GND plane L2
- Thermal vias + copper spread → giảm nhiệt → giảm EMI do thermal stress
- Layout: inductor xa connectors và analog circuit

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
| 4-layer PCB continuous GND | ✅ Đã thiết kế | L2 GND plane — CB_BLOCK_DIAGRAM.md §2 |
| Star ground point | ✅ Đã thiết kế | 1 điểm nối GND analog/digital gần power input — EMC_THERMAL_NOTES §2.1 |
| Decoupling capacitors | ✅ Đã thiết kế | 100nF sát mỗi VCC pin IC — CB_SCHEMATIC_NOTES §3, EMC_THERMAL_NOTES §2.3 |
| TVS all I/O ports | ✅ Đã thiết kế | SMAJ15A (UI), P6KE36A (DI), SMAJ6.5A (RS-485), PRTR5V0U2X (USB) — CB_SCHEMATIC_NOTES §5 |
| Ferrite beads RS-485 + Power | ✅ Đã thiết kế | 600Ω@100MHz — EMC_THERMAL_NOTES §2.4 |
| CM choke 24V input + Y-cap | ✅ Đã thiết kế | 3.5mH + 10nF/1kV — EMC_THERMAL_NOTES §2.4 |
| MOV + TVS surge protection | ✅ Đã thiết kế | MOV SIOV-S14K275 + TVS P6KE33A — EMC_THERMAL_NOTES §4 |
| Opto-isolation DI | ✅ Đã thiết kế | PC817 ×8 — CB_SCHEMATIC_NOTES §5 |
| RS-485 isolation | ✅ Đã thiết kế | ADUM1201 — EMC_THERMAL_NOTES §2.1 |
| ESD arrays USB/SD | ✅ Đã thiết kế | PRTR5V0U2X — CB_SCHEMATIC_NOTES §5 |
| Relay coil ferrite bead | ✅ Đã thiết kế | 600Ω cách ly +5V_RELAY — EMC_THERMAL_NOTES §2.3 |
| Clearance/creepage relay HV | ✅ Đã thiết kế | ≥3.2mm clearance, ≥4mm creepage — EMC_THERMAL_NOTES §4.5 |
| Series R SPI clocks | ✅ Đã thiết kế | 33Ω trên SPI0_CLK, SPI3_CLK, UART TX — CB_SCHEMATIC_NOTES §2.4, §3.1 |

---

## 5. Rủi ro Tồn đọng & Khuyến nghị

| ID | Rủi ro | Mức | Khuyến nghị |
|----|--------|-----|------------|
| **R-01** | CM3 module không có shield riêng (chỉ heatsink) | **M** | Nếu radiated emission fail → xem xét shield can hoặc chuyển vỏ nhôm (tăng shielding 10–20dB) |
| **R-02** | DC/DC inductor bức xạ gần UI terminals | **M** | Verify layout: inductor cách UI connector ≥10mm. Near-field probe pre-scan trước lab. |
| **R-03** | ESD air ±15kV (L4) — khe hở vỏ DIN-rail | **M** | Test ESD tại tất cả khe hở vỏ (khe tản nhiệt CM3, USB, RJ-45). Xem xét gasket nếu fail. |
| **R-04** | Relay không có RC snubber trong schematic | **L** | Thêm snubber RC (100Ω + 10nF) song song contact relay nếu quan sát nhiễu khi switching |
| **R-05** | Conducted emission 150kHz–500kHz từ DC/DC | **M** | Pre-compliance: LISN + spectrum analyzer. Đảm bảo input CM choke + Y-cap đủ. |
| **R-06** | SPI0 (20-40MHz) trace dài 80mm | **M** | Pre-scan near-field probe ở ~80mm. Đảm bảo series R 33Ω gần source. |

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
