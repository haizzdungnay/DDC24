# C1 — Safety Risk Assessment (IEC 60730-1 Annex H)

> **Document ID:** CR-QCVN-C1 | Rev 1.0 | 2026-06-02
> **Tiêu chuẩn áp dụng:** IEC 60730-1 Annex H (Risk Assessment framework), IEC 61010-1 (Safety requirements)
> **Sản phẩm:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm (Carrier Board v1.x + Radxa CM3 + STM32G0B1)
> **Mục đích:** Đánh giá rủi ro an toàn điện cho chứng nhận QCVN 4:2009/BCT

---

## 1. Phạm vi

Tài liệu này xác định các mối nguy hiểm (hazards) liên quan đến an toàn điện, đánh giá mức độ rủi ro và biện pháp giảm thiểu cho sản phẩm MK-DDC-24. Phạm vi bao gồm toàn bộ hệ thống điện tử từ nguồn 24VAC/VDC đầu vào đến các cổng I/O có thể tiếp cận bởi người dùng.

**Đặc điểm nguồn:**
- Nguồn đầu vào: 24VAC hoặc 24VDC ±20% (19.2V – 28.8V)
- Nguồn nội bộ: +5V / 3A (DC/DC buck), +3.3V / 1A (LDO), +1.8V / 200mA (LDO), +15V / 200mA (Boost)
- Relay contact: 5A @ 250VAC / 5A @ 30VDC (HV boundary chính)
- PCB: 4 lớp, FR-4, Pollution Degree 2, Overvoltage Category II

---

## 2. Phương pháp đánh giá

Theo IEC 60730-1 Annex H, kết hợp ISO 12100:

**Thang đánh giá:**

| Yếu tố | Mức | Mô tả |
|--------|:---:|-------|
| **Severity (S)** | S1 | Chấn thương nhẹ, không cần can thiệp y tế |
| | S2 | Chấn thương nghiêm trọng, cần can thiệp y tế |
| | S3 | Tử vong hoặc thương tật vĩnh viễn |
| | S4 | Nhiều người bị ảnh hưởng / thiệt hại nghiêm trọng |

| Yếu tố | Mức | Mô tả |
|--------|:---:|-------|
| **Likelihood (L)** | L1 | Rất thấp — khó xảy ra, cần nhiều điều kiện hội tụ |
| | L2 | Thấp — có thể xảy ra trong điều kiện bất thường |
| | L3 | Trung bình — có thể xảy ra vài lần trong vòng đời |
| | L4 | Cao — thường xuyên xảy ra |

**Ma trận rủi ro (S × L):**

| | L1 | L2 | L3 | L4 |
|:-:|:--:|:--:|:--:|:--:|
| **S4** | M | H | H | U |
| **S3** | M | H | H | U |
| **S2** | L | M | H | H |
| **S1** | L | L | M | H |

- **L (Low):** Rủi ro chấp nhận được — không cần hành động thêm
- **M (Medium):** Cần giám sát — có thể chấp nhận với mitigation hiện tại
- **H (High):** Cần giảm thiểu — phải có mitigation bổ sung hoặc chứng minh mitigation hiện tại đủ
- **U (Unacceptable):** Không thể chấp nhận — bắt buộc thiết kế lại

---

## 3. Bảng đánh giá rủi ro

### 3.1 Electric Shock / Điện giật

