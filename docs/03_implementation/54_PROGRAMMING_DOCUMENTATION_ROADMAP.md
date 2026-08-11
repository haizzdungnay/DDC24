# Plan 54 — Roadmap hoàn thiện hồ sơ Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-PROG-DOC-054` |
| Phiên bản | 3.28 |
| Trạng thái | **IMPLEMENTATION IN PROGRESS — candidate v2.21; P1 `6/6 DONE`; P2 `7/8`; tiếp theo `TASK-PROG-207`; `RELEASE_READY BLOCKED`** |
| Ngày baseline | 2026-08-11 |
| Chủ quản | System Engineering + Document Control |
| Người phê duyệt | Product Owner, System Architect, Verification Lead |
| Phạm vi | 22 hồ sơ điều khiển yêu cầu, thiết kế, kiểm chứng và triển khai Programming Rev A |
| Kế hoạch triển khai phụ thuộc | [`PLAN-PROG-053`](53_PROGRAMMING_IMPLEMENTATION_PLAN.md) |
| Chu kỳ cập nhật | Cuối mỗi phiên sửa tài liệu và tại mỗi cổng `DOC-G0..DOC-G4` |

## 1. Mục tiêu và ranh giới

Roadmap này là bảng điều khiển duy nhất để theo dõi việc **tạo, viết đủ nội
dung, review và phê duyệt** bộ hồ sơ Programming. Nó trả lời bốn câu hỏi:

1. Bộ hồ sơ phải có bao nhiêu file và file nào đang thiếu?
2. File đã tồn tại có thực sự đủ cho FE, BE, FW-SOM, FW MCU, HW và QA implement
   mà không tự phát minh thêm thiết kế hay chưa?
3. Hồ sơ nào phải làm trước vì đang chặn contract, safety hoặc các team khác?
4. Ai viết, ai review, điều kiện nào cho phép chuyển trạng thái?

Roadmap không phải Detailed Design, không thay nội dung của 22 hồ sơ và không tự
chứng minh implementation/release. Quyền triển khai được cấp bởi
`AUTH-PROG-2026-08-11-03` và ghi tại Plan 53. Roadmap không được tính là file thứ 23 để làm tăng
tỷ lệ hoàn tất của bộ hồ sơ.

**Phân chia thẩm quyền, để không sinh roadmap thứ ba.** Plan 54 quản **hồ sơ**:
mức trưởng thành, checklist, review và chữ ký. [Plan 53](53_PROGRAMMING_IMPLEMENTATION_PLAN.md)
là **implementation authority**: pha, gate `G0..G6`, ba cổng quyền hạn
`PLAN_READY`/`IMPLEMENT_READY`/`RELEASE_READY`, thẻ task và lát cắt dọc. Khi cần
biết “được phép code chưa”, đọc Plan 53 §4.2 — **không** suy từ mức M của Plan 54.
Không tạo roadmap thứ ba; mọi nhu cầu theo dõi mới phải vào một trong hai file này.

Quy tắc kiểm soát tài liệu áp dụng cho cả hai nằm ở
[`DOC-GOV-001`](../00_governance/DOC_GOVERNANCE.md), kèm harness chạy lại được
`python3 scripts/docs_iso_harness.py --expect`.

Nguồn để lập baseline:

- [`PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md`](../CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md)
  và [`PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md`](../CHUONG_YEU_CAU/PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md);
- [`PROG-DOCSET-001`](../02_design/PROGRAMMING_DESIGN_INDEX.md),
  [`RSK-PROG-001`](../07_records/PROGRAMMING_RISK_REGISTER.md) và
  [`TRACE-PROG-001`](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md);
- báo cáo As-Built theo mã nguồn tại
  [`BAO_CAO_SRC_2026-08-09`](../07_records/BAO_CAO_SRC_2026-08-09/00_README.md);
- rule “Cấu trúc bắt buộc của một file thiết kế” trong `AGENTS.md`.

### 1.1 Căn chỉnh mục tiêu chuẩn

| Họ chuẩn/hướng dẫn | Cơ chế trong roadmap |
|---|---|
| ISO 9001 | ID/version/owner/reviewer/approver, revision history, register, review và change control |
| ISO/IEC/IEEE 29148 | SRS có nguồn, rationale, acceptance, verification method và trace hai chiều |
| ISO/IEC/IEEE 12207 và 15288 | Tách yêu cầu, kiến trúc, detailed design, implementation plan, V&V, operations và release gate |
| ISO/IEC 25010 | NFR và acceptance cho performance, reliability, usability, security, compatibility, maintainability |
| IEC 61131-3 | Hồ sơ Language/Compiler, Control Semantics và Runtime xác định subset/profile dự án có thể kiểm chứng |
| IEC 62443 direction | Security Design, trust boundary, RBAC, integrity, audit, least privilege và abuse case |

Đây là căn chỉnh cấu trúc và bằng chứng theo mục tiêu chuẩn — tức **ISO-aligned**
— chứ **không** phải tuyên bố chứng nhận hay compliance. Cấm dùng “compliant”,
“certified” hay “đạt chuẩn” khi chưa có đánh giá độc lập và Test Result hợp lệ.
Định nghĩa đầy đủ và bảy quy tắc trung thực nằm ở
[`DOC-GOV-001`](../00_governance/DOC_GOVERNANCE.md) §1 và §6.

## 2. Dashboard baseline 2026-08-09

| Chỉ số | Kết quả | Ý nghĩa |
|---|---:|---|
| Tổng hồ sơ trong baseline | 22 | Mẫu số cố định của roadmap |
| File đã tồn tại | 22/22 = **100%** | Đủ đúng baseline file; không đồng nghĩa đã Approved |
| File chưa được tạo | 0/22 = **0%** | Đủ toàn bộ đường dẫn baseline |
| Hồ sơ đạt `M3` — checklist đủ, `TBD/BLOCKED` có owner, link sạch | 22/22 = **100%** | Đo theo định nghĩa §3.1; bằng chứng tại `PROG-REV-2026-08-09` |
| Hồ sơ đạt `M4` — review liên chức năng đã đóng | 0/22 = **0%** | Cần reviewer của bên tiêu thụ contract; tự kiểm không thay thế |
| Hồ sơ đạt `M5` — Approved | 0/22 = **0%** | Maturity thực tế không nâng bằng waiver; không chặn implementation |
| Điểm trưởng thành tài liệu | **1320/2200 = 60,0%** | 22 file M3; chưa có M4/M5 |
| Quyết định | **0 OPEN / 17 DECIDED / 0 CLOSED** | Toàn bộ decision được phê duyệt bởi `AUTH-PROG-2026-08-11-03` |
| Rủi ro có điểm từ 15 trở lên | 11/16 | Chặn production cutover cho tới khi có evidence và residual acceptance |
| Kịch bản có Test Result mới | 2/32 record `BLOCKED`; 0/32 PASS | Evidence production vẫn `MISSING/RED`; không nâng trace/risk |
| Cổng implementation | **PLAN_READY PASS; mọi IMPLEMENT_READY PASS; G1 GO; G2 IN_PROGRESS** | P2/P3 đã mở; release vẫn cần 32/32 PASS, residual và target/HIL |
| Tiến độ code theo Plan 53 | **P1 6/6; P2 7/8; tổng 20/49 = 40,8%** | `TASK-PROG-200..206 DONE`; tiếp theo `TASK-PROG-207` |

Điểm `60,0%` là điểm trưởng thành **tài liệu**, không phải phần trăm code, test,
release hay mức sẵn sàng production. Chỉ số phải được tính lại từ bảng master;
không nhập phần trăm bằng cảm tính.

### 2.1 Trạng thái thực thi hiện tại

