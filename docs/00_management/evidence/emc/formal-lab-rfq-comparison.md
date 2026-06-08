# Formal Lab RFQ Comparison — MK-DDC-24 EMC (IEC 61326-1)

> **Document ID:** KX-DDC24-EXT-RFQ-001  
> **Phiên bản:** 1.0 | 2026-06-02  
> **Trạng thái:** Draft — shortlist, chờ gửi RFQ và nhận quote  
> **Owner:** DeveloperTeam  
> **Ref:** IOT-5507 | HW-Q-003 | IEC 61326-1 | KX-DDC24-PM-MARKET-001 §6.3  
> **Input:** EMC_THERMAL_NOTES.md, pre-compliance-report.md, qa-emc-verification-checklist.md

---

## 1. Tổng quan yêu cầu

| Mục | Yêu cầu |
|-----|---------|
| **Tiêu chuẩn** | IEC 61326-1 (EMC for measurement, control and laboratory use) |
| **Sản phẩm** | MK-DDC-24 — BACnet DD Controller, carrier board v1.0 + Radxa CM3 |
| **Phân loại** | Class A (industrial) / CISPR 11 |
| **Số vòng test** | 2 rounds (Round 1: pre-compliance/full; Round 2: fix verification + full) |
| **Số lượng mẫu** | Tối thiểu 2 DUT mỗi round |
| **Ngân sách dự kiến** | 5,000–15,000 USD/round (tổng 10,000–30,000 USD cho 2 rounds) |
| **Thời điểm mong muốn** | Month 3 (August 2026) — slot cần book trước 4–8 tuần |

### Phạm vi test (theo IEC 61326-1 Class A)

| Test | Tiêu chuẩn | Yêu cầu |
|------|-----------|---------|
| Radiated emission | CISPR 11 | 30–1000 MHz, Class A |
| Conducted emission | CISPR 11 | 0.15–30 MHz, AC power port |
| ESD immunity | IEC 61000-4-2 | Level 4: ±8kV contact, ±15kV air |
| Radiated RF immunity | IEC 61000-4-3 | Level 3: 10 V/m, 80–1000 MHz |
| EFT/Burst immunity | IEC 61000-4-4 | Level 3: ±2kV power, ±1kV I/O |
| Surge immunity | IEC 61000-4-5 | Level 3: ±2kV L-L, ±4kV L-PE |
| Conducted RF immunity | IEC 61000-4-6 | Level 3: 10 Vrms, 0.15–80 MHz |
| Power freq. magnetic field | IEC 61000-4-8 | Level 4: 30 A/m |

---

## 2. Shortlist Lab

### 2.1 TÜV Rheinland Vietnam — EMC & Electrical Laboratory

| Mục | Thông tin |
|-----|-----------|
| **Tên lab** | TÜV Rheinland Vietnam — EMC and Electrical Laboratory |
| **Địa chỉ** | RF-7E, Plot H-1, Thang Long Industrial Park II, Duong Hao Ward, Hung Yen Province, Vietnam |
| **Điện thoại** | +84 2213 974 560 |
| **Email** | info@vn.tuv.com |
| **Website** | https://www.tuv.com/vietnam |
| **Accreditation** | ISO/IEC 17025 — recognized by STAMEQ (Ministry of Science and Technology, Vietnam) |
| **Phạm vi được công nhận** | ITE, industrial equipment, scientific equipment, medical devices — IEC 61326-1 applicable |
| **Cơ sở vật chất** | 10m semi-anechoic chamber, shielded room (4m×6m), pulse immunity room |
| **Chứng nhận có thể cấp** | CR Mark (Vietnam), CB test report (if IECEE recognized), CE/EMC |

**Quote/Status:** ⬜ Chưa gửi RFQ — cần gửi inquiry  
**Lead time ước tính:** 2–4 tuần từ lúc booking đến có kết quả  
**Month 3 slot:** ⬜ Chưa xác nhận  
**Cost/round ước tính:** 7,000–15,000 USD (tùy số test items)  
**Payment terms:** ⬜ Chưa rõ — cần hỏi  
**Booking next step:** Gửi email info@vn.tuv.com với product spec + test scope yêu cầu quote

**Ưu điểm:**
- Lab ISO 17025 ngay tại Việt Nam (Hung Yen) — gần trụ sở KINEXUS
- Có 10m chamber phù hợp cho industrial equipment
- Có thể kết hợp CR Mark nếu cần
- Chi phí cạnh tranh hơn Singapore/HK lab

**Nhược điểm:**
- Chưa confirm rõ ràng IEC 61326-1 trong scope (ITE + industrial equipment là phù hợp, cần xác nhận với lab)
- Lab tương đối mới (2016) so với TUV SUD Singapore

---

