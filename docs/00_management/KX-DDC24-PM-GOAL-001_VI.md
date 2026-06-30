# Project Goals — MK-DDC-24
## Mục tiêu dự án

> **Document ID:** KX-DDC24-PM-GOAL-001
> **Phiên bản:** 1.3 | 2026-06-30 · **Trạng thái:** In-Review — I/O baseline aligned to ADR-010 · **Owner:** PMO
> *Cập nhật theo [PM-MARKET-001 v1.1](KX-DDC24-PM-MARKET-001_VI.md)*
> 📘 [docs/README](../README.md) · Liên quan: [PM-OVERVIEW](KX-DDC24-PM-OVERVIEW-001_VI.md) · [PRD](../01_specs/PRD_MK-DDC-24_VI.md) · [IMPLPLAN](KX-DDC24-PM-IMPLPLAN-001_VI.md)

---

## 1. Tuyên bố Mục tiêu (Goal Statement)

> Phát triển và đưa ra thị trường **MK-DDC-24** — bộ điều khiển DDC compact, chuẩn mở, Linux-based — làm giải pháp điều khiển **FCU / VAV / AHU nhỏ** cho tòa nhà thương mại tại **Đông Nam Á**, với chi phí cạnh tranh, tích hợp BMS nhanh và bảo mật theo IEC 62443, đạt **chứng nhận BACnet BTL** trước khi ship Ver 1.0 GA.

---

## 2. Mục tiêu Chiến lược (Strategic Goals)

| # | Mục tiêu | Vì sao quan trọng |
|---|----------|-------------------|
| G1 | **Chuẩn mở, không vendor lock-in** | IEC 61131-3 + BACnet BTL giúp SI/BMS tích hợp tự do, mở rộng thị trường |
| G2 | **Giá cạnh tranh** | Thấp hơn ≥ 10% so với SBO, ≥ 20% so với PXC4 để thắng thầu phân khúc tầm trung. Mục tiêu khuyến nghị: ≥ 15% vs SBO tại mức giá ~500 USD (xem PM-MARKET-001 §2.2) |
| G3 | **Tích hợp & commissioning nhanh** | Giảm chi phí nhân công lắp đặt — lợi thế bán hàng cho SI/OEM |
| G4 | **Bảo mật tích hợp (security-by-design)** | Đáp ứng yêu cầu hạ tầng tòa nhà hiện đại; nền tảng cho IEC 62443-4-2 |
| G5 | **Nền tảng mở rộng được** | Kiến trúc 2 lớp + Modbus RTU master + roadmap edge-AI cho tương lai |

---

## 3. Mục tiêu SMART (Đo lường được)

> Các chỉ tiêu định lượng cho **Ver 1.0 (GA)**. Nguồn: [PRD §1, §5, §9](../01_specs/PRD_MK-DDC-24_VI.md).

### 3.1 Sản phẩm & Kỹ thuật

| ID | Mục tiêu | Chỉ tiêu | Tham chiếu |
|----|----------|----------|------------|
| OBJ-01 | Điều khiển real-time ổn định | Control loop jitter ≤ **5 ms** (PREEMPT_RT) | NFR-001 |
| OBJ-02 | Đáp ứng BACnet | Who-Is → I-Am < **100 ms**; ghi PV → output < **500 ms** | NFR-002, UC-02 |
| OBJ-03 | Độ tin cậy | Uptime ≥ **99.9%**; MTBF ≥ **60.000 h** @ 40°C | NFR-003/004 |
| OBJ-04 | Sampling I/O tại MCU | ≤ **1 ms** | FR-015 |
| OBJ-05 | Dải nhiệt độ hoạt động | **-20°C … +65°C**, 10–90% RH | NFR-010 |
| OBJ-06 | OTA an toàn | Downtime ≤ **60 s**, rollback A/B tự động khi boot lỗi | NFR-007, UC-03 |

### 3.2 Thương mại

| ID | Mục tiêu | Chỉ tiêu | Tham chiếu |
|----|----------|----------|------------|
| OBJ-07 | Giá bán | ≤ **550 USD** EXW (BOM SOM ≤ 40 USD). Chênh lệch ≥ 10% vs SBO, ≥ 20% vs PXC4. **Khuyến nghị mạnh ≤ 510 USD EXW** để đảm bảo ≥ 15% vs SBO ở end-user level. Channel waterfall model xác nhận lợi thế 14-15% tại 5 nước ASEAN (VN/TH/MY/ID/PH) với EXW 510. End-user price ~820-960 USD tùy quốc gia (xem [PM-MARKET-001 v1.1 §3.5](KX-DDC24-PM-MARKET-001_VI.md)) | PRD §1, §6; PM-MARKET-001 v1.1 |
| OBJ-08 | Tốc độ commissioning | 1 FCU zone < **2 giờ** (SI có kinh nghiệm) | NFR-008 |

### 3.3 Tuân thủ & Bảo mật

| ID | Mục tiêu | Chỉ tiêu | Tham chiếu |
|----|----------|----------|------------|
| OBJ-09 | Chứng nhận BACnet | **BTL certified** (ASHRAE SSPC-135) trước GA | NFR-009 |
| OBJ-10 | Bảo mật build release | **Không CVE CVSS ≥ 7.0**; TLS 1.3; secure boot + firmware ký GPG | NFR-006, FR-030/031/032 |
| OBJ-11 | Quy trình phát triển | Tuân thủ **IEC 62443-4-1** SDLC | FR-036 |

---

## 4. Tiêu chí Thành công Ver 1.0 (Definition of Done)

