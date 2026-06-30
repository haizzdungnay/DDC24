# HW BRINGUP TEST PROCEDURE

> **Document:** HW-TEST-01 | Rev 1.2 | Status: Draft | 2026-06-30
> **Sản phẩm:** MK-DDC-24 Hardware Bringup & Test
> **Phiên bản:** HW-TEST v1.2 | 2026-06-30
> **Trạng thái:** Draft for Review
> **Tổ chức:** MK-DDC Project — Hardware Team

---

## 1. Phạm vi & Mục tiêu

### 1.1 Phạm vi Test

Đ quy trình này bao gồm quá trình bring-up và test phần cứng cho board MK-DDC-24, bao gồm:
- Kiểm tra vật lý và lắp đặt
- Power-up sequence validation
- Basic MCU functionality test
- I/O subsystem validation
- Communication interface test
- Full system integration test

### 1.2 Yêu cầu Đầu vào

| Item | Description | Status |
|------|-------------|---------|
| MK-DDC-24 PCB | Fully assembled with all components | Required |
| Power supply | 24VAC/VDC, 2A min | Required |
| Test equipment | Oscilloscope, multimeter, logic analyzer | Required |
| Connection cables | USB-C, RS485, Ethernet | Required |
| Test loads | Resistors, potentiometers | Required |

---

## 2. Safety Precautions

### 2.1 Electrical Safety

- **ALWAYS** disconnect power before making connections
- Verify polarity before connecting 24V supply
- Use insulated tools when working with live circuits
- Keep fingers away from high voltage areas
- Wear ESD wrist strap when handling PCB

### 2.2 Equipment Safety

- Power supply voltage range: 24VAC/VDC ±10%
- Max current: 2A continuous
- No short circuits on output terminals
- Monitor temperature during operation

---

## 3. Hardware Bringup Procedure

### 3.1 Step 1: Visual Inspection

#### Checklist:
- [ ] No solder bridges or shorts on PCB
- [ ] All components properly soldered (no tombstoning)
- [ ] Correct polarity on electrolytic capacitors and diodes
- [ ] No missing components (cross-check with BOM)
- [ ] PCB dimensions match mechanical drawing
- [ ] No mechanical damage (cracks, bent pins)

#### Tools:
- Magnifying glass (10×)
- Good lighting
- Multimeter (continuity check)

---

### 3.2 Step 2: Power Supply Test

#### 3.2.1 24V Input Connection
1. Set multimeter to DC voltage mode (200V range)
2. Connect 24V power supply to terminal blocks
3. Verify input voltage: **23.5-26.5V DC**
4. Check polarity: RED(+) to VCC terminal, BLACK(-) to GND terminal

#### 3.2.2 5V Regulated Output
1. Verify the selected +5V converter and RefDes match the approved `PWR_DESIGN.md` evidence; do not power a board built from the rejected 3A legacy design.
2. Measure TP1 (`VCC_5V`) to TP3 (`GND`): **4.95-5.05V DC**
3. Check ripple with oscilloscope: **<50mVpp**
4. Verify no oscillations (>1MHz)

#### 3.2.3 3.3V MCU Supply
1. Verify the selected 3.3V switching regulator and RefDes match the approved power evidence; AMS1117 is not a released Rev A solution.
2. Measure voltage at STM32 VDD pins: **3.27-3.33V DC**
3. Check startup sequence: 24V→5V→3.3V (within 100ms)
4. Verify current draw: **<100mA idle**

---

### 3.3 Step 3: MCU Basic Functionality

#### 3.3.1 Power-on Reset
1. Connect USB-C to PC
2. Check MCU status LED (D5): **should blink 3 times**
3. Verify USB enumeration: **STM32 Virtual COM Port**
4. Check bootloader mode: **short press RESET button**
5. Before I/O tests, send IOP `CMD_HANDSHAKE` and record `IOP_VER_MAJOR.MINOR`, `MCU_FW_VERSION`, handshake status, and `BOARD_CAP_MAP`.
6. Pass only when IOP is 2.0-compatible and `BOARD_CAP_MAP` contains UI_16, AO_4, and DO_4 for the base Rev A SKU.

#### 3.3.2 Crystal Oscillator
1. Set oscilloscope to 10MHz/div, 1V/div
2. Measure Y1 (8MHz crystal): **8.0±0.1MHz**
3. Check Y3 (4.096MHz): **4.096±0.05MHz**
4. Verify stable frequency (no drift >1%)

#### 3.3.3 Serial Communication
1. Connect the IOP protocol test tool/logic analyzer to the MCU-CM3 UART path.
2. Set baud rate: **921600, 8N1**.
3. Send binary `CMD_HANDSHAKE` and verify `CMD_HANDSHAKE_RESP` LEN=8 with IOP version, MCU firmware version, status, and board capability map.
4. Send `CMD_GET_IO` and verify an 80-byte frame (header + 74-byte payload + CRC) within the 3ms response timeout.
5. Check signal integrity and the nominal 2ms GET_IO request cadence with oscilloscope/logic analyzer.

---

### 3.4 Step 4: I/O Subsystem Test