| Chặng | Trạng thái | Kết quả hiện tại |
|---|---|---|
| R0 — Kiểm soát baseline | **COMPLETE** | Register 22 hồ sơ, owner/reviewer, scoring, risk/scenario mapping và đường dẫn chuẩn đã chốt; candidate hiện hành ghim bằng **22 SHA-256** (`candidate_pin_check.py` PASS), `e3e9fb2` đã `SUPERSEDED` |
| R1 — Requirement/decision/architecture | **M3 COMPLETE** | Index/SRS/Open Decisions/Architecture đạt cổng loại tương ứng; có mục Đọc nhanh và phụ lục tự kiểm |
| R2 — Contract + 5 thiết kế lõi | **M3 COMPLETE / APPROVED FOR IMPLEMENTATION** | Data/Interface và 5 hồ sơ lõi có bảng `DD-01..DD-13`; TLS/provenance là deliverable implementation |
| R3 — Thiết kế theo team | **M3 COMPLETE** | UI/UX theo IA **bốn workspace** `PGM-01..04`: asset render được cho từng workspace (Tổng quan desktop/mobile, Thiết kế, Kiểm tra & Vận hành kèm modal, Runtime & Bảo trì kèm drawer), cây component, API theo workspace, copy VI/EN, token và rollout; FE, BE, FW-SOM, FW MCU, HW đủ checklist |
| R4 — Assurance/delivery | **M3 COMPLETE** | 32 test spec, Ops, 16 risk, 60 dòng trace, Plan 53 có P1 6/6 và P2 7/8; kho Test Result có 2 record BLOCKED/checksum PASS và 0/32 PASS |
| R5 — Review/sign-off | **COMPLETE FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`: Product + Architect `ACCEPT ALL`; 8 consumer/discipline, Verification/QA và Document Control `WAIVED FOR IMPLEMENTATION`; 0/22 M4/M5 vẫn được ghi đúng thực tế |

`DOC-G0` được chuyển PASS sau chỉ đạo ngày 2026-08-09 “triển khai theo roadmap”
và việc đăng ký cùng baseline vào `CONTROL.md`, Document Hub, Design Index và
Implementation Index. PASS này chỉ cho phép viết hồ sơ R1; không thay chữ ký
Product/Architecture/QA và không mở G0 của `PLAN-PROG-053`.

## 3. Thang trạng thái và cách tính

### 3.1 Mức trưởng thành của từng hồ sơ

| Mức | Điểm | Điều kiện tối thiểu |
|---|---:|---|
| `M0 — NOT CREATED` | 0 | Chưa có file tại đường dẫn chuẩn |
| `M1 — OUTLINE` | 10 | Có file, metadata và đầu mục; nội dung chưa đủ để review |
| `M2 — DRAFT CONTENT` | 30 | Có nội dung thực chất, nhưng checklist áp dụng chưa được chứng minh đầy đủ hoặc còn quyết định chưa kiểm soát |
| `M3 — REVIEW READY` | 60 | Đủ checklist áp dụng; mọi `TBD/BLOCKED` có owner, ảnh hưởng, gate và điều kiện mở; link nội bộ sạch |
| `M4 — REVIEW CLOSED` | 80 | Review liên chức năng hoàn tất; finding P0/P1 đã đóng; requirement/risk/trace đã đồng bộ |
| `M5 — APPROVED` | 100 | Người có thẩm quyền ký; revision history hoàn tất; hồ sơ được phép dùng làm baseline implement |

Một file tự ghi `In Review` không tự động đạt `M3/M4`. Việc đổi mức phải có
bằng chứng trong cột “Bằng chứng/trạng thái kế tiếp” của bảng master.

Ranh giới `M3` và `M4` — đây là chỗ dễ hiểu sai nhất, nên phát biểu một lần và
dùng thống nhất ở mọi mục:

- **`M3` là cổng kiểm được bằng chứng khách quan.** Điều kiện: checklist áp dụng
  của đúng loại tài liệu đã được xử lý và ghi thành bảng **trong chính hồ sơ**;
  mọi `TBD/BLOCKED` có đủ owner, ảnh hưởng, gate và điều kiện mở khóa; link nội
  bộ sạch. Chủ quản hồ sơ tự kiểm được, và bên thứ ba kiểm lại được bằng harness.
- **`M4` là cổng cần con người.** Điều kiện: reviewer của **bên tiêu thụ** contract
  đã đọc và đóng finding P0/P1. Tự kiểm của người soạn **không** thay thế được,
  dù checklist có đầy đủ đến đâu.

Không dùng “peer review” như điều kiện của `M3`; đó là điều kiện của `M4`.

### 3.2 Công thức

```text
File coverage       = số file tồn tại / 22 × 100%
Maturity progress   = tổng điểm M0..M5 của 22 hồ sơ / 2200 × 100%
Review-ready rate   = số hồ sơ M3 trở lên / 22 × 100%
Approved rate       = số hồ sơ M5 / 22 × 100%
```

Không giảm mẫu số, không tách file lớn thành nhiều file để tăng điểm và không
chấm `M3` chỉ vì đã viết nhiều trang. Khi merge/gộp hồ sơ, phải sửa baseline,
lý do và revision history trước khi tính lại.

### 3.3 Nhãn ưu tiên

- `P0`: chặn contract, safety, ownership hoặc chặn nhiều team; xử lý trước.
- `P1`: cần để một team implement/test đúng sau khi P0 ổn định.
- `P2`: hoàn thiện assurance, vận hành và handover; không được bỏ qua trước ký.

## 4. Master tracker 22 hồ sơ

> Baseline ban đầu dùng `M2` cho file đã có nội dung nhưng chưa qua checklist
> implementation-readiness; dùng `M0` cho file chưa tồn tại. “Mức” trong bảng
> không ghi đè trạng thái kiểm soát nằm bên trong từng tài liệu.

| # | ID / hồ sơ | Loại | Owner chính / reviewer | Mức | Ưu tiên | Bằng chứng/trạng thái kế tiếp |
|---:|---|---|---|---:|---|---|
| 1 | [`PROG-DOCSET-001`](../02_design/PROGRAMMING_DESIGN_INDEX.md) | Kiểm soát | System Engineering / Document Control | `M3` 60 | P0 | v2.9; register 22 dòng khớp harness; P1 6/6, P2 7/8 và candidate v2.21 |
| 2 | [`SRS-PROG-001`](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | Yêu cầu | Product + System / QA | `M3` 60 | P0 | Đọc nhanh + phụ lục cổng M3 loại Requirements; 60 ID canonical, acceptance định lượng |
| 3 | [`PROG-OD-001`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | Quyết định | Product + Architect / các lead | `M3` 60 | P0 | v0.9; `17 DECIDED`, `0 OPEN`, `0 CLOSED`; approved for implementation |
| 4 | [`ARCH-PROG-001`](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | Kiến trúc | System Architect / Safety + Ops | `M3` 60 | P0 | v0.6; Architect `ACCEPT` 6/6 ADR, còn đồng phê duyệt/evidence |
| 5 | [`DM-PROG-001`](../02_design/software/PROGRAMMING_DATA_MODEL.md) | Detailed Design | BE + Core / FE + QA | `M3` 60 | P0 | v0.8; SQLite v4 + change/bundle receipt/import atomic As-Built; operation/target evidence còn mở |
| 6 | [`IFSPEC-PROG-001`](../02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md) | Detailed Design | BE + Core / FE + Security | `M3` 60 | P0 | v1.2; 11 operation Project/Draft/Revision/Check/change/bundle có source; 14 operation/lifecycle/TLS production còn mở |
| 7 | [`DDD-LANG-PROG-001`](../02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md) | Detailed Design | Compiler + Controls / Core + FE + QA | `M3` 60 | P0 | v0.7; `TASK-PROG-200..203 DONE`: ST/FBD common IR, artifact provenance/source map host; local POU/worker/target còn mở |
| 8 | [`IFSPEC-ART-PROG-001`](../02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md) | Detailed Design | Compiler + Core / Security + Ops | `M3` 60 | P0 | v0.7; loader/type/manifest/source map ST/FBD host; production stage/swap/target evidence còn mở |
| 9 | [`DDD-CTRL-PROG-001`](../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md) | Detailed Design | Controls + Core / Safety + QA | `M3` 60 | P0 | Đọc nhanh + bảng `DD-01..DD-13`; 1 BLOCKED (`OD-PROG-004/012/013` + Safety review) |
| 10 | [`DDD-LIFE-PROG-001`](../02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md) | Detailed Design | Core + BE + Ops / Architect + QA | `M3` 60 | P0 | Đọc nhanh + bảng `DD-01..DD-13`; 1 BLOCKED (`OD-PROG-009/010`) |
| 11 | [`UX-WEB-PROG-001`](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) | Detailed Design | UX / FE + Product + QA | `M3` 60 | P1 | IA bốn workspace + tám journey + migration 17 UC; SVG render được cho `PGM-01..04` gồm desktop/mobile, modal Commission và drawer Restore; mapping vùng→API/state/action/RBAC/copy; cây component, token và rollout; 1 BLOCKED (`OD-PROG-016` + 6 vai trò ký) |
| 12 | [`DDD-FE-PROG-001`](../02_design/software/PROGRAMMING_FE_DESIGN.md) | Detailed Design | FE Lead / UX + BE + QA | `M3` 60 | P1 | v0.8; FBD typed model/reducer/history 50/keyboard component có 15 test; route/API/browser workspace còn mở |
| 13 | [`DDD-BE-PROG-001`](../02_design/software/PROGRAMMING_BE_DESIGN.md) | Detailed Design | BE Lead / Core + Security + QA | `M3` 60 | P0 | v1.0; change manifest + source-only bundle/quarantine/import atomic As-Built; operation/Core còn mở |
| 14 | [`DDD-FWSOM-PROG-001`](../02_design/software/PROGRAMMING_FW_SOM_DESIGN.md) | Detailed Design | Core/FW-SOM Lead / Controls + QA | `M3` 60 | P0 | Đọc nhanh + bảng `DD-01..DD-13`; 1 BLOCKED (`OD-PROG-009/012/013`, chưa có evidence target) |
| 15 | [`DDD-FWMCU-PROG-001`](../02_design/firmware/PROGRAMMING_FW_MCU_DESIGN.md) | Detailed Design | FW MCU Lead / Core + HW + QA | `M3` 60 | P1 | Đọc nhanh + bảng `DD-01..DD-13`; 1 BLOCKED (`HW-AUTH-001/002`, HIL RED) |
| 16 | [`DDD-HW-PROG-001`](../04_design/hardware/PROGRAMMING_HW_DESIGN.md) | Detailed Design | HW Lead / FW + Safety + QA | `M3` 60 | P1 | Đọc nhanh + bảng `DD-01..DD-13`; 2 BLOCKED (`DD-03` thiếu baseline có kiểm soát; HW NO-GO) |
| 17 | [`DDD-SEC-PROG-001`](../02_design/software/PROGRAMMING_SECURITY_DESIGN.md) | Detailed Design | Security + BE / Core + Ops + QA | `M3` 60 | P0 | Đọc nhanh + bảng `DD-01..DD-13`; 1 BLOCKED (TLS production, `OD-PROG-001`) |
| 18 | [`VVP-PROG-001`](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | V&V | Verification Lead / tất cả lead | `M3` 60 | P0 | v0.9; 32/32 spec; 2 record BLOCKED, 0/32 PASS |
| 19 | [`OPS-PROG-001`](../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) | Vận hành | Ops/Release / Core + BE + QA | `M3` 60 | P1 | Đọc nhanh + phụ lục cổng M3 loại Operations; 1 BLOCKED (chưa diễn tập) |
| 20 | [`RSK-PROG-001`](../07_records/PROGRAMMING_RISK_REGISTER.md) | Assurance | Product + Architect + QA / risk owner | `M3` 60 | P0 | v1.3; 16/16 Open; 5/16 treatment source partial sau Task 205, residual giữ nguyên |
| 21 | [`TRACE-PROG-001`](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Traceability | Verification Lead / Document Control | `M3` 60 | P0 | v3.9; 60 dòng, 2/60 `I=Y`; Task 205 source partial, 2 record BLOCKED, 0/32 PASS |
| 22 | [`PLAN-PROG-053`](53_PROGRAMMING_IMPLEMENTATION_PLAN.md) | Delivery | Dev Lead + Architect / Product + QA | `M3` 60 | P1 | v0.30; P2 7/8, tổng 20/49; tiếp theo `TASK-PROG-207` |

## 5. Quan hệ rủi ro → hồ sơ phải ưu tiên

| Nhóm rủi ro đang mở | Hồ sơ kiểm soát chính | Kết quả thiết kế bắt buộc |
|---|---|---|
| `RSK-PROG-001/004` — dual owner, hold-last sai | Control Semantics + Runtime Lifecycle + Architecture | Một owner Local logic, transition/hold-last/PID rõ và fault test được |
| `RSK-PROG-002/005` — Task 30 s, watchdog, compiler tranh CPU | Language/Compiler + FW-SOM + V&V | Base step độc lập, budget/WCET/quota và target load test |
| `RSK-PROG-003/013` — IOP gap, nhầm skeleton là HIL | FW-SOM + FW MCU + HW + V&V | Swap không chặn iobus, acceptance 199/200/201 ms và bằng chứng điện thật |
| `RSK-PROG-006/011/012/014` — artifact, bundle, RBAC, error lệch | Artifact/Loader + Security + Interface + BE | Bounded loader, source-only import, server RBAC, error authority và negative test |
| `RSK-PROG-007/008` — optimistic success, double activation | Data + Interface + Runtime Lifecycle + FE/BE | Durable operation, idempotency, authoritative read-back và `UNKNOWN` reconcile |
| `RSK-PROG-009/010` — RETAIN/quality sai | Data + Runtime Lifecycle + Interface | Stable identity/version/CRC, freshness/quality end-to-end, không thay unknown bằng zero |
| `RSK-PROG-015` — claim IEC/ISO không có evidence | SRS + V&V + Trace + Document Control | Claim guardrail và phê duyệt chỉ dựa trên Test Result hiện hành |

## 6. Roadmap theo dependency và cổng

```text
R0 Kiểm soát baseline
  → R1 Khóa requirement, decision và architecture
    → R2 Hoàn thiện contract + 5 thiết kế lõi còn thiếu
      → R3 Hoàn thiện thiết kế theo team FE/BE/FW-SOM/FW-MCU/HW
        → R4 Đồng bộ V&V, operations, risk, trace và Plan 53
          → R5 Review chéo, đóng finding và ký DOC-G4
