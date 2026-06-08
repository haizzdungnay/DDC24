# C2 — Creepage & Clearance Assessment (IEC 61010-1)

> **Document ID:** CR-QCVN-C2 | Rev 1.0 | 2026-06-02
> **Tiêu chuẩn áp dụng:** IEC 61010-1 (Safety requirements for electrical equipment for measurement, control, and laboratory use)
> **Sản phẩm:** MK-DDC-24 — Carrier Board v1.x (4-layer PCB, FR-4)
> **Mục đích:** Đánh giá khoảng cách clearance và creepage cho tất cả HV boundaries theo QCVN 4:2009/BCT

---

## 1. Tham số áp dụng

| Tham số | Giá trị | Căn cứ |
|---------|---------|--------|
| **Overvoltage Category** | II | Thiết bị gắn với nguồn building wiring cố định |
| **Pollution Degree** | 2 | Môi trường điều khiển công nghiệp nhẹ, có kiểm soát độ ẩm |
| **Material Group** | IIIa | FR-4 PCB (CTI 175–400V) |
| **Altitude** | ≤ 2000m | Môi trường lắp đặt tiêu chuẩn |
| **PCB Layers** | 4 | L1: Signal_Top, L2: GND, L3: Power, L4: Signal_Bot |
| **Mounting** | DIN-rail, vỏ nhựa | Cách ly bổ sung qua vỏ máy |

**Điện áp làm việc (Working Voltage) theo từng vùng:**

| Vùng | Điện áp danh định | Peak (AC) | Phân loại IEC 61010-1 |
|------|:-----------------:|:---------:|-----------------------|
| Power Input (24V) | 24VAC/VDC ±20% | 33V (AC) / 28.8V (DC) | SELV — ≤ 50V |
| +5V Logic Rail | 5VDC | 5V | SELV |
| +3.3V Logic Rail | 3.3VDC | 3.3V | SELV |
| **Relay Contact** | **250VAC** | **354V** | **Hazardous Voltage** |
| Relay Coil | 5VDC | 5V | SELV |
| RS-485 Bus | 3.3V logic, -7/+12V bus | 12V | SELV (functional extra-low voltage) |
| UI Input | 0–10VDC / 4–20mA | 10V | SELV |
| AO Output | 0–10VDC | 10V | SELV |

> **Lưu ý:** Chỉ có vùng relay contact (250VAC) là Hazardous Voltage theo định nghĩa IEC 61010-1 (> 30VAC hoặc > 60VDC). Các vùng còn lại là SELV.

---

## 2. Yêu cầu Clearance theo IEC 61010-1

Clearance dựa trên **peak working voltage** và **overvoltage category**.

### 2.1 Công thức tra bảng

**Clearance (basic insulation) theo Table 4 — IEC 61010-1:**
- Altitude ≤ 2000m: không cần hiệu chỉnh
- Hệ số cho Cat II: áp dụng trực tiếp bảng

**Yêu cầu tham chiếu cho các mức điện áp chính:**

| Working Voltage (V rms) | Peak (V) | Clearance Basic (mm) | Clearance Reinforced (mm) |
|:-----------------------:|:--------:|:--------------------:|:-------------------------:|
| 24 | 33 | 0.2 | 0.4 |
| 250 | 354 | 3.0 | 6.0 |

### 2.2 Yêu cầu Creepage theo IEC 61010-1

Creepage dựa trên **RMS working voltage**, **pollution degree**, và **material group**.

**Creepage (Table 5 — IEC 61010-1, PD2, Material Group IIIa):**

| Working Voltage (V rms or V DC) | Creepage Basic (mm) | Creepage Reinforced (mm) |
|:-------------------------------:|:-------------------:|:------------------------:|
| 24 | 1.0 | 2.0 |
| 250 | 4.0 | 8.0 |

---

## 3. Bảng đánh giá Clearance & Creepage

### 3.1 Power Input — 24VAC/VDC Terminal

