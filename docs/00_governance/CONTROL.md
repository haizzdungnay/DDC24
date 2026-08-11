# Document Control

**ID:** DOC-CTRL-001
**Trạng thái:** Active
**Chủ quản:** Project Engineering
**Cập nhật:** 2026-08-11 (Programming candidate v2.8 `APPROVED FOR IMPLEMENTATION`; `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS`; `17 DECIDED/0 OPEN/0 CLOSED`)

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

Riêng Programming Rev A, host unit test ST/IR/cyclic component chỉ là As-Built
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

### Register Programming Rev A

| Hồ sơ | Lớp/trách nhiệm |
|---|---|
| [DDC24 Programming Product Spec](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) | Product Spec authority; §1–§7 `Active`, §8–§9 là **Amendment A1 `PROPOSED`** (bốn workspace + tám journey + benchmark) chờ `OD-PROG-016` |
| [Quy tắc kiểm soát tài liệu](DOC_GOVERNANCE.md) | `DOC-GOV-001` Active — ISO-aligned, `DD-01..DD-13`, thang `M0..M5`, ba cổng quyền hạn, harness và bảy quy tắc trung thực |
| [Programming Open Decisions](PROGRAMMING_OPEN_DECISIONS.md) | 17 quyết định: `17 DECIDED`, `0 OPEN`, `0 CLOSED`; approved for implementation |
| [Programming Requirements Specification](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | System/software/hardware/NFR requirements và acceptance Programming Rev A |
| [Programming Design Index](../02_design/PROGRAMMING_DESIGN_INDEX.md) | register chủ quản: 22/22 hồ sơ đạt M3 — Review Ready. Vòng consumer review **kỹ thuật** đã chạy (`9/9` finding đóng) nhưng **`0/22` đạt `M4`** — `M4` đòi chữ ký người thật, xem `DOC-GOV-001` §3 |
| [Programming Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | ownership, process/failure boundary, lifecycle và cutover target |
| [Programming Documentation Roadmap](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md) | v3.1: candidate v2.8 approved; chữ ký còn thiếu `WAIVED FOR IMPLEMENTATION`; nằm ngoài mẫu số 22 |
| [Programming Implementation Plan](../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) | v0.17: P0 7/7 DONE; P1 READY TO START; mọi implementation gate PASS |
| [Programming Risk Register](../07_records/PROGRAMMING_RISK_REGISTER.md) | risk/control/owner/evidence/residual gate |
| [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Product Capability → Product Requirement → System Requirement → Verification Requirement |
| [Programming Docs Sync Report](../07_records/reviews/PROGRAMMING_DOCS_SYNC_REPORT.md) | record của lần đồng bộ 2026-08-03 |
| [Programming Design Set Review 2026-08-09](../07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) | record rà 22 hồ sơ + finding register `F-PROG-001..012`; căn cứ nâng M3 |
| [Gói review cổng P0 2026-08-10](../07_records/reviews/PROGRAMMING_P0_GATE_REVIEW_PACKAGE_2026-08-10.md) | v2.0 — `ACCEPT ALL`; `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS` |
| [Manifest candidate P0 2026-08-10](../07_records/reviews/PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md) | v3.2 — candidate v2.8 định danh bằng **22 SHA-256**, commit `b068b7d`; approved for implementation |
| [Consumer review liên chức năng P0 2026-08-10](../07_records/reviews/PROGRAMMING_P0_CONSUMER_REVIEW_2026-08-10.md) | v1.6 — `9/9` finding đóng; `0/8` chữ ký thật nhưng `8/8 WAIVED FOR IMPLEMENTATION`; không chặn code |
| [ADR-026..031](DECISIONS.md) | 6/6 **`Accepted`** theo `AUTH-PROG-2026-08-11-03`; evidence thu trong implementation |
| [DDC-24 Baseline Source Fix Report](../07_records/reviews/DDC24_BASELINE_SRC_FIX_REPORT.md) | record tổng hợp thay đổi source, test và readiness |
| [Modbus RTU Point As-Built Report](../07_records/reviews/MODBUS_RTU_POINT_AS_BUILT_REPORT.md) | record implementation/test host và blocker RS485 thật |
| [Physical I/O HIL Report](../07_records/reviews/PHYSICAL_IO_HIL_REPORT.md) | record firmware evidence và các gate HIL còn mở |
| [Deployment Provenance Report](../07_records/reviews/DEPLOYMENT_PROVENANCE_REPORT.md) | record build/package provenance và sai khác target |
| [Modbus RTU Point Detailed Design](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md) | Design `In Review`; proposal trước Programming, chưa phải Active/As-Built |
| [Modbus RTU Point Design Review Proposal](../07_records/reviews/MODBUS_RTU_POINT_DESIGN_REVIEW_PROPOSAL.md) | review record/finding/decision request; không thay design authority |

Các plan C0/C1–C10 và detailed design Programming có trước ADR-023 không phải
authority cho Product Spec mới cho tới khi được reconcile và phê duyệt lại.

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