```

Các team có thể viết song song, nhưng không được tự khóa field/ABI/semantics khi
hồ sơ upstream còn `OPEN`. Mọi giả định tạm thời phải có `TBD/BLOCKED`, owner và
điều kiện mở khóa.

### R0 — Kiểm soát baseline (`DOC-G0`)

| Task | Owner | Kết quả cần giao | Exit |
|---|---|---|---|
| `DOC-5400` | Document Control | Chốt danh mục 22 file, ID, owner, reviewer, authority và đường dẫn chuẩn | Không còn file “ẩn” ngoài register |
| `DOC-5401` | System Engineering | Đánh mức M0..M5, ghi snapshot và công thức | Dashboard tái tính được |
| `DOC-5402` | Product + Architect | Phân nhóm 17 open decision theo hồ sơ/gate bị chặn | Mỗi decision có owner và downstream impact |
| `DOC-5403` | QA | Ánh xạ risk và scenario vào hồ sơ chủ quản (hiện 16 risk, 32 scenario) | Không có risk/scenario mồ côi |

**Exit `DOC-G0`:** master tracker được phê duyệt làm baseline kiểm soát. Gate này
không đồng nghĩa G0 của implementation đã xanh.

### R1 — Requirement và kiến trúc (`DOC-G1`)

| Task | Owner | Kết quả cần giao | Exit |
|---|---|---|---|
| `DOC-5410` | Product + System | SRS có requirement đơn nghĩa, rationale, allocation, giới hạn và acceptance định lượng | SRS đạt M3 |
| `DOC-5411` | Product + các lead | Quyết định capacity/type/task/FBD/library/RBAC/RETAIN/cutover | Decision cần cho R2 đạt `DECIDED` |
| `DOC-5412` | Architect | Architecture có owner/state/failure/trust/deploy/rollback | Không còn `ARCH-CONF-PROG-*` vô chủ |
| `DOC-5413` | Verification | Trace SRS → risk → scenario và phát hiện requirement thiếu | Coverage requirement 100% ở mức design plan |

**Exit `DOC-G1`:** SRS và Architecture M3; mọi decision chặn R2 đã `DECIDED`
hoặc `BLOCKED` có thẩm quyền chấp nhận. Chưa cho phép code contract production.

### R2 — Contract và thiết kế lõi (`DOC-G2`)

| Task | Owner | Kết quả cần giao | Exit |
|---|---|---|---|
| `DOC-5420` | BE + Core | Data Model và Interface Spec field-level, versioned | Producer/consumer cùng review một contract |
| `DOC-5421` | Compiler + Controls | Tạo Language/Compiler Design | ST/FBD → common IR deterministic, diagnostics và limits đầy đủ |
| `DOC-5422` | Compiler + Core | Tạo Artifact/Loader Spec | Layout, bounded validation, stage/swap/reject rõ từng byte/section |
| `DOC-5423` | Controls + Core | Tạo Control Semantics | Scan/order/priority/PID/hold-last/overrun có pseudocode và fault behavior |
| `DOC-5424` | Core + BE + Ops | Tạo Runtime Lifecycle Design | Atomic state machine cho Check/Commission/Restore/RETAIN/LKG/power-loss |
| `DOC-5425` | Security + BE | Tạo Security Design | RBAC/trust/integrity/sandbox/import/audit/abuse case/secret handling |

**Exit `DOC-G2`:** 7 hồ sơ contract/lõi đạt M3, error namespace thống nhất, mọi
schema/ABI có compatibility, deploy order, rollback và verification owner.

### R3 — Thiết kế theo team (`DOC-G3`)

| Task | Owner | Kết quả cần giao | Exit |
|---|---|---|---|
| `DOC-5430` | UX + FE | UI/UX + FE Detailed Design | Route/flow/state/copy/a11y và source/component/API mapping đủ implement |
| `DOC-5431` | BE | BE Detailed Design | Package/handler/store/job/transaction/quota/audit/test mapping đủ implement |
| `DOC-5432` | Core/FW-SOM | FW-SOM Detailed Design | Base-step/loader/scheduler/process image/arbitration/RETAIN/trace đủ implement |
| `DOC-5433` | FW MCU + HW | MCU + Hardware Detailed Design | BSP/ISR/DMA/electrical/test point/HIL limit đủ implement và đo |

**Exit `DOC-G3`:** sáu hồ sơ team đạt M3; một dev không tham gia thiết kế trả lời
được chính xác sửa file/module nào, contract gì, state/fault gì và test nào.

### R4 — Assurance và kế hoạch giao hàng (`DOC-G4`)

| Task | Owner | Kết quả cần giao | Exit |
|---|---|---|---|
| `DOC-5440` | Verification | V&V specification cho 32 scenario | Mỗi scenario có fixture/step/expected/target/evidence/pass authority; kho có 2 record BLOCKED, 0/32 PASS |
| `DOC-5441` | Ops/Release | Runbook Commission/Restore/upgrade/replacement/incident | Có command, read-back, backup, rollback trigger và evidence path |
| `DOC-5442` | Risk owners + QA | Risk register sau design review | Control link đủ; residual chưa giảm nếu chưa có test result |
| `DOC-5443` | Verification + Document Control | Traceability chi tiết và kiểm tra link | Requirement → design → source target → test → evidence không đứt |
| `DOC-5444` | Dev Lead | Đồng bộ Plan 53 theo design Approved | Task/dependency/gate/RACI/estimate không buộc dev tự đoán |
| `DOC-5445` | Tất cả approver | Review chéo, đóng finding P0/P1 và ký | 22/22 hồ sơ M5 hoặc blocker được Product/Architect/QA chấp thuận rõ |

Hồ sơ hỗ trợ review P0
[`PROG-P0-GATE-2026-08-10`](../07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md)
gom evidence, decision authority, blocker và sign-off cho `PROG-000..006`. File
này **không** làm tăng baseline từ 22 lên 23 và không tự nâng M4/M5. Candidate
review đã được ghim bằng
[`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](../07_records/reviews/PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md).
Readiness branch/build/toolchain/CI/target/HIL/evidence được đo tại
[`PROG-P0-ENV-2026-08-10`](../07_records/reviews/PROGRAMMING_P0_ENVIRONMENT_READINESS_2026-08-10.md):
host và kho evidence PASS phần chuẩn bị; CI/target/HIL còn BLOCKED.

**Exit `DOC-G4`:** 22/22 hồ sơ Approved, 100% link sạch, không có `TBD` vô owner,
`PROG-DOCSET-001` và `PLAN-PROG-053` đồng bộ. Lúc này mới xem xét mở G0 của Plan
53. Production evidence và release gate vẫn phải được tạo trong implementation.

## 7. Checklist bắt buộc trước khi nâng Detailed Design lên M3

Mỗi file thuộc loại Detailed Design trong bảng master phải đánh `PASS`, `N/A` có
lý do hoặc `BLOCKED` có owner cho từng mã sau. Chỉ ghi “có mục” không được tính
là PASS; nội dung phải đủ để implement và test.

