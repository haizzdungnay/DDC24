# docs/adr/ — Architectural Decision Records

> **Recovery status (2026-07-22): Historical/In Review.** Các ADR rời được giữ để bảo toàn context. [Decision Log](../00_governance/DECISIONS.md) là register hiện hành và đã chuẩn hóa các ID trùng ADR-010/ADR-011.

> **Owner:** Tech Lead / Architect | **Last Updated:** 2026-06-27

ADR lưu lại các quyết định kiến trúc quan trọng. Mỗi ADR có: Context, Decision, Consequences, Status.

## Index

| ADR | Tiêu đề | Status |
|-----|---------|--------|
| [ADR-001](ADR-001-adc-avdd-noise-measurement-contract.md) | ADC AVDD Noise Measurement Contract | Accepted |
| [ADR-002](ADR-002-clock-harmonics-gnd-boundary-contract.md) | Clock Harmonics GND Boundary Contract | Accepted |
| [ADR-003](ADR-003-emc-pre-compliance-measurement-boundary-readiness-contract.md) | EMC Pre-compliance Boundary Contract | Accepted |
| [ADR-004](ADR-004-component-based-runtime.md) | Component-based Runtime (legacy importer role kể từ ADR-018) | Superseded by ADR-018 |
| [ADR-005](ADR-005-three-process-architecture.md) | Three-process Architecture (iobus/core/web) | Accepted |
| [ADR-006](ADR-006-rev-a-ui-form-json.md) | Rev A UI: Form/JSON (không Web IDE) | Accepted |
| [ADR-007](ADR-007-web-stack-go.md) | Web Stack: Go (không Python) | Accepted |
| [ADR-008](ADR-008-bms-edge-positioning-and-revA-component-set.md) | BMS Edge Positioning + Rev A Component Set | Accepted |
| [ADR-009](ADR-009-isa101-hmi-and-nav-restructure.md) | ISA-101 HMI & Nav Restructure | Accepted |
| [ADR-010](ADR-010-iop-v2-poll-capability-map.md) | IOP v2.0: Poll + Capability Map | Accepted |
| [ADR-018](ADR-018-mekong-owned-iec-aligned-program-runtime.md) | Mekong-owned IEC 61131-3-aligned Program Runtime (ST+FBD, Rev A.0) | Accepted — supersedes ADR-004 |

**Lưu ý:** ADR-001/002/003/005 thiếu section `Consequences` — cần bổ sung. ADR-011..017 chỉ
tồn tại hợp nhất trong [Decision Log](../00_governance/DECISIONS.md), chưa có file riêng
trong thư mục này — bảng trên chưa liệt kê, đây là gap có từ trước, ngoài phạm vi ADR-018.
