# EMC Test Plan — MK-DDC-24 (QCVN 9:2012 / IEC 61326-1)

> **Document ID:** CR-QCVN-D2-EMC-TESTPLAN | Rev 1.2 | 2026-06-05  
> **Dự án:** MK-DDC-24 — BACnet IoT Controller  
> **Tiêu chuẩn áp dụng:** QCVN 9:2012 / IEC 61326-1:2020 (Industrial — Class A)  
> **Phòng thử nghiệm:** TBD (TUV / Intertek / VN Lab)  
> **Dự kiến test:** Q3/Y8

---

## 1. Product Information

| Thông số | Giá trị |
|----------|---------|
| **Product name** | MK-DDC-24 BACnet IoT Controller |
| **Model number** | MK-DDC-24 v1.x |
| **Power supply** | 24VAC/VDC ±20%, 2A max (via terminal block 2-pin) |
| **Power consumption** | ~8W typical, ~15W max (all DO active) |
| **Operating environment** | Indoor, Pollution Degree 2, Installation Category II |
| **Enclosure** | DIN-rail ABS V0 (tùy chọn nhôm) |
| **Ports** | See §2 Port Mapping |
| **Classification** | IEC 61326-1: Industrial (Class A) |

---

## 2. Port Mapping

| Port | Loại | Số lượng | Cable length | Vị trí test |
|------|------|---------|-------------|------------|
| **Enclosure** | Cabinet | 1 | N/A | Mặt trước, mặt sau, khe hở |
| **AC/DC Power Input** | Power | 1 (2-pin terminal) | ≤3m (unshielded) | Power port |
| **RS-485 A/B** | Signal — I/O | 1 (3-pin terminal) | ≤10m (unshielded) | Signal/control port |
| **Ethernet RJ-45** | Signal — network | 1 | ≤30m (STP) | Signal port |
| **UI1–UI16** | Signal — input | 16 (terminal block) | ≤10m (unshielded) | Signal/control port |
| **Optional DI1–DI8** | Signal — input | Optional SKU/module only | ≤10m (unshielded) | Exclude from base-SKU test; separate configuration when populated |
| **AO1–AO4** | Signal — output | 4 (terminal block) | ≤10m (unshielded) | Signal/control port |
| **DO1–DO4 (Relay)** | Signal — output | 4 (terminal block) | ≤10m (unshielded) | Signal/control port |
| **USB-C** | Service port | 1 | ≤1m (shielded) | Signal port |
| **USB-A** | Service port | 1 | ≤1m (shielded) | Signal port |
| **Debug UART (USB-C)** | Service port | 1 | ≤1m (shielded) | Signal port |
| **microSD** | Service port | 1 | N/A | Enclosure |

---

## 3. Emission Tests (CISPR 11 / EN 55011)

### 3.1 Radiated Emission

| Tham số | Giá trị |
|---------|---------|
| **Standard** | CISPR 11 (EN 55011) — Group 1, Class A |
| **Frequency range** | 30 MHz – 1 GHz (radiated) |
| **Test site** | 3m semi-anechoic chamber (SAC) hoặc 10m OATS |
| **Limit (30–230 MHz)** | 40 dBµV/m (quasi-peak) @ 10m OR 50 dBµV/m (quasi-peak) @ 3m |
| **Limit (230–1000 MHz)** | 47 dBµV/m (quasi-peak) @ 10m OR 57 dBµV/m (quasi-peak) @ 3m |
| **Distance correction** | +10.5 dB applied from 10m → 3m (inverse distance, 20·log₁₀(10/3)) |
| **Measurement** | Quasi-peak detector (CISPR 16-1-1) |
| **Antenna** | Biconical (30–300 MHz), Log-periodic (300–1000 MHz) |
| **Antenna height** | 1–4m scan |
| **Turntable** | 0–360°, both polarizations |
| **Dwell time** | ≥15s per frequency (quasi-peak) |
| **Step size** | ≤1% of fundamental / CISPR recommendation |

