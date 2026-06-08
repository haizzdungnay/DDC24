# C6 — Relay Specifications (HF46F-5 / DO Contact)

> **Document ID:** CR-QCVN-C6 | Rev 1.0 | 2026-06-02
> **Tiêu chuẩn áp dụng:** IEC 61010-1 §6, §9, §13 (Clearance, creepage, HV protection), QCVN 4:2009/BCT
> **Sản phẩm:** MK-DDC-24 — Carrier Board v1.x (DO1–DO4)
> **Mục đích:** Đặc tả kỹ thuật relay đầu ra digital (DO) phục vụ chứng nhận QCVN 4:2009/BCT

---

## 1. Tổng quan

MK-DDC-24 có 4 kênh digital output sử dụng relay SPDT **HF46F-005-HS1TGF** (Hongfa) hoặc tương đương **G5LE-14-5VDC** (Omron). Mỗi kênh relay điều khiển tải AC/DC đến 5A thông qua terminal block 5.08mm pitch.

**Cấu trúc kênh DO (mỗi kênh):**

```
STM32 GPIO ──[ULN2003A driver]──[Relay K_x coil 5V]──[Contact COM/NO/NC]
                                         │
                                Freewheeling diode (internal ULN2003A)
```

---

## 2. Relay Specifications — HF46F-005-HS1TGF

### 2.1 Thông số cuộn coil

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| **Model** | HF46F-005-HS1TGF | Hongfa Relay |
| **Manufacturer** | Hongfa Technology Co. | — |
| **Coil Voltage (V~nom~)** | **5 VDC** | ±10% (4.5V – 5.5V) |
| **Coil Current** | 72 – 80 mA | Tại 5VDC, 23°C |
| **Coil Power** | ≈ 400 mW | 5V × 80 mA |
| **Coil Resistance** | 62.5 Ω ±10% | Tính toán từ V/I |
| **Must-Operate Voltage** | ≤ 75% V~nom~ (≤ 3.75V) | Đảm bảo relay chắc chắn ON |
| **Must-Release Voltage** | ≥ 10% V~nom~ (≥ 0.5V) | Đảm bảo relay OFF |

### 2.2 Thông số tiếp điểm (Contact)

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| **Contact Arrangement** | **SPDT** (1 Form C) | COM + NC + NO |
| **Contact Material** | AgSnO₂ (Silver Tin Oxide) | Chịu arc tốt hơn AgCdO |
| **Rated Load (product)** | **5 A @ 250 VAC / 5 A @ 30 VDC** | Công bố sản phẩm (derated for endurance + UL clearance) |
| **Max Switching Voltage** | 250 VAC / 30 VDC | Giới hạn thiết kế |
| **Max Switching Current** | 5 A | — |
| **Max Switching Power** | 1250 VA / 150 W | AC / DC |
| **Minimum Load** | 10 mA @ 5 VDC | Tiếp điểm mạ vàng (gold plating) |
| **Contact Resistance** | ≤ 100 mΩ | Ban đầu, tại 1A 6VDC |

### 2.3 Độ bền (Endurance)

| Tham số | Giá trị | Điều kiện |
|---------|:-------:|-----------|
| **Mechanical Life** | ≥ 10 × 10⁶ cycles | Không tải |
| **Electrical Life** | **≥ 100 × 10³ cycles** | Tại 5A 250VAC resistive |
| **Electrical Life (typical)** | ≥ 50 × 10³ cycles | Tại 5A 30VDC resistive |
| **Operate Time** | ≤ 10 ms (typical 7 ms) | Tại V~nom~ |
| **Release Time** | ≤ 5 ms (typical 2 ms) | — |
| **Bounce Time** | ≤ 5 ms | — |

### 2.4 Cách ly (Isolation)

| Tham số | Giá trị | Tiêu chuẩn |
|---------|:-------:|-----------|
| **Dielectric Coil–Contact** | **4000 V RMS** (1 phút) | IEC 61010-1 / IEC 61810-1 |
| **Dielectric Between Open Contacts** | 1000 V RMS (1 phút) | IEC 61810-1 |
| **Insulation Resistance** | ≥ 1000 MΩ @ 500 VDC | — |
| **Clearance Coil–Contact** | **≥ 3.2 mm** | IEC 61010-1 Cat II, PD2 |
| **Creepage Coil–Contact** | ≥ 4.0 mm | IEC 61010-1 Cat II, PD2 |

