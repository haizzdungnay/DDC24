# Chỉ mục hồ sơ ứng dụng AHU hiệu suất cao MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DES-INDEX-AHUHP-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY; 15/15 hồ sơ candidate, 0 M4, 0 M5** |
| Ngày | 2026-08-13 |
| Chủ quản | System Engineering + Document Control |
| Người review | Consumer leads theo từng hồ sơ |
| Người phê duyệt | CTO + Product Owner + System Architect |
| Nguồn | `DOC-GOV-001`; `PROD-AHUHP-001` |

## 0. Đọc nhanh

Bộ này là candidate để CTO review và mở plan triển khai sau. `M3` chỉ nói hồ sơ
đủ nội dung để review; không nói đã được người thật review, phê duyệt, implement,
test hay release. Mọi Test Result hiện `MISSING`; `PLAN_READY`,
`IMPLEMENT_READY` và `RELEASE_READY` đều `BLOCKED`.

## 1. Document register

| # | Lớp | ID | Hồ sơ | Trạng thái | Chủ quản |
|---:|---|---|---|---|---|
| 1 | Product | `PROD-AHUHP-001` | [Product Spec](../01_product/AHU_HIGH_PERFORMANCE_PRODUCT_SPEC.md) | M3/Proposed | Product |
| 2 | Requirements | `SRS-AHUHP-001` | [Requirements Spec](../02_requirements/AHU_HIGH_PERFORMANCE_REQUIREMENTS_SPEC.md) | M3/Proposed | System |
| 3 | Governance | `OD-AHUHP-001` | [Open Decisions](../00_governance/AHU_HIGH_PERFORMANCE_OPEN_DECISIONS.md) | M3; 13 OPEN | System Architect |
| 4 | Architecture | `ARCH-AHUHP-001` | [Architecture](../03_architecture/AHU_HIGH_PERFORMANCE_ARCHITECTURE.md) | M3/Proposed | System Architect |
| 5 | Detailed Design | `DDD-SW-AHUHP-CTRL-001` | [Control App Design](software/AHU_HIGH_PERFORMANCE_CONTROL_APP_DESIGN.md) | M3 | Controls Lead |
| 6 | Detailed Design | `DDD-SW-AHUHP-PLANT-001` | [AHU Plant Simulator Design](software/AHU_PLANT_SIMULATOR_DESIGN.md) | M3 | Simulator Lead |
| 7 | Detailed Design | `DDD-FW-AHUHP-FMCU-001` | [Fake MCU Design](firmware/AHU_FAKE_MCU_DESIGN.md) | M3 | FW-SOM/FW-MCU Lead |
| 8 | Detailed Design | `DDD-IF-AHUHP-SIM-001` | [Simulation Interface Spec](interfaces/AHU_SIMULATION_INTERFACE_SPEC.md) | M3 | System/Contract Lead |
| 9 | Detailed Design | `DDD-UX-AHUHP-001` | [UI/UX Design](../04_uiux/AHU_HIGH_PERFORMANCE_UI_UX_DESIGN.md) | M3 | UX/FE Lead |
| 10 | Verification | `VVP-AHUHP-001` | [Verification Plan](../05_verification/AHU_HIGH_PERFORMANCE_VERIFICATION_PLAN.md) | M3/Planned | QA/HIL |
| 11 | Operations | `OPS-AHUHP-001` | [Simulation Operations Runbook](../06_operations/AHU_SIMULATION_OPERATIONS_RUNBOOK.md) | M3/Planned | Platform/Ops |
| 12 | Risk | `RSK-AHUHP-001` | [Risk Register](../07_records/AHU_HIGH_PERFORMANCE_RISK_REGISTER.md) | M3; residual unaccepted | System/QA |
| 13 | Traceability | `TRACE-AHUHP-001` | [Traceability Matrix](../07_records/AHU_HIGH_PERFORMANCE_TRACEABILITY_MATRIX.md) | M3; 0 Test Result | System/QA |
| 14 | Delivery | `PLAN-AHUHP-001` | [Plan 55](../03_implementation/55_AHU_HIGH_PERFORMANCE_IMPLEMENTATION_PLAN.md) | M3; chưa được phép triển khai | PM/Tech Lead |
| 15 | Register | `DES-INDEX-AHUHP-001` | File hiện tại | M3 | Document Control |

Record trình CTO, không nằm trong mẫu số 15:
[Gói CTO Review 2026-08-13](../07_records/reviews/AHU_HIGH_PERFORMANCE_CTO_REVIEW_PACKAGE_2026-08-13.md).

## 2. Luồng đọc cho reviewer

1. Product Spec → xác nhận capability, scope và KPI.
2. Requirements → kiểm 50 nghĩa vụ và acceptance.
3. Open Decisions → chọn `OD-AHUHP-001..013`.
4. Architecture → kiểm ownership/failure/deployment boundary.
5. Control → Plant → Fake MCU → Interface → UI/UX.
6. Verification → Risk → Traceability.
7. Plan 55 → dependency, task, gate, estimate và rollback.
8. Gói CTO Review → ghi quyết định; không sửa ngược record để giả đã ký.

## 3. Coverage và maturity

| Chỉ số | Giá trị candidate |
|---|---:|
| File coverage | 15/15 = 100% |
| M3 | 15/15 |
| M4 | 0/15 |
| M5 | 0/15 |
| Requirement có design allocation | 51/51 |
| Test Result đã chạy/ký | 0/24 |
| Open Decision | 13 |
| Renderable UI asset | 3 |

## 4. Gate

| Gate | Trạng thái | Blocker và điều kiện mở |
|---|---|---|
| `PLAN_READY` | BLOCKED | Owner consumer leads + CTO; đóng P0/P1, quyết định 13 OD và ghim revision/hash |
| `IMPLEMENT_READY[P1]` | BLOCKED | Owner System/CTO; cần `PLAN_READY` và machine-readable schema/contract của P1 được review |
| `IMPLEMENT_READY[P2..P5]` | BLOCKED | Owner theo Plan 55; mỗi pha chỉ mở khi entry gate trước đạt |
| `RELEASE_READY` | BLOCKED | Owner QA/Release/Product; cần target/HIL/site evidence và residual risk acceptance |

## 5. Quy tắc thay đổi

- Sửa nội dung UI phải sửa SVG cùng revision.
- Thay ID/contract/timing/point mapping phải đồng bộ Requirements, Interface,
  VVP, Risk, Trace và Plan.
- Sau khi CTO ký, tạo authority record có candidate hash; không đổi âm thầm
  candidate đã ký.
- Không ghi `PASS` cho Test Result trước khi có artifact evidence được review.

## 6. Lịch sử và phê duyệt

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo register 15 hồ sơ candidate AHUHP |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Document Control | Tự kiểm M3 | Harness/link/ID/checklist đạt; không thay review người thật |
| Consumer Leads | Chưa ký | Review hồ sơ mình tiêu thụ và đóng finding |
| CTO/Product/System | Chưa ký | Chấp thuận candidate revision/hash và gate |
