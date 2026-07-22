# Document Control

**ID:** DOC-CTRL-001
**Trạng thái:** Active
**Chủ quản:** Project Engineering
**Cập nhật:** 2026-07-22

## Mục tiêu

Bộ hồ sơ trong [Document Hub](../README.md) gồm baseline đang hiệu lực và corpus thiết kế chi tiết. Archive chỉ dùng truy nguyên lịch sử; tài liệu phục hồi phải được gắn `In Review`, `Historical` hoặc `Superseded` cho đến khi reconcile với baseline/code.

## Thứ tự thẩm quyền

Khi nội dung xung đột, áp dụng thứ tự sau:

1. `shared/iop_protocol.h`, `shared/mkddc_shm.h`, schema/validator và code đã test đối với contract đã triển khai.
2. [Decision log](DECISIONS.md) đối với lựa chọn kiến trúc và phạm vi.
3. [Requirements](../02_requirements/REQUIREMENTS.md) đối với hành vi phải đạt.
4. Tài liệu architecture/design đối với cách hiện thực.
5. Verification, operations và traceability đối với bằng chứng và quy trình.

Sai khác giữa code và yêu cầu không tự động làm code đúng: phải mở finding, xác định baseline được phê duyệt, rồi sửa code hoặc hồ sơ và test trong cùng thay đổi.

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

## Lưu trữ và phục hồi

- Gói: `archives/markdown-before-restructure-2026-07-22.tar.gz`
- Manifest: `archives/markdown-before-restructure-2026-07-22.sha256.txt`
- SHA-256 gói: `60b6631dfdc1395f4292960097872417d149f2572eb15fd2e224aa869cd98857`

Phục hồi vào thư mục tạm, không ghi đè workspace: `mkdir /tmp/ddc-doc-recovery && tar -xzf archives/markdown-before-restructure-2026-07-22.tar.gz -C /tmp/ddc-doc-recovery`.
