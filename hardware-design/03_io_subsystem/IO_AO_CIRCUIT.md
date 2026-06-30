# IO Subsystem — Analog Output Circuit

> **Document:** HW-DES-03-AO | Rev 1.3 | 2026-06-30
> **Cập nhật:** Kênh đầu vào từ "8 UI + 8 DI" → "16 UI toàn bộ" (xem REWORK_DI_TO_UI.md)

---

## 1. Tổng quan

4 kênh Analog Output (AO1–AO4):
- Mode xuất: **0–10V** hoặc **4–20mA** (cấu hình per kênh)
- DAC nguồn: **DAC8554** (Texas Instruments, 4-channel, 16-bit, SPI)
- Op-amp buffer: **TLV4110** (Rail-to-rail output, 5V/15V supply)
- Cô lập: **ISO7721** (digital isolator SPI side) — optional Ver 2

---

## 2. DAC8554 — 4-channel SPI DAC

| Thông số | Giá trị |
|----------|---------|
| **IC** | TI DAC8554 |
| **Channels** | 4 (A, B, C, D) |
| **Độ phân giải** | 16-bit |
| **Interface** | SPI (Mode 1, CPOL=0, CPHA=1) |
| **V_REF** | 2.5V (từ REF3025, 5ppm/°C) |
| **Output range** | 0 – V_REF × 2 = 0 – 5V (trước op-amp) |
| **Clock SPI** | max 50 MHz (dùng 10 MHz) |
| **Nguồn (AVDD)** | 5V |
| **Package** | TSSOP-16 |

**Kết nối MCU:**
- `SCLK` → STM32 SPI1_CLK (PA5)
- `DIN` → STM32 SPI1_MOSI (PA7)
- `SYNC` (CS) → STM32 PA4 (active LOW)
- `LDAC` → STM32 PB0 (GPIO điều khiển — pulse LOW để update đồng bộ 4 kênh sau khi ghi xong; khớp MCU_SPEC §3.2)
- `VREF` → REF3025 (2.5V precision ref)

---

## 3. Mạch Output mỗi kênh AO

### 3.1 Mode 0–10V (Voltage Output)

```
DAC8554_OUT_x (0–5V)
       │
   [R_series 1kΩ]
       │
   [Op-amp TLV4110]  ← AVDD = +15V, GND
   (gain = 2, non-inverting)
       │ Vout = DAC_V × 2 = 0–10V
   [R_out 100Ω]
       │
   [TVS SMAJ12A clamp]
       │
  AO_x terminal (0–10V output)
```

**Gain Op-amp:** Rf = Rin = 10kΩ → Gain = 1 + Rf/Rin = 2
**Output impedance:** 100Ω series (bảo vệ ngắn mạch tạm thời)
**Short circuit current:** 10V / 100Ω = 100mA max (OK cho load ≥ 2kΩ standard)

### 3.2 Mode 4–20mA (Current Output, V-to-I)

```
DAC8554_OUT_x (0–5V raw DAC range)
       │
   [Op-amp TLV4110 as V-to-I converter]
       │         │
      [Rf]      [Rs = 50Ω precision]
       │         │
   [NPN transistor BCX56] ← base drive từ op-amp
       │
  AO_x+ terminal
       │
  [Loop load Ra]
       │
  AO_x− terminal (Loop GND — cô lập)
       │
   [Rs 50Ω] → feedback vào op-amp inverting input
```

**Required transfer:** `I_out = V_sense / Rs`, where `Rs = 50 ohm` and `V_sense` must span 0.2–1.0V for 4–20mA. The DAC itself spans 0–5V, so the final op-amp/resistor network must implement the required gain/offset and cannot connect the full DAC voltage directly across `Rs`. System mapping remains `raw=0 -> 4mA`, `raw=65535 -> 20mA`; final resistor values and error budget are blocked pending schematic review.

