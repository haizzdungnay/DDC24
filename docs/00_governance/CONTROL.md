# Document Control

**ID:** DOC-CTRL-001
**Phiên bản:** 1.6
**Trạng thái:** Active
**Chủ quản:** Project Engineering
**Cập nhật:** 2026-08-24 (`AUTH-PROG-2026-08-24-05` pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; `T59-801=DONE`, `T59-802=READY`, R1/R2/R3 được mở nhưng bắt buộc chạy tuần tự; `IMPLEMENTATION_CLOSE=PENDING`, `TARGET_FAKE_MCU_DEPLOY=PARTIAL`, `TARGET_FAKE_MCU_SOAK=NOT_RUN`, `RELEASE_READY=NO-GO`)

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
| [DDC24 Programming Product Spec](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) | `PROD-PROG-001` v3.3 Active; PGM-02 R1/R2/R3 exact-pinned cho implementation bởi `AUTH-PROG-2026-08-24-05`; v3.3 đồng bộ ADR-061 (chu kỳ {10…50000} ms) và ADR-062 |
| [Quy trình clean code & clean docs](CLEAN_CODE_WORKFLOW.md) | `WF-CLEAN-001` v1.0 Active — ba vai tách biệt, ma trận quyền, workflow state, branch/merge rule, quality gate, truy xuất và lịch chạy; thi hành bằng `scripts/workflow_guard.py` |
| [Quy tắc kiểm soát tài liệu](DOC_GOVERNANCE.md) | `DOC-GOV-001` Active — ISO-aligned, `DD-01..DD-13`, thang `M0..M5`, ba cổng quyền hạn, harness và bảy quy tắc trung thực |
| [Programming Decision Register](PROGRAMMING_OPEN_DECISIONS.md) | `DEC-PROG-REGISTER-001` v1.4 — 12 quyết định unified CLOSED; change request/exact pin CLOSED; ghost-POU policy RESOLVED nhưng corrective implementation còn PENDING; `ADR-053` Accepted |
| [Programming Requirements Specification](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | `SRS-PROG-001` v1.3 Active cho implementation: 82 baseline + 7 PGM-02 = 89 requirement; v1.3 đồng bộ ADR-061/062; evidence vẫn theo VVP |
| [Programming Unified Product Detailed Design](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) | `DDD-SW-PROG-UNIFIED-001` v1.3 — overlay PGM-02 exact-pinned cho implementation; maturity M3, không giả M4/M5 |
| [PGM-02 Workspace ST/FBD Detailed Design](../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md) | `DDD-SW-PGM02-WORKSPACE-001` v0.3 `M3 — REVIEW READY / AUTHORIZED FOR IMPLEMENTATION`; route/identity/EDIT/LIVE/SIMULATE/NFR/test/rollback |
| [Programming Design Index](../02_design/PROGRAMMING_DESIGN_INDEX.md) | `PROG-DOCSET-001` v4.4-candidate — register và thứ tự đọc authority hiện hành/Candidate |
| [Programming Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | v1.2 Active; worker isolation/failure boundary PGM-02 exact-pinned cho implementation |
| [Programming Document Readiness Matrix](PROGRAMMING_DOCUMENT_READINESS_MATRIX.md) | v2.5 — exact-pinned cho implementation; `T59-802=READY`, task sau theo dependency; release NO-GO |
| [Programming Plan 59](../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) | `PLAN-PROG-059` v2.7 — 69 authority card/9 Wave; `T59-801` DONE, `T59-802` READY; dependency R1 → R2 → R3 |
| [Prompt tự động Plan59](../03_implementation/PROMPT_PLAN59_AUTONOMOUS_EXECUTION.md) | Prompt thi hành task Ready/Ordered, kiểm chứng và cập nhật Plan59; không tự nâng evidence host thành release |
| [Prompt CTO Plan59 W6+W7](../03_implementation/PROMPT_PLAN59_CTO_W6_W7_EXECUTION.md) | `PROMPT-PLAN59-CTO-W6W7` v1.0 — quyền quyết định cho hardening/packaging/RC và target/HIL/V&V; Must physical/soak/RETAIN/install/SIGNED/provenance không được waive |
| [Programming Risk Register](../07_records/PROGRAMMING_RISK_REGISTER.md) | `RSK-PROG-001` v4.22-candidate — 23/23 Open; `RSK-PROG-023` nối DDD/ADR/U15 nhưng residual chưa hạ |
| [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | `TRACE-PROG-001` v6.9 — 89 requirement/47 scenario authorized for implementation; PGM-02 giữ `I/T/P/R=N` tới khi có source/evidence |
| [Programming Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | baseline v2.0 + v2.1-candidate; 47 scenario, `U13..U15` NOT_RUN |
| [DDC-24 Release Record 2026-09-27](../07_records/DDC24_RELEASE_RECORD_2026-09-27.md) | `DDC24-RELEASE-RECORD-2026-09-27` **Draft chờ Release Owner ký** — RC `main@f86150e3`; W7 9 PASS / 1 FAIL / 4 NOT_RUN; bảy điều kiện mở `GO` cập nhật + hai điều kiện mới; verdict đề xuất **NO-GO** phát hành hiện trường |
| [Programming Release Record 2026-08-23](../07_records/PROGRAMMING_RELEASE_RECORD_2026-08-23.md) | `PROG-RELEASE-RECORD-2026-08-23` Active — verdict **NO-GO** đã ký; bảng 14 cổng W7, 12 scenario Product và bảy điều kiện mở `GO` |
| [Programming Unified Baseline Manifest](../07_records/reviews/PROGRAMMING_UNIFIED_BASELINE_MANIFEST_2026-08-20.md) | v1.49 ghim 17-file authority set sau `AUTH-PROG-2026-08-24-05`; exact Candidate ngoài bảng được khóa bằng commit `413a043` |
| [ADR-050](DECISIONS.md) | Quyết định hợp nhất một Product và supersede mô hình phạm vi Rev cũ |
| [ADR-053](../adr/ADR-053-programming-simulation-worker-cach-ly.md) | `Accepted` bởi `AUTH-PROG-2026-08-24-05` — worker Simulation ephemeral cách ly; thi hành R3 vẫn đợi dependency R2 |
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
| 1.6 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05`: pin exact Candidate `413a043`, mở PLAN/IMPLEMENT_READY cho PGM-02 nhưng bắt buộc R1→R2→R3; giữ maturity/evidence/release trung thực và `IMPLEMENTATION_CLOSE=PENDING` cho corrective ghost-POU. |
| 1.5-candidate | 2026-08-24 | Đăng ký 17-file review package PGM-02, formal DDD/contract/ADR-053, 89 requirement/47 scenario và 16 card Candidate; `T59-801` REVIEW, downstream code/PLAN_READY/IMPLEMENT_READY vẫn PENDING/NO-GO. |
| 1.4 | 2026-08-24 | Ghi controlled change request PGM-02 v2.2: Owner mở duy nhất `T59-801`/WP-00, Architect pin và code R1/R2/R3 còn NO-GO. Đồng bộ Decision Register 2 record OPEN, Plan59 53 task/9 Wave, Risk 23/23 Open, Trace v6.7 và `TARGET_FAKE_MCU_DEPLOY=PARTIAL`; không đổi Product/SRS/DDD/VVP hoặc `RELEASE_READY=NO-GO`. |
| 1.3 | 2026-08-24 | Đồng bộ Plan59 52 task và tách bốn lớp trạng thái: quyền implementation đã PASS; corrective implementation, deploy/soak MCU FAKE còn chờ evidence mới; CI được owner defer cho đóng implementation và physical MCU/HIL được defer nhưng `RELEASE_READY` giữ `NO-GO`. |
| 1.2 | 2026-08-23 | Thêm `PROG-RELEASE-RECORD-2026-08-23` vào register và đổi dòng trạng thái theo Plan59 v2.3: W5+W6 đóng sổ, W7 đã **ký** verdict `NO-GO` (trước đây `RELEASE_READY=NO-GO` là trạng thái mặc định chờ đánh giá; nay là một quyết định có chữ ký, có bảng Must và bảy điều kiện mở). |
| 1.1 | 2026-08-23 | Đồng bộ Plan59 v2.2 sau khi đóng sổ W5: cả tám cổng HOST của W5 PASS trong một lượt sau khi sửa `F-W5-CLOSE-01` (Core không biên dịch được) và `F-W5-CLOSE-02` (helper E2E coi `load` là "đã mount"). Không thay đổi Product/SRS/DDD/VVP và không mở `RELEASE_READY`. |
| 1.0 | 2026-08-21 | Thiết lập revision có kiểm soát cho register; đồng bộ Programming Design Index v4.1, Readiness Matrix v2.1 và Plan59 v2.1 sau khi W5 hoàn tất ở mức HOST/LOCAL. Không thay đổi Product/SRS/DDD/VVP và không mở `RELEASE_READY`. |