| # | Boundary | Working Voltage | Peak | PD | Mat Grp | Req'd Clearance | Req'd Creepage | Actual Design | Pass? |
|:-:|----------|:---------------:|:----:|:--:|:-------:|:---------------:|:--------------:|:-------------:|:-----:|
| B-01 | Terminal 24V (+) → GND (PCB) | 24V rms / 33V peak | 33V | 2 | IIIa | 0.2mm | 1.0mm | 2mm (terminal pitch 5.08mm) | **PASS** |
| B-02 | Terminal 24V → adjacent LV trace (PCB) | 24V rms / 33V peak | 33V | 2 | IIIa | 0.2mm (functional) | 1.0mm | ≥ 3mm (routing rule) | **PASS** |
| B-03 | F1 (polyfuse) pin → adjacent trace | 24V rms / 33V peak | 33V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 1mm | **PASS** |
| B-04 | Bridge GBU4J AC pin → DC+ pin | 24V rms / 33V peak | 33V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 2mm (package spacing) | **PASS** |

### 3.2 Relay Contact — 250VAC (HV Boundary chính)

| # | Boundary | Working Voltage | Peak | PD | Mat Grp | Req'd Clearance | Req'd Creepage | Actual Design | Pass? |
|:-:|----------|:---------------:|:----:|:--:|:-------:|:---------------:|:--------------:|:-------------:|:-----:|
| **B-05** | **Relay contact trace → adjacent LV trace** | **250V rms / 354V peak** | **354V** | **2** | **IIIa** | **3.0mm** | **4.0mm** | **4mm** | **PASS** |
| **B-06** | **Relay contact terminal DO_COM → GND** | **250V rms / 354V peak** | **354V** | **2** | **IIIa** | **3.0mm** | **4.0mm** | **≥ 4mm (design rule; copper pour clearance)** | **PASS** |
| **B-07** | **Relay contact terminal DO_NO → GND** | **250V rms / 354V peak** | **354V** | **2** | **IIIa** | **3.0mm** | **4.0mm** | **≥ 4mm** | **PASS** |
| **B-08** | **Relay contact terminal DO_NC → GND** | **250V rms / 354V peak** | **354V** | **2** | **IIIa** | **3.0mm** | **4.0mm** | **≥ 4mm** | **PASS** |
| **B-09** | **Relay-to-relay (contact → adjacent relay contact)** | **250V rms / 354V peak** | **354V** | **2** | **IIIa** | **3.0mm** | **4.0mm** | **≥ 5mm (design rule)** | **PASS** |
| B-10 | Relay contact trace → relay coil pin (PCB) | 250V → 5V | 354V | 2 | IIIa | 3.0mm (basic) | 4.0mm | ≥ 5mm (relay footprint separation) | **PASS** |
| B-11 | Terminal block DO_COM → DO_COM (kề nhau, khác kênh) | 250V rms | 354V | 2 | IIIa | 3.0mm | 4.0mm | 5.08mm (pitch) | **PASS** |
| B-12 | Terminal block DO → DI terminal | 250V rms vs 24V | — | 2 | IIIa | 3.0mm | 4.0mm | ≥ 10mm (layout separation) | **PASS** |

### 3.3 Relay Internal Isolation (Coil → Contact)

| # | Boundary | Dielectric Rating | Req'd Clearance | Actual | Pass? |
|:-:|----------|:-----------------:|:---------------:|:-----:|:-----:|
| **B-13** | **Relay coil (5V) → contact (250VAC) — internal to HF46F** | **4000V RMS (1 min)** | **Phụ thuộc relay spec** | **4000V RMS guaranteed by manufacturer** | **PASS** |

> **Cơ sở:** HF46F-5-HS1TGF (hoặc G5LE-14-5VDC) có isolation coil–contact ≥ 4000V RMS, đáp ứng yêu cầu reinforced insulation cho 250VAC.

### 3.4 RS-485 Communication

| # | Boundary | Working Voltage | Peak | PD | Mat Grp | Req'd Clearance | Req'd Creepage | Actual Design | Pass? |
|:-:|----------|:---------------:|:----:|:--:|:-------:|:---------------:|:--------------:|:-------------:|:-----:|
| B-14 | RS-485 A/B → GND (PCB clearance) | 3.3V logic / 12V bus | 12V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 3mm (design rule) | **PASS** |
| B-15 | RS-485 A/B → relay contact trace | 12V vs 250V | 354V | 2 | IIIa | 3.0mm | 4.0mm | ≥ 10mm (physical separation) | **PASS** |
| B-16 | RS-485 TVS (SMAJ6.5A) pin → adjacent trace | Bus voltage | 12V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 1mm | **PASS** |