#### 3.4.1 Universal Input (UI) Channels

Use the dedicated UI test plan: [`HW-TEST-UI-16CH.md`](HW-TEST-UI-16CH.md).

**Rev A UI bring-up minimum:**

1. Confirm schematic/assembly matches `IO_UI_CIRCUIT.md` Rev 2.2 or later.
2. Confirm no terminal field net routes directly to TMUX/ADC.
3. Confirm all 16 shunts are **49.9R 0.1% 25ppm** where current mode is populated.
4. Confirm per-channel mode latch boots to safe/default state.
5. Run 0-10V checks at 0V, 2.5V, 5V, 10V on all 16 channels.
6. Run 4-20mA checks at 4mA, 12mA, 20mA, 22mA, 24mA on all 16 channels.
7. Run NTC resistor-simulation checks and Vexc compensation check.
8. Run auxiliary dry-contact open/closed/debounce checks.
9. Run controlled 24V miswire, short-GND, open-wire, ADC timeout, DRDY timeout, UART CRC fail, and sequence-gap tests per the dedicated plan.
10. Verify CM3 receives binary IOP frames with **16 x int32 signed raw ADC** values; no JSON or float payload is allowed.

Pass/fail details and calibration records are stored with the dedicated UI test report.

#### 3.4.2 Analog Output (AO) Channels

**Setup for AO Test:**
```
┌─────────────────────────────────┐
│           TEST SETUP             │
│                                 │
│  ┌─────────┐     ┌─────────┐    │
│  │ 10kΩ    │     │ 100kΩ   │
│  │ Load    │     │ Load    │
│  └─────────┘     └─────────┘    │
│       │               │           │
│  AO Channel ─────────┘           │
│                                 │
│  VCC (5V) ────────────┐          │
│                      │           │
│   GND ────────────────┘           │
└─────────────────────────────────┘
```

**Test Procedure:**
1. In 0-10V mode, command and measure **0, 2.5, 5.0, 7.5, and 10.0V** on every AO channel with the declared voltage-mode load.
2. In 4-20mA mode, command and measure **4, 8, 12, 16, 20, and 22mA** on every AO channel.
3. Repeat current-mode points at **0, 250, and 500 ohm** loop load; 600 ohm is not released.
4. Record raw command, measured output, error, +15V rail, settling time, and output-driver temperature at every point.
5. Apply provisional acceptance limits from the signed AO error budget; do not substitute the old blanket +/-5% criterion for a linearity result.

#### 3.4.3 Digital Output (DO) / Relay

**Setup for DO Test:**
```
┌─────────────────────────────────┐
│           TEST SETUP             │
│                                 │
│  ┌─────────┐     ┌─────────┐    │
│  │ LED     │     │ Relay   │
│  │ Test    │     │ Coil    │
│  └─────────┘     └─────────┘    │
│       │               │           │
│  DO Channel ─────────┘           │
│                                 │
│  VCC (5V) ────────────┐          │
│                      │           │
│   GND ────────────────┘           │
└─────────────────────────────────┘
```

**Test Procedure:**
1. Send command `DO:0:ON` → **LED ON, Relay CLICK**
2. Send command `DO:0:OFF` → **LED OFF, Relay RELEASE**
3. Test all 4 channels sequentially
4. Verify switching time: **<10ms**
5. Check contact resistance: **<100mΩ when ON**

---

### 3.5 Step 5: Communication Interface Test

#### 3.5.1 Ethernet
1. Connect Ethernet cable to PC
2. Set PC IP: 192.168.1.100/24
3. Verify link LED: **solid green**
4. Ping board: **<2ms response time**
5. Check MAC address: **matches SOM spec**

#### 3.5.2 RS-485
1. Connect RS-485 test equipment
2. Send Modbus RTU command `01 03 00 00 00 01 CRC`
3. Verify response length: **5 bytes**
4. Check signal integrity: **clean square wave**
5. Test termination: **120Ω resistor between A/B**

#### 3.5.3 USB Interfaces
1. Connect USB-C to PC
2. Check device enumeration: **recognized as serial port**
3. Check USB-A host port: **detects USB drive**
4. Verify data transfer: **>1MB/s**

---

### 3.6 Step 6: Full System Integration

#### 3.6.1 Concurrent I/O Test
1. All 16 UI channels active (simultaneous)
2. All 4 AO channels at different voltages
3. 2 DO channels switching at 1Hz
4. Ethernet streaming data
5. Measure power consumption: **<2A @24V**

#### 3.6.2 Thermal Test
1. Run full I/O load for 30 minutes
2. Monitor temperature with thermal camera
3. Check and record hot spots:
   - STM32 and both ADS131M08 devices
   - +5V, +3.3V, +1.8V, and +15V regulator/controller, switch/diode, and inductor
   - DAC8554, AO op-amp/output transistors at 500-ohm full-scale load
   - UI buffers/muxes, references, shunts, and terminal protection
   - ULN2003A, relay coils, relay-contact suppression parts, bridge, fuse, and input TVS/MOV
4. Verify no thermal shutdown

Acceptance temperatures come from the selected-part derating calculation and closure evidence, not a generic component-class limit.