### 2.2 TÜV SÜD PSB Singapore — EMC Laboratory

| Mục | Thông tin |
|-----|-----------|
| **Tên lab** | TÜV SÜD PSB Singapore — Electrical & Electronic Lab |
| **Địa chỉ** | 15 International Business Park, TUV SÜD @ IBP, Singapore 609937 |
| **Điện thoại** | +65 6973 6268 (Dr. Deng Jun Hong) |
| **Email** | junhong.deng@tuvsud.com |
| **Website** | https://www.tuvsud.com/en-sg/lp/emc-testing |
| **Accreditation** | SAC-SINGLAS (ISO/IEC 17025), IECEE CB Scheme recognized |
| **Phạm vi được công nhận** | IEC/EN 61326-1 explicitly listed, bao gồm parts -2-1 đến -2-6 |
| **Cơ sở vật chất** | 3m và 10m EMC chambers, 3m RF chambers |
| **Chứng nhận có thể cấp** | CB report, CE/EMC, FCC, các chứng nhận quốc tế khác |

**Quote/Status:** ⬜ Chưa gửi RFQ — cần gửi inquiry  
**Lead time ước tính:** 3–5 tuần (Singapore lab thường busy hơn)  
**Month 3 slot:** ⬜ Chưa xác nhận  
**Cost/round ước tính:** 10,000–18,000 USD (Singapore cost higher)  
**Payment terms:** ⬜ Chưa rõ — cần hỏi  
**Booking next step:** Gửi email junhong.deng@tuvsud.com với product spec + test scope

**Ưu điểm:**
- Scope ISO 17025 **explicitly ghi IEC 61326-1** — đảm bảo report được công nhận
- IECEE CB Scheme — có thể phát hành CB report cho global recognition
- Lab lâu đời, uy tín, facility hiện đại
- One-stop service: EMC + safety (IEC 61010-1) + energy efficiency

**Nhược điểm:**
- Chi phí cao hơn lab trong nước
- Cần gửi mẫu ra Singapore — logistics + customs
- Lead time có thể dài hơn do lab thường xuyên full booking

---

### 2.3 Intertek — Hong Kong EMC Laboratory

| Mục | Thông tin |
|-----|-----------|
| **Tên lab** | Intertek Hong Kong — Electrical & EMC Testing |
| **Địa chỉ** | Hong Kong (multiple labs — cần confirm EMC lab location) |
| **Điện thoại** | (qua website Intertek Hong Kong) |
| **Email** | (qua intertek.com.hk contact form) |
| **Website** | https://www.intertek.com.hk/electrical/ |
| **Accreditation** | HOKLAS (005), HKCAS (015), IAS (TL-964), CNAS (L9373), UKAS |
| **Phạm vi được công nhận** | IEC standards cho electrical/electronic products — cần confirm IEC 61326-1 scope |
| **Cơ sở vật chất** | EMC chambers, safety lab — established >50 years in HK |
| **Chứng nhận có thể cấp** | CE/EMC, FCC, CB scheme, UKCA, các chứng nhận quốc tế |

**Quote/Status:** ⬜ Chưa gửi RFQ — cần gửi inquiry  
**Lead time ước tính:** 3–5 tuần  
**Month 3 slot:** ⬜ Chưa xác nhận  
**Cost/round ước tính:** 9,000–16,000 USD  
**Payment terms:** ⬜ Chưa rõ — cần hỏi  
**Booking next step:** Truy cập intertek.com.hk/electrical/ → gửi inquiry form

**Ưu điểm:**
- Mạng lưới toàn cầu, uy tín lâu năm
- Đa dạng chứng nhận (CE, FCC, CB, UKCA)
- Có thể kết hợp nhiều services trong một lab

**Nhược điểm:**
- Chi phí cao hơn lab trong nước
- Cần confirm IEC 61326-1 trong scope HOKLAS
- Gửi mẫu ra Hong Kong — logistics, customs
- Thời gian chờ có thể dài

---

### 2.4 BACL Vietnam — Hanoi EMC Laboratory (备选)

| Mục | Thông tin |
|-----|-----------|
| **Tên lab** | Bay Area Compliance Laboratories Corp. (BACL) Vietnam |
| **Địa chỉ** | Lot A2 CN1, Tu Liem Small and Medium Industrial Cluster, Minh Khai Ward, North Tu Liem District, Hanoi, Vietnam |
| **Điện thoại** | +84 926868710 |
| **Email** | bacl.vn@baclcorp.com |
| **Website** | https://www.baclcorp.com.cn |
| **Accreditation** | ISO/IEC 17025 — AOSC (Vietnam Accreditation Body) |
| **Phạm vi được công nhận** | 142 standards, 623 test items — EMC, RF, reliability. Cần confirm IEC 61326-1 scope |
| **Cơ sở vật chất** | Rohde & Schwarz, Keysight, AR equipment |
| **Chứng nhận có thể cấp** | CE/EMC, FCC, CR Mark |