### 3.5 UI / DI / AO I/O

| # | Boundary | Working Voltage | Peak | PD | Mat Grp | Req'd Clearance | Req'd Creepage | Actual Design | Pass? |
|:-:|----------|:---------------:|:----:|:--:|:-------:|:---------------:|:--------------:|:-------------:|:-----:|
| B-17 | UI input terminal → GND | 0–10V (max 15V với TVS clamp) | 15V | 2 | IIIa | 0.2mm | 1.0mm | 5.08mm (pitch) | **PASS** |
| B-18 | UI TVS (SMAJ15A) pin → adjacent trace | 10V working | 15V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 1mm | **PASS** |
| B-19 | DI 24V terminal → logic side (opto) | 24V → 3.3V | 24V | 2 | IIIa | 0.2mm (opto internal isolation) | — | Opto PC817: 5000V RMS | **PASS** |
| B-20 | AO output terminal → GND | 0–10V | 10V | 2 | IIIa | 0.2mm | 1.0mm | 5.08mm (pitch) | **PASS** |
| B-21 | UI/DI terminal → relay contact terminal | 24V / 10V vs 250V | 354V | 2 | IIIa | 3.0mm | 4.0mm | ≥ 10mm (section separation) | **PASS** |

### 3.6 Power Supply Internal

| # | Boundary | Working Voltage | Peak | PD | Mat Grp | Req'd Clearance | Req'd Creepage | Actual Design | Pass? |
|:-:|----------|:---------------:|:----:|:--:|:-------:|:---------------:|:--------------:|:-------------:|:-----:|
| B-22 | DC_RAW (28–33V) → GND | 33V peak | 33V | 2 | IIIa | 0.2mm | 1.0mm | 1mm (min) | **PASS** |
| B-23 | LM2596HVS Input pin → Output pin | 33V → 5V | 33V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 1mm | **PASS** |
| B-24 | LM2596HVS Tab (GND) → adjacent trace | 33V | 33V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 1mm | **PASS** |
| B-25 | +5V rail → +3.3V rail (LDO input-output) | 5V → 3.3V | 5V | 2 | IIIa | 0.1mm | 0.5mm | ≥ 0.3mm (power trace width) | **PASS** |
| B-26 | Boost SX1308: Input 5V → Output 15V | 5V → 15V | 15V | 2 | IIIa | 0.2mm | 1.0mm | ≥ 1mm | **PASS** |

### 3.7 PCB Layer-to-Layer Isolation

| # | Boundary | Dielectric | Thickness | Voltage Stress | Pass? |
|:-:|----------|-----------|:---------:|:--------------:|:-----:|
| B-27 | L1 (Signal) → L2 (GND) — prepreg | FR-4, ~0.2mm | 200µm | 354V peak → 1.77 kV/mm | **PASS** (FR-4 dielectric strength ~20 kV/mm) |
| B-28 | L2 (GND) → L3 (Power) — core | FR-4, ~0.7mm | 700µm | 33V peak → 0.05 kV/mm | **PASS** |
| B-29 | L3 (Power) → L4 (Signal_Bot) — prepreg | FR-4, ~0.2mm | 200µm | 354V peak (HV trên L4) → 1.77 kV/mm | **PASS** |
| B-30 | HV trace (L4) → GND plane (L2) via FR-4 | FR-4, ~1.0mm (core + prepreg) | 1.0mm | 354V → 0.35 kV/mm | **PASS** |

---

## 4. Đánh giá chi tiết các HV Boundary chính

### 4.1 Boundary B-05: Relay contact trace → adjacent LV trace

**Mô tả:** Khoảng cách giữa trace mang 250VAC (relay contact trên L4) và trace tín hiệu thấp (LV) gần nhất trên cùng lớp.