> **Ghi chú:** PCB clearance thực tế: 4.0 mm (≥ yêu cầu 3.2 mm). PCB creepage thực tế: 5.0 mm (≥ yêu cầu 4.0 mm). Xem CR-QCVN-C2.

### 2.5 Thông số môi trường và cơ khí

| Tham số | Giá trị | Ghi chú |
|---------|---------|---------|
| **Operating Temperature** | −40°C → +85°C | Full load đến +85°C |
| **Storage Temperature** | −40°C → +105°C | — |
| **Humidity** | 5 – 85% RH | Không ngưng tụ |
| **Vibration Resistance (operating)** | 10 – 55 Hz, 1.5 mm | IEC 60068-2-6 |
| **Shock Resistance** | 100 m/s² (≈ 10 G) | IEC 60068-2-27 |
| **Dimensions** | 27.3 × 14.5 × 19.0 mm | PCB mount |
| **Terminal Pitch** | 5.08 mm | — |
| **Weight** | ≈ 8 g | — |
| **Pins** | 5 pins (coil 2 + contact 3) | — |

---

## 3. Ứng dụng trong mạch DO

| Tham số | Giá trị | Căn cứ |
|---------|---------|--------|
| **Số kênh** | 4 (K1–K4) | IO_DO_RELAY §1 |
| **Driver IC** | ULN2003A | Darlington array, 500 mA/channel |
| **Flyback protection** | Internal diode (ULN2003A COM pin → +5V_RELAY) | Không cần diode ngoài |
| **Coil supply** | +5V_RELAY (tách từ +5V qua ferrite bead 600Ω) | Giảm nhiễu relay bounce |
| **Current/coil** | 80 mA × 4 relays = 320 mA | Nằm trong budget 400 mA |
| **AC load type** | Resistive / Inductive (với RC snubber optional) | Snubber 100Ω + 100nF/630V |
| **HV boundary** | Hazardous Voltage > 30VAC tại contact | Theo IEC 61010-1 |

---

## 4. Bảo vệ và An toàn (Protection & Safety)

| Loại bảo vệ | Biện pháp | Tham chiếu |
|------------|----------|-----------|
| **Flyback coil** | ULN2003A internal clamping diode | IO_DO_RELAY §4 |
| **Contact arc (inductive)** | RC snubber 100Ω + 100nF/630V (optional) | IO_DO_RELAY §8 |
| **Overcurrent contact** | External fuse do khách hàng lắp | IO_DO_RELAY §8 |
| **Clearance/creepage** | PCB layout tuân thủ IEC 61010-1 | CR-QCVN-C2 |
| **Isolation reinforced** | Relay cách ly coil–contact 4000V RMS | §2.4 above |

---

## 5. Kiểm định (Verification)

| Hạng mục | Phương pháp | Tiêu chí |
|---------|------------|---------|
| **Coil voltage** | Đo V~coil~ tại chân relay | 4.5 – 5.5 VDC |
| **Coil current** | Đo I~coil~ qua từng relay | 72 – 80 mA |
| **Contact resistance** | 4-wire Kelvin đo COM–NO / COM–NC | ≤ 100 mΩ |
| **Operate/Release time** | Oscilloscope đo coil voltage + contact | ≤ 10 ms / ≤ 5 ms |
| **Dielectric coil–contact** | Hi-pot 4000V RMS / 1 phút coil đến contact | Không đánh thủng |
| **Electrical life (sample)** | 100k cycles @ 5A 250VAC resistive | ∆R~contact~ < 2× initial |
| **Clearance measurement** | Đo PCB clearance coil–contact trace | ≥ 3.2 mm |

---

## 6. Tài liệu tham khảo

| Tài liệu | ID |
|---------|-----|
| IO Subsystem — Digital Output Relay Circuit | HW-DES-03-DO (§2, §5) |
| Bill of Materials — MK-DDC-24 v1.0 | HW-DES-06-BOM (§2.7) |
| Creepage & Clearance Assessment | CR-QCVN-C2 |
| Hongfa HF46F Datasheet | HF46F-005-HS1TGF |
| IEC 61010-1 — Safety requirements | — |
| IEC 61810-1 — Electromechanical elementary relays | — |
| QCVN 4:2009/BCT | — |

---

**Document ID:** CR-QCVN-C6 | Rev 1.0 | 2026-06-02
**Taxonomy:** C6-relay-v1
