# MK-DDC-24 Document Hub

**Trạng thái:** Active
**Cập nhật:** 2026-07-22

Đây là cổng vào duy nhất cho hồ sơ Markdown đang hiệu lực. Mỗi chủ đề chỉ có một tài liệu chủ quản; không tạo file Markdown mới nếu nội dung có thể cập nhật vào hồ sơ bên dưới.

| Hồ sơ | Mục đích |
|---|---|
| [Control](00_governance/CONTROL.md) | quản trị, thẩm quyền, trạng thái và quy tắc thay đổi |
| [Decision log](00_governance/DECISIONS.md) | quyết định kiến trúc hiện hành, gồm các ADR đã hợp nhất |
| [Product](01_product/PRODUCT.md) | định vị, baseline và phạm vi Rev A |
| [Requirements](02_requirements/REQUIREMENTS.md) | yêu cầu có ID và tiêu chí chấp nhận |
| [System](03_architecture/SYSTEM.md) | kiến trúc hệ thống và deployment topology |
| [Interfaces](04_design/INTERFACES.md) | IOP, SHM, cấu hình và API contracts |
| [Firmware](04_design/FIRMWARE.md) | baseline MCU, sampling, actuation, IOP và watchdog |
| [Software](04_design/SOFTWARE.md) | thiết kế các service và component runtime |
| [Hardware](04_design/HARDWARE.md) | baseline điện tử, I/O và ràng buộc thiết kế |
| [Verification](05_verification/VERIFICATION.md) | chiến lược test, ma trận và release gates |
| [Development & operations](06_operations/DEVELOPMENT_AND_OPERATIONS.md) | build, test, deploy, vận hành và phục hồi |
| [Traceability](07_records/TRACEABILITY.md) | ánh xạ yêu cầu → thiết kế → code → bằng chứng |

## Detailed design corpus

- [Hardware detailed design](04_design/hardware/README.md)
- [Firmware detailed design](02_design/firmware/README.md)
- [Software detailed design](02_design/software/README.md)
- [Interface detailed design](02_design/interfaces/README.md)
- [Source specifications](01_specs/README.md)
- [Implementation guides](03_implementation/README.md)
- [Hardware review records](07_records/reviews/hardware/README.md)
- [IEC 61131-3 Program/SOM FW gap assessment](07_records/reviews/KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md)
- [IEC 61131-3 corrective design doc review — structure + design](07_records/reviews/KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md)
- [IEC 61131-3 Program/SOM FW decisions — Q0–Q9 CTO 2026-07-23, Decided/Closed](07_records/reviews/KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md)
- [ADR-018 — Mekong-owned IEC 61131-3-aligned Program Runtime](adr/ADR-018-mekong-owned-iec-aligned-program-runtime.md)
- [Program Runtime C0 Architecture and Feasibility Plan](07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md)
- [Program Runtime Implementation Plan C1–C10](07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md)
- [Program Runtime document conflict report (ADR-018 remediation, 31/31 closed)](07_records/reviews/KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md)
- [Program Runtime readiness review for C0 — C0_READY status](07_records/reviews/PROGRAM_RUNTIME_READY_FOR_C0.md)

Luồng đọc khuyến nghị: Product → Requirements → System → baseline Design → Detailed design → Verification. Các tài liệu chi tiết có trạng thái `In Review` phải được đối chiếu với baseline/code trước khi dùng cho release.

Archive lịch sử không phải nguồn chuẩn: `archives/markdown-before-restructure-2026-07-22.tar.gz`.

Artifact hỗ trợ không phải Markdown được giữ tại `02_design/interfaces/openapi.yaml`, `07_records/evidence/` và `07_records/security/`; chúng không tự tạo thành bằng chứng release nếu chưa được review theo Verification.