| ID | Hazard | Cause / Failure Mode | Subsystem | Existing Mitigation | S | L | Risk | Additional Measures | Residual Risk |
|:--:|--------|----------------------|-----------|---------------------|:-:|:-:|:----:|-------------------|:------------:|
| **H-01** | Điện giật từ nguồn 24V | Chạm trực tiếp terminal 24VAC/VDC không có vỏ bọc | Power Input (terminal block) | 24V là SELV theo IEC 61010-1; polyfuse F1 2A giới hạn dòng; bridge rectifier GBU4J cách ly AC; TVS P6KE33A clamp quá áp | S1 | L2 | **Low** | Bổ sung cảnh báo trên vỏ máy "24VAC/VDC only" | Low |
| **H-02** | Điện giật từ relay contact 250VAC | Chạm trực tiếp terminal DO COM/NO/NC đang mang điện áp nguy hiểm | DO Relay (terminal block, 250VAC/5A) | Clearance ≥ 3.2mm (IEC 61010-1); creepage ≥ 4mm; HV traces trên L4 (bottom), không cross L1; không via trong vùng HV | S3 | L2 | **High** | Yêu cầu vỏ máy có khóa/cảnh báo; HV terminal phải có dấu hiệu nhận biết rõ ràng (nhãn nguy hiểm) | Medium |
| **H-03** | Điện giật qua relay coil-contact fail | Chọc thủng cách ly coil–contact (HV vào mạch logic 5V) | DO Relay (coil-contact) | Relay HF46F isolation 4000V RMS (1 phút); ULN2003A drive +5V_RELAY tách qua ferrite bead; +5V_RELAY từ +5V chính | S3 | L1 | **Medium** | Kiểm tra 100% isolation test sản xuất; chọn relay có UL/certified isolation | Low |
| **H-04** | Điện giật qua RS-485 bus | Điện áp common-mode cao (surge) trên RS-485 truyền vào logic 3.3V | RS-485 (MAX13487E) | TVS SMAJ6.5A mỗi chân A/B; MAX13487E có giới hạn common-mode -7V đến +12V; isolation gap ≥ 3mm | S2 | L2 | **Medium** | Không bắt buộc thêm — TVS + gap hiện tại đủ cho Cat II | Low |
| **H-05** | Điện giật từ UI input (0-10V) | Surge từ cảm biến bên ngoài (24V loop) truyền vào | UI Input (8 kênh) | TVS SMAJ15A mỗi kênh; series R_fuse 100Ω; signal conditioning op-amp cách ly | S2 | L2 | **Medium** | Không bắt buộc thêm | Low |

### 3.2 Fire / Quá nhiệt

| ID | Hazard | Cause / Failure Mode | Subsystem | Existing Mitigation | S | L | Risk | Additional Measures | Residual Risk |
|:--:|--------|----------------------|-----------|---------------------|:-:|:-:|:----:|-------------------|:------------:|
| **H-06** | Cháy DC/DC converter | Ngắn mạch tải +5V; quá dòng kéo dài; LM2596HVS quá nhiệt (>125°C) | Power Supply (Stage 2: LM2596HVS) | Polyfuse F1 2A ngõ vào; thermal pad + 4 thermal via φ0.5mm; LM2596HVS có thermal shutdown (165°C); dissipation ~2.5W được tản qua pad | S2 | L2 | **Medium** | Kiểm tra thermal imaging trong QA; đảm bảo airflow trong vỏ | Low |
| **H-07** | Cháy relay contact | Quá tải contact > 5A; hồ quang kéo dài | DO Relay (contact) | Contact rating 5A @ 250VAC (derated từ 10A datasheet); RC snubber optional (100Ω + 100nF/630V); fuse ngoài do khách hàng lắp | S3 | L1 | **Medium** | Hướng dẫn lắp đặt yêu cầu fuse ngoài; ghi rõ max load trên nhãn máy | Low |
| **H-08** | Cháy LDO +3.3V | Ngắn mạch tải 3.3V; dissipation max 1.7W | Power Supply (Stage 3: AMS1117-3.3) | AMS1117 có thermal shutdown; SOT-223 với thermal pad + via | S1 | L2 | **Low** | Không bắt buộc thêm | Low |
| **H-09** | Cháy do thiết bị ngoài đấu vào relay | Ngắn mạch trên tải của khách hàng qua contact relay | DO Relay (external wiring) | Fuse ngoài do khách hàng lắp (bắt buộc ghi trong manual); contact rating 5A giới hạn dòng qua terminal | S3 | L2 | **High** | Ghi rõ trong hướng dẫn lắp đặt: "Bắt buộc lắp fuse phù hợp với tải bên ngoài"; đánh dấu max rating trên vỏ máy | Medium |

### 3.3 Surge / Quá áp

| ID | Hazard | Cause / Failure Mode | Subsystem | Existing Mitigation | S | L | Risk | Additional Measures | Residual Risk |
|:--:|--------|----------------------|-----------|---------------------|:-:|:-:|:----:|-------------------|:------------:|
| **H-10** | Surge trên nguồn 24V | Sét đánh gián tiếp; switching surge từ thiết bị khác | Power Input (Stage 1) | TVS P6KE33A (±600W peak pulse); bulk cap 2200µF/50V hấp thụ năng lượng; polyfuse F1 không bảo vệ surge nhưng giới hạn dòng sau surge | S2 | L2 | **Medium** | Kiểm tra surge test IEC 61000-4-5 Level 2 (±1kV) trong QA | Low |
| **H-11** | Surge trên RS-485 | Sét/cảm ứng trên đường truyền dài | RS-485 bus | TVS SMAJ6.5A mỗi chân A/B | S2 | L2 | **Medium** | Không bắt buộc thêm | Low |
| **H-12** | Surge trên UI input | Surge từ cảm biến hiện trường (dây dài) | UI Input | TVS SMAJ15A + R_fuse 100Ω series | S2 | L2 | **Medium** | Không bắt buộc thêm | Low |