| Mã | Nội dung phải kiểm | Điều kiện PASS |
|---|---|---|
| `DD-01` | Metadata và quyền tài liệu | Có ID/version/status/date/owner/reviewer/approver/source/scope/revision |
| `DD-02` | Mục tiêu, actor, phạm vi | Có outcome, use case, in/out, constraint và success criteria |
| `DD-03` | As-Built có dẫn chứng | Có source/contract/class/function/route/schema và gap đã kiểm tra |
| `DD-04` | Target design và ownership | Owner mutable state/policy, input/output/consumer, boundary và failure path rõ |
| `DD-05` | Data model từng field | Type/unit/default/range/null/key/validation/lifecycle/version/migration rõ |
| `DD-06` | Interface/contract | Payload/layout/auth/timeout/retry/idempotency/error/audit/compatibility rõ |
| `DD-07` | State/algorithm/timing | State machine, guard/action, pseudocode, ordering/atomicity/WCET/resource rõ |
| `DD-08` | User/operation flow | Route/action/state/copy/a11y hoặc preflight/read-back/rollback/incident rõ |
| `DD-09` | Error/safety/security | Detection/code/state/output/recovery/audit/alarm/safe behavior/abuse case rõ |
| `DD-10` | Ánh xạ repository | File/package/class/function/build/config/package/feature flag cần tạo/sửa rõ |
| `DD-11` | Verification/acceptance | Requirement, fixture, input/step, expected định lượng, fault case, target/evidence rõ |
| `DD-12` | Compatibility/deployment/rollback | Version/migration/partial deploy/restart/rollback/data preservation rõ |
| `DD-13` | Trace/risk/decision/sign-off | Link end-to-end, risk/residual, TBD owner/gate và bảng ký đầy đủ |

### Checklist theo loại hồ sơ không phải Detailed Design

| Loại | Cổng M3 bắt buộc |
|---|---|
| Requirements | ID ổn định; một nghĩa; source/rationale; priority; allocation; verification method; acceptance định lượng; không lẫn solution chưa duyệt |
| Open Decisions | Context; options/trade-off; decision authority; deadline/gate; quyết định; rationale; consequences; tài liệu phải đồng bộ |
| Architecture | Context/component/deployment; ownership; trust/failure boundary; interface direction; state; capacity/timing; compatibility/rollback; ADR conflict |
| V&V | Trace requirement/risk; test level; fixture; precondition; steps; expected; negative/fault; environment/target; evidence; pass authority |
| Operations | Role/preflight; command; expected/read-back; backup; rollback; incident; escalation; audit/evidence; bảo vệ dữ liệu |
| Risk | Cause/event/impact; S/L; control; owner; verification/evidence; residual; acceptance authority; review date |
| Traceability | Mọi link trỏ tới ID/section thật; phân biệt planned/documented/implemented/tested/passed/released |
| Implementation Plan | Entry/exit; dependency; owner/RACI; deliverable; test/evidence; change control; deploy/rollback; không mở gate từ prose |

## 8. Quy trình cập nhật tracker trong mỗi phiên

1. Rebase trạng thái từ file hiện tại; không dùng số của phiên trước nếu file đã
   thay đổi.
2. Sửa hồ sơ chủ quản trước, sau đó sửa downstream contract/design/test/trace.
3. Ghi version, trạng thái, ngày, owner và revision history trong chính hồ sơ.
4. Chạy checklist áp dụng; finding chưa đóng phải có ID, severity, owner và gate.
5. Cập nhật dòng tương ứng trong bảng master: mức, điểm và bằng chứng chuyển mức.
6. Tính lại bốn chỉ số ở dashboard bằng công thức §3.2.
7. Đồng bộ Open Decisions, Risk Register và Traceability nếu nội dung thay đổi
   requirement, contract, safety, test hoặc evidence.
8. Cập nhật `CHANGELOG.md` trong cùng phiên; ghi rõ kiểm tra nào đã chạy và kiểm
   tra nào không áp dụng.
9. Review diff/link/ID trùng; reviewer ký rồi mới nâng `M3 → M4 → M5`.

Không xóa finding để làm đẹp tỷ lệ. Nếu một hồ sơ Approved bị thay đổi contract,
requirement hoặc safety behavior, hạ về ít nhất `M3` và review lại downstream.

## 9. RACI review hồ sơ

| Nhóm hồ sơ | R — soạn | A — chấp thuận | C — review bắt buộc | I |
|---|---|---|---|---|
| Product/SRS/Decision | Product + System | Product Owner | Architect, các lead, QA | Dev/Ops |
| Architecture/Data/Interface | Architect + BE/Core | System Architect | FE, Security, Ops, QA | Product/HW/FW |
| Language/Artifact/Control/Lifecycle | Compiler + Controls + Core | Runtime Architect | BE, Security, Ops, QA | FE/FW/HW |
| UI/UX + FE | UX + FE | UX/FE Lead | Product, BE, QA | Core/Ops |
| BE + Security | BE + Security | Software Architect | FE, Core, Ops, QA | Product |
| FW-SOM + FW MCU + HW | Core/FW/HW | HW/FW Lead | Controls, Safety, Ops, QA | FE/BE |
| V&V/Risk/Trace | QA + risk owner | Verification Lead | Tất cả owner | Product/Release |
| Operations/Plan | Ops + Dev Lead | Release/Product Owner | Architect, Security, QA | Tất cả team |

## 10. Nhật ký snapshot tiến độ

Mỗi lần thay đổi mức, thêm **một dòng mới**; không sửa số lịch sử.

