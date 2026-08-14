# MK-DDC-24 Document Hub

**Trạng thái:** Active
**Cập nhật:** 2026-08-14 (đã loại bản Markdown trùng/lịch sử và corpus AHUHP candidate chưa triển khai; Programming vẫn `APPROVED FOR IMPLEMENTATION`; audit As-Built xác nhận UC-PROG-03 NO-GO và `RELEASE_READY BLOCKED`)

Đây là cổng vào duy nhất cho hồ sơ Markdown đang hiệu lực. Mỗi chủ đề chỉ có một tài liệu chủ quản; không tạo file Markdown mới nếu nội dung có thể cập nhật vào hồ sơ bên dưới.

| Hồ sơ | Mục đích |
|---|---|
| [Control](00_governance/CONTROL.md) | quản trị, thẩm quyền, trạng thái và quy tắc thay đổi |
| [Quy tắc kiểm soát tài liệu](00_governance/DOC_GOVERNANCE.md) | `DOC-GOV-001`: cấu trúc bắt buộc `DD-01..DD-13`, thang `M0..M5`, ba cổng `PLAN_READY`/`IMPLEMENT_READY`/`RELEASE_READY`, harness và quy tắc trung thực |
| [Decision log](00_governance/DECISIONS.md) | quyết định kiến trúc hiện hành, gồm các ADR đã hợp nhất |
| [Product](01_product/PRODUCT.md) | định vị, baseline và phạm vi Rev A |
| [Product Spec Programming Rev A](01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) | capability, product requirement, thuật ngữ và scope Programming Rev A |
| [Requirements](02_requirements/REQUIREMENTS.md) | yêu cầu có ID và tiêu chí chấp nhận |
| [System](03_architecture/SYSTEM.md) | kiến trúc hệ thống và deployment topology |
| [Interfaces](04_design/INTERFACES.md) | IOP, SHM, cấu hình và API contracts |
| [Firmware](04_design/FIRMWARE.md) | baseline MCU, sampling, actuation, IOP và watchdog |
| [Software](04_design/SOFTWARE.md) | thiết kế các service và component runtime |
| [Hardware](04_design/HARDWARE.md) | baseline điện tử, I/O và ràng buộc thiết kế |
| [Verification](05_verification/VERIFICATION.md) | chiến lược test, ma trận và release gates |
| [Development & operations](06_operations/DEVELOPMENT_AND_OPERATIONS.md) | build, test, deploy, vận hành và phục hồi |
| [Traceability](07_records/TRACEABILITY.md) | ánh xạ yêu cầu → thiết kế → code → bằng chứng |
| [Chỉ mục hồ sơ rà soát](07_records/reviews/README.md) | trạng thái từng record rà soát/phê duyệt/triển khai, đã đối chiếu mã nguồn; kèm bảng ánh xạ đường dẫn trước/sau tái cấu trúc |
| [Programming Traceability Matrix](07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Product Capability → Product Requirement → System Requirement → Verification Requirement |
| [Programming Open Decisions](00_governance/PROGRAMMING_OPEN_DECISIONS.md) | 17 quyết định: `17 DECIDED`, `0 OPEN`, `0 CLOSED`; baseline đã duyệt |
| [Programming Design Index](02_design/PROGRAMMING_DESIGN_INDEX.md) | cổng vào bộ 22 hồ sơ yêu cầu, thiết kế, kiểm chứng và delivery Programming Rev A |
| [Programming Documentation Roadmap](03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md) | v3.37: P0..P4 source/host DONE; P5 `8/11`; P6 `0/3`; `RELEASE_READY BLOCKED` |
| [Programming Implementation Plan](03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) | v0.55: tổng `43/53`; P5 corrective đang thực hiện; team vẫn được viết/merge code, release chưa được mở |
| [Programming Risk Register](07_records/PROGRAMMING_RISK_REGISTER.md) | 16 rủi ro, design control, owner, evidence gate và residual |
| [Programming Docs Sync Report](07_records/reviews/PROGRAMMING_DOCS_SYNC_REPORT.md) | record đồng bộ docs theo ADR-023 ngày 2026-08-03 |
| [Programming — Báo cáo As-Built/gap PM-CTO 2026-08-14](07_records/reviews/PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md) | hiện trạng source đa lớp, 12 finding; UC-PROG-03 sai từ bước 2; quyết định cần PM/CTO và NO-GO release |
| [DDC-24 Baseline Source Fix Report](07_records/reviews/DDC24_BASELINE_SRC_FIX_REPORT.md) | kết quả CI, Point Model, Config Apply, health/recovery và readiness trước Programming Design |
| [Modbus RTU Point As-Built Report](07_records/reviews/MODBUS_RTU_POINT_AS_BUILT_REPORT.md) | coverage FE/BE/iobus/Core/WS, simulator và blocker RS485 thật |
| [Modbus RTU Point Detailed Design](02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md) | design In Review: Bus/Device/Point, typed runtime, quality, atomic apply, write result và HIL gate |
| [Modbus RTU Point Design Review Proposal](07_records/reviews/MODBUS_RTU_POINT_DESIGN_REVIEW_PROPOSAL.md) | báo cáo phương án, finding P0 và chín quyết định cần reviewer duyệt |
| [Modbus RTU Product Requirements](01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md) | capability, product requirement và 18 use case Modbus RTU |
| [Modbus RTU Data Model](02_design/software/MODBUS_RTU_DATA_MODEL.md) | mô hình canonical Bus/Device/Point, quality, persistence/revision, import/export |
| [Modbus RTU UI/UX Design](04_uiux/MODBUS_RTU_UI_UX_DESIGN.md) | năm page Web, wireframe, validation, state và ma trận quyền |
| [Modbus RTU FE Design](02_design/software/MODBUS_RTU_FE_DESIGN.md) | cấu trúc feature, state model, vòng đời candidate |
| [Modbus RTU BE Design](02_design/software/MODBUS_RTU_BE_DESIGN.md) | giao dịch cấu hình, validator, admission, commissioning, RBAC/audit |
| [Modbus RTU FW-SOM Design](02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md) | ownership, scheduler hai bus, codec, quality, write path, reload |
| [Modbus RTU API Spec](02_design/interfaces/MODBUS_RTU_API_SPEC.md) | REST/WebSocket đề xuất, mã lỗi ổn định, idempotency |
| [Modbus RTU Interface Spec](02_design/interfaces/MODBUS_RTU_INTERFACE_SPEC.md) | luồng end-to-end, interface matrix và contract runtime v2 |
| [Modbus RTU Verification Plan](05_verification/MODBUS_RTU_VERIFICATION_PLAN.md) | test specification 6 tầng và ma trận VR |
| [Modbus RTU Traceability Matrix](07_records/MODBUS_RTU_TRACEABILITY_MATRIX.md) | Capability → Requirement → Design → VR → Test → Source |
| [Modbus RTU Open Decisions](00_governance/MODBUS_RTU_OPEN_DECISIONS.md) | 16 quyết định còn thiếu authority + 3 blocker ngoài phạm vi |
| [Modbus RTU Docs Sync Report](07_records/reviews/MODBUS_RTU_DOCS_SYNC_REPORT.md) | record đồng bộ 2026-08-04: mâu thuẫn đã xử lý, gap và kết luận gate |
| [Modbus RTU Code Review](07_records/reviews/MODBUS_RTU_CODE_REVIEW_2026-08-04.md) | 14 defect source có dẫn chứng dòng code, tách khỏi gap thiết kế |
| [Modbus RTU Implementation Plan](03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) | Plan 49: Track A vá an toàn + Track B contract v2; bảng task, RACI, swimlane, mốc |
| [Dashboard và Web UX PA3 Implementation Plan](03_implementation/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md) | Plan 52: data truth → shell → Dashboard → 12 use case → kiểm chứng và deploy Foxlinx |
| [Modbus RTU — Báo cáo PM/CTO](07_records/reviews/MODBUS_RTU_PM_CTO_REVIEW_BRIEF_2026-08-04.md) | 10 rủi ro, 11 câu hỏi cần quyết định, 7 đề nghị phê duyệt |
| [Khảo sát UART/RS485 board production](07_records/test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md) | bằng chứng read-only trên Foxlinx: 2 UART bật, không có cấu hình RS-485 trong DT |
| [Physical I/O HIL Report](07_records/reviews/PHYSICAL_IO_HIL_REPORT.md) | phân biệt firmware host evidence với HIL/safe-state vật lý chưa thực hiện |
| [Deployment Provenance Report](07_records/reviews/DEPLOYMENT_PROVENANCE_REPORT.md) | build identity, release manifest, installer và sai khác target hiện hữu |
| [Repository Architecture Restructure Plan](03_implementation/46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md) | Closed 2026-08-04 — G0..G5 PASS, source migration, regression host và nghiệm thu target/rollback |
| [RST-205 Closure Review](07_records/reviews/RST205_CLOSURE_REVIEW_2026-08-04.md) | đối chiếu tiêu chí đóng Plan 46, số đo regression và gap còn tồn tại |
| [RST-202 Target Acceptance Runbook](03_implementation/47_RST202_TARGET_ACCEPTANCE_RUNBOOK.md) | quy trình install/startup/provenance/rollback trên board để đóng blocker cuối của Plan 46 |
| [Repository Restructure Host Evidence](07_records/evidence/restructure/HOST_RESTRUCTURE_GATES_20260803.json) | số đo layout, C++ matrix, Go race, FE/E2E, firmware và release checksum sau migration |

## Hardware platform

- [Foxlinx SOM-DDC-24 — Tài liệu kit phần cứng](08_hardware/foxlinx-som-ddc24/README.md) — spec, pinout, UART/RS485, deploy checklist, known issues

## Detailed design corpus

- [Hardware detailed design](04_design/hardware/README.md)
- [Firmware detailed design](02_design/firmware/README.md)
- [Software detailed design](02_design/software/README.md)
- [Interface detailed design](02_design/interfaces/README.md)
- [Source specifications](01_specs/README.md)
- [Implementation guides](03_implementation/README.md)
- [Hardware review records](07_records/reviews/hardware/README.md)
- [ADR-020 — Mekong-owned IEC 61131-3-aligned Program Runtime](adr/ADR-020-mekong-owned-iec-aligned-program-runtime.md)
- Hồ sơ Program Runtime/IEC 61131-3 và audit dùng cây source trước tái cấu trúc đã
  được loại khỏi cây Markdown ngày 2026-08-14. Khi cần truy nguyên, phục hồi từ
  commit `b69fdf152fd1b424bb4ab2239b5cf97b0e86b554`; chúng **không phải nguồn chuẩn**.

Luồng đọc khuyến nghị cho Programming: Product baseline → Product Spec
Programming → Requirements → Open Decisions → Design Index → Documentation
Roadmap → hồ sơ thiết kế theo vai trò → Verification → Risk → Traceability →
Implementation Plan. Baseline 2026-08-09 có đủ 22/22 file và 22/22 đạt `M3 —
Review Ready`: checklist theo loại đã đủ, mọi `TBD/BLOCKED` có owner/ảnh hưởng/
gate/điều kiện mở, link nội bộ sạch — bằng chứng tại
[`PROG-REV-2026-08-09`](07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md).
Maturity đo được vẫn 22/22 M3, 0/22 M4/M5 vì không giả chữ ký/evidence; vòng
review kỹ thuật đã đóng `9/9` finding, 8 chữ ký được `WAIVED FOR IMPLEMENTATION`;
Open Decisions hiện `17 DECIDED / 0 OPEN / 0 CLOSED`. `PLAN_READY` và mọi
`IMPLEMENT_READY[*]` đã `PASS`; evidence vẫn `0/32` và được tạo trong task. Với
chủ đề khác, luồng đọc là Product → Requirements → System → baseline Design →
Detailed design → Verification. Tài liệu `In Review` phải được đối chiếu
baseline/code trước khi dùng cho release.

Hồ sơ lịch sử không phải nguồn chuẩn. Snapshot trước tái cấu trúc nằm tại
`archives/markdown-before-restructure-2026-07-22.tar.gz`; các bản Markdown bị
loại trong đợt dọn 2026-08-14 phục hồi được từ commit
`b69fdf152fd1b424bb4ab2239b5cf97b0e86b554`.

Artifact hỗ trợ không phải Markdown được giữ tại
[`contracts/openapi/openapi.yaml`](../contracts/openapi/openapi.yaml),
`07_records/evidence/` và `07_records/security/`; chúng không tự tạo thành bằng
chứng release nếu chưa được review theo Verification.