#### Test Setup
```
┌──────────────────┐      ┌──────────────────┐
│   MK-DDC-24      │      │   Antenna        │
│   (EUT)          │──────│   (1–4m)         │──── Receiver
│   DIN-rail       │  3m  └──────────────────┘
│   mounted        │
└──────────────────┘
     │
   Power Supply 24VDC (battery or linear — avoid SMPS conducted noise)
```

#### EUT Configuration
- Power: 24VDC from linear PSU or battery (để tránh nhiễu từ nguồn SMPS)
- Load: All I/O active — UI loop test via signal generator, DI driven by 24VDC, DO relay connected to resistive load 1A
- Communication: BACnet/IP active (Ethernet connected)
- TFT HMI: active, displaying default screen
- RS-485: terminated with 120Ω
- Cable: All I/O cables arranged per CISPR 11 typical configuration (cable bundle centralized)

#### Pre-scan (before lab)
- Near-field probe scan: clock harmonics (8MHz, 64MHz, 100MHz, 4.096MHz)
- Spectrum analyzer + LISN: conducted emission pre-check
- Ambient noise survey (nếu test ở site không phải chamber)

---

### 3.2 Conducted Emission (AC Mains Port)

> **Lưu ý:** MK-DDC-24 dùng 24VAC/VDC input (low voltage). Theo CISPR 11, conducted emission áp dụng cho AC mains ports (≥230VAC). Nếu lab yêu cầu conducted test do power input dài >3m, test theo limits dưới đây.

| Tham số | Giá trị |
|---------|---------|
| **Standard** | CISPR 11 (EN 55011) — Group 1, Class A |
| **Frequency range** | 150 kHz – 30 MHz |
| **Limit (150–500 kHz)** | 79 dBµV (QP) / 66 dBµV (AV) |
| **Limit (500 kHz–30 MHz)** | 73 dBµV (QP) / 60 dBµV (AV) |
| **Detection** | Quasi-peak + Average |
| **Network** | LISN (50Ω / 50µH) |

#### Test Setup
```
Mains  ─── LISN ─── MK-DDC-24 (24VAC via isolation transformer)
                  │
               Receiver
```

---

## 4. Immunity Tests

### 4.1 Electrostatic Discharge — IEC 61000-4-2

| Tham số | Giá trị |
|---------|---------|
| **Performance criterion** | **Criterion A** — no degradation during test |
| **Test level** | Level 4 |
| **Contact discharge** | ±8 kV (all accessible conductive parts) |
| **Air discharge** | ±15 kV (all insulating surfaces, gaps) |
| **Discharge interval** | 1s between discharges |
| **Polarity** | Both positive and negative |
| **Number of discharges** | 10 per test point |
| **ESD gun** | 150pF / 330Ω discharge network |

#### Test Points (Contact)

| Point | Location | Discharge | Expected behavior |
|-------|----------|-----------|-------------------|
| TP-C01 | USB-C connector shield | ±8kV | No disturbance |
| TP-C02 | USB-A connector shield | ±8kV | No disturbance |
| TP-C03 | RJ-45 Ethernet shield | ±8kV | No disturbance |
| TP-C04 | RS-485 terminal GND | ±8kV | No disturbance |
| TP-C05 | Debug UART USB-C shield | ±8kV | No disturbance |
| TP-C06 | DIN-rail mounting clip | ±8kV | No disturbance |
| TP-C07 | Screw terminal mounting points | ±8kV | No disturbance |

#### Test Points (Air)

| Point | Location | Discharge | Expected behavior |
|-------|----------|-----------|-------------------|
| TP-A01 | USB-C connector body | ±15kV | No upset |
| TP-A02 | USB-A connector body | ±15kV | No upset |
| TP-A03 | RJ-45 connector body | ±15kV | No upset |
| TP-A04 | RS-485 terminal insulation | ±15kV | No upset |
| TP-A05 | microSD slot | ±15kV | No upset |
| TP-A06 | TFT display bezel | ±15kV | No disturbance |
| TP-A07 | Enclosure ventilation slots | ±15kV | No disturbance |
| TP-A08 | Power terminal insulation | ±15kV | No upset |
| TP-A09 | All I/O terminal insulation | ±15kV | No upset |
| TP-A10 | Screw gaps, plastic seams | ±15kV | No upset |

