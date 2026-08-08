# Document Conflict Report — ADR-020 (Mekong-Owned IEC-Aligned Program Runtime)

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

**Document ID:** KX-DDC24-PROGRAM-RUNTIME-CONFLICT-REPORT-001
**Trạng thái:** **Closed — 31/31 conflict đã sửa 2026-07-23.** `CONFLICT_REMAINING = 0`.
**Ngày tạo:** 2026-07-23 · **Ngày đóng:** 2026-07-23
**Nguồn quyết định:** [`ADR-020-mekong-owned-iec-aligned-program-runtime.md`](../../../adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md)
**Phương pháp:** repo-wide grep (case-insensitive) cho `IEC 61131`, `PLCopen`,
`wiresheet`, `component graph/component-based` (khi claim là engine chính), `FBD/ST/LD/
SFC` (context ngôn ngữ PLC), `Rev C` (khung hoãn IEC), `online change`, `graph.json` (khi
claim là format duy nhất), `certified/compliant` gần IEC/PLCopen — trên toàn bộ `.md`
trong `docs/` và source comment trong `services/`, `web/`, `src/`, `fw/`; sau đợt sửa đầu
tiên chạy lại một vòng grep xác nhận (`compliant/certified` gần IEC) để tìm sót, phát
hiện thêm 5 file không nằm trong danh sách gốc (mục 2, hàng 27–31).

## 1. Kết luận

- **Source code:** 0 hit thật cả hai vòng grep. Grep khớp với hex literal trong
  `_deps/nlohmann_json` (build tree vendored), không phải comment/implementation. Xác
  nhận: không có code nào cần sửa cho ADR-020 — toàn bộ remediation là tài liệu.
- **Corpus governance Active** (`DECISIONS.md`, `PRODUCT.md`, `SOFTWARE.md`,
  `REQUIREMENTS.md`, `VERIFICATION.md`, `TRACEABILITY.md`, `ADR-004`) — đã sửa.
- **Corpus legacy/In Review** (`docs/01_specs/*`, `docs/00_management/*`,
  `docs/adr/ADR-006/008/009`, `docs/03_implementation/09_*`, `docs/02_design/
  GETTING_STARTED_DEV.md`, `docs/02_design/software/SW_DDD_MK-DDC-24_VI.md`,
  `docs/02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md`,
  `docs/adr/README.md`) — **đã sửa toàn bộ** trong đợt 2026-07-23, theo yêu cầu
  ACTION-01/02 (không chấp nhận "không chặn" như đợt review trước; xem cột Trạng thái).
  Không dùng cách "chỉ gắn watermark" — mỗi dòng bị flag có sửa nội dung cụ thể (xem
  cột "Hành động đã làm").

## 2. Bảng conflict và remediation (tất cả Closed)