Dự án Ver 1.0 coi là **đạt mục tiêu** khi toàn bộ Acceptance Criteria của PRD §9 pass:

- [ ] 100% test case base-SKU hardware pass (16 UI across supported Rev A modes, 4 AO, 4 DO; no populated DI)
- [ ] BACnet BTL conformance test pass
- [ ] Đọc/ghi toàn bộ I/O từ northbound không ảnh hưởng BACnet
- [ ] FCU commissioning end-to-end < 2 giờ (SI độc lập)
- [ ] OTA update + rollback tự động khi boot lỗi
- [ ] Uptime 72 giờ liên tục trong lab không crash
- [ ] Penetration test: không CVE CVSS ≥ 7.0
- [ ] BOM SOM ≤ 40 USD, giá bán ≤ 550 USD EXW

---

## 5. Phân kỳ Mục tiêu theo Roadmap

| Phiên bản | Mục tiêu trọng tâm | Target |
|-----------|--------------------|--------|
| **Ver 1.0 (MVP)** | BACnet/IP + IEC 61131-3 FBD/ST, Web IDE, OTA A/B, BTL certified | Q4/Y7 |
| **Ver 1.1** | MQTT TLS đầy đủ, REST API, dashboard realtime | Q1/Y8 |
| **Ver 1.2** | BACnet/SC, khởi động IEC 62443-4-2 | Q2/Y8 |
| **Ver 2.0** | IEC 62443-4-2 component cert, edge-AI anomaly detection (NPU), thư viện ST nâng cao | Q4/Y8 |

---

## 6. Ngoài phạm vi (Non-Goals — Ver 1.0)

Để giữ trọng tâm, các hạng mục sau **không** thuộc mục tiêu Ver 1.0:

- ❌ BACnet **MS/TP** và Modbus **slave** (đã bỏ — ARCH-R010; northbound chỉ qua IP).
- ❌ BACnet/SC (Secure Connect) — dời sang Ver 1.2.
- ❌ Edge-AI / NPU anomaly detection — dời sang Ver 2.0.
- ❌ Chứng nhận IEC 62443-4-2 **component** — chỉ tuân thủ 4-1 (process) ở Ver 1.0.
- ❌ Thị trường ngoài Đông Nam Á (chứng nhận khu vực khác chưa nằm trong phạm vi).

---

## 7. Rủi ro chính đối với Mục tiêu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|--------|-----------|------------|
| BTL certification trượt lịch | Lùi GA Ver 1.0 | Test conformance sớm trong lab; theo dõi qua [OPEN_ISSUES](../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md) |
| BOM vượt 40 USD (giá SOM biến động) | Vượt mục tiêu giá 550 USD | Theo dõi BOM trong hardware-design/; phương án SOM dự phòng |
| Jitter > 5 ms khi tải cao | Không đạt NFR-001 | PREEMPT_RT tuning, HIL test sớm (TEST-003) |
| Lỗ hổng bảo mật phát hiện muộn | Trượt OBJ-10 | Pentest sớm, SDLC IEC 62443-4-1, quét CVE định kỳ |
| SOM extended-temp variant unavailable (HW-Q-002) | Cần đổi SOM → redesign major, trượt GA | Xác nhận availability từ Radxa trước Month 2; đánh giá SOM dự phòng (RK3588, i.MX8M) |
| BTL lab booking trễ | Lead time 4-8 tuần không kịp GA Q4/Y7 | Book lab ngay Sprint 1 (tháng 7/2026) — [PM-MARKET-001 §6.1](KX-DDC24-PM-MARKET-001_VI.md) |
| **Regional certification budget escalation** | Tổng cert budget (int'l + regional) có thể lên đến USD 40,600-92,900 — gấp ~2× estimate v1.0. VN+TH+MY Sprint 1: USD 11,600-29,900 | Phase approach: VN+TH trước (~USD 4,600-8,900), defer MY/ID/PH. CEO review budget. [PM-MARKET-001 v1.1 §6.7](KX-DDC24-PM-MARKET-001_VI.md) |
| **TI/Radxa catalog pricing gap** | Catalog pricing ADS131M08/DAC8554 30-50% cao hơn BOM estimate nếu không có direct vendor relationship | Thiết lập TI direct account + Radxa volume commitment trước procurement. [PM-MARKET-001 v1.1 §4.1](KX-DDC24-PM-MARKET-001_VI.md) |
| **Competitor pricing unverified** | Giá SBO/PXC4 là ước tính, chưa có báo giá distributor chính thức. Nếu giá thật thấp hơn → lợi thế cạnh tranh bị thu hẹp | CEO authorize formal RFQ đến ≥2 SEA distributors. [PM-MARKET-001 v1.1 §2.4](KX-DDC24-PM-MARKET-001_VI.md) |

---

## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | PMO | Phát hành đầu — tổng hợp mục tiêu từ PRD Rev 1.1 |
| 1.1 | 2026-06-02 | ResearchDirector | Cập nhật mục tiêu giá theo PM-MARKET-001: điều chỉnh chênh lệch SBO/PXC4, bổ sung rủi ro SOM temp + BTL lab booking |
| 1.2 | 2026-06-02 | ResearchDirector | Deep-dive update từ PM-MARKET-001 v1.1: OBJ-07 thêm channel waterfall model confirmation; bổ sung 3 rủi ro (regional cert budget escalation, TI/Radxa catalog pricing gap, competitor pricing unverified) |
| 1.3 | 2026-06-30 | PMO/QA | Aligned base-SKU acceptance wording to ADR-010: 16 UI + 4 AO + 4 DO, no populated industrial DI. |