**Quote/Status:** ⬜ Chưa gửi RFQ  
**Lead time ước tính:** 2–4 tuần  
**Month 3 slot:** ⬜ Chưa xác nhận  
**Cost/round ước tính:** 5,000–10,000 USD (cạnh tranh nhất)  
**Payment terms:** ⬜ Chưa rõ — cần hỏi  
**Booking next step:** Gửi email bacl.vn@baclcorp.com với product spec

**Ưu điểm:**
- Chi phí thấp nhất trong các lựa chọn
- Lab tại Hà Nội — logistics dễ dàng
- AOSC accreditation — được công nhận tại Việt Nam và quốc tế (ILAC)

**Nhược điểm:**
- Scope có IEC 61326-1 không rõ ràng — cần confirm
- Thương hiệu mới hơn TUV/Intertek
- Chưa rõ kinh nghiệm với industrial control equipment

> **Ghi chú:** BACL Vietnam là **backup option** — chi phí thấp, nhưng cần confirm scope và chất lượng. Dùng nếu TUV Rheinland quá tải hoặc giá cao.

---

## 3. So sánh tổng hợp

| Tiêu chí | TÜV Rheinland VN | TÜV SÜD Singapore | Intertek Hong Kong | BACL Vietnam |
|----------|:----------------:|:-----------------:|:------------------:|:------------:|
| **Vị trí** | Hung Yen, VN | Singapore | Hong Kong | Hanoi, VN |
| **ISO 17025** | ✅ STAMEQ | ✅ SAC-SINGLAS | ✅ HOKLAS | ✅ AOSC |
| **IEC 61326-1 trong scope** | ⚠️ Cần confirm | ✅ Explicit | ⚠️ Cần confirm | ⚠️ Cần confirm |
| **10m chamber** | ✅ | ✅ | ✅ | ⬜ Cần rõ |
| **CB scheme** | ⬜ Cần rõ | ✅ | ✅ | ⬜ Cần rõ |
| **Lead time ước tính** | 2–4 tuần | 3–5 tuần | 3–5 tuần | 2–4 tuần |
| **Cost/round (USD)** | 7,000–15,000 | 10,000–18,000 | 9,000–16,000 | 5,000–10,000 |
| **Logistics** | 📍 Nội địa (dễ) | ✈️ Gửi ra SG | ✈️ Gửi ra HK | 📍 Nội địa (dễ) |
| **Phù hợp Month 3 slot** | ⬜ Cần confirm | ⬜ Cần confirm | ⬜ Cần confirm | ⬜ Cần confirm |
| **Ưu tiên RFQ** | **#1** | **#2** | #3 | **Backup** |

---

## 4. Kế hoạch RFQ

### 4.1 RFQ Priority

| Thứ tự | Lab | Lý do | Hành động |
|:------:|-----|-------|-----------|
| **P0** | TÜV Rheinland Vietnam | Local, chi phí hợp lý, quen thuộc với CR Mark — phù hợp nhất cho KINEXUS | Gửi RFQ **ngay lập tức** |
| **P1** | TÜV SÜD Singapore | IEC 61326-1 explicit scope, CB scheme — backup nếu TUV VN không khả dụng | Gửi RFQ song song |
| **P2** | BACL Vietnam | Backup chi phí thấp, nội địa | Gửi RFQ nếu P0/P1 không phù hợp |

### 4.2 Nội dung RFQ (draft)

Khi gửi RFQ, cần bao gồm:

1. **Product info:** MK-DDC-24 (BACnet DDC Controller), carrier board + CM3 SOM
2. **Standard:** IEC 61326-1 Class A (CISPR 11)
3. **Test scope:**
   - Radiated emissions (30–1000 MHz, 10m)
   - Conducted emissions (0.15–30 MHz, AC power port)
   - IEC 61000-4-2 ESD (±8kV contact, ±15kV air)
   - IEC 61000-4-3 Radiated RF (10 V/m)
   - IEC 61000-4-4 EFT (±2kV power, ±1kV I/O)
   - IEC 61000-4-5 Surge (±2kV L-L, ±4kV L-PE)
   - IEC 61000-4-6 Conducted RF (10 Vrms)
   - IEC 61000-4-8 Magnetic field (30 A/m)
4. **Số lượng mẫu:** 2 units per round
5. **Số vòng:** 2 rounds (Round 1: full test; Round 2: fix verification + re-test)
6. **Timeline mong muốn:** August 2026 (Month 3)
7. **Yêu cầu báo giá:**
   - Cost per test item (breakdown)
   - Cost per round (package)
   - Discount for 2 rounds
   - Lead time from booking to report
   - Report format (ISO 17025 accredited report)
   - Validity of quote

