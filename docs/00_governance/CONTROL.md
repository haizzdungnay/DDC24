# Document Control

**ID:** DOC-CTRL-001
**Phiên bản:** 1.2
**Trạng thái:** Active
**Chủ quản:** Project Engineering
**Cập nhật:** 2026-08-23 (Programming Product v3.0 thống nhất; Plan59 v2.3 Active; W5+W6 đóng sổ, W7 ký verdict **NO-GO**; `PLAN_READY PASS`; `IMPLEMENT_READY PASS`; `RELEASE_READY NO-GO`; `12 DECIDED/0 OPEN`)

## Mục tiêu

Bộ hồ sơ trong [Document Hub](../README.md) gồm baseline đang hiệu lực và corpus thiết kế chi tiết. Archive chỉ dùng truy nguyên lịch sử; tài liệu phục hồi phải được gắn `In Review`, `Historical` hoặc `Superseded` cho đến khi reconcile với baseline/code.

## Lớp tài liệu và thẩm quyền

Không dùng một loại tài liệu để trả lời thay loại khác:

| Lớp | Authority | Không được suy diễn |
|---|---|---|
| Product Spec | [Product baseline](../01_product/PRODUCT.md), Product Spec chủ đề và Product decision quy định sản phẩm phải làm gì/phạm vi nào. | Không chứng minh implementation. |
| Requirement | [Requirements](../02_requirements/REQUIREMENTS.md) quy định từng system/software/interface/NFR layer phải đáp ứng gì. | Không tự chọn process/API/schema/thuật toán. |
| Design | Architecture/design quy định sẽ hiện thực requirement bằng cách nào sau khi được phê duyệt. | Không biến đề xuất hoặc plan thành As-Built. |
| As-Built | Code, contract, binary/deployment và test/evidence đã kiểm chứng quy định source/hệ chạy hiện tại thực sự có gì. | Không tự sửa Product Spec hoặc tự đóng requirement/release gate. |

Khi nội dung cùng lớp xung đột, áp dụng baseline `Active` mới hơn có decision
tham chiếu rõ. Đối với fact đã triển khai, `contracts/iop/iop_protocol.h`,
`contracts/shm/mkddc_shm.h`, schema/validator và code đã test là nguồn As-Built. Đối
với phạm vi cam kết, Product Spec và Product decision là nguồn chuẩn. Decision
không được âm thầm mở rộng Product Spec; requirement/design phải trace ngược về
Product Requirement.

Sai khác giữa code và yêu cầu không tự động làm code đúng: phải mở finding, xác định baseline được phê duyệt, rồi sửa code hoặc hồ sơ và test trong cùng thay đổi.

Riêng Programming, host unit test ST/IR/cyclic component chỉ là As-Built
development evidence. Nó không được dùng làm bằng chứng runtime production,
Activation, RETAIN, FBD, I/O Mapping end-to-end hoặc Online Monitor.

## Trạng thái và thay đổi

Trạng thái hợp lệ: `Draft`, `In Review`, `Active`, `Superseded`, `Archived`. Chỉ `Active` được dùng làm baseline. Mọi thay đổi tài liệu phải:

1. cập nhật đúng tài liệu chủ quản thay vì tạo file mới;
2. giữ ID ổn định hoặc ghi rõ quan hệ `supersedes`;
3. cập nhật [Traceability](../07_records/TRACEABILITY.md) nếu ảnh hưởng requirement/interface/test;
4. cập nhật `CHANGELOG.md` dưới `[Unreleased]`;
5. chạy kiểm tra link và xác minh phù hợp với mức rủi ro.

Không được tuyên bố chứng nhận ISO/IEC, BTL, EMC hoặc release readiness khi chưa có bằng chứng được phê duyệt.

## Controlled register

[Document Hub](../README.md) là register điều hướng; [chỉ mục hồ sơ rà soát](../07_records/reviews/README.md) là register của các record trong `07_records/reviews/`. Các file baseline cấp cao là authority; các index HW/FW/SW/interface quản lý corpus thiết kế chi tiết. Review log, finding và evidence phải nằm trong `07_records`, không được trộn với design authority.

