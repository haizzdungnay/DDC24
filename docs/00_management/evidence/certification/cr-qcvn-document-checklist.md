# CR Mark / QCVN — Hồ sơ Kỹ thuật Checklist

> **Issue:** IOT-5459
> **Sản phẩm:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm
> **Created:** 2026-06-02 · **Last Updated:** 2026-06-04 · **Owner:** PMO / TechLead · **Status:** Đang tập hợp

Danh sách dưới đây dựa trên yêu cầu điển hình của hồ sơ đăng ký CR Mark theo Method 1 (có ISO 9001). Các mục có thể thay đổi theo yêu cầu cụ thể của từng lab.

---

## A. Tài liệu Pháp lý Doanh nghiệp

| # | Tài liệu | Hiện có? | Owner bổ sung | Ghi chú |
|---|----------|:--------:|---------------|---------|
| A1 | Giấy đăng ký kinh doanh (bản sao công chứng) | [ ] | KINEXUS Admin | Tiếng Việt |
| A2 | Mã số thuế | [ ] | KINEXUS Admin | |
| A3 | Giấy chứng nhận ISO 9001 (nếu có) | [ ] | KINEXUS QA | Cần cho Method 1 |
| A4 | Đơn đăng ký chứng nhận (theo mẫu lab) | [x] | PMO | Placeholder đã tạo — chờ mẫu lab → legal-dossier/A4-application-form-placeholder.md |
| A5 | Giấy ủy quyền (nếu người nộp không phải giám đốc) | [x] | PMO | Bản nháp đã tạo → legal-dossier/A5-authorization-letter-template.md |

---

## B. Tài liệu Kỹ thuật Sản phẩm

| # | Tài liệu | Hiện có? | Owner bổ sung | Ghi chú |
|---|----------|:--------:|---------------|---------|
| B1 | Data Sheet sản phẩm (DS_MK-DDC-24) | ✅ Rev 2.1 | — | Có sẵn |
| B2 | Sơ đồ khối hệ thống (system block diagram) | ✅ Rev 1.0 | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-B2-system-block-diagram.md |
| B3 | Sơ đồ mạch nguyên lý (schematic) | ✅ KiCad | DeveloperTeam | hardware-design/kicad/ (10 sheets hierarchical) |
| B4 | Bản vẽ PCB layout | ⚠️ Pending fix | DeveloperTeam | KiCad file exists. IOT-5560: K4 relay missing + routing/DRC pending |
| B5 | Sơ đồ đấu nối (wiring diagram) | ✅ | — | Trong DS §5.1-5.3 |
| B6 | Bản vẽ cơ khí / kích thước (mechanical drawing) | ✅ Rev 1.0 | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-B6-mechanical-drawing.md |
| B7 | BOM (Bill of Materials) đầy đủ | ✅ | — | hardware-design/06_bom/ |
| B8 | Danh sách linh kiện critical (critical components list) | ✅ Rev 1.0 | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-B8-critical-components-list.md |
| B9 | Nhãn sản phẩm (product label) | ✅ Rev 1.0 | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-B9-product-label.md |
| B10 | Hướng dẫn lắp đặt (installation manual) | ✅ KX-DDC24-INSTALL-001_VI | Docs Team | Tiếng Việt · docs/03_manuals/ |

---

## C. Tài liệu An toàn (QCVN 4:2009/BKHCN)

| # | Tài liệu | Hiện có? | Owner bổ sung | Ghi chú |
|---|----------|:--------:|---------------|---------|
| C1 | Đánh giá rủi ro an toàn điện (electrical safety risk assessment) | ✅ QA approved | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-C1-safety-risk-assessment.md |
| C2 | Thông số cách điện (creepage/clearance distances) | ✅ QA approved | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-C2-creepage-clearance.md |
| C3 | Đặc tính cầu chì / bảo vệ quá dòng (fuse/OCP) | ✅ Rev 1.1 (fixed 04/06) | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-C3-fuse-ocp.md. Power budget corrected: ≈187mA@24V=4.5W, margin 10.7× |
| C4 | Đặc tính cách điện biến áp nguồn (isolation transformer specs) | ✅ QA approved | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-C4-isolation-transformer.md |
| C5 | Báo cáo thử nghiệm sơ bộ safety (nếu có) | ❌ HW physical | HW Engineer | Requires physical testing — AI agent cannot produce. SELV-only device; may be N/A. |
| C6 | Đặc tính relay (rating, endurance, clearance) | ✅ QA approved | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-C6-relay-specs.md |

---

## D. Tài liệu EMC (QCVN 9:2012/BKHCN)

| # | Tài liệu | Hiện có? | Owner bổ sung | Ghi chú |
|---|----------|:--------:|---------------|---------|
| D1 | Đánh giá rủi ro EMC (EMC risk assessment) | ✅ Rev 1.1 (fixed 04/06) | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-D1-emc-risk-assessment.md. RS-485 refs corrected to Modbus RTU per ARCH-R010 |
| D2 | Kế hoạch thử nghiệm EMC (EMC test plan) | ✅ Rev 1.1 (fixed 04/06) | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-D2-emc-test-plan.md. RS-485 refs corrected to Modbus RTU per ARCH-R010 |
| D3 | Báo cáo pre-compliance EMC (nếu có) | ❌ HW physical | HW Engineer | Requires spectrum analyzer + near-field probe — AI agent cannot produce |
| D4 | Đặc tính lọc EMI (ferrite bead, common-mode choke) | ✅ TechLead approved | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-D4-emi-filter.md |
| D5 | Cấu hình nối đất (grounding scheme) | ✅ TechLead approved | DeveloperTeam | docs/00_management/evidence/certification/cr-qcvn-D5-grounding-scheme.md |

