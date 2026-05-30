# Power Supply Design — MK-DDC-24 Carrier Board

> **Document:** HW-DES-04-PWR | Rev 1.0 | 2026-05-27

---

## 1. Tổng quan

Nguồn đầu vào duy nhất: **24 VAC hoặc 24 VDC ±20%** (19.2V – 28.8V).  
Carrier board tự tạo tất cả các rail nội bộ từ nguồn này.

---

## 2. Power Rails Yêu cầu

| Rail | Điện áp | Dòng max | Tải chính |
|------|:-------:|:--------:|---------|
| **+5V** | 5.0V ±2% | 3.0A | Radxa CM3 (2.5A), RS-485, logic |
| **+3.3V** | 3.3V ±1% | 1.0A | MCU STM32, ADS131M08, DI opto ref, DIP SW |
| **+1.8V** | 1.8V ±1% | 200mA | ADS131M08 DVDD, spare |
| **+15V** | 15V ±2% | 200mA | AO op-amp rail (dùng 4 AO op-amp TLV4110) |
| **+5V_RELAY** | 5.0V ±5% | 400mA | Relay coil ×4 (100mA/relay) |

> **Ghi chú:** CM3 tự tạo 1.8V, 1.1V, 0.9V nội bộ từ PMIC. Carrier chỉ cần cấp 5V.

---

## 3. Stage 1 — Input Protection & Rectification

### 3.1 Input (24VAC/VDC ±20%)

```
24VAC/VDC ──[Polyfuse F1 2A]──[Bridge GBU4J]──[TVS P6KE33A]──┬── DC_RAW
                                                               │
                                                           [C1 2200µF/50V]
                                                               │
                                                              GND
```

| Linh kiện | Giá trị / Model | Chức năng |
|-----------|----------------|---------|
| **F1** | Polyfuse 2A, 60V (MF-R200) | Bảo vệ ngắn mạch, self-reset |
| **Bridge rectifier** | GBU4J (4A, 600V) | Đổi AC → DC; DC bypass qua diode |
| **TVS** | P6KE33A (33V clamp) | Bảo vệ surge ±600W |
| **C1** | 2200µF / 50V, electrolytic | Bulk cap, giảm ripple sau rectifier |
| **C2** | 100nF / 63V, X7R | HF bypass |

**DC_RAW:** 28–32V đỉnh (từ 24VAC) hoặc 19.2–28.8V (từ 24VDC).  
**Voltage range vào DC/DC Stage 2:** 19–33V.

---

## 4. Stage 2 — DC/DC: Tạo +5V/3A

**IC:** LM2596HVS-5.0 (Step-down, 5V fixed, 3A, 150kHz, input max 45V)  
hoặc alternative: **MPQ8636** (synchronous, hiệu suất cao hơn)

```
DC_RAW ──[L1 100µH]──[LM2596HVS]──[D_catch SS34]──+5V
             │              │                │
         [C3 100nF]    [Rsense]          [C4 470µF + C5 100nF]
```

| Linh kiện | Giá trị | Ghi chú |
|-----------|---------|---------|
| **IC** | LM2596HVS-5.0 | SOT-223, fixed 5V output |
| **L1** | 100µH, 3A, DCR ≤ 0.15Ω | Inductor ferrite shielded |
| **D_catch** | SS34 (Schottky, 3A 40V) | Freewheeling diode |
| **C3** | 100nF X7R | Input HF bypass |
| **C4** | 470µF / 16V | Output filter (low ESR) |
| **C5** | 100nF X7R | Output HF bypass |
| **C_in** | 470µF / 50V | Thêm vào input LM2596 |

**Hiệu suất:** ~80% @ 2A → dissipation ≈ 2.5W (cần thermal pad trên PCB)  
**Ripple output:** < 50mVpp @ 3A

---

## 5. Stage 3 — LDO: Tạo +3.3V/1A và +1.8V

### 5.1 +3.3V từ +5V

**IC:** AMS1117-3.3 (LDO, 1A, dropout 1.3V @ 1A)  
Hoặc: **AP2114H-3.3** (LDO, 1A, quiescent 55µA, ổn định hơn)

```
+5V ──[AMS1117-3.3]── +3.3V
           │
       [C6 10µF + C7 100nF]
```

| Tham số | Giá trị |
|---------|---------|
| Dropout | 1.3V @ 1A (5V – 1.3V = 3.7V > 3.3V ✅) |
| Dissipation max | (5 – 3.3) × 1A = 1.7W → cần thermal via |
| Packages | SOT-223 với thermal pad |

### 5.2 +1.8V từ +3.3V

**IC:** XC6206P182 (LDO, 200mA, dropout 250mV)

---

## 6. Stage 4 — Boost +15V (dành cho AO op-amp)

**IC:** MT3608 hoặc SX1308 (Boost converter, input 2–24V, output đến 28V, 2A)

```
+5V ──[SX1308]──[D_boost SS24]── +15V
          │                         │
      [L_boost 22µH]           [C_out 100µF/25V]
```

| Thông số | Giá trị |
|---------|---------|
| **Input** | 5V |
| **Output** | 15V ±2% |
| **Dòng** | 200mA (4 kênh AO, mỗi kênh ~40mA op-amp) |
| **Ripple** | < 30mVpp |

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
              ├─► +3.3V (LDO, < 1ms sau +5V)
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

| Tải | Điện áp | Dòng điển hình | Dòng max |
|-----|:-------:|:--------------:|:--------:|
| Radxa CM3 (idle) | 5V | 800mA | 2.5A (full load) |
| STM32G0B1 | 3.3V | 20mA | 50mA |
| ADS131M08 | 3.3V | 30mA | 50mA |
| RS-485 MAX13487E | 3.3V | 20mA | 50mA |
| DI Optocoupler ×8 | 3.3V | 80mA (10mA/kênh) | 80mA |
| LED ×4 | 3.3V | 20mA (5mA/LED) | 20mA |
| AO op-amp ×4 | 15V | 40mA | 80mA |
| Relay coil ×4 | 5V | 320mA (80mA/relay) | 400mA |
| **Tổng** | — | **~1.4A ×5V + ~0.25A×15V** | **~4.5W điển hình** |
| **Nguồn cung cấp** | 24V input | **~250mA** | **375mA @ 80% eff** |

**Nguồn 24VAC/VDC 30W** là đủ cho toàn bộ tải.

---

**Document ID:** HW-DES-04-PWR | Rev 1.0 | 2026-05-27
