# Document Control

**ID:** DOC-CTRL-001
**Trạng thái:** Active
**Chủ quản:** Project Engineering
**Cập nhật:** 2026-08-03 (đăng ký hồ sơ thiết kế/review Modbus RTU Point)

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

[Document Hub](../README.md) là register điều hướng. Các file baseline cấp cao là authority; các index HW/FW/SW/interface quản lý corpus thiết kế chi tiết. Review log, finding và evidence phải nằm trong `07_records`, không được trộn với design authority.

Không áp dụng mục tiêu giảm số file cho tài liệu thiết kế cần thiết để tái tạo, review, verify hoặc manufacture sản phẩm. Chỉ được loại bỏ tài liệu sau khi chứng minh nội dung đã được hợp nhất và có đường dẫn phục hồi.

### Register Programming Rev A

| Hồ sơ | Lớp/trách nhiệm |
|---|---|
| [DDC24 Programming Product Spec](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) | Product Spec authority |
| [Programming Open Decisions](PROGRAMMING_OPEN_DECISIONS.md) | vấn đề chưa quyết định; không phải Design |
| [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Product Capability → Product Requirement → System Requirement → Verification Requirement |
| [Programming Docs Sync Report](../07_records/reviews/PROGRAMMING_DOCS_SYNC_REPORT.md) | record của lần đồng bộ 2026-08-03 |
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

## Lưu trữ và phục hồi

- Gói: `archives/markdown-before-restructure-2026-07-22.tar.gz`
- Manifest: `archives/markdown-before-restructure-2026-07-22.sha256.txt`
- SHA-256 gói: `60b6631dfdc1395f4292960097872417d149f2572eb15fd2e224aa869cd98857`

Phục hồi vào thư mục tạm, không ghi đè workspace: `mkdir /tmp/ddc-doc-recovery && tar -xzf archives/markdown-before-restructure-2026-07-22.tar.gz -C /tmp/ddc-doc-recovery`.
