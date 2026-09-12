# docs/04_uiux/ — UI/UX Design

> **Recovery status (2026-07-22): In Review.** Nội dung UI/UX được phục hồi đầy đủ; các scope statement cũ phải đối chiếu với Product Baseline và Decision Log.

> **Owner:** UX Lead | **Last Updated:** 2026-09-08

Tài liệu thiết kế giao diện người dùng theo ISA-101 HMI standard (ADR-009).

## Tài liệu

| File | Mô tả |
|------|-------|
| [KX-DDC24-UC-HMI-001](KX-DDC24-UC-HMI-001_VI.md) | Five-surface limited-operator HMI use cases |
| [KX-DDC24-UX-HMI-001](KX-DDC24-UX-HMI-001_VI.md) | UX design HMI local 320×240 |
| [KX-DDC24-UX-SYSTEM-001](KX-DDC24-UX-SYSTEM-001_VI.md) | UX system-wide (form/JSON config) |
| [KX-DDC24-UC-WEB-NETWORK-001](KX-DDC24-UC-WEB-NETWORK-001_VI.md) | Use case Web — Cài đặt → Mạng (10 UC + ma trận truy vết) |
| [KX-DDC24-UX-WEB-NETWORK-001](KX-DDC24-UX-WEB-NETWORK-001_VI.md) | UI/UX spec + wireframe Web — Cài đặt → Mạng |
| [MODBUS_RTU_UI_UX_DESIGN](MODBUS_RTU_UI_UX_DESIGN.md) | UI/UX spec + wireframe Web — Modbus RTU (Overview, Devices, Points, Mapping, Diagnostics); **In Review 2026-08-04** |
| [UX_REDESIGN_INPUT_BRIEF_2026-08-08](UX_REDESIGN_INPUT_BRIEF_2026-08-08.md) | Hồ sơ đầu vào cho thiết kế lại UX toàn hệ thống — role/I/O/protocol/alarm/action as-built đọc trực tiếp source |
| [UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14](UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md) | Thiết kế lại `/eng/inputs`: Header cố định + 6 tab thay 3 mode Summary/Wizard/Advanced; tách Electrical Mode/Sensor Profile; **Approved + Phase 1 Implemented** 2026-08-14, plan implement ở [Plan 55](../03_implementation/55_UI_UNIVERSAL_INPUT_REDESIGN_PLAN.md) |
| [PROGRAMMING_UI_UX_DESIGN](PROGRAMMING_UI_UX_DESIGN.md) | `UX-WEB-PROG-001` v2.6 — companion có kiểm soát cho requirement, safety, contract, state, RBAC và acceptance Programming; không ghi đè composition trực quan của gói handoff |
| [KX-DDC24 Programming FE Handoff](KX_DDC24_Programming_FE_Handoff_v2_1/README_FE_HANDOFF.md) | Authority trực quan PGM-01..06 theo `AUTH-UX-PROG-2026-09-08-01`; dùng đúng PNG/HTML trong `assets`, không dùng bộ SVG Programming đã loại; asset không phải bằng chứng As-Built/runtime |
| [KX-DDC24-UC-WEB-SCHEDULER-001](KX-DDC24-UC-WEB-SCHEDULER-001_VI.md) | Use case Web — Lịch vận hành (26 UC + ma trận truy vết 20 acceptance) |
| [KX-DDC24-UX-WEB-SCHEDULER-001](KX-DDC24-UX-WEB-SCHEDULER-001_VI.md) | UI/UX spec + wireframe Web — Lịch vận hành (4 route + 6 tab, 7 màn hình) |
| [KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001](KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001_VI.md) | **Superseded 2026-08-07** bởi hai tài liệu trên sau khi PM/CTO duyệt ADR-023. Giữ làm hồ sơ phân tích 20 khoảng cách. |

> **Ghi chú 2026-07-31:** hai tài liệu Web ở trên được lập để đóng finding G-01/G-02
> (trước đó kho chỉ có use case và wireframe cho HMI, **không có gì cho Web**, trong
> khi `settings/network` là trang cấu hình rủi ro nhất của sản phẩm).

**Quyết định:** ADR-016 trong [Decision Log](../00_governance/DECISIONS.md) · [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) · [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)