### 3.4 ESD / Nhiễu tĩnh điện

| ID | Hazard | Cause / Failure Mode | Subsystem | Existing Mitigation | S | L | Risk | Additional Measures | Residual Risk |
|:--:|--------|----------------------|-----------|---------------------|:-:|:-:|:----:|-------------------|:------------:|
| **H-13** | ESD vào connector người dùng | Chạm tay vào USB, SD, debug UART khi không nối đất | I/O connectors (USB-C, USB-A, SD, UART, RS-485) | PRTR5V0U2X ESD arrays tại tất cả user-accessible connectors; TVS trên UI/DI/RS-485 | S1 | L3 | **Medium** | Kiểm tra ESD test IEC 61000-4-2 (Level 3: ±6kV contact, ±8kV air) trong QA | Low |
| **H-14** | ESD vào màn hình HMI | Chạm tay vào màn hình TFT | HMI TFT ILI9341 | CM3 GPIO điều khiển RST; series R 33Ω trên CLK/MOSI (không phải ESD protection chính) | S1 | L3 | **Medium** | Bổ sung ESD suppression trên FFC/FPC connector nếu có (không bắt buộc nếu màn hình nằm trong vỏ) | Low |

### 3.5 Mechanical / Vật lý

| ID | Hazard | Cause / Failure Mode | Subsystem | Existing Mitigation | S | L | Risk | Additional Measures | Residual Risk |
|:--:|--------|----------------------|-----------|---------------------|:-:|:-:|:----:|-------------------|:------------:|
| **H-15** | Cháy nổ tụ điện | Ngược cực tụ hóa C1 2200µF/50V; quá áp > 50V | Power Input (Stage 1) | TVS P6KE33A clamp trước C1; C1 rated 50V > max DC_RAW 33V; bridge rectifier GBU4J đảo DC đúng cực | S2 | L1 | **Low** | Không bắt buộc thêm | Low |
| **H-16** | Chập cháy do rơi vụn dẫn | Bụi dẫn điện hoặc ẩm trên PCB tại vùng HV (250VAC) | DO Relay area | Pollution Degree 2 thiết kế; clearance ≥ 3.2mm; không có copper fill dưới HV trace; conformal coating khuyến nghị | S2 | L2 | **Medium** | Conformal coating cho toàn bộ PCB (tùy chọn theo môi trường lắp đặt) | Low |

---

## 4. Kết luận và Khuyến nghị

**Rủi ro mức High (cần hành động):**
1. **H-02 (Electric shock relay contact 250VAC):** Yêu cầu thiết kế vỏ máy có khóa/cảnh báo; HV terminal phải có nhãn nguy hiểm rõ ràng theo IEC 61010-1.
2. **H-09 (Fire external load):** Hướng dẫn lắp đặt phải ghi rõ "Bắt buộc lắp fuse ngoài"; max rating được in trên vỏ máy.

**Rủi ro mức Medium (cần giám sát/chứng minh):**
- Tất cả các mục H-03, H-04, H-05, H-06, H-07, H-10, H-11, H-12, H-13, H-14, H-16 — đã có mitigation thiết kế phù hợp, cần xác nhận bằng test trong giai đoạn QA.

**Rủi ro mức Low (chấp nhận được):**
- H-01, H-08, H-15 — không cần hành động thêm.

**Hành động bắt buộc trước khi release:**
1. Thiết kế nhãn cảnh báo HV trên vỏ máy (vị trí gần terminal DO)
2. Bổ sung mục "External fuse requirement" trong user manual
3. Thực hiện các test QA: IEC 61000-4-5 Surge (Level 2), IEC 61000-4-2 ESD (Level 3), Isolation test relay coil-contact (4000V RMS)
4. Xem xét conformal coating cho môi trường lắp đặt ẩm/bụi

---

> **Document ID:** CR-QCVN-C1 | Rev 1.0 | 2026-06-02
> **Prepared by:** Developer Team
> **Next review:** Sau khi có kết quả QA test (surge, ESD, isolation)
