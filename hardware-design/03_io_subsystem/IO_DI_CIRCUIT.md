# IO Subsystem — Digital Input Circuit

> **Document:** HW-DES-03-DI | Rev 1.0 | 2026-05-27

---

## 1. Tổng quan

8 kênh Digital Input (DI1–DI8):
- Điện áp ngõ vào: **24VDC** (18–30VDC)
- Cô lập quang học (opto-isolation): **PC817** hoặc tương đương
- Trạng thái: HIGH (≥ 18VDC) / LOW (< 5VDC hoặc hở)
- Chỉ thị LED mỗi kênh

---

## 2. Sơ đồ Mạch mỗi kênh DI

```
DI_x+ ──[Polarity OK D1 BAT85]──[R1 2.2kΩ/0.5W]──[LED opto]──────── DI_x−
                                                      │
                                 [R2 470Ω] ── [LED chỉ thị xanh]
                                                      │
                                                    [Opto PC817]
                                                      │
                                              (photo-transistor)
                                                    │   │
                                                   GND  └── [R_pull 10kΩ → 3.3V]
                                                              │
                                                     STM32 GPIO PB4–PB11 (DI1–DI8 input)
```

### Chi tiết tính toán

**Điều kiện ON:** V_input ≥ 18VDC

| Linh kiện | Giá trị | Tính toán |
|-----------|---------|---------|
| **R1** (current limit LED opto) | 2.2kΩ / 0.5W | `I_LED = (24 – 1.2) / 2200 = 10.4mA` |
| **D1** (polarity protection) | BAT85 (Schottky) | Bảo vệ đảo cực DI_x+/DI_x- |
| **PC817 CTR** | ≥ 100% @ 5mA | Photo-transistor on khi I_LED ≥ 5mA |
| **R2** (LED chỉ thị) | 470Ω | Parallel với R1, chia để có 2mA → LED indicator |
| **R_pull** (3.3V pull-up) | 10kΩ | Pull-up collector photo-transistor |
| **C_debounce** | 100nF | Hardware debounce: τ = 10k × 100n = 1ms |

**Output GPIO logic:**
- DI ON (24V input) → LED opto sáng → transistor dẫn → GPIO = LOW (active LOW)
- DI OFF (0V/open) → LED opto tắt → transistor ngắt → GPIO = HIGH (3.3V qua pull-up)

> **STM32 firmware:** Đảo logic. `DI_STATE = !GPIO_read()` → DI ON = 1, DI OFF = 0.

---

## 3. Thông số Điện của DI

| Thông số | Giá trị |
|----------|---------|
| Điện áp ngõ vào ON | 18–30VDC |
| Điện áp ngõ vào OFF | < 5VDC hoặc hở mạch |
| Vùng bất định (dead band) | 5–18VDC (không định nghĩa) |
| Dòng tiêu thụ (ON) | ~11mA @ 24VDC |
| Trở kháng ngõ vào | ~2.2kΩ |
| Cô lập | 1500V RMS (PC817, 1 phút) |
| Thời gian đáp ứng | < 5ms (hardware) + debounce 20ms (software) |
| Tần số input max | 50Hz (square wave) |

---

## 4. Bảo vệ Input

| Loại | Linh kiện | Mức bảo vệ |
|------|---------|-----------|
| Đảo cực | BAT85 Schottky | Chịu ngược đến −30V không hỏng |
| Overvoltage surge | TVS P6KE36A | Clamp tại 36V, 600W pulse |
| ESD | PRTR5V0U2X array | ±8kV (IEC 61000-4-2 Level 4) |
| Cô lập | PC817 opto | 1500V RMS |

---

## 5. LED Chỉ thị

| LED | Màu | Trạng thái |
|-----|-----|-----------|
| DI1–DI8 | Xanh lá | Sáng khi DI = ON (24V) |

**Bố trí:** Hàng LED ngang phía trên terminal block DI, nhìn từ mặt trước DIN-rail.

---

## 6. Terminal Block

| Kênh | Ký hiệu | Ghi chú |
|------|---------|---------|
| DI1+ | DI1 | 24VDC signal |
| DI1− | DI_COM | Chung GND lớp cô lập (floating GND qua opto) |
| ... | ... | |
| DI8+ | DI8 | |

> DI_COM (negative terminal DI) cách ly với logic GND nội bộ qua opto. Có thể nối đến GND của sensor bên ngoài.

---

**Document ID:** HW-DES-03-DI | Rev 1.0 | 2026-05-27