| Ngày | Baseline | M0 | M1 | M2 | M3 | M4 | M5 | File coverage | Maturity | DOC gate | Bằng chứng |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 2026-08-09 | 22 | 5 | 0 | 17 | 0 | 0 | 0 | 77,3% | 23,2% | DOC-G0 RED | Kiểm kê đường dẫn, metadata, Risk v0.1 và Trace v2.0 |
| 2026-08-09 R0 | 22 | 5 | 0 | 17 | 0 | 0 | 0 | 77,3% | 23,2% | DOC-G0 PASS | Chỉ đạo triển khai + register 22 hồ sơ tại CONTROL/Hub/Index; R1 bắt đầu |
| 2026-08-09 R1 | 22 | 5 | 0 | 13 | 4 | 0 | 0 | 77,3% | 28,6% | DOC-G1 REVIEW READY / BLOCKED | Index/SRS/OD/Architecture M3; thiếu chữ ký 15 decision; R2 viết target có kiểm soát |
| 2026-08-09 R2 | 22 | 0 | 0 | 11 | 11 | 0 | 0 | 100% | 45,0% | DOC-G2 REVIEW READY / BLOCKED | Data/Interface + 5 hồ sơ lõi đạt M3; OpenAPI/IPC/code chưa Active; thiếu decision/TLS sign-off |
| 2026-08-09 R3 | 22 | 0 | 0 | 5 | 17 | 0 | 0 | 100% | 53,2% | DOC-G3 REVIEW READY / BLOCKED | Sáu hồ sơ team đạt M3; implementation/browser/target/HIL và approval còn blocked |
| 2026-08-09 R4 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 REVIEW READY / BLOCKED | 22/22 M3; 15 decision, peer review/sign-off, implementation và evidence 0/30 còn blocked |
| 2026-08-09 tái kiểm toán | 22 | 0 | 0 | 22 | 0 | 0 | 0 | 100% | 30,0% | DOC-G4 RED / DETAIL REWORK | Hạ nhãn M3 tự chấm vì chưa có peer-review record; mở vòng chi tiết 1 |
| 2026-08-09 detail-1 | 22 | 0 | 0 | 22 | 0 | 0 | 0 | 100% | 30,0% | DOC-G4 RED / PEER REVIEW PENDING | 22/22 đã bổ sung cổng implement và self-check; không tự nâng M3/M4/M5 |
| 2026-08-09 M3 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / CONSUMER REVIEW + SIGN-OFF PENDING | `PROG-REV-2026-08-09`: 12 finding tài liệu đóng (5 P0, 6 P1, 1 P2); 22/22 có Đọc nhanh + bảng checklist từng mã; link/anchor/ID trùng = 0; M4/M5 giữ 0 vì cần người thật |
| 2026-08-09 visual-1 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / CONSUMER REVIEW + SIGN-OFF PENDING | Rule Detailed Design bổ sung cổng visual; UI/UX v0.5 có SVG cho đủ PGM-01..06, gồm landing desktop/mobile, modal Commission và drawer Restore; mức M3 không đổi, browser/runtime evidence vẫn 0 |
| 2026-08-09 simplify-1 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / OD-PROG-016 + CONSUMER REVIEW PENDING | Amendment A1: IA bốn workspace + tám journey `UJ-PROG-01..08`; migration 17 UC (12 MERGED / 3 SCENARIO / 2 ROADMAP); 13 hồ sơ IMPACTED, 9 REVIEWED-NO CHANGE; 60 requirement, 32 scenario, 16 risk, 17 decision; điểm heuristic mục tiêu 87/100; 3 SVG mới; M3 giữ nguyên, M4/M5 vẫn 0 |
| 2026-08-09 baseline-git | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY OPEN | Đưa 22/22 hồ sơ vào kiểm soát cấu hình Git (trước đó 20/22 untracked); harness vào repository tại `scripts/docs_iso_harness.py` có exit code và khối `EXPECT`; `DOC-GOV-001` và template hồ sơ vào repository; tách ba cổng quyền hạn ở Plan 53. M3 giữ 22/22, M4/M5 vẫn 0 |
| 2026-08-10 P0-review | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED | Duyệt Plan 53 v0.8; sửa 42→49 task, 30→32 scenario, 15→17 decision; tách P0-A/P0-B để bỏ dependency vòng tròn; lập gói P0 cho 7/7 task nhưng giữ 0/7 DoD vì chưa có consumer review, pin candidate và chữ ký |
| 2026-08-10 P0-pin | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED | Candidate P0 `e3e9fb2` đã ghim trên `origin/main`: tree `54eb519e`, 22/22 SHA-256/Git blob + hai hồ sơ hỗ trợ; blocker pin đóng, nhưng 0/7 DoD, M4/M5 0/22 vì review/conflict/sign-off còn thiếu |
| 2026-08-10 P0-env | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED | Host branch/build/toolchain PASS; kho Test Result sẵn nhưng 0/32; GitHub CI BLOCKED do billing, target BLOCKED do SSH auth, HIL BLOCKED do authority/fixture; P0 giữ 0/7 DoD |
| 2026-08-10 P1-cards | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED | Plan 53 v0.11 có 6/6 thẻ P1 đủ owner/contract/source/dependency/test/evidence/deploy/rollback/DoR/DoD; chỉ là PLAN-ONLY, P1 giữ 0/6 DoD và 0/32 Test Result |
| 2026-08-10 P0-consumer-review | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED — **chỉ còn chờ chữ ký** | Vòng consumer review **kỹ thuật** chạy trên 22 cặp producer→consumer: `9/9` finding `F-CR-01..09` đóng; 9/22 hồ sơ lên revision mới; 6 xung đột kiến trúc có `ADR-026..031` (`Proposed`); candidate ghim lại bằng 22 SHA-256 và thêm `candidate_pin_check.py`. **M4 vẫn 0/22** vì `DOC-GOV-001` §3 đòi reviewer là người thật — vòng kỹ thuật không nâng được mức trưởng thành |
| 2026-08-10 authority-1 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED một phần | `AUTH-PROG-2026-08-10-01`: Product Owner/CTO + System Architect Phạm Đình Chương `ACCEPT`; staging DONE; Architect `ACCEPT` 6/6 ADR; `3 DECIDED/14 OPEN/0 CLOSED`. Candidate v2.5 ghim lại; 0/22 M4/M5, consumer/Verification/discipline/QA còn thiếu |
| 2026-08-10 gate-audit-1 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED | Trước P1 phát hiện `PLAN-PROG-053` §6.5/§10 còn gọi `e3e9fb2` là candidate hiện hành. Đã sửa, phát hành candidate v2.7 và kiểm lại CI/target: GitHub jobs vẫn `steps=[]`, SSH target vẫn bị từ chối. Không đổi thiết kế hay code; Product/Architect cần xác nhận delta v2.7, P1 giữ 0/6 DoD |
| 2026-08-11 gate-recheck-2 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED | Sửa biên bản consumer còn trỏ v2.5 thành candidate v2.7/commit `a236200`; rerun CI attempt 2 vẫn 17/17 job `steps=[]`, SSH target vẫn bị từ chối. Không đổi thiết kế/code; `0/8` consumer, `0/22 M4/M5`, P1 `0/6` DoD |
| 2026-08-11 authority-2 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | DOC-G4 RED / PLAN_READY BLOCKED một phần | `AUTH-PROG-2026-08-11-02`: Product Owner/CTO + System Architect Phạm Đình Chương `ACCEPT` candidate v2.7 tại `a236200` sau khi xác nhận delta v2.5→v2.7 chỉ đổi chỉ báo cấu hình/trạng thái. CI/CD chuyển `DEFERRED` cho assurance/release, không chặn `PLAN_READY` hoặc `IMPLEMENT_READY[contract]`. Giữ `0/8` consumer, `0/22 M4/M5`, P1 `0/6` DoD vì không giả chữ ký còn thiếu |
| 2026-08-11 authority-3 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **PLAN_READY PASS / IMPLEMENT_READY[*] PASS** | `AUTH-PROG-2026-08-11-03`: Product Owner/CTO + System Architect `ACCEPT ALL` không kèm approval condition; 17/17 decision `DECIDED`; 6/6 ADR `Accepted`; chữ ký còn thiếu `WAIVED FOR IMPLEMENTATION`; CI/target/HIL không phải entry blocker; P0 7/7 DONE, P1 READY TO START |
| 2026-08-11 P1-task-100 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P1 IN_PROGRESS 1/6 / RELEASE_READY BLOCKED** | `TASK-PROG-100 DONE`: source commits `9917e3b` + `81080f8` + `efbed2d`; contract OpenAPI/Go/TS đồng bộ 25 operation và golden payload; regression host PASS; Trace nâng riêng `BE-110 I=Y`; Test Result giữ 0/32 |
| 2026-08-11 P1-task-101 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P1 IN_PROGRESS 2/6 / RELEASE_READY BLOCKED** | `TASK-PROG-101 DONE`: source `51fe515` + `e9707b4`; IPC v1 C++↔Go, peer/deadline/bounds/reconcile/no-mutation và golden SHA-256 PASS; `BE-110 I=Y`, các requirement lifecycle/recovery partial giữ `I=N`; Test Result giữ 0/32 |
| 2026-08-11 P1-task-102 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P1 IN_PROGRESS 3/6 / RELEASE_READY BLOCKED** | `TASK-PROG-102 DONE`: source `95585e7`; profile/schema/generated constants, `HASH_ONLY`, deterministic encode, loader no-mutation, golden/negative/boundary/fuzz PASS; full gate CTest 875/875, Go vet/test, FE 54 file/473 test + lint/build PASS; `CORE-101 I=Y`, Test Result giữ 0/32 |
| 2026-08-11 P1-task-103 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P1 IN_PROGRESS 4/6 / RELEASE_READY BLOCKED** | `TASK-PROG-103 DONE`: source `4a1e9f5`; catalog 19 public/77 detail, schema/manifest/generator C++/Go/TS, OpenAPI 1.16 và fail-safe unknown/HTTP/args; CTest 877/877, Go vet/test, FE 55 file/479 test + lint/build PASS; tổng `I=Y` giữ 2/60 và Test Result 0/32 |
| 2026-08-11 P1-task-104 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P1 IN_PROGRESS 5/6 / RELEASE_READY BLOCKED** | `TASK-PROG-104 DONE`: source `312f357`; SQLite v1, migration checksum/fail-closed, ETag/immutable/idempotency/audit, online backup/restore và fault/concurrency/race PASS; CTest 877/877, Go vet/test, FE 55 file/479 test + lint/build PASS; tổng `I=Y` giữ 2/60, Test Result 0/32 |
| 2026-08-11 P1-task-105 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P1 DONE 6/6 / G1 GO / RELEASE_READY BLOCKED** | Source `7f0c532` + `30a068b`; join 6/6 contract, self-test 5/5, order âm 5/5 và rollback bảo toàn/0 Commission PASS. Hai record VS-001/019 BLOCKED, 0/32 PASS; next `TASK-PROG-200` |
| 2026-08-11 P2-task-200 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 1/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `8d58efa` + `a638470`; ST subset/sáu type/source map/golden, fuzz tất định 10.000 mutation và parser/loader mỗi bộ 10 triệu input PASS; CTest 898/898, Go/FE regression PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; next `TASK-PROG-201` |
| 2026-08-11 P2-task-201 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 2/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `52dfb57`; FBD canonical schema/golden/manifest, C++ validator/fuzzer và FE model/reducer/component keyboard-first. Contract mutation 10/10, Core 8/8, FE 15/15, ASan fuzz 50.000 input, CTest 906/906 và Go/FE regression PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; tiếp theo `TASK-PROG-202` |
| 2026-08-11 P2-task-202 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 3/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `4819901`; FBD canonical hạ qua semantic checker/typed IR/runtime chung, 20 cặp ST↔FBD, trace TON và fail-closed. Contract mutation 10/10, targeted 17/17, ASan fuzz 100.000 input, CTest 915/915 và Go/FE regression PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; tiếp theo `TASK-PROG-203` |
| 2026-08-11 P2-task-203 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 4/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `2c2bfb4`; SHA-256/build manifest/source map ST/FBD khóa profile/library/ABI, UUID/unit và fail-closed. Targeted 35/35, mutation 7/7, CTest 927/927 và Go/FE regression PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; tiếp theo `TASK-PROG-204` |
| 2026-08-11 P2-task-204 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 5/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `66848a1`; lifecycle SQLite v2 và sáu API Project/Draft/Revision, ETag/CAS, cursor HMAC, receipt idempotency 24 giờ/restart, immutable seal/read và RBAC. CTest 927/927, Go/race, FE 494/494 và contract G1 PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; tiếp theo `TASK-PROG-205` |
| 2026-08-11 P2-task-205 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 6/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `e8c289e`; SQLite v3, hai API Check, receipt 24 giờ, lease/retry, compiler sandbox/timeout/process-group kill, terminal diagnostic và Artifact content-address/read-back. CTest 929/929, Go/race, FE 494/494 và contract G1 PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; tiếp theo `TASK-PROG-206` |
| 2026-08-11 P2-task-206 | 22 | 0 | 0 | 0 | 22 | 0 | 0 | 100% | 60,0% | **P2 IN_PROGRESS 7/8 / G2 IN_PROGRESS / RELEASE_READY BLOCKED** | Source `95b9388`; change manifest deterministic, ZIP source-only byte-exact, quarantine/validation fail-closed, import Project+Draft atomic, SQLite v4 receipt và OpenAPI v1.19. CTest 929/929, Go/race, FE 494/494 và contract G1 7/7 PASS. Tổng I=Y giữ 2/60, Test Result 0/32 PASS; tiếp theo `TASK-PROG-207` |

## 10.1 Ma trận impact của Amendment A1 trên 22 hồ sơ