#### Protection elements to verify before execution
- Final UI, optional-DI, RS-485 and USB protection parts against clamp/leakage/pulse limits
- Final Ethernet magnetics/shield termination
- Final chassis/functional-earth capacitor only if safety classification and grounding review approve it

---

### 4.2 Radiated RF Immunity — IEC 61000-4-3

| Tham số | Giá trị |
|---------|---------|
| **Performance criterion** | **Criterion A** — no degradation during test |
| **Test level** | Level 3 |
| **Field strength** | 10 V/m (unmodulated) |
| **Modulation** | 80% AM @ 1 kHz |
| **Frequency range** | 80 MHz – 1 GHz (extended: 1–6 GHz nếu lab yêu cầu) |
| **Step size** | 1% of fundamental frequency |
| **Dwell time** | ≥3s per frequency |
| **Antenna** | Broadband (bilog, horn) |
| **Distance** | 3m |
| **Antenna polarization** | Both vertical and horizontal |
| **Test positions** | Front, rear, left, right (4 faces) |

#### Test Setup
```
┌──────────────────┐      ┌──────────────────┐
│   MK-DDC-24      │      │   Antenna        │
│   (EUT)          │──────│   (1–4m)         │──── Generator
│   DIN-rail       │  3m  └──────────────────┘
│   mounted        │
└──────────────────┘
     │
   Monitoring PC (outside chamber)
```

#### Monitoring during test
- BACnet/IP communication: continuous polling (read AI values, DI states)
- HMI display: verify no flicker, no garbled text
- UI input: signal generator → ADC readback, monitor drift
- AO output: measure output voltage drift (≤2% of range)
- DO relay: verify no chatter (monitor contact via external pull-up)
- RS-485: continuous loopback traffic

---

### 4.3 Electrical Fast Transient / Burst — IEC 61000-4-4

| Tham số | Giá trị |
|---------|---------|
| **Performance criterion** | **Criterion A** (power port) / **Criterion B** (signal ports) |
| **Test level** | Level 3 |
| **Voltage** | ±2 kV |
| **Rise time** | 5 ns |
| **Pulse width** | 50 ns |
| **Burst duration** | 15 ms |
| **Burst period** | 300 ms |
| **Test duration** | ≥60s per coupling |

#### Ports & Coupling

| Port | Coupling method | Level | Criterion |
|------|----------------|-------|-----------|
| 24VAC/VDC power input | Coupling/decoupling network (CDN) | ±2kV | A |
| RS-485 A/B | Capacitive clamp | ±2kV | B |
| UI1–UI16 | Capacitive clamp | ±2kV | B |
| Optional DI1–DI8 | Capacitive clamp | ±2kV | B; optional-SKU test only |
| AO1–AO4 | Capacitive clamp | ±2kV | B |
| Ethernet RJ-45 | Capacitive clamp | ±2kV | B |

#### Protection elements to verify
- Final input choke/capacitor network after schematic freeze
- Final coordinated TVS/MOV devices on all applicable ports
- Ferrite/filter implementation on RS-485 and UI
- Optional-DI isolation/protection only when testing the populated optional SKU
- ADUM1201 isolation (RS-485)
- Magnetics common-mode rejection (Ethernet)

---

### 4.4 Surge Immunity — IEC 61000-4-5

| Tham số | Giá trị |
|---------|---------|
| **Performance criterion** | **Criterion B** — temporary degradation allowed, self-recovery |
| **Test level** | Level 3 |
| **Waveform** | 1.2/50 µs (voltage), 8/20 µs (current) |
| **Voltage** | ±2 kV (line-to-line), ±4 kV (line-to-earth) |
| **Polarity** | Both positive and negative |
| **Phase** | 0°, 90°, 180°, 270° (AC) |
| **Number of surges** | 5 per condition |
| **Interval** | ≥60s between surges |

#### Ports & Coupling

| Port | Coupling | Level L-L | Level L-PE | Generator source |
|------|----------|-----------|------------|-----------------|
| 24VAC/VDC power input | CDN | 2kV | 4kV | 2Ω (L-L), 12Ω (L-PE) |
| RS-485 A/B | GDT + TVS | 2kV | N/A | 42Ω |
| UI1–UI16 | Final per-channel protection | 1kV target | N/A | 42Ω |
| Optional DI1–DI8 | Final protection + isolation | 1kV target | N/A | 42Ω; optional-SKU test only |

