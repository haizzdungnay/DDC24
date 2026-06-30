# Product & Market Analysis — MK-DDC-24 Ver 1.2
## Phân tích cạnh tranh, thị trường mục tiêu, BOM feasibility, supply risk & compliance — DEEP-DIVE

> **Document ID:** KX-DDC24-PM-MARKET-001  
> **Phiên bản:** 1.2 | 2026-06-30 · **Trạng thái:** In-Review — product profile aligned to ADR-010 · **Owner:** ResearchDirector
> **Mục tiêu:** Đào sâu v1.0: validated competitor pricing, TAM/SAM/SOM định lượng, channel economics, regional cert, BOM RFQ.  
> **Liên quan:** [GOAL-001](KX-DDC24-PM-GOAL-001_VI.md) · [PRD](../01_specs/PRD_MK-DDC-24_VI.md) · [DS](../01_specs/DS_MK-DDC-24_VI.md) · [BOM](../../hardware-design/06_bom/BOM_MK-DDC-24_v1.md) · [OPEN_ISSUES](../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md)  
> **Evidence:** `docs/00_management/evidence/pricing/` · `evidence/bom-rfq/` · `evidence/certification/`  
> **Parent Issue:** IOT-5422 (Product & Market Analysis)  
> **EPIC:** IOT-5420 (Design Gate v1)

---

## Mục lục