Vòng đơn giản hóa ngày 2026-08-09 rà **toàn bộ** 22 hồ sơ, nhưng chỉ sửa hồ sơ
thực sự bị ảnh hưởng. Nguyên tắc: nếu mental model mới **không** đổi contract
hay hành vi của một layer thì ghi `REVIEWED — NO CHANGE` kèm lý do, không viết
lại để tài liệu trông đồng đều.

| # | Hồ sơ | Kết luận | Lý do / thay đổi chính |
|---:|---|---|---|
| 1 | `PROG-DOCSET-001` Design Index | **IMPACTED** | Cập nhật trạng thái và version của các hồ sơ bị sửa |
| 2 | `SRS-PROG-001` Requirements | **IMPACTED** | `FE-101` sang bốn workspace; thêm `FE-113/114/115`, `NFR-109/110`; 55 → 60 requirement |
| 3 | `PROG-OD-001` Open Decisions | **IMPACTED** | Thêm `OD-PROG-016` (IA/journey) và `OD-PROG-017` (thư viện mẫu); 15 → 17 |
| 4 | `ARCH-PROG-001` Architecture | `REVIEWED — NO CHANGE` | Gộp IA là thay đổi tầng trình bày. Quyền sở hữu tiến trình, biên tin cậy, biên lỗi và cutover không đổi |
| 5 | `DM-PROG-001` Data Model | `REVIEWED — NO CHANGE` | Không thêm/bớt entity, field, khóa hay migration. Tab là trạng thái URL, không phải dữ liệu bền vững |
| 6 | `IFSPEC-PROG-001` Interface Spec | **IMPACTED** | Thêm §6.1 ba nhánh impact `NONE/PRESENT/UNAVAILABLE` (fail-closed) và `?activeOnly=true` cho `GET /overrides`. **Không** thêm endpoint |
| 7 | `DDD-LANG-PROG-001` Language/Compiler | `REVIEWED — NO CHANGE` | Tập con ngôn ngữ, hệ kiểu, IR và diagnostic không phụ thuộc IA. `OD-PROG-017` nếu được duyệt sẽ tác động sau, đã ghi ở Product Spec §8.6 |
| 8 | `IFSPEC-ART-PROG-001` Artifact/Loader | `REVIEWED — NO CHANGE` | Layout artifact và loader không thấy tầng UI |
| 9 | `DDD-CTRL-PROG-001` Control Semantics | `REVIEWED — NO CHANGE` | Không đổi scan order, arbitration, PID, hold-last hay overrun |
| 10 | `DDD-LIFE-PROG-001` Runtime Lifecycle | `REVIEWED — NO CHANGE` | Máy trạng thái Check/Commission/Restore giữ nguyên. Xác nhận theo rủi ro là quy tắc trình bày; số ô xác nhận không phải guard của state machine |
| 11 | `UX-WEB-PROG-001` UI/UX | **IMPACTED** | Trọng tâm: IA bốn workspace, tám journey, migration 17 UC, route + chuyển hướng, ba SVG mới, cây component, API theo workspace, `UX-T-006` |
| 12 | `DDD-FE-PROG-001` FE Design | **IMPACTED** | §0.1 cây thư mục và route bốn workspace; ba ràng buộc tab/Draft/truy vấn dùng chung; năm chuyển hướng |
| 13 | `DDD-BE-PROG-001` BE Design | **IMPACTED** | §0.1 nhịp gọi `GET /overrides` từ ba màn hình và yêu cầu impact ba nhánh. Không đổi persistence/worker/RBAC |
| 14 | `DDD-FWSOM-PROG-001` FW-SOM | `REVIEWED — NO CHANGE` | Runtime trên SOM không biết tầng UI |
| 15 | `DDD-FWMCU-PROG-001` FW MCU | `REVIEWED — NO CHANGE` | MCU không biết Project, Revision hay màn hình |
| 16 | `DDD-HW-PROG-001` HW | `REVIEWED — NO CHANGE` | Không đổi ràng buộc điện hay điểm đo |
| 17 | `DDD-SEC-PROG-001` Security | `REVIEWED — NO CHANGE` | RBAC vẫn ở server; “viewer không thấy dãy nút vô hiệu hóa” là yêu cầu trình bày (`FE-114`), **không** thay kiểm quyền. Re-auth cho thao tác nguy hiểm giữ nguyên |
| 18 | `VVP-PROG-001` V&V | **IMPACTED** | Thêm `VS-PROG-031` (usability có người dùng thật) và `VS-PROG-032` (chuyển hướng route, giữ trạng thái tab); 30 → 32 |
| 19 | `OPS-PROG-001` Operations | **IMPACTED** | §18.1: số ô xác nhận thay đổi theo ảnh hưởng thật; `Chưa tính được` là điều kiện dừng; vùng thao tác nguy hiểm tách riêng |
| 20 | `RSK-PROG-001` Risk Register | **IMPACTED** | Thêm `RSK-PROG-016` — đơn giản hóa làm mất bước an toàn, `5×3=15`; 15 → 16 risk |
| 21 | `TRACE-PROG-001` Traceability | **IMPACTED** | Thêm 5 dòng requirement, §10 trace tám journey và bảng trạng thái migration 17 UC |
| 22 | `PLAN-PROG-053` Implementation Plan | **IMPACTED** | §15.1 chia P5 thành sáu lát cắt dọc `S5-A..F` theo workspace và journey |

Tổng: **13 `IMPACTED`**, **9 `REVIEWED — NO CHANGE`**, **0 `BLOCKED`** ở mức
tài liệu. Không hồ sơ nào bị chặn khỏi việc rà; các blocker còn lại là blocker
phê duyệt đã có từ trước, cộng `OD-PROG-016`.

Ngoài baseline 22, bốn hồ sơ nguồn/điều khiển cũng được sửa: Product Spec
`PROD-PROG-001` (Amendment A1), Plan 54 này, `CONTROL.md` và `CHANGELOG.md`.

## 10.2 Baseline có kiểm soát cấu hình

Trước 2026-08-09, chỉ **2/22** file baseline được Git theo dõi. Một hồ sơ chưa
được version control thì không có gì để ghim, so sánh hay quay lui — chưa phải
controlled baseline theo hướng ISO 9001. Đã khắc phục.

| Thuộc tính | Giá trị |
|---|---|
| Commit baseline | `05c1c48` |
| Hash đầy đủ | `05c1c480418a2256f1010527f9d90fb6ff549b86` |
| Nhánh | `docs/programming-design-set-v22` |
| Số file baseline được Git theo dõi | **22/22** |
| Harness xác nhận | `python3 scripts/docs_iso_harness.py --expect` → `PASS`, exit `0` |

Đây là **baseline gốc** dùng để so sánh và rollback. Nó không còn là candidate
của vòng review P0 hiện hành; mọi thẻ task mới phải dùng candidate ở đoạn dưới.

SHA-256 rút gọn 16 ký tự đầu của từng file tại commit trên:

| File | SHA-256 (16 ký tự đầu) |
|---|---|
| `PROGRAMMING_OPEN_DECISIONS.md` | `4b088889c2fe39a5` |
| `PROGRAMMING_DESIGN_INDEX.md` | `6f66112d9a47b19d` |
| `PROGRAMMING_FW_MCU_DESIGN.md` | `f8fa75c9a2d96851` |
| `PROGRAMMING_ARTIFACT_LOADER_SPEC.md` | `d945df62955cfb7a` |
| `PROGRAMMING_INTERFACE_SPEC.md` | `24c12db6bf005442` |
| `PROGRAMMING_BE_DESIGN.md` | `bd28570968d75446` |
| `PROGRAMMING_CONTROL_SEMANTICS.md` | `1d697ef0f867a2d0` |
| `PROGRAMMING_DATA_MODEL.md` | `62abb98e74fcfa47` |
| `PROGRAMMING_FE_DESIGN.md` | `0d345168887f30e7` |
| `PROGRAMMING_FW_SOM_DESIGN.md` | `f45e01f6326f0711` |
| `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `7fb15c2fb70a9b86` |
| `PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md` | `9026d1f978747496` |
| `PROGRAMMING_SECURITY_DESIGN.md` | `35d3c5ed2e6be324` |
| `PROGRAMMING_REQUIREMENTS_SPEC.md` | `34859905f640dead` |
| `PROGRAMMING_ARCHITECTURE.md` | `99f3e0d215e92bc6` |
| `53_PROGRAMMING_IMPLEMENTATION_PLAN.md` | `4597e2654cf01911` |
| `PROGRAMMING_HW_DESIGN.md` | `609a8dad26acb23b` |
| `PROGRAMMING_UI_UX_DESIGN.md` | `b6a98ca512417431` |
| `PROGRAMMING_VERIFICATION_PLAN.md` | `30f1cc9359e63e9d` |
| `PROGRAMMING_OPERATIONS_RUNBOOK.md` | `cae5448594562959` |
| `PROGRAMMING_RISK_REGISTER.md` | `f631828cbb790687` |
| `PROGRAMMING_TRACEABILITY_MATRIX.md` | `9c2a5939a18869ba` |

Candidate P0 hiện hành đã ghim:

| Thuộc tính | Giá trị |
|---|---|
| Định danh | 22 SHA-256 của candidate v2.21 ở manifest v3.27; không dùng candidate đã `SUPERSEDED` làm revision hiện hành |
| Commit/tree | `6893c878987983a41e26f0a190656353001c27a3` / `8f1801ac4c412f1fc7848c5855375af9949c79e8`; source authority `95b9388994e7eaceeddda2af321352c9db9a338d` |
| Nhánh phát hành | `feat/programming-source-bundle-20260811` — remote đã xóa sau merge PR #151 |
| Manifest | [`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](../07_records/reviews/PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) |
| Phạm vi | 22/22 hồ sơ baseline; đồng bộ `TASK-PROG-206 DONE`, P2 7/8 và ranh giới 2 record BLOCKED/0 PASS |
| Trạng thái | **PIN PASS 22/22; APPROVED FOR IMPLEMENTATION** |