#### Protection elements to verify
- Input MOV/TVS/fuse/bridge selection and coordination are not frozen.
- RS-485 GDT/TVS/filter selection must coordinate with the final transceiver and target pulse.
- TVS per I/O channel
- Galvanic isolation (DI opto, RS-485 ADUM1201)

---

### 4.5 Conducted RF Immunity — IEC 61000-4-6

| Tham số | Giá trị |
|---------|---------|
| **Performance criterion** | **Criterion A** — no degradation during test |
| **Test level** | Level 3 |
| **Voltage** | 10 Vrms (150 kHz – 80 MHz) |
| **Modulation** | 80% AM @ 1 kHz |
| **Step size** | 1% of fundamental |
| **Dwell time** | ≥3s per frequency |

#### Ports & Injection Method

| Port | Injection method | Level | Criterion |
|------|-----------------|-------|-----------|
| 24VAC/VDC power input | EMN (CDN-M1) | 10 Vrms | A |
| RS-485 A/B | EMN (CDN-M2) | 10 Vrms | A |
| UI1–UI16 | EMN (CDN-M2) or current clamp | 10 Vrms | A |
| Optional DI1–DI8 | EMN (CDN-M2) | 10 Vrms | A; optional-SKU test only |
| AO1–AO4 | EMN (CDN-M2) | 10 Vrms | A |
| Ethernet RJ-45 | EMN (CDN-M3) | 10 Vrms | A |

#### Monitoring
Same as IEC 61000-4-3 (§4.2). Focus on:
- ADC reading accuracy (UI)
- AO output voltage stability
- BACnet/IP communication integrity
- RS-485 communication errors

---

### 4.6 Power Frequency Magnetic Field Immunity — IEC 61000-4-8

| Tham số | Giá trị |
|---------|---------|
| **Performance criterion** | **Criterion A** — no degradation during test |
| **Test level** | Level 4 |
| **Field strength** | 30 A/m (continuous) |
| **Frequency** | 50 Hz and 60 Hz |
| **Duration** | ≥1 min per orientation |
| **Induction coil** | Standard 1m × 1m square coil |
| **Test orientations** | X, Y, Z (EUT centered in coil) |

#### Test Setup
```
┌─────────────────────────────────────┐
│    1m × 1m induction coil           │
│  ┌──────────────────────────┐      │
│  │     MK-DDC-24 (EUT)      │      │──── Power supply
│  │     centered in coil      │      │
│  └──────────────────────────┘      │
└─────────────────────────────────────┘
          │
     Magnetic field generator (50/60 Hz)
```

#### Monitoring
- BACnet/IP communication: verify no interruption
- I/O reading: verify no false triggering on DI, no ADC drift >2%
- DO relay: verify no chatter
- HMI: verify no flicker, no display corruption

---

## 5. Acceptance Criteria

| Test | Standard | Performance Criterion | Pass Definition |
|------|----------|---------------------|----------------|
| Radiated Emission | CISPR 11 Class A | N/A | All frequencies below limit with ≥2dB margin |
| Conducted Emission | CISPR 11 Class A | N/A | All frequencies below limit with ≥2dB margin |
| ESD (IEC 61000-4-2) | IEC 61326-1 | **A** | No loss of function, no reset, no data corruption |
| Radiated RF (IEC 61000-4-3) | IEC 61326-1 | **A** | Measurement error ≤2% of range, no communication loss |
| EFT (IEC 61000-4-4) | IEC 61326-1 | **A** (power), **B** (signal) | Power: no degradation. Signal: self-recovery after burst |
| Surge (IEC 61000-4-5) | IEC 61326-1 | **B** | Temporary degradation allowed, auto-recovery within 30s |
| Conducted RF (IEC 61000-4-6) | IEC 61326-1 | **A** | Measurement error ≤2% of range, no communication loss |
| Power freq. magnetic field (IEC 61000-4-8) | IEC 61326-1 | **A** | No degradation, no false triggering on DI, ADC drift ≤2% |

---

## 6. Test Sequence