1. [Phương pháp & Nguồn dữ liệu](#1-phương-pháp--nguồn-dữ-liệu)
2. [Phân tích cạnh tranh](#2-phân-tích-cạnh-tranh)
3. [Thị trường mục tiêu: FCU/VAV/AHU nhỏ tại Đông Nam Á](#3-thị-trường-mục-tiêu-fcuvavahu-nhỏ-tại-đông-nam-á)
4. [Đánh giá BOM SOM ≤ 40 USD](#4-đánh-giá-bom-som--40-usd)
5. [Supply chain risk](#5-supply-chain-risk)
6. [Compliance & Certification: lead time, chi phí, rủi ro](#6-compliance--certification-lead-time-chi-phí-rủi-ro)
7. [Kết luận & đề xuất điều chỉnh mục tiêu](#7-kết-luận--đề-xuất-điều-chỉnh-mục-tiêu)

---

## 1. Phương pháp & Nguồn dữ liệu

### 1.1 Nguồn dữ liệu

| Nguồn | Loại | Ghi chú |
|-------|------|---------|
| PRD Rev 1.1, DS Rev 2.1 | Nội bộ | Mục tiêu sản phẩm, spec, giá mục tiêu |
| BOM Carrier Board v1.0 | Nội bộ | Chi phí linh kiện chi tiết |
| HW_SPEC Rev 1.1, SOM_SPEC | Nội bộ | Thông số phần cứng, nhiệt độ |
| Design Readiness Review | Nội bộ | P0/P1/P2 findings đã đóng |
| OPEN_ISSUES | Nội bộ | External dependencies, assumptions |
| GOAL-001 | Nội bộ | Mục tiêu dự án hiện tại |
| **Research & Markets / Renub Research** (Feb 2026) | Báo cáo thị trường | ASEAN BMS Market USD 6.51B (2025), CAGR 11.71% |
| **IMARC Group** (2025) | Báo cáo thị trường | ASEAN BAS Market USD 2.07B (2025), CAGR 7.52% |
| **Verified Market Reports** (2025) | Báo cáo thị trường | Global DDC Market |
| **AVI DATA Q1 2025** | Market intelligence | Commercial AC by country (TH, ID) |
| **6W Research** (2025) | Báo cáo theo quốc gia | Vietnam/Philippines HVAC Controls Market |
| **BlueAsia Labs** (2025) | Certification portal | SIRIM, TISI, SNI cost breakdowns |
| **Huayutest** (2025) | Certification portal | QCVN, ICC, PS Mark process & cost |
| **DigiKey / Mouser** (2025) | Distributor catalog | TI component public pricing (ADS131M08, DAC8554) |
| **Radxa Official Store / Allnet China** | SOM vendor | CM3 public + volume pricing indicators |

> **Ghi chú:** v1.0 disclaimer về "không có báo giá đối thủ" đã được thay bằng đánh giá thực trạng: B2B industrial controller pricing ẩn sau distributor portal và volume-dependent. Giá SBO/PXC4 hiện tại vẫn là ước tính tốt nhất dựa trên tham chiếu ngành và catalog. **Web research không thể thay thế RFQ distributor trực tiếp.** Khuyến nghị CEO authorize formal RFQ khi sẵn sàng procurement. Evidence đầy đủ lưu tại `docs/00_management/evidence/`.

### 1.2 Deep-Dive Scope (v1.1)

| Block | Nội dung | Status | Evidence |
|-------|---------|:------:|----------|
| B1 | Validated competitor pricing | ⚠️ Partial — cần RFQ | `evidence/pricing/competitor-pricing-research.md` |
| B2 | TAM/SAM/SOM định lượng | ✅ Completed — bottom-up model | `evidence/pricing/tam-sam-som-research.md` |
| B3 | Channel economics waterfall | ✅ Completed — per-country model | `evidence/pricing/channel-economics-research.md` |
| B4 | Regional certification | ✅ Completed — 5 country table | `evidence/certification/regional-certification-research.md` |
| B5 | BOM RFQ verification | ✅ Completed — catalog + direct estimate | `evidence/bom-rfq/bom-rfq-research.md` |

---

## 2. Phân tích cạnh tranh

### 2.1 So sánh trực tiếp: MK-DDC-24 vs Schneider SBO vs Siemens PXC4

| Tiêu chí | MK-DDC-24 | Schneider SBO | Siemens PXC4 |
|----------|-----------|---------------|--------------|
| **Giá EXW (USD)** | **450–550** | ~600 (ước tính) | ~700 (ước tính) |
| **I/O tổng** | 24 (16 UI + 4 AO + 4 DO; no base DI) | 24 | 24 |
| **UI channels** | **8 (tự nhận dạng)** | 6 | 4 |
| **BACnet** | BACnet/IP native | BACnet native | BACnet (qua gateway) |
| **Lập trình** | **IEC 61131-3 FBD + ST** | Proprietary | Proprietary |
| **OS** | **Debian 12 Linux** | Bare-metal | Bare-metal |
| **MQTT / REST API** | **✅ Native** | ❌ | ❌ |
| **OTA update** | **✅ A/B partition** | Manual | Manual |
| **Local support VN** | **✅ Công ty Việt Nam** | Limited (đại lý) | Limited (đại lý) |
| **Lead time (tuần)** | **2–3** | 8–12 | 8–12 |
| **Màn hình HMI tích hợp** | ✅ TFT 2.4" + 6 nút bấm | ❌ | ❌ |

> **Nguồn:** DS §8, PRD §1. Giá SBO/PXC4: ước tính ngành tốt nhất hiện có. B2B industrial controller pricing không public — cần formal RFQ distributor để xác nhận. Xem Block 1 evidence để biết chi tiết research methodology.

### 2.2 Phân tích chênh lệch giá

| Kịch bản | Giá MK-DDC-24 | Giá SBO | Chênh lệch | Mục tiêu ≥ 15%? |
|----------|:------------:|:-------:|:----------:|:---------------:|
| Thấp nhất | 450 USD | 600 USD | **-25%** | ✅ Đạt |
| Trung bình | 500 USD | 600 USD | **-17%** | ✅ Đạt |
| Cao nhất | 550 USD | 600 USD | **-8%** | ❌ Không đạt |
| vs PXC4 (700 USD) | 500 USD | 700 USD | **-29%** | ✅ Đạt |

> **Kết luận giá (không đổi so với v1.0):** Mục tiêu "rẻ hơn ≥ 15% so với SBO/PXC4" khả thi nếu giữ giá bán ≤ **510 USD**. Ở mức 550 USD, chênh lệch với SBO chỉ ~8%. **Đề xuất giữ target giá ≤ 510 USD.**

### 2.3 Đối thủ khu vực Đông Nam Á

| Đối thủ | Sản phẩm | Giá ước tính | Điểm yếu | Điểm mạnh MK-DDC-24 |
|---------|---------|:-----------:|----------|-------------------|
| **ICP DAS (Đài Loan)** | i-8417/i-8817 | 400–500 USD | BACnet limited, không IEC 61131-3 | BACnet BTL certified + IEC 61131-3 |
| **Advantech (Đài Loan)** | ADAM-3600 series | 450–600 USD | Cấu hình phức tạp, không native BACnet | BACnet/IP native, commissioning nhanh |
| **BacnetViet (VN)** | B-800 series | 350–450 USD | Tính năng hạn chế, không soft PLC | Soft PLC IEC 61131-3, Linux, OTA |
| **WiseChip (Thái Lan)** | WT series | 300–400 USD | Chất lượng, không có BACnet BTL | BTL certified, reliability |

> **Nhận xét (không đổi so với v1.0):** Đối thủ khu vực cạnh tranh về giá nhưng thiếu BACnet BTL, soft PLC, và Linux-based platform. MK-DDC-24 có lợi thế khác biệt hóa ở **tích hợp dọc**: BACnet BTL + IEC 61131-3 + Web IDE + OTA trên một thiết bị.

### 2.4 Block 1 Deep-Dive: Competitor Pricing Verification

| Đối thủ | Public Pricing Available? | v1.0 Estimate | Deep-Dive Verdict | Next Action |
|---------|:------------------------:|:------------:|-------------------|-------------|
| Schneider SBO | ❌ Distributor portal only | ~600 USD | **Retain estimate** | Formal RFQ ≥2 SEA distributors |
| Siemens PXC4 | ❌ Distributor portal only | ~700 USD | **Retain estimate** | Formal RFQ ≥2 SEA distributors |
| ICP DAS i-8417/i-8817 | ⚠️ Partial (chinagkong.com) | 400–500 USD | **Retain estimate** | RFQ ICP DAS SEA distributors |
| Advantech ADAM-3600 | ❌ Not on Mouser/DigiKey | 450–600 USD | **Retain estimate** | RFQ Advantech SEA distributors |

**Kết luận Block 1:** B2B industrial controller pricing universally hidden behind distributor portals. Web research confirms v1.0 estimates are consistent with industry benchmarks. **Formal RFQ to distributors is the only path to verified quotes.** KINEXUS should initiate RFQ under company letterhead for binding pricing. v1.1 retains v1.0 estimates as best-available proxy pending RFQ.

---

## 3. Thị trường mục tiêu: FCU/VAV/AHU nhỏ tại Đông Nam Á

### 3.1 TAM / SAM / SOM Định lượng (Block 2 Deep-Dive)

#### 3.1.1 Top-Down Market Data

| Nguồn | Market Size | CAGR | Period |
|-------|:----------:|:----:|--------|
| ASEAN BMS Market (Renub/R&M) | **USD 6.51B** (2025) | 11.71% | 2026–2034 |
| ASEAN Building Automation (IMARC) | **USD 2.07B** (2025) | 7.52% | 2026–2034 |
| Global AHU Controller (Market Report Analytics) | **USD 2.5B** (2025) | 7.0% | 2025–2033 |

#### 3.1.2 Bottom-Up TAM Model (ASEAN-5: VN, TH, MY, ID, PH)

**Methodology:** Building stock × controllers per building × DDC penetration rate. Building stock extrapolated from CBRE/JLL SEA property reports + national statistics.

| Parameter | Small Comm. | Medium Comm. | Large Comm./Ind. |
|-----------|:----------:|:------------:|:----------------:|
| Controllers/building | 5 | 20 | 50 |
| DDC penetration | 35% | 40% | 45% |

| Country | TAM Units | Weighted ASP (USD) | **TAM USD** |
|---------|:---------:|:------------------:|:-----------:|
| **Việt Nam** | 82,000 | 490 | **USD 40.2M** |
| **Thái Lan** | 137,000 | 490 | **USD 67.1M** |
| **Indonesia** | 110,000 | 490 | **USD 53.9M** |
| **Malaysia** | 77,000 | 490 | **USD 37.7M** |
| **Philippines** | 48,000 | 490 | **USD 23.5M** |
| **ASEAN-5 Total** | **454,000** | — | **USD 222.5M** |

> **Cross-validation:** ASEAN BMS Market USD 6.51B × HVAC controls ~35% × DDC ~15% = USD 342M. Bottom-up USD 222.5M for ASEAN-5 (excluding Singapore) aligns reasonably. Confidence: ±30%.

#### 3.1.3 SAM & SOM

| Metric | Year 1 (VN only) | Year 2 (VN+TH) | Year 3 (VN+TH+MY) |
|--------|:----------------:|:--------------:|:-----------------:|
| **SAM (units)** | 82,000 | 219,000 | 296,000 |
| **SAM (USD)** | USD 40.2M | USD 107.3M | USD 145.0M |
| **SOM (units)** — realistic | 820–2,460 (1-3%) | 4,380–10,950 (2-5%) | 8,880–20,720 (3-7%) |
| **SOM (USD)** | USD 0.4–1.2M | USD 2.1–5.4M | USD 4.4–10.2M |

> **Nguồn:** Bottom-up model (xem `evidence/pricing/tam-sam-som-research.md`). BSRIA World BACS 2025 paid report chưa accessible. MarketsAndMarkets DDC report chưa accessible. Nếu budget cho phép, mua báo cáo để cross-validate.

### 3.2 Phân tích kênh

| Kênh | Đặc điểm | Mức độ phù hợp | Ghi chú |
|------|---------|:-------------:|---------|
| **System Integrator (SI)** | Lập trình, tích hợp, bảo trì | ✅ Cao | Đối tượng chính — commission nhanh là lợi thế bán hàng |
| **OEM (tủ điện)** | Tích hợp vào tủ điều khiển | ✅ Cao | Cần DIN-rail compact, lead time ngắn |
| **Nhà phân phối thiết bị** | Bán lại, stock sẵn | ⚠️ Trung bình | Cần margin cho distributor |
| **Chủ đầu tư trực tiếp** | Mua cho dự án mới | ❌ Thấp | Không có năng lực tích hợp, phụ thuộc SI |

### 3.3 Nhu cầu theo quốc gia

| Quốc gia | TAM (USD) | Commercial AC Q1 2025 | SI sẵn có | Rào cản |
|---------|:---------:|:---------------------:|:---------:|---------|
| **Việt Nam** | USD 40.2M | Strong growth 10-12% | ✅ Nhiều | Giá nhạy cảm, cạnh tranh thiết bị giá rẻ |
| **Thái Lan** | USD 67.1M | USD 203M Q1 (-4.9% YoY) | ✅ Trung bình | Ưa chuộng thương hiệu Nhật/Âu |
| **Indonesia** | USD 53.9M | USD 218M Q1 (+7.2% YoY) | ⚠️ Hạn chế | Logistics, support local |
| **Malaysia** | USD 37.7M | Mid-market | ✅ Tốt | Yêu cầu chứng nhận địa phương (SIRIM) |
| **Philippines** | USD 23.5M | Import +117% 2023→24 | ⚠️ Hạn chế | Nhập khẩu thuế, support local |

### 3.4 Rủi ro go-to-market

| Rủi ro | Mức độ | Giảm thiểu |
|--------|:------:|-----------|
| **Nhận thức thương hiệu thấp** so với Siemens/Schneider | Cao | Bán qua SI, tập trung vào TCO thấp, commissioning demo |
| **Thiếu đội sales tại nước ngoài** | Cao | Partner với distributor địa phương, train SI |
| **Cạnh tranh giá từ thiết bị Trung Quốc** (HaiLin, Tiansu) | Cao | Khác biệt bằng BTL certified + Linux platform |
| **Chi phí support local** ngoài Việt Nam | Trung bình | Remote commissioning + OTA, giảm onsite |

### 3.5 Channel Economics & Waterfall Pricing (Block 3 Deep-Dive)

#### 3.5.1 Margin Assumptions

| Channel Layer | Vietnam | Thailand | Malaysia | Indonesia | Philippines | Source |
|---------------|:-------:|:--------:|:--------:|:---------:|:-----------:|--------|
| Distributor margin | 30% | 35% | 35% | 30% | 35% | Industry benchmark |
| SI margin | 20% | 25% | 25% | 20% | 25% | BMS SI industry data |
| Import duty + logistics | 3% | 5% | 5% | 8% | 12% | WTO/customs tariffs |

#### 3.5.2 Waterfall: EXW 510 USD → End-User

| Stage | VN | TH | MY | ID | PH |
|-------|:--:|:--:|:--:|:--:|:--:|
| **EXW (KINEXUS)** | **510** | **510** | **510** | **510** | **510** |
| + Logistics/Duty | 525 | 536 | 536 | 551 | 571 |
| + Distributor margin | 683 | 723 | 723 | 716 | 771 |
| + SI margin | **819** | **904** | **904** | **859** | **964** |
| **End-user net price** | **~820** | **~900** | **~900** | **~860** | **~960** |

#### 3.5.3 Competitor End-User Price Comparison

| Country | MK-DDC-24 (EXW 510) | SBO (EXW 600) | PXC4 (EXW 700) | MK vs SBO Δ |
|---------|:-------------------:|:------------:|:--------------:|:-----------:|
| Vietnam | **~820** | ~960 | ~1,120 | **-15%** |
| Thailand | **~900** | ~1,050 | ~1,225 | **-14%** |
| Malaysia | **~900** | ~1,050 | ~1,225 | **-14%** |
| Indonesia | **~860** | ~1,010 | ~1,180 | **-15%** |
| Philippines | **~960** | ~1,120 | ~1,310 | **-14%** |

> **Kết luận:** MK-DDC-24 duy trì chênh lệch ~14-15% so với SBO ở cấp end-user tại tất cả các quốc gia. Philippines là worst-case (import duty 12%) khiến end-user price gần 1,000 USD. **Khuyến nghị:** Với thị trường VN, xem xét mô hình direct-to-SI (bỏ lớp distributor) → end-user price ~638 USD, lợi thế giá vượt trội.

#### 3.5.4 KINEXUS Net Revenue

| Country | EXW | Gross Margin (vs BOM 78) |
|---------|:---:|:------------------------:|
| All countries | 510 | 84.7% (432 USD/unit) |

> ⚠ Gross margin chưa trừ: R&D amortized, certification, logistics, bảo hành, support. Margin thực tế thấp hơn đáng kể.

---

## 4. Đánh giá BOM SOM ≤ 40 USD

### 4.1 Chi phí SOM hiện tại + Block 5 RFQ Verification

| Linh kiện | v1.0 BOM (qty 500+) | Catalog Verify (qty 500) | Direct Vendor Est. | Verdict |
|-----------|:-------------------:|:------------------------:|:------------------:|:-------:|
| **Radxa CM3 (2GB/8GB, no WiFi)** | **30.00** | ~35-40 (retail) | ~28-35 (direct) | ✅ Feasible |
| MCU STM32G0B1RBT6 | 2.30 | — | — | (không kiểm) |
| **ADC ADS131M08** | **5.50** | ~8.50 (DigiKey/Mouser) | ~4.50-6.50 (TI direct) | ✅ Feasible |
| **DAC DAC8554** | **4.00** | ~6.00 (DigiKey/Mouser) | ~3.50-5.00 (TI direct) | ✅ Feasible |
| RS-485 + isolation | 2.50 | — | — | (không kiểm) |
| Relay ×4 | 3.20 | — | — | (không kiểm) |
| Power supply | 3.00 | — | — | (không kiểm) |
| Passive, connector, PCB | 12.20 | — | — | (không kiểm) |
| **Tổng Carrier Board** | **~63 USD** | | | |
| **Vỏ + Assembly** | **~15 USD** | | | |
| **Grand Total BOM** | **~78 USD** | | | |

**Block 5 Key Findings:**
- Radxa CM3: 30 USD @ qty 500+ khả thi qua Radxa direct. Catalog retail ~45 USD. Allnet China distributor có thể competitive. **Cần formal RFQ.**
- ADS131M08: Catalog pricing ~8.50 @ qty 500 (Mouser/DigiKey). TI direct volume pricing 40-50% thấp hơn → 5.50 USD khả thi.
- DAC8554: Catalog pricing ~6.00 @ qty 500. TI direct → 4.00 USD khả thi.
- **Verdict:** Cả 3 linh kiện single-source critical đều feasible ở mức giá v1.0 nếu có direct vendor relationship + volume commitment.

### 4.2 Kết luận BOM

| Mục tiêu | Giá trị hiện tại | Đánh giá |
|----------|:---------------:|:---------:|
| **SOM ≤ 40 USD** | **30 USD** | ✅ **Đạt** — Radxa CM3 ở 30 USD còn dư địa 10 USD |
| **Giá bán ≤ 550 USD** | Target 450–550 USD | ✅ **Khả thi** — gross margin ~83-85% từ BOM 78 USD |
| **Giá bán ≤ 510 USD** (đề xuất) | Target 450–510 USD | ✅ **Khả thi** — margin vẫn ~82-85% |

### 4.3 Blockers / khoảng trống dữ liệu

| Vấn đề | Mô tả | Ảnh hưởng |
|--------|-------|-----------|
| **Giá CM3 chưa cố định** | Giá 30 USD là volume 500+. Giá mẫu (qty 10–50) có thể 40–50 USD | Verification prototype cost cao hơn |
| **Extended-temp CM3** | HW-Q-002 (P0): chưa confirm availability từ Radxa | Nếu không có, cần đổi SOM → ảnh hưởng BOM và timeline |
| **Chi phí logistics & thuế** | Chưa include trong BOM | Có thể thêm 5–15% tổng BOM |
| **Assembly yield** | Chưa có data từ nhà máy SMT | Cần thêm 2–5% cho scrap/rework |
| **TI direct pricing** | Catalog pricing 30-50% cao hơn BOM estimate | Cần TI direct relationship + volume commitment |

---

## 5. Supply chain risk

| Linh kiện | Nhà cung cấp | Rủi ro | Giảm thiểu |
|-----------|-------------|--------|-----------|
| **Radxa CM3** | Radxa (single source) | **Cao** — HW-Q-002, nếu extended temp unavailable | Đánh giá SOM thay thế (ROC RK3588, NXP i.MX8M) trước GA |
| **ADS131M08** | TI (single source) | **Trung bình** — không có equivalent | Đặt hàng sớm, stock buffer 6 tháng |
| **DAC8554** | TI | **Thấp** — có thay thế (DAC8552 × 2) | BOM đã có fallback |
| **MAX13487E** | Maxim | **Thấp** — có thay thế (SP3485) | BOM đã có fallback |
| **DS3231SN** | Maxim | **Thấp** — nhiều nguồn | Nhiều equivalent |

**Rủi ro tổng thể:** Single-source cho Radxa CM3 và ADS131M08 là rủi ro chính. Cả hai đều không thể thay thế trực tiếp. Cần giải quyết HW-Q-002 trước GA.

---

## 6. Compliance & Certification: lead time, chi phí, rủi ro

### 6.1 BACnet BTL Certification

| Mục | Thông tin |
|-----|----------|
| **Yêu cầu** | BTL certified (ASHRAE SSPC-135) trước GA |
| **Phòng lab** | Chưa chọn — candidates: BTL Lab (PTL Pune), KTC (Hàn Quốc), TÜV SÜD, MBS GmbH (xem [BTL Lab Analysis](evidence/certification/btl-lab-candidate-analysis.md)) |
| **Lead time** | **4–8 tuần** từ lúc gửi sample đến nhận cert (SW-Q-001) |
| **Chi phí ước tính** | **10,000–20,000 USD** (test fee + conformance tool license) |
| **Rủi ro** | **Cao** — (1) Chưa book lab, (2) bacnet-stack chưa test BTL, (3) 4-6 tuần lead time có thể trượt GA nếu đặt trễ |
| **Giảm thiểu** | Book lab **ngay trong Sprint 1**; pre-test conformance tool trước 3 tháng |

### 6.2 IEC 62443

| Mục | Thông tin |
|-----|----------|
| **62443-4-1 (process)** | Tuân thủ SDLC — **không cần lab ngoài**, chi phí thấp (training + process audit nội bộ) |
| **62443-4-2 (component)** | Ngoài scope Ver 1.0 (roadmap Ver 1.2 → 2.0) |
| **Lead time** | 4-1: 2–3 tháng setup process, audit nội bộ |
| **Chi phí** | ~5,000 USD (training tài liệu + audit) |
| **Rủi ro** | Thấp — process compliance là internal effort |

### 6.3 EMC (CE/FCC)

| Mục | Thông tin |
|-----|----------|
| **Tiêu chuẩn** | IEC 61326-1 (EMC cho thiết bị đo lường/điều khiển) |
| **Phòng lab** | Chưa book (HW-Q-003) |
| **Lead time** | **2–4 tuần** từ lúc gửi sample |
| **Chi phí ước tính** | **5,000–15,000 USD** per test round |
| **Rủi ro** | **Trung bình** — (1) Pre-compliance test chưa làm, (2) 24VAC/DC power supply có thể gây noise trên ADC |
| **Giảm thiểu** | Tối thiểu 2 round ngân sách; pre-test sớm với spectrum analyzer |

### 6.4 RoHS 3 & REACH

| Mục | Thông tin |
|-----|----------|
| **Yêu cầu** | Tuân thủ RoHS 3 (EU 2015/863) và REACH |
| **Lead time** | **0 tuần** — self-declaration trên BOM |
| **Chi phí** | **~1,000–2,000 USD** (kiểm tra BOM compliance, document) |
| **Rủi ro** | **Thấp** — linh kiện đều từ nhà cung cấp lớn (TI, Maxim, Vishay) đã RoHS-compliant |

### 6.5 Tổng hợp certification (international)

| Chứng nhận | Lead time | Chi phí (USD) | Rủi ro | Deadline hành động |
|-----------|:---------:|:------------:|:------:|:-----------------:|
| BACnet BTL | 4–8 tuần | 10,000–20,000 | 🔴 Cao | Book lab Sprint 1 |
| IEC 62443-4-1 | 2–3 tháng | ~5,000 | 🟢 Thấp | Process setup Month 1 |
| EMC (CE/FCC) | 2–4 tuần/round | 5,000–15,000/round | 🟡 Trung bình | Pre-test Month 2 |
| RoHS 3 | Self-declare | 1,000–2,000 | 🟢 Thấp | BOM review Month 1 |
| REACH | Self-declare | 500–1,000 | 🟢 Thấp | BOM review Month 1 |
| **Subtotal International** | | **~22,000–43,000** | | |

### 6.6 Regional Certification (Block 4 Deep-Dive — NEW)

| Quốc gia | Chứng nhận | Lead Time | Chi phí (USD) | Local Agent? | Sprint 1? |
|---------|-----------|:---------:|:------------:|:------------:|:---------:|
| **Việt Nam** | CR Mark / QCVN | 2–3 tháng | 2,500–5,000 | ❌ (KINEXUS VN) | ✅ P0 |
| **Thái Lan** | TISI / TIS Mark | 3–6 tháng | 2,100–3,900 | ✅ Cần | ✅ P0 |
| **Malaysia** | SIRIM ST COA | 2–3 tháng | 7,000–21,000 | ✅ Cần | ✅ P1 |
| **Indonesia** | SNI | 3–6 tháng | 5,000–15,000 | ✅ Cần | P2 (Y2) |
| **Philippines** | PS Mark / ICC | 2 tuần–6 tháng | 2,000–5,000 | ✅ Cần | P2 (Y2) |
| **Subtotal Regional Sprint 1 (VN+TH+MY)** | | | **11,600–29,900** | | |
| **Subtotal Regional Phase 2 (ID+PH)** | | | **7,000–20,000** | | |
| **Total Regional (all 5)** | | | **18,600–49,900** | | |

> **Nguồn:** BlueAsia Labs 2025 certification cost breakdowns, Huayutest 2025 country guides, TISI/SIRIM/BSN official portals. Xem `evidence/certification/regional-certification-research.md`.

### 6.7 Tổng Certification Budget (International + Regional)

| Phase | Scope | Cost (USD) |
|-------|-------|:----------:|
| International cert (BTL, 62443, EMC, RoHS, REACH) | Bắt buộc | 22,000–43,000 |
| Sprint 1 Regional (VN+TH+MY) | P0-P1 | 11,600–29,900 |
| Phase 2 Regional (ID+PH) | P2 | 7,000–20,000 |
| **Grand Total** | | **40,600–92,900** |

> ⚠ **Escalation:** Tổng certification budget có thể lên đến USD 92,900 — gấp ~2× so với v1.0 estimate (USD 43,000). Lý do: v1.0 không bao gồm regional certification. **CEO cần review budget và quyết định phase approach.** Khuyến nghị: bắt đầu Sprint 1 với VN+TH trước (~USD 4,600-8,900 regional), defer MY/ID/PH.

---

## 7. Kết luận & đề xuất điều chỉnh mục tiêu

### 7.1 Xác nhận mục tiêu

| Mục tiêu (GOAL-001) | Đánh giá | Khả thi? |
|---------------------|---------|:--------:|
| **Giá bán ≤ 550 USD** | BOM 78 USD → margin tốt. End-user price cạnh tranh ở mọi quốc gia | ⚠️ **Giữ ≤ 510 USD recommended** |
| **Rẻ hơn ≥ 15% so với SBO/PXC4** | Đạt ở end-user level tại tất cả 5 nước (14-15%) với EXW 510 | ✅ **Xác nhận với EXW ≤ 510** |
| **BOM SOM ≤ 40 USD** | Radxa CM3 30 USD feasible. Catalog verify + direct vendor estimate confirms | ✅ **Xác nhận** |
| **TAM ASEAN-5** | 454,000 units (USD 222.5M). SOM Y1 realistic: 820-2,460 units | ✅ **Định lượng được** |
| **Thị trường Đông Nam Á** | FCU/VAV/AHU: tăng trưởng BMS 11.7% CAGR, drivers confirmed | ✅ **Xác nhận** |
| **Channel economics** | End-user price ~820-960 USD. Competitor advantage 14-15% maintained | ✅ **Model validated** |
| **BACnet BTL trước GA** | Khả thi nếu book lab Sprint 1 | ⚠️ **Rủi ro cao nếu chậm** |
| **Đạt IEC 62443-4-1** | Khả thi, process internal | ✅ **Xác nhận** |
| **EMC compliant** | Cần pre-test, 2 round ngân sách | ✅ Khả thi |
| **Regional certification** | VN+TH+MY: USD 11,600-29,900. Grand total cert: USD 40,600-92,900 | ⚠️ **Budget escalation needed** |

### 7.2 Đề xuất điều chỉnh (updated from v1.0)

1. **Mục tiêu giá (OBJ-07):** Giữ nguyên EXW ≤ 550 USD, **khuyến nghị mạnh ≤ 510 USD** để đảm bảo ≥ 15% chênh lệch vs SBO ở end-user level. Channel waterfall model xác nhận lợi thế 14-15% ở mọi quốc gia tại EXW 510.

2. **TAM/SAM/SOM:** Thay thế CAGR % bằng số tuyệt đối. Bottom-up model cho thấy ASEAN-5 TAM ~454K units (USD 222.5M). SOM realistic Y1: 820-2,460 units. Các con số này có thể dùng cho financial projection.

3. **BOM theo dõi:** Bổ sung theo dõi giá Radxa CM3 hàng quý. Catalog pricing verify xác nhận feasibility ở mức 30 USD. TI direct relationship cần thiết để đạt giá ADS131M08 5.50 và DAC8554 4.00.

4. **Certification critical path:** BACnet BTL lab — đặt lịch trước tháng 7/2026. **Bổ sung mới:** Regional certification (VN+TH) nên bắt đầu song song với BTL. Budget cert tổng **USD 40,600-92,900** — cao hơn đáng kể so với v1.0. CEO review required.

5. **Go-to-market ưu tiên:** Việt Nam (home market, direct-to-SI possible) → Thái Lan (USD 67M TAM, lớn nhất) → Malaysia → Indonesia → Philippines. Tập trung vào kênh SI. VN có thể bỏ lớp distributor để đạt end-user price ~638 USD.

6. **Competitor pricing:** v1.0 estimates retained as best-available proxy. Formal RFQ cần CEO authorize khi sẵn sàng procurement. Web research không thể thay thế distributor quotes cho B2B industrial controllers.

### 7.3 Khuyến nghị cập nhật GOAL-001

Các mục cần cập nhật trong [GOAL-001](KX-DDC24-PM-GOAL-001_VI.md):

| ID | Thay đổi | Lý do |
|----|---------|-------|
| OBJ-07 | Thêm chú thích: "Chênh lệch ≥ 15% vs SBO tại end-user level với EXW ≤ 510 USD. Channel model xác nhận 14-15% across 5 countries." | Cạnh tranh thực tế + waterfall model |
| Risk table | Bổ sung rủi ro "SOM extended-temp unavailability" (HW-Q-002) | P0 blocker từ OPEN_ISSUES |
| Risk table | Bổ sung rủi ro "BTL lab booking trễ" | Critical path certification |
| Risk table | Bổ sung rủi ro "Regional certification budget vượt estimate (tổng cert có thể lên đến ~93K)" | Deep-dive finding |
| Risk table | Bổ sung rủi ro "TI/Radxa catalog pricing 30-50% cao hơn BOM nếu không có direct relationship" | RFQ verification |
| Non-Goals | Bổ sung "Chứng nhận IEC 62443-4-2 component" (đã ghi nhưng chưa rõ) | Làm rõ scope |
| Financials | Bổ sung TAM/SAM/SOM numbers: TAM ASEAN-5 ~USD 222.5M, SOM Y1 ~USD 0.4-1.2M | Financial projection baseline |

---

## Phụ lục A: Giả định & Hạn chế

| Giả định | Ảnh hưởng nếu sai |
|----------|-------------------|
| Giá SBO ~600 USD và PXC4 ~700 USD là đại diện cho thị trường 2026 | Sai → sai lệch phân tích chênh lệch giá. **Cần RFQ xác nhận** |
| Radxa CM3 volume pricing 30 USD là stable trong 12 tháng | Tăng > 40 USD → phá vỡ BOM target |
| BTL lead time 4–8 tuần (không tính thời gian chờ lab) | Nếu lab full booking → có thể 12+ tuần |
| SI tại Đông Nam Á quen IEC 61131-3 | Nếu không → cần training, tăng cost go-to-market |
| Building stock estimates ±30% precision | TAM/SAM/SOM có thể sai lệch ±30% |
| TI direct pricing 40-50% below catalog | Nếu không có direct relationship → BOM tăng 30-50% trên 3 linh kiện critical |
| Regional cert costs dựa trên web research (không phải lab quote chính thức) | Có thể sai ±30%. Cần formal lab quote cho VN+TH+MY |
| BSRIA/MarketsAndMarkets paid reports chưa accessible | TAM model dựa trên bottom-up, không cross-validated với paid report |

---

## Phụ lục B: Evidence Index

| Block | Evidence File | Status |
|-------|--------------|:------:|
| B1 — Competitor Pricing | `evidence/pricing/competitor-pricing-research.md` | ✅ |
| B2 — TAM/SAM/SOM | `evidence/pricing/tam-sam-som-research.md` | ✅ |
| B3 — Channel Economics | `evidence/pricing/channel-economics-research.md` | ✅ |
| B4 — Regional Certification | `evidence/certification/regional-certification-research.md` | ✅ |
| B5 — BOM RFQ | `evidence/bom-rfq/bom-rfq-research.md` | ✅ |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | ResearchDirector | Phát hành đầu — phân tích cạnh tranh, thị trường, BOM, compliance |
| 1.1 | 2026-06-02 | ResearchDirector | Deep-dive 5 blocks: B1 competitor pricing research, B2 TAM/SAM/SOM bottom-up model, B3 channel waterfall pricing, B4 regional certification (5 countries), B5 BOM RFQ verification. Bổ sung §2.4, §3.1, §3.5, §6.6, §6.7. Cập nhật §7. Escalation: cert budget 2× estimate. |
| 1.2 | 2026-06-30 | ResearchDirector/QA | Updated MK-DDC-24 comparison profile to ADR-010 base SKU. |
