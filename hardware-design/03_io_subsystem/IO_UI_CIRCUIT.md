# IO Subsystem — Universal Input Circuit Design

> **Document:** HW-DES-03-UI | Rev 1.0 | 2026-05-27  
> **Liên quan:** HW-DES-05-MCU (STM32G0B1), HW-DES-02-CB

---

## 1. Tổng quan

8 kênh UI tự nhận dạng loại sensor. Mỗi kênh được **MCU STM32G0B1 đọc** từ **ADS131M08** (ADC sigma-delta 24-bit, 8-channel đồng thời) qua SPI3 @ 1ms. MCU gửi **raw value (uint24)** lên CM3 qua IOP; việc **scale/linearization** (CVD, Steinhart-Hart…) thực hiện trong `kinexus-io-driver` trên CM3 (xem SW_ARCH §4).

**Tại sao dùng ADS131M08 thay vì ADC onboard STM32?**  
→ STM32G0B1 chỉ có ADC 12-bit, không đủ độ chính xác cho PT100/NTC. ADS131M08 cung cấp 24-bit, noise < 1µV_RMS, đọc 8 kênh đồng thời.

---

## 2. ADS131M08 — External ADC

| Thông số | Giá trị |
|----------|---------|
| **IC** | Texas Instruments ADS131M08 |
| **Độ phân giải** | 24-bit delta-sigma |
| **Channels** | 8 kênh đồng thời |
| **Sample rate** | 250 SPS – 32 kSPS (dùng 1 kSPS) |
| **Input range** | ±1.2V differential (với gain) |
| **Noise** | < 1 µVRMS @ 1kSPS |
| **Interface** | SPI (Mode 1, CPOL=0, CPHA=1) |
| **Clock SPI** | max 25 MHz (dùng 4 MHz) |
| **Nguồn** | 3.3V digital, 3.3V analog (AVDD) |
| **Package** | TSSOP-32 |

**Kết nối (ADS131M08 chỉ nối tới MCU STM32 — KHÔNG nối CM3):**
- `SCLK` → STM32 **SPI3_CLK** (PC10)
- `DIN/SDI` → STM32 **SPI3_MOSI** (PC12) — bắt buộc để ghi config register
- `DOUT` → STM32 **SPI3_MISO** (PC11)
- `!CS` → STM32 GPIO (PB2)
- `DRDY` → STM32 PA8 (interrupt báo data ready)
- `CLKIN` → 4.096 MHz crystal (hoặc MCO từ STM32)

> **Kiến trúc đã chốt (IOP-Q-R001/R007):** MCU STM32 là master DUY NHẤT của ADS131M08, đọc 8 kênh @ 1ms rồi truyền raw value **lên** CM3 qua IOP (UART2 921.600 baud). CM3 không có đường SPI nào tới ADC. Việc scale/linearization có thể làm tại MCU hoặc tại IOP driver trên CM3 (xem SW_ARCH §4).

---

## 3. Mạch Điều hòa Tín hiệu mỗi UI kênh

### 3.1 Sơ đồ chung mỗi kênh

```
UI_x (terminal) ──┬── [TVS SMAJ15A] ── GND
                  │
                  ├── [R_fuse 100Ω/0.5W] ──┬── [Schottky D] ── 3.3V (clamp)
                  │                         │
                  │                    [Mux TMUX1208]
                  │                         │
                  │         ┌───────────────┴──────────────────────────┐
                  │         │ Mode: 0-10V  │ 4-20mA │ RTD   │ NTC/DI  │
                  │         │              │        │       │         │
                  │  [R_div 100k/12.1k] [R_shunt 62Ω] [Kelvin] [Pull-up]
                  │         │              │        │       │         │
                  └─────────┴──────────────┴────────┴───────┴─────────►
                                        ADS131M08 CH_x (differential input)
```

### 3.2 Mode 0–10V (Voltage Input)

| Linh kiện | Giá trị | Ghi chú |
|-----------|---------|---------|
| R1 (series) | 100kΩ | Kết hợp R2 tạo divider, bảo vệ ADC |
| R2 (to GND) | 12.1kΩ 0.1% | 10V → 1.073V vào ADC |
| C_filter | 100nF | Anti-alias, Fc = 13 kHz |
| TVS | SMAJ15A | Clamp tại 16.7V |
| Schottky | BAT54 | Clamp upper: 3.3V + 0.3V = 3.6V |

**Công thức scale:** `V_real = V_ADC × (R1+R2)/R2 = V_ADC × 9.27`  
**Độ chính xác:** ±0.05% FS (24-bit ADC + 0.1% resistor)

### 3.3 Mode 4–20mA (Current Input)