To minimize test time and EUT stress, execute in the following order:

| Step | Test | Duration (est.) | Notes |
|------|------|----------------|-------|
| 1 | Visual inspection & functional test | 0.5 day | Verify all I/O, communication, HMI |
| 2 | Radiated emission | 1.0 day | Pre-scan + full measurement |
| 3 | Conducted emission | 0.5 day | Only if required by lab |
| 4 | ESD (IEC 61000-4-2) | 0.5 day | Contact + air on all test points |
| 5 | Radiated RF (IEC 61000-4-3) | 1.0 day | 4 faces, 2 polarizations |
| 6 | EFT (IEC 61000-4-4) | 0.5 day | All ports |
| 7 | Surge (IEC 61000-4-5) | 0.5 day | Power + signal ports |
| 8 | Conducted RF (IEC 61000-4-6) | 1.0 day | All ports |
| 9 | Power freq. magnetic field (IEC 61000-4-8) | 0.5 day | 3 orientations (X, Y, Z) at 50/60 Hz |
| 10 | Final functional test | 0.5 day | Repeat step 1 to verify no latent damage |
| | **Total** | **~6.5 days** | |

---

## 7. Test Equipment List

| Equipment | Specification | Purpose |
|-----------|--------------|---------|
| EMI Receiver | CISPR 16-1-1 compliant, 9kHz–1GHz | Radiated/conducted emission |
| LISN | 50Ω/50µH, CISPR 16-1-2 | Conducted emission |
| Bilog antenna | 30 MHz – 1 GHz | Radiated emission / RF immunity |
| Horn antenna | 1–6 GHz (extended) | Radiated RF immunity |
| ESD gun | IEC 61000-4-2 compliant, 150pF/330Ω | ESD test |
| EFT generator | IEC 61000-4-4 compliant, 5/50ns | EFT test |
| Surge generator | IEC 61000-4-5 compliant, 1.2/50µs | Surge test |
| RF generator + amp | 150kHz–1GHz, 10V/m field capability | RF immunity |
| CDNs | M1 (power), M2 (signal), M3 (network) | Conducted RF, surge, EFT coupling |
| Capacitive clamp | IEC 61000-4-4 | EFT coupling |
| Signal generator | 4-20mA / 0-10V / NTC simulator | UI stimulus |
| DC load | 0–5A resistive | DO relay load |
| Induction coil | 1m × 1m, IEC 61000-4-8 compliant | Power frequency magnetic field |
| Magnetic field generator | 50/60 Hz, adjustable to 30 A/m | Power frequency magnetic field |
| Monitor PC | BACnet/IP client + serial console | Functional monitoring |

---

## 8. EUT Configuration for All Tests

### 8.1 Power
- 24VDC ±5% (linear PSU for emission; isolation transformer for immunity)
- Cables: ≤3m, bundled per CISPR 11 typical arrangement

### 8.2 I/O Loading

| Port | Load/Stimulus |
|------|--------------|
| UI1–UI4 | 4-20mA loop from signal generator |
| UI5–UI6 | 0-10VDC from signal generator |
| UI7–UI8 | NTC thermistor simulator (10kΩ @ 25°C) |
| DI1–DI4 | 24VDC from PSU (ON) |
| DI5–DI8 | Open (OFF) |
| AO1–AO2 | 500Ω load (4-20mA mode) |
| AO3–AO4 | 10kΩ load (0-10V mode) |
| DO1–DO2 | Resistive load 1A |
| DO3–DO4 | No load |
| RS-485 | 120Ω termination + Modbus RTU traffic |
| Ethernet | Connected to monitor PC (BACnet/IP) |
| HMI TFT | Active, cycling display |
| USB-C | Connected to debug console |
| USB-A | Connected to flash drive |

### 8.3 Software State
- Debian 12 + PREEMPT_RT (production image)
- Kinexus BACnet agent running (BACnet/IP server)
- I/O scan active: all UI/DI/AO/DO updating at 1s interval
- BACnet COV subscriptions active
- HMI display UI values (cycling page)

