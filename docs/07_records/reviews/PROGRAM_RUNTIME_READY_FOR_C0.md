# Program Runtime — Readiness Review for C0

**Document ID:** KX-DDC24-PROGRAM-RUNTIME-C0-READINESS-001
**Ngày:** 2026-07-23
**Nguồn:** ADR-020 + 8 ACTION items yêu cầu bởi CTO (Phạm Đình Chương), 2026-07-23
**Kết luận:** **C0_READY = NO** — một blocker duy nhất còn lại (owner assignment), không
phải kỹ thuật hay tài liệu.

---

## Đối chiếu từng ACTION

### ACTION-01 — Đồng bộ toàn bộ repository theo ADR-020

**Done.** Repo-wide grep (2 vòng, gồm vòng xác nhận sau khi sửa) không còn dòng nào
tuyên bố "IEC 61131-3 không thuộc Rev A.0" hoặc mô tả kiến trúc runtime khác với ADR-020
mà không có ghi chú/sửa. 0 hit trong source code (chỉ hex literal vendored, không phải
implementation). Chi tiết: `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md`.

### ACTION-02 — Đóng toàn bộ Governance Conflict

**Done.** 31/31 conflict Closed (26 từ scan đầu + 5 phát hiện thêm ở vòng xác nhận). Mỗi
dòng có: nguyên nhân, quyết định mới, hành động cụ thể (không chỉ banner), trạng thái.

```text
Repository Governance Conflict

OPEN = 0
```

### ACTION-03 — Cập nhật Baseline Documentation

**Done.** `REQUIREMENTS.md` (+13 requirement mới: SYS/SWR×9/IF/SAFE/NFR/FW-REQ-MCU×2),
`VERIFICATION.md` (+test layer Program Runtime, +gate table G0–G6), `TRACEABILITY.md`
(+hàng cho toàn bộ requirement mới, trạng thái Planned/Missing đúng thực tế — chưa có
code). Không còn requirement cũ nào mâu thuẫn ADR-020 trong 3 file này.

### ACTION-04 — Chuẩn hóa Datasheet

**Done.** `DS_MK-DDC-24_VI.md`: bỏ "IEC 61131-3 | Compliant (FBD + ST programming)",
thay bằng "Not certified/compliant — ... theo ADR-020". Sửa thêm banner, tagline mục 1,
bullet tính năng mục 2, toàn bộ mục 6 (thêm cảnh báo roadmap/chưa release), bảng so sánh
đối thủ mục 8 — không còn chỗ nào trong file mô tả Program Runtime như đang bán.

### ACTION-05 — Chuẩn hóa PM Plan

**Done, theo xác nhận trực tiếp của CTO.** `KX-DDC24-PM-IMPLPLAN-001_VI.md` nay ghi rõ:
Rev A.0 Program Editor = **ST Text Editor** + **FBD Graphical Editor** (Mekong Program
Runtime, ADR-020). Không còn dùng "canvas" mơ hồ cho cả hai — chỉ FBD được gọi là
canvas/graphical, ST là text editor. Đã phân biệt rõ với legacy `graph.json` importer
(T-FE-03, không phải Program Runtime editor).

### ACTION-06 — Assign Owner

**BLOCKED — không thể tự thực hiện.** 5 vai trò cần tên thật: Program Runtime Architect,
SOM Backend Lead, Firmware Lead, QA/HIL Lead, TechLead review (+ CTO cho C0.15/C0.14).
Đây là thông tin nhân sự nội bộ — tôi không có quyền truy cập, không được đoán hay đặt
placeholder giả (vd "Nguyễn Văn A") vì điều đó sẽ tạo hồ sơ governance sai. **Cần CTO
hoặc Project Engineering cung cấp tên thật** trước khi mục này Done.

### ACTION-07 — Cập nhật C0 Plan

**Một phần.** Đã thêm cột Reviewer/ETA vào bảng tổng hợp §3 của C0 plan theo đúng cấu
trúc yêu cầu (Owner/Input/Output/Deliverable/Acceptance/Reviewer/Dependency đã có sẵn từ
bản 1.0 ở mức chi tiết từng workstream; §3 giờ có thêm Reviewer/ETA ở mức tóm tắt). **Không
đổi trạng thái workstream nào sang READY** vì điều kiện "có owner thật" (ACTION-06) chưa
đạt — đổi trạng thái bây giờ sẽ là ghi sai.