#### 3.6.3 Environmental Stress Test
1. Vibration test: **5-500Hz, 0.5mm amplitude**
2. Temperature cycling: **-10°C to +50°C**
3. Power cycling: **100 cycles**
4. Verify no parameter drift

---

## 4. Test Results & Documentation

### 4.0 Test-point measurement map

| TP | Net/group | Instrument | Expected / use |
|---|---|---|---|
| TP1 | VCC_5V | DMM + scope | 4.95-5.05V, ripple/load-step capture |
| TP2 | VCC_3V3 | DMM + scope | 3.27-3.33V, transient capture |
| TP3 | GND | Probe ground | Primary low-voltage reference |
| TP4 | UART0_TX | Logic analyzer | Debug UART |
| TP5 | UART2_TX | Logic analyzer/scope | IOP 921600 8N1, 2ms request cadence |
| TP6 | SPI3_CLK | Scope/logic analyzer | Both ADS transactions inside 1ms acquisition budget |
| TP7-TP8 | RS485_A/B | Differential probe | Idle bias, termination, waveform and EMC recovery |
| TP9 | MCU_nRESET | Scope | Startup/reset timing |
| TP10-TP25 | UI1-UI16 field | DMM/calibrator | Applied field stimulus |
| TP26-TP41 | UI1-UI16 ADC node | DMM/scope | Protected low-voltage conditioned node |
| TP42-TP45 | UI mode latch bus | Logic analyzer | DATA/CLK/LATCH/OE and safe reset state |
| TP46-TP49 | AO1-AO4 output | DMM/current calibrator | AO linearity/compliance sweep |
| TP50-TP53 | DO1-DO4 drive | Scope | Driver timing and relay actuation; logic-side only |

### 4.1 Test Report Format

```
MK-DDC-24 HW BRINGUP REPORT
===========================
Board ID: [Serial Number]
Test Date: [Date]
Test Engineer: [Name]

Summary: PASS/FAIL
Failed Tests: [List]
Recommendations: [List]

Detailed Results:
├── Power Supply Test: PASS
├── MCU Functionality: PASS
├── I/O Subsystem: PASS
├── Communication: PASS
└── Integration: PASS
```

### 4.2 Certification Criteria

A board passes bringup if:
- All visual inspection items pass
- Power supply voltages within ±1%
- All I/O channels functional (±5% accuracy)
- Communication interfaces operational
- Thermal limits not exceeded
- No failed tests

---

## 5. Troubleshooting Guide

### 5.1 Common Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| No power at 5V output | Bad LDO regulator | Check input voltage, replace U10 |
| MCU not responding | Bad crystal or power | Check Y1/Y3, measure 3.3V supply |
| ADC readings erratic | Noise on analog inputs | Check grounding, add bypass caps |
| Relay not clicking | Low coil voltage | Measure DO output voltage |
| USB not recognized | Bad USB connector | Check continuity, replace if needed |

### 5.2 Debug Equipment

- Oscilloscope: 100MHz, 4 channels
- Multimeter: True RMS, auto-ranging
- Logic analyzer: 100MHz SPI capture
- Current probe: 0-10A range
- Thermal camera: ±2°C accuracy

---

## 6. Safety & Maintenance

### 6.1 Post-Test Procedures

1. Disconnect all power supplies
2. Clean PCB with isopropyl alcohol
3. Apply conformal coating (if required)
4. Update serial number in database
5. Store test data in repository

### 6.2 Documentation Required

- Bringup report with signature
- Test data files (scope captures, readings)
- Calibration certificate if applicable
- Photos of successful test setup
- Updated firmware version

---

## 7. References

| Document | Version | Description |
|----------|---------|-------------|
| BOM_MK-DDC-24_v1.md | v1.2 | Board-level Bill of Materials |
| BOM-UI-16CH.md | v1.0 | Universal Input 16CH BOM |
| MCU_STM32G0_SPEC.md | v1.4 | MCU specifications and UI mode latch pinmap |
| IO_UI_CIRCUIT.md | v2.2 | Universal Input Rev A architecture |
| HW-TEST-UI-16CH.md | v1.0 | Dedicated UI 16CH test plan |
| IOP_PROTOCOL.md | v2.1 | IOP v2 frame, timing, and command contract |
| FW-ADC-SAMPLING.md | v1.1 | Firmware ADC sampling sequence |
| IO_AO_CIRCUIT.md | v1.3 | Analog Output circuit |
| IO_DO_RELAY.md | v1.3 | Digital Output circuit |

---

## Lịch sử Revision

| Ngày | Rev | Thay đổi |
|------|-----|---------|
| 2026-06-23 | v1.1 | Final rev bump Phase 1-2: Updated test procedure for 16ch UI, added ADC #2 validation |
| 2026-06-23 | v1.0 | Khởi tạo — quy trình bring-up và test MK-DDC-24 |
| 2026-06-30 | v1.2 | Added IOP/FW version gate, TP map, AO linearity/compliance sweep, and expanded thermal coverage |

---

_Document ID: HW-TEST-01 | Rev 1.2 | 2026-06-30_