| # | File | Dòng | Nội dung cũ (tóm tắt) | Loại conflict | Hành động đã làm | Trạng thái |
|---|---|---|---|---|---|---|
| 1 | `docs/adr/ADR-004-component-based-runtime.md` | 1,12,18,21,39,49,63 | "drop IEC 61131-3 from Rev A"; IEC listed under Rev C | wrong-architecture-description | Giữ nguyên nội dung lịch sử (audit trail — Context/Decision/Rejected không sửa); đổi `Status → Superseded by ADR-020`, thêm `Supersedes`/tham chiếu | **Closed** |
| 2 | `docs/00_governance/DECISIONS.md` | 14 | "Rev A dùng component graph runtime, không dùng IEC 61131-3/FBD/ST runtime." | stale-exclusion | Đổi trạng thái ADR-004 → Superseded by ADR-020 | **Closed** |
| 3 | `docs/00_governance/DECISIONS.md` | 16 | ADR-006 row "wiresheet canvas hoãn sau Rev A" | needs-amend-not-conflict | Thêm ghi chú tách biệt UI-canvas deferral khỏi quyết định ngôn ngữ | **Closed** |
| 4 | `docs/00_governance/DECISIONS.md` | 27 (mới), 39 | Thiếu dòng ADR-020; "...IEC 61131-3...không thuộc baseline Rev A.0" | stale-exclusion | Thêm dòng ADR-020 vào log; bỏ "IEC 61131-3" khỏi danh sách loại trừ, ghi rõ ST+FBD thuộc baseline, LD/SFC vẫn hoãn | **Closed** |
| 5 | `docs/01_product/PRODUCT.md` | 9, 20, 34 | Định vị không nhắc Program Runtime; "Runtime \| component graph 28 loại node"; "IEC 61131-3 runtime, FBD/ST IDE hoặc wiresheet canvas" trong "Ngoài phạm vi" | wrong-architecture-description + stale-exclusion | Cập nhật định vị; Runtime = Mekong Program Runtime (ST+FBD) + component graph legacy; loại trừ đổi thành LD/SFC/online change/certification claim | **Closed** |
| 6 | `docs/04_design/SOFTWARE.md` | 9-15, 25 | Thiếu `mkddc-program-service`/`mkddc-program-core`; "Rev A không có IEC 61131-3 runtime hoặc wiresheet editor." | stale-exclusion | Thêm 2 dòng service mới (chưa triển khai — C1+); đổi mô tả component graph thành legacy importer | **Closed** |
| 7 | `docs/02_requirements/REQUIREMENTS.md` | toàn file | Thiếu requirement cho Program Runtime | missing-baseline | Thêm SYS-REQ-IEC-001, SWR-REQ-IEC-001..009, IF-REQ-IEC-001, SAFE-REQ-IEC-001, NFR-REQ-IEC-001, FW-REQ-MCU-001..002 | **Closed** |
| 8 | `docs/05_verification/VERIFICATION.md` | toàn file | Thiếu Program Runtime gate/test layer | missing-baseline | Thêm test layer + "Program Runtime release gate — RED" (G0 YELLOW, G1–G6 RED) | **Closed** |
| 9 | `docs/07_records/TRACEABILITY.md` | toàn file | Thiếu traceability cho requirement mới | missing-baseline | Thêm hàng cho toàn bộ *-REQ-IEC-*/FW-REQ-MCU-*, trạng thái Planned | **Closed** |
| 10 | `docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md` | 9,117,209,218 | "thay thế IEC 61131-3 soft-PLC framing"; "IEC 61131-3/IDE nặng: loại khỏi Rev A → Rev C"; bảng Engine cũ | wrong-architecture-description | Banner cảnh báo lệch baseline + trỏ ADR-020; sửa đoạn "component-based DDC" 3 chỗ; sửa dòng "IEC 61131-3 / IDE nặng"; sửa bảng "Quan hệ tài liệu cũ" hàng Engine | **Closed** |
| 11 | `docs/01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md` | 17,372,401 | "Engine không còn là IEC 61131-3 PLC" và "PLC Runtime...IEC 61131-3 engine" (tự mâu thuẫn) | wrong-architecture-description | Mở rộng banner đầu file: khai báo toàn bộ nội dung `kinexus-*` PLC runtime bên dưới là lịch sử tiền-pivot, trỏ kiến trúc target thật sang `PROGRAM_SOM_FW_DRAFT_DESIGN` §4 | **Closed** |
| 12 | `docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md` | 65 | "✗ IEC 61131-3 FBD/ST → Rev C (ADR-004)" | stale-exclusion | Đổi thành "✓ ST+FBD → Rev A.0 roadmap (ADR-020, C0)"; thêm dòng "✗ LD/SFC/online change/certified claim" | **Closed** |
| 13 | `docs/01_specs/PRD_MK-DDC-24_VI.md` | 10,24,126,210,219,232 | Banner RECONCILE "không IEC" >< thân bài "FR-001 Phải chạy IEC 61131-3 FBD/ST...MUST" | wrong-architecture-description (tự mâu thuẫn) | Sửa banner; sửa mục tiêu "Tiêu chuẩn mở"; sửa FR-001, giả định SI, roadmap Ver 1.0, traceability FR-001 | **Closed** |
| 14 | `docs/01_specs/SRS_MK-DDC-24_VI.md` | 6,10,12,24,109,115,116,519 | "(IEC 61131-3 → Rev C, không thuộc Rev A)" >< thân bài PLC-001/002 MUST | wrong-architecture-description (tự mâu thuẫn) | Sửa header chuẩn tham chiếu, banner RECONCILE, bullet Soft PLC Runtime, tiêu đề mục 4, bảng công nghệ dòng 519 | **Closed** |
| 15 | `docs/01_specs/SW_REQUIREMENTS_MK-DDC-24_VI.md` | 122,123 | SW-PLC-001/002 MUST FBD/ST theo IEC 61131-3 (không caveat) | no-conflict-just-mention | Thêm banner + sửa 2 dòng: "theo Mekong Program Runtime, roadmap, không certified" | **Closed** |
| 16 | `docs/01_specs/DS_MK-DDC-24_VI.md` | 5,20,35,47,146,257,271,312 | Banner RECONCILE cũ; bảng "IEC 61131-3: Compliant"; nhiều chỗ mô tả Soft PLC như đang bán | wrong-architecture-description + **certified/compliant claim bị cấm** | **Ưu tiên P0 đã xử lý:** bỏ ô "Compliant", thay bằng "Not certified/compliant... theo ADR-020"; sửa banner, tagline, bullet tính năng, mục 6 (thêm cảnh báo roadmap), bảng so sánh đối thủ | **Closed** |
| 17 | `docs/01_specs/OPEN_ISSUES_MK-DDC-24_VI.md` | 51,76,105 | SW-Q-002/DEC-001 "chưa quyết định build vs open-source"; EXT-006 legal review "Not started" | needs-amend-not-conflict | Đóng cả 3: SW-Q-002 → Closed (Mekong tự xây); DEC-001 → Closed; EXT-006 → N/A | **Closed** |
| 18 | `docs/00_management/KX-DDC24-PM-GOAL-001_VI.md` | 21,80 | "IEC 61131-3 + BACnet BTL...", "BTL certified" mục tiêu Q4/Y7 | needs-amend-not-conflict | G1 sửa thành "IEC-aligned Mekong-owned, roadmap"; Ver 1.0 sửa bỏ "BTL certified" → "testing in progress", tách Program Runtime ra khỏi Ver 1.0 | **Closed** |
| 19 | `docs/00_management/KX-DDC24-PM-MARKET-001_VI.md` | 72,97,99,102,424 | Claim cạnh tranh "IEC 61131-3 FBD+ST" là differentiator đang có; đối thủ "BACnet BTL certified + IEC 61131-3" | no-conflict-just-mention → cần bỏ certified | Sửa bảng so sánh dòng Lập trình; sửa 2 dòng đối thủ (ICP DAS, BacnetViet); sửa câu kết luận "tích hợp dọc" | **Closed** |
| 20 | `docs/00_management/KX-DDC24-PM-OVERVIEW-001_VI.md` | 8 | "Hướng đã chốt: component-based DDC (không PLC IDE/IEC 61131-3)" | stale-exclusion | Sửa banner RECONCILE, trỏ ADR-020 | **Closed** |
| 21 | `docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md` | 65,298,325,332,344 | "KHÔNG thuộc Rev A.0: IEC 61131-3 PLC runtime · Web IDE FBD/ST canvas" | stale-exclusion | **CTO đã trả lời ranh giới (2026-07-23):** Program Editor Rev A.0 = ST Text Editor + FBD Graphical Editor, không gọi chung "canvas". Sửa dòng loại trừ, T-UX-02, T-FE-03 (làm rõ là legacy graph.json importer, không phải Program Runtime editor), P4 gate | **Closed** |
| 22 | `docs/02_design/GETTING_STARTED_DEV.md` | 8 | "không PLC 61131-3; web Go" | stale-exclusion | Thêm cập nhật ADR-020 vào banner kiến trúc canonical | **Closed** |
| 23 | `docs/adr/ADR-006-rev-a-ui-form-json.md` | Related, 51 | "Rejected: tied to the IEC 61131-3 model" | needs-amend-not-conflict | Giữ nguyên Decision gốc (lịch sử); thêm Note 2026-07-23 phân biệt legacy wiresheet (vẫn hoãn) vs FBD editor mới của Program Runtime (không bị ADR này chặn) | **Closed** |
| 24 | `docs/adr/ADR-008-bms-edge-positioning-and-revA-component-set.md` | 52 | "no BTL / no IEC 61131-3 / no HMI-OTA-MQTT ... unchanged" | stale-exclusion | Thêm note: phần "no IEC 61131-3" superseded by ADR-020; các constraint khác không đổi | **Closed** |
| 25 | `docs/adr/ADR-009-isa101-hmi-and-nav-restructure.md` | Builds-on, 8-13, 72 | "no IEC 61131-3 in Rev A"; "Rev A programming is not IEC 61131-3 FBD/ST" | stale-exclusion | Thêm note tại "Builds on", tại đoạn Validator, và tại quyết định #6 — phân biệt rõ Programming label (legacy) vs Program Runtime editor mới (ADR-020) | **Closed** |
| 26 | `docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md` | 93 | "graph.json, không IEC 61131-3 (ADR-004 → Rev C)" | stale-exclusion | Sửa thành "component graph legacy — không phải IEC 61131-3 Program Runtime; roadmap riêng ADR-020" | **Closed** |
| 27 | `docs/adr/README.md` | 16 | "ADR-004 | Component-based Runtime (không IEC 61131-3) | Accepted" | stale-exclusion | Sửa trạng thái ADR-004 → Superseded by ADR-020; thêm dòng index ADR-020 | **Closed** (phát hiện thêm, ngoài danh sách gốc) |
| 28 | `docs/02_design/software/SW_DDD_MK-DDC-24_VI.md` | 11 | "Engine component-based, không IEC 61131-3 (ADR-004)" | stale-exclusion | Mở rộng banner: component graph là engine chạy thật hôm nay + roadmap Program Runtime ADR-020 riêng | **Closed** (phát hiện thêm) |
| 29 | `docs/02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` | 12 | "lập trình IEC 61131-3" (không caveat, đọc như đang có) | wrong-architecture-description | Sửa thành "component graph hôm nay, roadmap Program Runtime IEC 61131-3-aligned" | **Closed** (phát hiện thêm) |
| 30 | `docs/01_specs/TEST_SPEC_MK-DDC-24_VI.md` | 167,180 | "IEC 61131-3 FCU program"; "IEC 61131-3 FBD/ST PLC" trong traceability matrix | no-conflict-just-mention | Thêm "(IEC 61131-3-aligned, roadmap ADR-020, đang C0)" vào cả 2 dòng | **Closed** (phát hiện thêm) |
| 31 | `docs/01_specs/DESIGN_PLAN_SWFW_MK-DDC-24_VI.md` | 38,181 | "IEC 61131-3 | Soft PLC (FBD, ST)" không caveat; DEC-001 chưa đóng | wrong-architecture-description + needs-amend | Sửa hàng tiêu chuẩn kỹ thuật; đóng DEC-001 tham chiếu OPEN_ISSUES | **Closed** (phát hiện thêm) |