---

## E. Tài liệu Khác (tùy lab yêu cầu)

| # | Tài liệu | Hiện có? | Owner bổ sung | Ghi chú |
|---|----------|:--------:|---------------|---------|
| E1 | Tài liệu mô tả quy trình sản xuất | [ ] | Production | Sơ đồ dây chuyền |
| E2 | Quy trình kiểm tra chất lượng (QC inspection procedure) | [ ] | QA | |
| E3 | Báo cáo kiểm tra xuất xưởng (routine test report mẫu) | [ ] | Production/QA | |
| E4 | User manual / Hướng dẫn sử dụng | ✅ KX-DDC24-USER-001_VI | Docs Team | Tiếng Việt · docs/03_manuals/ |
| E5 | Tài liệu phần mềm (software description) | ✅ KX-DDC24-SWDESC-001_VI | SW Engineer | Phiên bản FW, kiến trúc phần mềm · docs/03_manuals/ |

---

## Tổng kết Gap

| Nhóm | Tổng mục | ✅ Hoàn chỉnh | ⚠️ Cần fix | ❌ HW physical | Tỉ lệ sẵn sàng |
|-------|:-------:|:-----------:|:----------:|:--------------:|:------------:|
| A. Pháp lý doanh nghiệp | 5 | 2 | 0 | 0 | 40% |
| B. Kỹ thuật sản phẩm | 10 | 9 | 1 (B4) | 0 | 90% |
| C. An toàn (QCVN 4) | 6 | 5 (C1-C4, C6) | 0 | 1 (C5) | 83% |
| D. EMC (QCVN 9) | 5 | 4 (D1, D2, D4, D5) | 0 | 1 (D3) | 80% |
| E. Khác | 5 | 2 | 0 | 0 | 40% |
| **TOTAL** | **31** | **22** | **1** | **2** | **~71% (81% excluding physical test items)** |

> ✅ **Tiến triển tốt (từ 23% lên 71%).** Toàn bộ 14 tài liệu thiết kế kỹ thuật đã được tạo. 3 QA findings (C3, D1, D2) + B2 MS/TP refs đã fix ngày 04/06. Còn B4 PCB layout pending DeveloperTeam fix qua IOT-5560. C5 và D3 yêu cầu HW physical testing — cần CTO giao HW Engineer người thật.
>
> **Các bước tiếp theo:**
> - DeveloperTeam: fix B4 PCB layout (K4 relay, routing/DRC)
> - CTO: assign HW Engineer người cho C5 safety pre-test + D3 EMC pre-compliance scan
> - Sau fix xong: TechLead review → PMO chốt hồ sơ gửi lab

---

## Hành động đề xuất

| Ưu tiên | Hành động | Owner đề xuất | Trạng thái |
|:-------:|-----------|---------------|:----------:|
| P0 | KINEXUS Admin: cung cấp GĐKKD + MST (A1, A2) | KINEXUS Admin | Chưa bắt đầu |
| P0 | KINEXUS QA: xác nhận tình trạng ISO 9001 (A3) | KINEXUS QA | Chưa bắt đầu |
| P0 | PMO: hoàn thiện A4 (chờ mẫu lab) + A5 (chờ thông tin người nộp) | PMO | Placeholder đã tạo |
| P0 | **Fix C3 power budget** — đã fix ngày 04/06: sửa 375mA→≈187mA@24V, margin 10.7× | DeveloperTeam | ✅ Done Rev 1.1 |
| P0 | **Fix D1/D2/B2 stale MS/TP refs** — đã fix ngày 04/06: "BACnet MS/TP" → "Modbus RTU" | DeveloperTeam | ✅ Done Rev 1.1 |
| P1 | **Fix B4 PCB layout** — K4 relay missing + routing/DRC pending | DeveloperTeam | ⚠️ IOT-5560 in review |
| P1 | C5 Safety pre-test (nếu lab yêu cầu) | HW Engineer | ❌ HW physical |
| P1 | D3 EMC pre-compliance scan (khuyến nghị trước lab) | HW Engineer | ❌ HW physical |
| P1 | Liên hệ lab chứng nhận (TUV/Intertek) để xác nhận danh mục tài liệu | PMO | Chưa bắt đầu |
| P2 | Team lead review tất cả tài liệu kỹ thuật trước khi nộp | TechLead | Chờ fix xong |
| P2 | QA verify lại C3, D1, D2 sau fix | QAReviewer | Chờ fix xong |

---

## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | PMO | Phát hành đầu — 31 mục checklist, gap analysis, action recommendations |
| 2.0 | 2026-06-04 | TechLead | Cập nhật trạng thái sau khi 14/15 tài liệu kỹ thuật đã tạo. Đánh dấu 4 mục cần fix (C3, D1, D2, B4), 2 mục HW physical (C5, D3). |
| 2.1 | 2026-06-04 | TechLead | C3, D1, D2, B2 đã fix. Tỉ lệ sẵn sàng từ 23% → 71% (81% nếu không tính HW physical items). |