Manifest chứa SHA-256 đầy đủ, Git blob, số dòng và delta so với baseline gốc.
Nếu nội dung candidate đổi, phải phát hành commit/manifest mới và invalid phần
review chịu ảnh hưởng; không sửa hash lịch sử để trỏ sang working tree mới.

## 11. Điều kiện kết luận “bộ hồ sơ đã hoàn tất”

- 22/22 file tồn tại tại đường dẫn chuẩn và 22/22 đạt `M5`.
- 13 checklist `DD-*` được xử lý cho mọi Detailed Design; `N/A` có lý do.
- 17 decision đã được `DECIDED`; không có `TBD` vô
  owner hoặc không có gate.
- Risk Register liên kết control/test; residual chỉ đổi khi có evidence hợp lệ.
- Traceability không đứt chuỗi requirement → design → implementation target →
  scenario → Test Result; trạng thái evidence vẫn được báo trung thực.
- Tất cả finding review P0/P1 đóng, link/ID/revision sạch; chữ ký được miễn phải
  ghi `WAIVED FOR IMPLEMENTATION`, không giả tên người ký.
- `PLAN-PROG-053` đã đồng bộ từ thiết kế được duyệt và mở code gate.

Hoàn tất hồ sơ chỉ mở **quyền bắt đầu implementation có kiểm soát**. Nó không tự
chứng minh sản phẩm đã implement, đạt HIL, đạt IEC/ISO hay sẵn sàng release.

## 12. Lịch sử sửa đổi và phê duyệt