Không còn hàng nào ở trạng thái Open. `docs/02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`
(v0.4) không nằm trong bảng vì đã nhất quán với ADR-020 từ đầu — dùng làm nguồn wording
chuẩn cho toàn bộ 30 sửa đổi trên.

## 3. Giới hạn đã chấp nhận (ghi rõ, không phải "không chặn")

- Các sửa đổi trên là **annotation + correction tại điểm xung đột cụ thể** (banner/dòng/
  bảng bị flag), không phải viết lại toàn bộ nội dung mỗi tài liệu legacy — với các file
  `01_specs/*` tiền-pivot (SW_ARCH_SPEC, SRS, SW_DDD), phần thân bài sâu hơn (vd toàn bộ
  kiến trúc `kinexus-*` 7-service) vẫn giữ nguyên dưới dạng lịch sử/`<details>` đã tự gắn
  nhãn từ trước — không tạo conflict mới nên không cần đụng tới.
- `docs/adr/README.md` có gap từ trước (ADR-011..017 chưa có file riêng, chỉ nằm hợp nhất
  trong `DECISIONS.md`) — gap này được ghi chú lại nhưng **không thuộc phạm vi ADR-020**,
  không sửa trong đợt này.

## 4. Việc đã hoàn thành trong đợt 2026-07-23 (tham chiếu)

7 tài liệu Active: `DECISIONS.md`, `PRODUCT.md`, `SOFTWARE.md`, `REQUIREMENTS.md`,
`VERIFICATION.md`, `TRACEABILITY.md`, `ADR-004` (status header) — cộng với tạo mới
`ADR-020`, `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` v0.4,
`KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md`,
`KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`, và file quyết định
`KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md` — cộng với 24 file
legacy/PM/ADR/implementation-guide sửa trong đợt ACTION-01..02 này (mục 2, hàng 10–31).

## Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Tạo conflict report từ kết quả repo-wide scan; 26 dòng conflict, 9 Fixed (corpus Active), 17 Open (corpus legacy In Review), 3 ưu tiên khuyến nghị. |
| 2.0 | 2026-07-23 | ACTION-01/02: đóng toàn bộ 26 conflict còn Open + 5 conflict phát hiện thêm ở vòng grep xác nhận thứ hai (tổng 31). `CONFLICT_REMAINING = 0`. Không còn dòng "không chặn" nào — mỗi conflict có sửa nội dung cụ thể, không chỉ banner. |