Không áp dụng mục tiêu giảm số file cho tài liệu thiết kế cần thiết để tái tạo, review, verify hoặc manufacture sản phẩm. Chỉ được loại bỏ tài liệu sau khi chứng minh nội dung đã được hợp nhất và có đường dẫn phục hồi.

### Register Programming thống nhất

| Hồ sơ | Lớp/trách nhiệm |
|---|---|
| [DDC24 Programming Product Spec](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) | `PROD-PROG-001` v3.0 Active — một Product, đa Program, POU, Control Library, Published Signal, Enable/Disable và sáu workspace |
| [Quy tắc kiểm soát tài liệu](DOC_GOVERNANCE.md) | `DOC-GOV-001` Active — ISO-aligned, `DD-01..DD-13`, thang `M0..M5`, ba cổng quyền hạn, harness và bảy quy tắc trung thực |
| [Programming Decision Register](PROGRAMMING_OPEN_DECISIONS.md) | `DEC-PROG-REGISTER-001` Active — 12 quyết định khóa, 0 Open Decision, không còn decision blocker implementation |
| [Programming Requirements Specification](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | `SRS-PROG-001` v1.0 — 82 requirement gồm migration baseline và Product Target thống nhất |
| [Programming Unified Product Detailed Design](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) | `DDD-SW-PROG-UNIFIED-001` Active — authority về data/contract/state/algorithm/error/source/test/deploy/rollback |
| [Programming Design Index](../02_design/PROGRAMMING_DESIGN_INDEX.md) | `PROG-DOCSET-001` v4.1 — register và thứ tự đọc authority hiện hành |
| [Programming Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | ownership, process/failure boundary, package lifecycle và cutover target |
| [Programming Document Readiness Matrix](PROGRAMMING_DOCUMENT_READINESS_MATRIX.md) | v2.1 — `PLAN_READY=PASS`, `IMPLEMENT_READY=PASS`; resource ngoài được quản bằng evidence queue |
| [Programming Plan 59](../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) | `PLAN-PROG-059` v2.2 Active — execution/tracker authority duy nhất, 51 task/8 Wave đến release; W5 đóng sổ ở mức HOST/LOCAL |
| [Prompt tự động Plan59](../03_implementation/PROMPT_PLAN59_AUTONOMOUS_EXECUTION.md) | Prompt thi hành task Ready/Ordered, kiểm chứng và cập nhật Plan59; không tự nâng evidence host thành release |
| [Prompt CTO Plan59 W6+W7](../03_implementation/PROMPT_PLAN59_CTO_W6_W7_EXECUTION.md) | `PROMPT-PLAN59-CTO-W6W7` v1.0 — quyền quyết định cho hardening/packaging/RC và target/HIL/V&V; Must physical/soak/RETAIN/install/SIGNED/provenance không được waive |
| [Programming Risk Register](../07_records/PROGRAMMING_RISK_REGISTER.md) | risk/control/owner/evidence/residual gate |
| [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Product Capability → Product Requirement → System Requirement → Verification Requirement |
| [Programming Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | v2.0 — 32 scenario migration + 12 scenario Product thống nhất; release vẫn cần target/HIL record |
| [Programming Release Record 2026-08-23](../07_records/PROGRAMMING_RELEASE_RECORD_2026-08-23.md) | `PROG-RELEASE-RECORD-2026-08-23` Active — verdict **NO-GO** đã ký; bảng 14 cổng W7, 12 scenario Product và bảy điều kiện mở `GO` |
| [Programming Unified Baseline Manifest](../07_records/reviews/PROGRAMMING_UNIFIED_BASELINE_MANIFEST_2026-08-20.md) | SHA-256 của authority set Product/SRS/DDD/UX/VVP/Trace/Risk/Plan/Prompt |
| [ADR-050](DECISIONS.md) | Quyết định hợp nhất một Product và supersede mô hình phạm vi Rev cũ |
| [Plan 53/54/56 và WP tracker](../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) | `Superseded` — chỉ dùng truy nguyên As-Built/task/commit cũ; Plan59 sở hữu công việc tương lai |
| [DDC-24 Baseline Source Fix Report](../07_records/reviews/DDC24_BASELINE_SRC_FIX_REPORT.md) | record tổng hợp thay đổi source, test và readiness |
| [Modbus RTU Point As-Built Report](../07_records/reviews/MODBUS_RTU_POINT_AS_BUILT_REPORT.md) | record implementation/test host và blocker RS485 thật |
| [Physical I/O HIL Report](../07_records/reviews/PHYSICAL_IO_HIL_REPORT.md) | record firmware evidence và các gate HIL còn mở |
| [Deployment Provenance Report](../07_records/reviews/DEPLOYMENT_PROVENANCE_REPORT.md) | record build/package provenance và sai khác target |
| [Modbus RTU Point Detailed Design](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md) | Design `In Review`; proposal trước Programming, chưa phải Active/As-Built |
| [Modbus RTU Point Design Review Proposal](../07_records/reviews/MODBUS_RTU_POINT_DESIGN_REVIEW_PROPOSAL.md) | review record/finding/decision request; không thay design authority |

Các plan C0/C1–C10 và hồ sơ trước ADR-050 không phải authority cho Product
Programming thống nhất. Nội dung còn đúng được giữ làm supporting evidence;
mọi xung đột về POU, số Program, workspace, library, signal hoặc lifecycle phải
theo Product v3.0 và Unified DDD.

ADR-024 và `DDD-SW-MBRTU-POINT-001` đang `Proposed/In Review`. Chúng không đổi
trạng thái Programming Design tổng thể, không chứng minh implementation và
không cho phép đóng `MODBUS_RTU_POINT_READY` trước real-RS485/HIL/provenance.

### Register Modbus RTU (đồng bộ lần 2 & phê duyệt Active: 2026-08-05)

| Hồ sơ | Lớp/trách nhiệm | Trạng thái |
|---|---|---|
| [Modbus RTU Product Requirements](../01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md) | Product Spec chủ đề: capability, product requirement, 18 use case | **Active 0.2** (2026-08-05) |
| [Modbus RTU Data Model](../02_design/software/MODBUS_RTU_DATA_MODEL.md) | Design — mô hình canonical Bus/Device/Point (nguồn chân lý duy nhất) | **Active 0.2** (2026-08-05) |
| [Modbus RTU UI/UX Design](../04_uiux/MODBUS_RTU_UI_UX_DESIGN.md) | Design — năm page Web, wireframe, validation, quyền | **Active 0.2** (2026-08-05) |
| [Modbus RTU FE Design](../02_design/software/MODBUS_RTU_FE_DESIGN.md) | Design — feature structure, state model, candidate lifecycle | **Active 0.2** (2026-08-05) |
| [Modbus RTU BE Design](../02_design/software/MODBUS_RTU_BE_DESIGN.md) | Design — transaction, validator, admission, commissioning, RBAC/audit | **Active 0.2** (2026-08-05) |
| [Modbus RTU FW-SOM Design](../02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md) | Design — ownership, scheduler, codec, quality, write path, reload | **Active 0.2** (2026-08-05) |
| [Modbus RTU API Spec](../02_design/interfaces/MODBUS_RTU_API_SPEC.md) | Interface — REST/WebSocket đặc tả, mã lỗi, idempotency | **Active 0.2** (2026-08-05) |
| [Modbus RTU Interface Spec](../02_design/interfaces/MODBUS_RTU_INTERFACE_SPEC.md) | Interface — luồng end-to-end, interface matrix, contract v2 | **Active 0.2** (2026-08-05) |
| [Modbus RTU Verification Plan](../05_verification/MODBUS_RTU_VERIFICATION_PLAN.md) | Verification — test specification 6 tầng | **Active 0.2** (2026-08-05) |
| [Modbus RTU Traceability Matrix](../07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md) | Record — chuỗi truy vết đầy đủ | Active **1.1** |
| [Modbus RTU Open Decisions](MODBUS_RTU_OPEN_DECISIONS.md) | Governance — vấn đề chưa quyết định; không phải Design | Active **1.1** |
| [Modbus RTU Docs Sync Report](../07_records/reviews/MODBUS_RTU_DOCS_SYNC_REPORT.md) | Record — audit, mâu thuẫn đã xử lý, gap và kết luận gate | Active **2.0** |
| [Biên bản phê duyệt Modbus RTU 2026-08-04](../07_records/reviews/MODBUS_RTU_APPROVAL_RECORD_2026-08-04.md) | Record — 11 quyết định PM/CTO đã ký (Đ-01..Đ-11); authority Track A | Active |
| [Tờ trình phê duyệt Modbus RTU 2026-08-05](../07_records/reviews/MODBUS_RTU_APPROVAL_REQUEST_2026-08-05.md) | Record — 7 quyết định PM/CTO/Architect đã ký; ADR-024 Accepted & Track B Approved | Active |
| [Plan 49 — Modbus RTU Implementation](../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) | Implementation plan hai track; **Track A + Track B APPROVED** | Active |

Chín hồ sơ thiết kế Modbus RTU nêu trên đã được chuyển sang trạng thái **Active** theo Tờ trình phê duyệt ngày 2026-08-05 (`DDC24-MBRTU-REQ-APPROVE-2026-08-05`), đồng thời ADR-024 đã chuyển sang **Accepted**.

**Cho phép triển khai Track B:** Ban Dự án chính thức khởi động Track B theo Plan 49. Epics B1–B5 bắt đầu ngay sau khi đồng bộ OpenAPI và tài liệu. Epic B6 (Nghiệm thu phần cứng) yêu cầu đấu nối vật lý đồng hồ điện, biến tần và kết nối RS485 thật với xác nhận RS485 direction control từ Hardware Lead.

Ba tài liệu Modbus cũ đã được đánh **SUPERSEDED một phần** trong cùng lần đồng bộ:
`26_MODBUS_IMPLEMENTATION_PLAN.md`, `SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md` và
`MODBUS_REGISTER_MAP_MK-DDC-24_VI.md`. Chúng được giữ nguyên để bảo toàn lịch sử
quyết định; mỗi tài liệu ghi rõ phát biểu nào không còn hiệu lực.

## Lưu trữ và phục hồi

- Gói: `archives/markdown-before-restructure-2026-07-22.tar.gz`
- Manifest: `archives/markdown-before-restructure-2026-07-22.sha256.txt`
- SHA-256 gói: `60b6631dfdc1395f4292960097872417d149f2572eb15fd2e224aa869cd98857`

Phục hồi vào thư mục tạm, không ghi đè workspace: `mkdir /tmp/ddc-doc-recovery && tar -xzf archives/markdown-before-restructure-2026-07-22.tar.gz -C /tmp/ddc-doc-recovery`.

Đợt dọn Markdown ngày 2026-08-14 loại các snapshot As-Built đã bị thay thế,
record dùng cây source cũ, plan agent và prompt/backlog thô. Toàn bộ nội dung
trước khi dọn phục hồi được từ commit
`b69fdf152fd1b424bb4ab2239b5cf97b0e86b554`; phải checkout/extract vào thư mục
tạm, không ghi đè cây làm việc hiện hành. Gói thiết kế Programming 22 hồ sơ,
contract, risk/trace, test result và bằng chứng target/HIL không bị loại.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.2 | 2026-08-23 | Thêm `PROG-RELEASE-RECORD-2026-08-23` vào register và đổi dòng trạng thái theo Plan59 v2.3: W5+W6 đóng sổ, W7 đã **ký** verdict `NO-GO` (trước đây `RELEASE_READY=NO-GO` là trạng thái mặc định chờ đánh giá; nay là một quyết định có chữ ký, có bảng Must và bảy điều kiện mở). |
| 1.1 | 2026-08-23 | Đồng bộ Plan59 v2.2 sau khi đóng sổ W5: cả tám cổng HOST của W5 PASS trong một lượt sau khi sửa `F-W5-CLOSE-01` (Core không biên dịch được) và `F-W5-CLOSE-02` (helper E2E coi `load` là "đã mount"). Không thay đổi Product/SRS/DDD/VVP và không mở `RELEASE_READY`. |
| 1.0 | 2026-08-21 | Thiết lập revision có kiểm soát cho register; đồng bộ Programming Design Index v4.1, Readiness Matrix v2.1 và Plan59 v2.1 sau khi W5 hoàn tất ở mức HOST/LOCAL. Không thay đổi Product/SRS/DDD/VVP và không mở `RELEASE_READY`. |