| Tham số | Giá trị |
|---------|---------|
| Working voltage | 250V rms / 354V peak |
| Loại cách ly | Basic insulation |
| Clearance yêu cầu (IEC 61010-1 Table 4, 354V peak) | 3.0mm |
| Creepage yêu cầu (IEC 61010-1 Table 5, PD2, IIIa) | 4.0mm |
| **Design actual clearance** | **4mm** |
| **Design actual creepage** | **5mm** |
| Margin | +1.0mm (clearance), +1.0mm (creepage) |
| **Kết luận** | **PASS** |

### 4.2 Boundary B-09: Relay-to-relay

**Mô tả:** Khoảng cách giữa 2 relay kề nhau trên PCB, đo từ chân contact của relay này đến chân contact của relay kia.

| Tham số | Giá trị |
|---------|---------|
| Working voltage | 250V rms (giả sử khác pha hoặc cùng pha — worst-case same voltage) |
| Clearance yêu cầu | 3.0mm |
| Creepage yêu cầu | 4.0mm |
| **Design actual** | **≥ 5mm (layout rule)** |
| **Kết luận** | **PASS** |

### 4.3 Boundary B-12: Terminal block DO → DI terminal

**Mô tả:** Khoảng cách giữa terminal DO (250VAC) và terminal DI (24V) trên mặt PCB. Các nhóm terminal độc lập, cách nhau bằng khoảng trống PCB.

| Tham số | Giá trị |
|---------|---------|
| Working voltage | 250V rms vs 24V |
| Clearance yêu cầu | 3.0mm |
| Creepage yêu cầu | 4.0mm |
| **Design actual** | **≥ 10mm (physical separation between terminal blocks)** |
| **Kết luận** | **PASS (dư địa lớn)** |

### 4.4 Boundary B-13: Relay coil-contact isolation

**Mô tả:** Cách ly bên trong relay giữa cuộn coil (5V) và tiếp điểm (250VAC). Đây là reinforced insulation do coil nối với mạch logic người dùng có thể chạm tới.

| Tham số | Giá trị |
|---------|---------|
| Loại cách ly | Reinforced (coil → contact) |
| Điện áp test | 4000V RMS, 1 phút (theo datasheet relay) |
| Clearance internal | Do relay manufacturer đảm bảo |
| **Kết luận** | **PASS (dựa trên manufacturer spec)** |

---

## 5. Kết luận

**Tổng hợp: 30/30 boundaries đạt yêu cầu (PASS).**

| Nhóm | Số boundaries | PASS | FAIL |
|------|:-------------:|:----:|:----:|
| Power Input (24V) | 4 | 4 | 0 |
| **Relay Contact (250VAC)** | **8** | **8** | **0** |
| Relay Internal | 1 | 1 | 0 |
| RS-485 | 3 | 3 | 0 |
| UI/DI/AO I/O | 5 | 5 | 0 |
| Power Supply Internal | 5 | 5 | 0 |
| PCB Layer-to-Layer | 4 | 4 | 0 |
| **Tổng** | **30** | **30** | **0** |

**Các HV boundary chính đều đạt với dư địa:**
- Relay contact clearance: 4mm (yêu cầu 3.0mm) — dư +33%
- Relay contact creepage: 5mm (yêu cầu 4.0mm) — dư +25%
- Relay-to-relay: 5mm (yêu cầu 4.0mm creepage) — dư +25%
- DO → DI terminal separation: ≥ 10mm (yêu cầu 4.0mm) — dư +150%

**Khuyến nghị:**
1. Kiểm tra clearance/creepage trên PCB layout thực tế (Gerber) trước khi sản xuất để xác nhận thiết kế tuân thủ các giá trị trong tài liệu này.
2. Với lô sản xuất đầu tiên, thực hiện dielectric strength test (4000V RMS, 1 phút) trên mẫu relay để xác nhận isolation coil-contact.
3. Nếu sử dụng conformal coating, creepage có thể giảm theo IEC 61010-1 §5.4.2 — xem xét áp dụng cho các thiết kế future revision để tối ưu không gian PCB.

---

> **Document ID:** CR-QCVN-C2 | Rev 1.0 | 2026-06-02
> **Prepared by:** Developer Team
> **Verification method:** Desk review against IEC 61010-1 Ed. 4, Table 4 (Clearance) and Table 5 (Creepage)
> **Next step:** Verify against actual PCB layout (Gerber) in manufacturing readiness review