| Phiên bản | Ngày | Nội dung | Người sửa |
|---|---|---|---|
| 1.0 | 2026-08-09 | Tạo baseline 22 hồ sơ, thang M0..M5, master tracker, dependency gate và checklist | System Engineering |
| 1.1 | 2026-08-09 | Hoàn tất R0, đăng ký baseline vào CONTROL và mở công việc R1 theo chỉ đạo triển khai | System Engineering |
| 1.2 | 2026-08-09 | R1 technical complete: 4 hồ sơ M3; giữ approval blocker và bắt đầu R2 theo TARGET-PENDING | System Engineering |
| 1.3 | 2026-08-09 | R2 technical complete: tạo đủ 5 file, nâng 7 hồ sơ lõi lên M3, coverage 100%; bắt đầu R3 | System Engineering |
| 1.4 | 2026-08-09 | R3 technical complete: nâng sáu hồ sơ UI/FE/BE/FW-SOM/FW-MCU/HW lên M3; bắt đầu R4 | System Engineering |
| 1.5 | 2026-08-09 | R4 technical complete: 22/22 hồ sơ M3, coverage/review-ready 100%; DOC-G4 chờ external review/sign-off | System Engineering |
| 1.6 | 2026-08-09 | Tái kiểm toán hạ 22 hồ sơ về M2 do thiếu peer-review record; hoàn tất vòng detail 1 cho 22/22, cập nhật evidence từng file và giữ DOC-G4 RED | System Engineering |
| 1.7 | 2026-08-09 | Nâng 22/22 lên M3 theo định nghĩa §3.1 sau `PROG-REV-2026-08-09`; tách rõ ranh giới M3 (kiểm được bằng chứng khách quan) và M4 (cần reviewer bên tiêu thụ) để đóng finding `F-PROG-012`; cập nhật dashboard, tracker và snapshot | System Engineering |
| 1.8 | 2026-08-09 | Áp dụng rule visual mới: cập nhật bằng chứng UI/UX v0.5 có asset render được cho đủ PGM-01..06 và thêm snapshot `visual-1`; giữ nguyên M3/M4/M5 vì không có review hay evidence runtime mới | System Engineering |
| 1.9 | 2026-08-09 | Amendment A1 — đơn giản hóa và định vị cạnh tranh: thêm §10.1 ma trận impact 22 hồ sơ (13 IMPACTED / 9 REVIEWED-NO CHANGE); cập nhật dashboard cho 17 decision, 16 risk, 32 scenario; thêm snapshot `simplify-1`. Không tự nâng M4/M5 | System Engineering |
| 2.0 | 2026-08-09 | Đóng review chặn phê duyệt: sửa master tracker về 60 requirement và 17 decision, `DOC-5440` về 32 scenario; nêu rõ phân chia thẩm quyền Plan 54 (hồ sơ) ↔ Plan 53 (implementation) và cấm roadmap thứ ba; siết phát biểu ISO-aligned và trỏ `DOC-GOV-001`; thêm snapshot `baseline-git` | System Engineering |
| 2.1 | 2026-08-10 | Đồng bộ vòng duyệt P0: sửa Trace 55→60 và điều kiện hoàn tất 15→17 decision; ghi version Open Decisions/VVP/Plan 53 hiện hành; thêm gói review P0 ngoài baseline; tách P0-A/P0-B để bỏ dependency vòng tròn; thêm snapshot `P0-review`; giữ M3 22/22, M4/M5 0/22 | System Engineering |
| 2.2 | 2026-08-10 | Ghim candidate P0 `e3e9fb2` bằng manifest 22 hồ sơ + hai hồ sơ hỗ trợ; cập nhật snapshot `P0-pin`, Plan 53 v0.9 và sửa bảng `DOC-5440..5445` bị ngắt; giữ M3 22/22, M4/M5 0/22 và DOC-G4 RED | Document Control |
| 2.3 | 2026-08-10 | Rà môi trường P0 và thêm snapshot `P0-env`: host branch/build/toolchain + evidence repository PASS phần chuẩn bị; tách CI billing, target SSH auth và HIL authority/fixture thành blocker; đồng bộ Plan 53 v0.10, giữ M3/M4/M5 và DOC-G4 không đổi | Dev Lead + QA + Ops |
| 2.4 | 2026-08-10 | Thêm snapshot `P1-cards`, đồng bộ Plan 53 v0.11 với 6/6 thẻ task P1 đã điền đủ 11 trường; sửa dependency/evidence/decision gate nhưng giữ đúng 0/6 DoD, 0/32 Test Result, M3/M4/M5 và DOC-G4 không đổi | Dev Lead + Architect + Document Control |
| 2.5 | 2026-08-10 | Thêm snapshot `P0-consumer-review`: vòng review kỹ thuật xong, `9/9` finding đóng, 9/22 hồ sơ lên revision mới, `ADR-026..031` `Proposed`, candidate ghim bằng 22 SHA-256. Sửa phát biểu R0 và trạng thái đầu file để tách “review kỹ thuật xong” khỏi “authority đã ký”. **M3 22/22, M4/M5 vẫn 0/22**, DOC-G4 giữ RED | Document Control + Dev Lead |
| 2.6 | 2026-08-10 | Thêm snapshot `authority-1`; ghi Product Owner/CTO + System Architect Phạm Đình Chương `ACCEPT`, staging DONE, Architect `ACCEPT` 6/6 ADR, Open Decisions `3 DECIDED/14 OPEN`. Giữ M3 22/22, M4/M5 0/22 và DOC-G4 RED do consumer/Verification/discipline/QA còn thiếu | Product + Architect + Document Control |
| 2.7 | 2026-08-10 | Thêm snapshot `gate-audit-1`; sửa chỉ báo candidate đã cũ trong Plan 53, ghim candidate v2.7 và đo lại CI/target vẫn bị chặn. Không đổi requirement/contract/thiết kế/code; giữ 22/22 M3, M4/M5 0/22, P1 0/6 DoD và yêu cầu Product/Architect xác nhận delta v2.7 | Dev Lead + Document Control |
| 2.8 | 2026-08-10 | Ghi commit `a236200` và tree `8296338d` chứa candidate v2.7 vào tracker sau commit phát hành; bước bổ sung chỉ đổi hồ sơ hỗ trợ ngoài mẫu số 22, không thay candidate hay trạng thái gate | Document Control |
| 2.9 | 2026-08-11 | Thêm snapshot `gate-recheck-2`; đồng bộ biên bản consumer sang candidate v2.7 và ghi lần tái kiểm CI/target trên `2ad6931`. Giữ 22/22 M3, M4/M5 0/22, P1 0/6 DoD và mọi gate `BLOCKED` | Dev Lead + Document Control |
| 3.0 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-02`: Product Owner/CTO + System Architect `ACCEPT` candidate v2.7 sau khi review delta; CI/CD `DEFERRED` khỏi entry của lát cắt contract. Giữ M3 22/22, M4/M5 0/22 và `PLAN_READY BLOCKED` vì chữ ký consumer/Verification/Document Control không thuộc phạm vi ủy quyền | Product + Architect + Document Control |
| 3.1 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-03`: `ACCEPT ALL` không kèm approval condition; 17/17 decision `DECIDED`; 6/6 ADR `Accepted`; `PLAN_READY` và mọi `IMPLEMENT_READY[*]` `PASS`; consumer/discipline/Verification/Document Control `WAIVED FOR IMPLEMENTATION`; P0 7/7 DONE, P1 được bắt đầu ngay | Product + Architect + Document Control |
| 3.2 | 2026-08-11 | Ghi commit `b068b7d` và tree `6ab6ac10` chứa candidate v2.8; bước bổ sung chỉ đổi hồ sơ hỗ trợ ngoài mẫu số 22, không đổi candidate hoặc quyền implementation | Document Control |
| 3.3 | 2026-08-11 | Đồng bộ tiến độ code đầu tiên: `TASK-PROG-100 DONE`, P1 1/6; dẫn ba source commit và review G1; giữ maturity tài liệu 22/22 M3, M4/M5 0/22 và Test Result 0/32 | Dev Lead + Document Control |
| 3.4 | 2026-08-11 | Ghi PR #127 đã merge tại `7109bae`, remote feature branch đã xóa; candidate v2.9 có commit/tree truy xuất được, P1 và evidence không đổi | Document Control |
| 3.5 | 2026-08-11 | Hoàn tất `TASK-PROG-101`: thêm snapshot P1 2/6, dẫn source IPC v1 và review/evidence G1; phát hành candidate v2.10 do Plan 53/Trace đổi; giữ maturity 22/22 M3, M4/M5 0/22, Test Result 0/32 và `RELEASE_READY BLOCKED` | Dev Lead + Document Control |
| 3.6 | 2026-08-11 | Ghi PR #129 đã merge tại `adcefed`, tree `89f0ee5a`; remote feature branch đã xóa. Candidate v2.10/pin 22/22, P1 2/6 và ranh giới evidence không đổi | Document Control |
| 3.7 | 2026-08-11 | Hoàn tất `TASK-PROG-102`: thêm snapshot P1 3/6, dẫn source profile/artifact/loader và review/evidence G1; phát hành candidate v2.11 do Artifact Spec/Plan 53/Trace đổi; giữ maturity 22/22 M3, M4/M5 0/22, Test Result 0/32 và `RELEASE_READY BLOCKED` | Dev Lead + Document Control |
| 3.8 | 2026-08-11 | Ghi PR #131 đã merge tại `16d3e40`, tree `a0add512`; remote feature branch đã xóa. Candidate v2.11/pin 22/22, P1 3/6 và ranh giới evidence không đổi | Document Control |
| 3.9 | 2026-08-11 | Hoàn tất `TASK-PROG-103`: thêm snapshot P1 4/6, dẫn source catalog lỗi ba lớp và review/evidence G1; phát hành candidate v2.12 do Design Index/Interface/Artifact/Trace/Plan đổi; giữ 22/22 M3, M4/M5 0/22, Test Result 0/32 và `RELEASE_READY BLOCKED` | Dev Lead + Document Control |
| 3.10 | 2026-08-11 | Ghi PR #133 đã merge tại `1c74b9f`, tree `db5e225f`; remote feature branch đã xóa. Candidate v2.12/pin 22/22, P1 4/6 và ranh giới evidence không đổi | Document Control |
| 3.11 | 2026-08-11 | Hoàn tất `TASK-PROG-104`: thêm snapshot P1 5/6, dẫn source SQLite store/migration/backup và review/evidence G1; phát hành candidate v2.13 do Design Index/Data/BE/Risk/Trace/Plan đổi; giữ 22/22 M3, M4/M5 0/22, Test Result 0/32 và RELEASE_READY BLOCKED | Dev Lead + Document Control |
| 3.12 | 2026-08-11 | Ghi PR #135 đã merge tại `1f651b7`, tree `94326834`; remote feature branch đã xóa. Candidate v2.13/pin 22/22, P1 5/6 và ranh giới evidence không đổi | Document Control |
| 3.13 | 2026-08-11 | Hoàn tất `TASK-PROG-105`: join sáu contract, deploy/rollback dry-run, record review G1 và hai Test Result BLOCKED; phát hành candidate v2.14 do Index/VVP/Risk/Trace/Plan đổi. P1 6/6 DONE, G1 GO, next TASK-PROG-200; giữ 0/32 PASS và RELEASE_READY BLOCKED | Dev Lead + Architect + Document Control |
| 3.14 | 2026-08-11 | Ghi PR #137 đã merge tại `e6ab04b`, tree `9a022f96`; remote feature branch đã xóa. Candidate v2.14/pin 22/22, P1 6/6 và G1 GO không đổi | Document Control |
| 3.15 | 2026-08-11 | Hoàn tất `TASK-PROG-200`: cập nhật snapshot P2 1/8, Language/Artifact/Risk/Trace/Plan và evidence G2; phát hành candidate v2.15 do sáu hồ sơ baseline đổi. Parser/loader mỗi bộ fuzz 10 triệu input, CTest 898/898, Go và FE regression PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED | Compiler + Core Lead + Document Control |
| 3.16 | 2026-08-11 | Ghi PR #139 đã merge tại `288aa37`, tree `8d4fb50a`; remote feature branch đã xóa. Candidate v2.15/pin 22/22, P2 1/8 và ranh giới evidence/release không đổi | Document Control |
| 3.17 | 2026-08-11 | Hoàn tất `TASK-PROG-201`: thêm snapshot P2 2/8, dẫn source FBD canonical/validator/editor và review/evidence G2; phát hành candidate v2.16 do Index/Language/FE/Risk/Trace/Plan đổi. Contract mutation 10/10, Core 8/8, FE 15/15, ASan fuzz 50.000 input, CTest 906/906 và Go/FE regression PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED | Compiler + Core + FE Lead + Document Control |
| 3.18 | 2026-08-11 | Ghi PR #141 đã merge tại `207cd90`, tree `b85bdb2c`; remote feature branch đã xóa. Candidate v2.16/pin 22/22, P2 2/8 và ranh giới evidence/release không đổi | Document Control |
| 3.19 | 2026-08-11 | Hoàn tất `TASK-PROG-202`: thêm snapshot P2 3/8, dẫn source lowerer/equivalence/fuzz và review/evidence G2; phát hành candidate v2.17 do Index/Language/Risk/Trace/Plan đổi. Targeted 17/17, ASan fuzz 100.000 input, CTest 915/915 và Go/FE regression PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED | Compiler + Core Lead + Document Control |
| 3.20 | 2026-08-11 | Ghi PR #143 đã merge tại `7d424bc`, tree `aeb27c61`; remote feature branch đã xóa. Candidate v2.17/pin 22/22, P2 3/8 và ranh giới evidence/release không đổi | Document Control |
| 3.21 | 2026-08-11 | Hoàn tất `TASK-PROG-203`: thêm snapshot P2 4/8, dẫn source artifact/manifest/source-map và review/evidence G2; phát hành candidate v2.18 do Index/Language/Artifact/Risk/Trace/Plan đổi. Targeted 35/35, manifest mutation 7/7, CTest 927/927 và Go/FE regression PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED | Compiler + Core Lead + Document Control |
| 3.22 | 2026-08-11 | Ghi PR #145 đã merge tại `2899d02`, tree `cdef0e77`; remote feature branch đã xóa. Candidate v2.18/pin 22/22, P2 4/8 và ranh giới evidence/release không đổi | Document Control |
| 3.23 | 2026-08-11 | Hoàn tất `TASK-PROG-204`: thêm snapshot P2 5/8, dẫn source Project/Draft/Revision API + SQLite v2/ETag/idempotency/restart và review/evidence G2; phát hành candidate v2.19 do Index/Data/Interface/BE/Risk/Trace/Plan đổi. CTest 927/927, Go/race, FE 494/494 và contract G1 PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED | BE Lead + Architect + Document Control |
| 3.24 | 2026-08-11 | Ghi PR #147 đã merge tại `27a06e1`, tree `4e4e4d24`; remote feature branch đã xóa. Candidate v2.19/pin 22/22, P2 5/8 và ranh giới evidence/release không đổi | Document Control |
| 3.25 | 2026-08-11 | Hoàn tất `TASK-PROG-205`: thêm snapshot P2 6/8, dẫn source Check worker/sandbox/Artifact registry và review/evidence G2; phát hành candidate v2.20 do Index/Data/Interface/BE/Risk/Trace/Plan đổi. CTest 929/929, Go/race, FE 494/494 và contract G1 PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED; commit/tree/PR hồ sơ chờ ghi sau merge | BE Lead + Architect + Document Control |
| 3.26 | 2026-08-11 | Ghi PR #149 đã merge tại `3c8b4c3`, tree `aa7e13a9`; remote feature branch đã xóa. Candidate v2.20/pin 22/22, P2 6/8 và ranh giới evidence/release không đổi | Document Control |
| 3.27 | 2026-08-11 | Hoàn tất `TASK-PROG-206`: thêm snapshot P2 7/8, dẫn source change manifest/bundle source-only/import atomic và review/evidence G2; phát hành candidate v2.21 do Index/Data/Interface/BE/Risk/Trace/Plan đổi. CTest 929/929, Go/race, FE 494/494 và contract G1 7/7 PASS; giữ 0/32 PASS và RELEASE_READY BLOCKED; commit/tree/PR hồ sơ chờ ghi sau merge | BE Lead + Security + Document Control |
| 3.28 | 2026-08-11 | Ghi PR #151 đã merge tại `6893c87`, tree `8f1801ac`; remote feature branch đã xóa. Candidate v2.21/pin 22/22, P2 7/8 và ranh giới evidence/release không đổi; GitHub Actions không khởi chạy do billing/spending-limit của tài khoản, gate local đầy đủ vẫn PASS và đã ghi trong PR | Document Control |

| Vai trò | Người ký | Trạng thái | Ngày/ghi chú |
|---|---|---|---|
| Product Owner | Phạm Đình Chương | **ACCEPT ALL candidate v2.8** | 2026-08-11; `AUTH-PROG-2026-08-11-03`; không kèm approval condition |
| System Architect | Phạm Đình Chương | **ACCEPT ALL candidate v2.8** | 2026-08-11; 6/6 ADR `Accepted`; mọi implementation slice được mở |
| Verification Lead | — | **WAIVED FOR IMPLEMENTATION** | Review/Test Result vẫn độc lập, nhưng không chặn code |
| Document Control | — | **WAIVED FOR IMPLEMENTATION** | Hash/register vẫn kiểm máy, chữ ký không chặn code |