### ACTION-08 — Review cuối cùng

Đang thực hiện bằng chính tài liệu này.

---

## OUTPUT BẮT BUỘC

```text
FILES_UPDATED: 33
  (DECISIONS.md, PRODUCT.md, SOFTWARE.md, REQUIREMENTS.md, VERIFICATION.md,
   TRACEABILITY.md, ADR-004, adr/README.md, PROGRAM_SOM_FW_DRAFT_DESIGN v0.5,
   KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md, DS_MK-DDC-24_VI.md,
   KX-DDC24-PM-IMPLPLAN-001_VI.md, KX-DDC24-PM-GOAL-001_VI.md,
   KX-DDC24-PM-MARKET-001_VI.md, KX-DDC24-PM-OVERVIEW-001_VI.md,
   PRODUCT_DEFINITION_MK-DDC-24_VI.md, SW_ARCH_SPEC_MK-DDC-24_VI.md,
   REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md, PRD_MK-DDC-24_VI.md, SRS_MK-DDC-24_VI.md,
   SW_REQUIREMENTS_MK-DDC-24_VI.md, OPEN_ISSUES_MK-DDC-24_VI.md,
   TEST_SPEC_MK-DDC-24_VI.md, DESIGN_PLAN_SWFW_MK-DDC-24_VI.md,
   GETTING_STARTED_DEV.md, SW_DDD_MK-DDC-24_VI.md, BACNET_PICS_EPICS_MK-DDC-24_VI.md,
   ADR-006, ADR-008, ADR-009, 09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md,
   KX-DDC24-PENDING-DECISIONS..., KX-DDC24-PROGRAM-RUNTIME-C0-...PLAN.md,
   KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT..., CHANGELOG.md, docs/README.md)

FILES_CREATED: 4
  (ADR-020-mekong-owned-iec-aligned-program-runtime.md,
   KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md,
   KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md,
   KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md)
  + file này (PROGRAM_RUNTIME_READY_FOR_C0.md) + KX-DDC24-PENDING-DECISIONS... (từ vòng
  trước) = 6 file mới tổng cộng qua toàn bộ phiên làm việc.

CONFLICT_REMAINING: 0

BASELINE_STATUS: SYNCED
  (Product/ADR/Requirements/Verification/Traceability đều phản ánh ADR-020: ST+FBD,
   Mekong Runtime, Typed IR, Atomic Activation, không Online Change, không
   PLCopen/IEC Certified. Không còn requirement cũ nào mâu thuẫn.)

OWNER_ASSIGNED: NO
  (5 vai trò còn ở mức role, chưa có tên thật — xem ACTION-06. Đây là input duy nhất
   tôi không tự tạo ra được.)

C0_READY: NO
  (Blocked bởi OWNER_ASSIGNED = NO. Tất cả điều kiện tài liệu/governance khác đã đạt.)

NEXT_ACTION: CTO hoặc Project Engineering cung cấp tên thật cho 5 vai trò
  (Program Runtime Architect, SOM Backend Lead, Firmware Lead, QA/HIL Lead,
  TechLead review). Ngay khi có, tôi sẽ: (1) điền vào bảng §3 của C0 plan,
  (2) chuyển toàn bộ C0.1–C0.15 sang trạng thái READY, (3) cập nhật
  OWNER_ASSIGNED/C0_READY trong file này thành YES, và chỉ khi đó C0 mới được phép
  chính thức bắt đầu thực thi (vẫn không viết production code — C0 chỉ prototype
  giới hạn theo ranh giới đã định nghĩa ở C0 plan §1).
```

**Không được mở C1–C10 hoặc viết production code cho tới khi:**

```text
CONFLICT_REMAINING = 0     ✅ (đạt)
OWNER_ASSIGNED = YES       ❌ (chưa — chờ CTO)
C0_READY = YES             ❌ (chưa — phụ thuộc dòng trên)
```

## Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Review cuối ACTION-01..08. 7/8 action Done hoặc đã làm phần trong khả năng; ACTION-06 (assign owner thật) blocked — cần input CTO. C0_READY = NO cho tới khi có owner. |