### 4.3 Timeline

| Mốc | Hạn | Hành động |
|-----|:---:|-----------|
| Gửi RFQ | 2026-06-05 | Gửi inquiry đến TUV Rheinland VN + TUV SUD SG |
| Nhận quote | 2026-06-19 (2 tuần) | So sánh, đánh giá, chọn lab |
| Book slot | 2026-06-26 | Confirm booking, đặt cọc (nếu cần) |
| Gửi mẫu | 2026-07-17 (Month 2) | Giao DUT samples cho lab |
| Round 1 test | 2026-08-01 (Month 3) | Full compliance test |
| Round 2 test | 2026-09 (nếu cần) | Fix verification + re-test |
| Final report | 2026-09 | Nhận ISO 17025 accredited report |

---

## 5. Ngân sách dự kiến

### Kịch bản A: TÜV Rheinland Vietnam (khuyến nghị)

| Khoản mục | Chi phí (USD) |
|-----------|:-------------:|
| Round 1 — Full test | 8,000–15,000 |
| Round 2 — Re-test (nếu fail 1–2 items) | 3,000–7,000 |
| Phát sinh (logistics, mẫu, hỗ trợ) | 1,000–2,000 |
| **Tổng ước tính** | **12,000–24,000** |

### Kịch bản B: TÜV SÜD Singapore

| Khoản mục | Chi phí (USD) |
|-----------|:-------------:|
| Round 1 — Full test | 10,000–18,000 |
| Round 2 — Re-test | 4,000–9,000 |
| Logistics (gửi mẫu SG) | 500–1,000 |
| Phát sinh | 1,000–2,000 |
| **Tổng ước tính** | **15,500–30,000** |

### Kịch bản C: BACL Vietnam (backup, chi phí thấp)

| Khoản mục | Chi phí (USD) |
|-----------|:-------------:|
| Round 1 — Full test | 5,000–10,000 |
| Round 2 — Re-test | 2,500–5,000 |
| Phát sinh | 500–1,000 |
| **Tổng ước tính** | **8,000–16,000** |

---

## 6. Rủi ro và giảm thiểu

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
|--------|:--------:|:--------:|-----------|
| Lab không có IEC 61326-1 scope | Thấp (TUV SG có sẵn) | Cao — phải đổi lab | Confirm scope trước khi book |
| Lab full slot Month 3 | Trung bình | Cao — trượt timeline | Book sớm; có backup lab |
| Chi phí vượt ước tính | Trung bình | Trung bình | RFQ chi tiết từng item; giới hạn test scope tối thiểu |
| Fail Round 1 — cần Round 3 | Trung bình | Cao — tăng budget 50% | Pre-compliance kỹ trước khi gửi lab |
| Mẫu không đạt yêu cầu | Thấp | Trung bình | Gửi 2+ mẫu đã pre-test OK |

---

## 7. Kết luận và khuyến nghị

### Khuyến nghị

1. **Gửi RFQ ngay cho TÜV Rheinland Vietnam** (P0) — đây là lựa chọn tối ưu nhất về chi phí, vị trí, và thời gian.
2. **Gửi RFQ song song cho TÜV SÜD Singapore** (P1) — làm backup và để so sánh giá.
3. **Mục tiêu:** Book slot trước cuối tháng 6/2026 để đảm bảo Month 3 (August 2026).
4. **Ngân sách đề xuất:** 15,000–20,000 USD cho 2 rounds (chọn TUV Rheinland VN).
5. **Pre-condition trước khi gửi lab:** Hoàn thành tất cả P1 items trong pre-compliance report (clock harmonics scan, ESD 4kV test, ADC supply noise measurement).

### Next steps

| Bước | Hành động | Owner | Hạn |
|:----:|-----------|-------|:---:|
| 1 | Gửi RFQ inquiry đến TUV Rheinland VN (info@vn.tuv.com) | DeveloperTeam | 2026-06-05 |
| 2 | Gửi RFQ inquiry đến TUV SUD SG (junhong.deng@tuvsud.com) | DeveloperTeam | 2026-06-05 |
| 3 | Nhận và so sánh quote, chọn lab | DeveloperTeam | 2026-06-19 |
| 4 | Book slot + đặt cọc | DeveloperTeam | 2026-06-26 |
| 5 | Hoàn tất pre-compliance physical measurement | HW | Before lab submission |
| 6 | Gửi DUT samples + documentation cho lab | DeveloperTeam | 2026-07-17 |

---

## 8. Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | DeveloperTeam | Tạo shortlist + RFQ comparison cho IEC 61326-1 EMC lab |