**Released load target:** 0–500 ohm until the +15V converter and output transistor are frozen and measured.
**Nominal headroom at 500 ohm/20mA:** `15V - 10V(load) - 1V(sense) - transistor/circuit drop`, provisionally about 3V before rail tolerance and temperature effects.

> **600 ohm is not released.** It may be restored only after a min-rail/max-load/max-temperature sweep proves 4–20mA linearity with the frozen +15V converter and output topology. Raising the AO rail is a design option, not an approved change.

---

## 4. Precision Voltage Reference

**IC:** REF3025 (TI, 2.5V, ±0.05%, 5ppm/°C, SOT-23-3)
- Cấp cho VREF của DAC8554
- Decoupling: 1µF + 100nF tại VREF pin

---

## 5. Mode Select Per Channel

Mode chọn bằng software (STM32 firmware nhận lệnh từ CM3 qua IOP):

| DAC code | Mode 0–10V | Mode 4–20mA |
|:--------:|:----------:|:-----------:|
| 0x0000 | 0V | 4mA |
| 0x8000 | 5V | 12mA |
| 0xFFFF | 10V | 20mA |

**Relay K_AO_x:** Mỗi kênh có 1 relay DPDT nhỏ (IM23 relay, 5V coil) để switch giữa đường ra 0–10V và 4–20mA.
- Relay OFF → 0–10V output path active
- Relay ON → 4–20mA output path active

> Alternative: Dùng analog switch TMUX1219 thay relay để tốc độ cao và không wear.

---

## 6. Thông số Output

| Thông số | 0–10V | 4–20mA |
|----------|:-----:|:------:|
| Phạm vi | 0 – 10V | 4 – 20mA |
| Độ phân giải | 16-bit → 0.15mV | 16-bit → 0.244µA |
| Độ chính xác | Provisional; final claim requires signed error budget/calibration | Provisional; final claim requires signed error budget/compliance sweep |
| Tải min (0–10V) | 2kΩ (5mA max) | — |
| Tải max (4–20mA) | — | **500Ω released target; 600Ω blocked** |
| Ripple | < 2mVpp | < 10µApp |
| Bảo vệ ngắn mạch | 100Ω series (tự giới hạn dòng) | Electronic current limit |
| Cô lập | Không (Ver 1) | Không (Ver 1) |
| Cập nhật rate | Applied by STM32 output task within 10ms nominal | Applied by STM32 output task within 10ms nominal |

---

## 7. Bảo vệ Output

| Loại | Giải pháp |
|------|---------|
| Ngắn mạch 0–10V | R 100Ω series, PTC fuse 100mA |
| Overvoltage ngõ ra | TVS SMAJ12A (clamp 13.3V) |
| Đảo tải 4–20mA | Freewheeling diode 1N4148 |
| ESD | TVS PRTR5V0U2X tại terminal |

---

## 8. Compliance verification gate

- [ ] Sweep 4, 8, 12, 16, 20, and 22mA at 0, 250, and 500 ohm over min/nom/max +15V rail and temperature.
- [ ] Record output error, transistor/op-amp headroom, +15V ripple, temperature, and loop stability for every AO channel.
- [ ] Demonstrate short/open/reverse wiring behavior and recovery without damage.
- [ ] Do not publish a 600-ohm or final accuracy claim until evidence is approved and linked in the closure register.

**Document ID:** HW-DES-03-AO | Rev 1.3 | 2026-06-30

## Revision History

| Rev | Ngày | Thay đổi |
|-----|------|----------|
| 1.0 | 2026-05-27 | Initial release — 4 kênh AO với DAC8554, TLV4110, hỗ trợ 0-10V/4-20mA |
| 1.1 | 2026-06-23 | Update consistency — Kênh đầu vào từ "8 UI + 8 DI" → "16 UI toàn bộ" (xem REWORK_DI_TO_UI.md) |
| 1.2 | 2026-06-23 | Final rev bump Phase 1 — I/O count update verified (16 UI only) |
| 1.3 | 2026-06-30 | Corrected the 4–20mA transfer requirement, limited released load target to 500 ohm, and added compliance evidence gate |
