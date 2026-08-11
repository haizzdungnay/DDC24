# docs/adr/ — Architectural Decision Records

> **Recovery status (2026-07-22): Historical/In Review.** Các ADR rời được giữ để bảo toàn context. [Decision Log](../00_governance/DECISIONS.md) là register hiện hành và đã chuẩn hóa các ID trùng ADR-010/ADR-011.

> **Owner:** Tech Lead / Architect | **Last Updated:** 2026-08-11

ADR lưu lại các quyết định kiến trúc quan trọng. Mỗi ADR có: Context, Decision, Consequences, Status.

## Index

| ADR | Tiêu đề | Status |
|-----|---------|--------|
| [ADR-001](ADR-001-adc-avdd-noise-measurement-contract.md) | ADC AVDD Noise Measurement Contract | Accepted |
| [ADR-002](ADR-002-clock-harmonics-gnd-boundary-contract.md) | Clock Harmonics GND Boundary Contract | Accepted |
| [ADR-003](ADR-003-emc-pre-compliance-measurement-boundary-readiness-contract.md) | EMC Pre-compliance Boundary Contract | Accepted |
| [ADR-004](ADR-004-component-based-runtime.md) | Component-based Runtime (legacy importer role kể từ ADR-020) | Superseded by ADR-020 |
| [ADR-005](ADR-005-three-process-architecture.md) | Three-process Architecture (iobus/core/web) | Accepted |
| [ADR-006](ADR-006-rev-a-ui-form-json.md) | Rev A UI: Form/JSON (không Web IDE) | Accepted |
| [ADR-007](ADR-007-web-stack-go.md) | Web Stack: Go (không Python) | Accepted |
| [ADR-008](ADR-008-bms-edge-positioning-and-revA-component-set.md) | BMS Edge Positioning + Rev A Component Set | Accepted |
| [ADR-009](ADR-009-isa101-hmi-and-nav-restructure.md) | ISA-101 HMI & Nav Restructure | Accepted |
| [ADR-010](ADR-010-iop-v2-poll-capability-map.md) | IOP v2.0: Poll + Capability Map | Accepted |
| [ADR-011](ADR-011-bacnet-reliability-quality-mapping.md) | BACnet Reliability/Quality Mapping | Accepted |
| [ADR-012](ADR-012-ao-channel-config-model.md) | AO Channel Config Model | Accepted |
| [ADR-015](../00_governance/DECISIONS.md) | Privileged System Config Apply | Accepted — chỉ có trong Decision Log, không có file ADR rời |
| [ADR-016](../00_governance/DECISIONS.md) | Time Authority Model | Accepted — chỉ có trong Decision Log, không có file ADR rời |
| [ADR-017](ADR-017-settings-network-tabs-and-state-contract.md) | Settings/Network Tabs and State Contract | Accepted |
| [ADR-018](ADR-018-sqlite-block-historian.md) | SQLite block historian, scheduled per-point policy, unified Trends | Accepted |
| [ADR-019](../00_governance/DECISIONS.md) | Independent global point tag/name namespaces + static references | Accepted — registered in Decision Log |
| [ADR-020](ADR-020-mekong-owned-iec-aligned-program-runtime.md) | Mekong-owned IEC 61131-3-aligned Program Runtime (ST+FBD, Rev A.0) | Accepted — supersedes ADR-004 |
| [ADR-021](ADR-021-restructure-core-and-backend-by-domain.md) | Restructure `services/core` + `web/backend` theo domain | Phase A Accepted & DONE — Phase B Proposed |
| [ADR-022](ADR-022-ci-cd-tu-dong-deploy-xuong-board.md) | CI/CD tự động deploy xuống board | Accepted |
| [ADR-023](ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md) | Scheduler v3.1: priority, transport và phạm vi | Accepted |
| [ADR-026](ADR-026-programming-runtime-profile-va-validator-duy-nhat.md) | Programming runtime profile và validator duy nhất | Accepted 2026-08-11 |
| [ADR-027](ADR-027-programming-bootstrap-va-quyen-so-huu-chu-ky-scan.md) | Bootstrap và quyền sở hữu chu kỳ scan | Accepted 2026-08-11 |
| [ADR-028](ADR-028-programming-cong-thuc-watchdog-theo-base-step.md) | Công thức watchdog theo base step | Accepted 2026-08-11 |
| [ADR-029](ADR-029-programming-overrun-la-task-fault.md) | Overrun là Task fault | Accepted 2026-08-11 |
| [ADR-030](ADR-030-programming-ma-loi-cong-khai-va-detail-code.md) | Mã lỗi công khai và detail code | Accepted 2026-08-11 |
| [ADR-031](ADR-031-programming-integrity-mode-hash-only-rev-a.md) | Integrity mode HASH_ONLY Rev A | Accepted 2026-08-11 |

**Lưu ý:** ADR-001/002/003/005 thiếu section `Consequences` — cần bổ sung. Khi register này và
[Decision Log](../00_governance/DECISIONS.md) khác nhau, Decision Log là register điều hành.