| Linh kiện | Giá trị | Ghi chú |
|-----------|---------|---------|
| R_shunt | 62Ω ±0.1% | 4mA → 248mV; 20mA → 1240mV (trong range ADC) |
| R_protect | 10Ω | Current limit series |
| TVS | SMAJ6.5A | Bảo vệ overvoltage |

**Công thức scale:** `I_mA = V_ADC / 0.062`  
**Nguồn phụ:** Loop power 24VDC cần được cấp ngoài (passive receiver)

### 3.4 Mode PT100 / PT1000 (RTD)

| Linh kiện | Giá trị | Ghi chú |
|-----------|---------|---------|
| I_excitation | 1mA (PT100) / 300µA (PT1000) | Từ nguồn dòng REF200 hoặc INA101 |
| R_ref | 100Ω ±0.01% (PT100) | Tham chiếu |
| Kết nối | 2-wire (PT100) / 2-wire (PT1000) | Ver 1; 3-wire option ở Ver 2 |
| Filter | 1µF ceramic | Noise rejection 50/60Hz |

**Nguồn dòng:** Dùng REF200 (100µA × 2) → ghép thành 200µA cho PT100, hoặc dùng cấu hình op-amp.  
**Linearization:** Thực hiện bằng lookup table Callendar-Van Dusen trong STM32 firmware.

| Nhiệt độ (°C) | PT100 (Ω) | PT1000 (Ω) |
|:-------------:|:---------:|:-----------:|
| -30 | 88.22 | 882.2 |
| 0 | 100.00 | 1000.0 |
| 25 | 109.73 | 1097.3 |
| 100 | 138.51 | 1385.1 |
| 200 | 175.86 | 1758.6 |

### 3.5 Mode NTC 10kΩ / 20kΩ

| Linh kiện | Giá trị | Ghi chú |
|-----------|---------|---------|
| R_pullup | 10kΩ ±0.1% (NTC10k) / 20kΩ ±0.1% (NTC20k) | Chia áp từ 3.3V |
| V_ref | 3.3V (từ CM3 PMIC output, ổn định) | |

**Công thức Steinhart-Hart:**  
$$T(K) = \frac{1}{A + B \ln(R) + C (\ln R)^3}$$

Với NTC 10k B=3950: `A=0.001129, B=0.0002341, C=8.76×10⁻⁸`

### 3.6 Mode Dry Contact (Digital Input qua UI)

| Linh kiện | Giá trị | Ghi chú |
|-----------|---------|---------|
| R_pullup | 10kΩ | Đến 3.3V |
| Threshold | < 1V = closed, > 2V = open | Đọc digital qua ADC threshold |
| Debounce | 20ms software | Trong STM32 firmware |

---

## 4. Multiplexer (Analog Front-end Mode Select)

**IC:** TMUX1208 (8:1 analog mux, 5V supply, ±15V signal range, Ron 10Ω)  
Mỗi UI kênh có 1 TMUX1208 để chọn signal path:

| SEL[2:0] | Mode |
|:--------:|------|
| 000 | 0–10V (resistor divider) |
| 001 | 4–20mA (shunt resistor) |
| 010 | PT100 (excitation current ON) |
| 011 | PT1000 (excitation current ON, reduced) |
| 100 | NTC 10kΩ (pull-up 10k) |
| 101 | NTC 20kΩ (pull-up 20k) |
| 110 | Dry contact (pull-up, digital threshold) |
| 111 | Reserved |

SEL pins → STM32G0B1 GPIO → cấu hình bởi IOP command từ CM3.

---

## 5. Auto-detect Heuristic

Khi khởi động, nếu chưa có cấu hình lưu sẵn:

1. Đặt mode = **0–10V**, đo V → nếu V < 0.1V AND R_measured < 200Ω → khả năng là RTD
2. Đặt mode = **NTC 10k**, đo V → nếu 0.5V < V < 2.8V → khả năng NTC 10k
3. Xác nhận bằng temperature plausibility (−50°C < T < 150°C)
4. Nếu không khớp → báo "Unknown, please configure manually"

> Kết quả auto-detect gợi ý, người dùng phải xác nhận qua web UI.

---

## 6. Bảo vệ Input

| Loại | Linh kiện | Mức |
|------|---------|-----|
| Overvoltage | TVS SMAJ15A | Clamp 16.7V |
| Reverse polarity | Schottky BAT54 | −0.3V max |
| Short to 24V | R_fuse 100Ω PTC | Self-reset |
| ESD | TVS array PRTR5V0U2X | ±8kV (IEC 61000-4-2) |
| EMI filter | Ferrite bead 600Ω@100MHz + 100nF | Common mode |

---

**Document ID:** HW-DES-03-UI | Rev 1.0 | 2026-05-27