### 8.4 Thermal Conditions
- Ambient temperature: 23°C ±5°C (per IEC 61326-1 standard conditions)
- EUT in steady-state thermal equilibrium before each test (≥30 min powered)
- Power dissipation: ~8W typical, ~15W max (all DO active)
- If internal temperature exceeds 40°C during immunity tests, record deviation in report
- EMC thermal notes consistent with CR-QCVN-C1 safety risk assessment: operating temperature range –10°C to +60°C (ambient), full I/O loading to maximize thermal stress during emission measurements

---

## 9. Pre-compliance Checklist (Before Lab)

| # | Item | Done | Notes |
|---|------|------|-------|
| 1 | Near-field probe scan — clock harmonics | ☐ | 8MHz, 64MHz, 100MHz, 4.096MHz |
| 2 | Near-field probe scan — final DC/DC converters | ☐ | +5V/+3.3V/+15V switch loops and magnetics |
| 3 | Near-field probe scan — MIPI DSI/display path | ☐ | CM3 → TFT connector/traces |
| 4 | ESD gun pre-test (4kV contact on all ports) | ☐ | Verify TVS functionality |
| 5 | Verify all approved TVS/MOV/ESD arrays soldered | ☐ | Frozen BOM + visual inspection |
| 6 | Verify approved chassis/functional-earth capacitor if populated | ☐ | Safety class/value/placement per final grounding review |
| 7 | Verify final RS-485 and input filter parts | ☐ | Frozen BOM and layout |
| 8 | Verify final power-input common-mode filter | ☐ | Selected value/part, not legacy assumption |
| 9 | Verify decoupling caps on all IC VCC pins | ☐ | 100nF <2mm from each pin |
| 10 | Verify GND continuity (L2) — no slots | ☐ | Visual + multimeter |
| 11 | Verify relay HV clearance ≥3.2mm | ☐ | Creepage ≥4mm |
| 12 | Functional test full I/O (all channels) | ☐ | Baseline before EMC test |
| 13 | RS-485 termination 120Ω | ☐ | Verify termination resistor |
| 14 | DIN-rail mounting clip ground connection | ☐ | Verify low-impedance to chassis GND |

---

## 10. Deliverables

| # | Deliverable | Format | Mô tả |
|---|-------------|--------|-------|
| 1 | EMC Test Report | PDF | Full test report from test lab |
| 2 | Test Data Sheets | PDF/CSV | Raw measurement data per test |
| 3 | Photographs | JPEG | EUT setup photos (all test configurations) |
| 4 | Certificate of Conformity | PDF | QCVN 9:2012 / IEC 61326-1 |
| 5 | Deviations Report | PDF | Nếu có fail, report deviations + corrective action |
| 6 | Labelled EUT | Photo | Product label + certification mark |

---

## 11. Dự toán Ngân sách (ước tính)

| Hạng mục | Chi phí (USD) | Ghi chú |
|---------|:------------:|---------|
| Radiated emission (full) | $1,200–$1,800 | 1 day chamber + engineer |
| Conducted emission | $400–$600 | 0.5 day (if required) |
| ESD (IEC 61000-4-2) | $600–$900 | 0.5 day |
| Radiated RF (IEC 61000-4-3) | $1,500–$2,200 | 1 day, 4 faces |
| EFT (IEC 61000-4-4) | $600–$900 | 0.5 day |
| Surge (IEC 61000-4-5) | $600–$900 | 0.5 day |
| Conducted RF (IEC 61000-4-6) | $1,200–$1,800 | 1 day, all ports |
| Power freq. magnetic field (IEC 61000-4-8) | $300–$500 | 0.5 day, 3 orientations |
| Report & certification | $500–$800 | — |
| **Total** | **$6,900–$10,400** | Phụ thuộc lab và số ngày |
| Pre-compliance (near-field, ESD pre-scan) | $0–$500 | In-house nếu có equipment |

---

**Document ID:** CR-QCVN-D2-EMC-TESTPLAN | Rev 1.2 | 2026-06-05  
**Next actions:**
- [ ] Pre-compliance scan (near-field probe, ESD pre-test)
- [ ] Chọn lab (TUV / Intertek / VN Lab)
- [ ] Đặt lịch test Q3/Y8
- [ ] Cập nhật risk assessment sau pre-compliance
