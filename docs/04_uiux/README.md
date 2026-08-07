# docs/04_uiux/ — UI/UX Design

> **Recovery status (2026-07-22): In Review.** Nội dung UI/UX được phục hồi đầy đủ; các scope statement cũ phải đối chiếu với Product Baseline và Decision Log.

> **Owner:** UX Lead | **Last Updated:** 2026-07-22

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
| [KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001](KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001_VI.md) | **DRAFT — chờ review 2026-08-07.** Phương án UI/UX/UC cho Scheduler Engine v3.1 (bỏ mô hình thanh ghi `TSx`): 20 khoảng cách spec↔mã nguồn, 6 quyết định cần chốt, 26 use case, kiến trúc thông tin 4 route + tab, wireframe 7 màn hình |

> **Ghi chú 2026-07-31:** hai tài liệu Web ở trên được lập để đóng finding G-01/G-02
> (trước đó kho chỉ có use case và wireframe cho HMI, **không có gì cho Web**, trong
> khi `settings/network` là trang cấu hình rủi ro nhất của sản phẩm).

**Quyết định:** ADR-016 trong [Decision Log](../00_governance/DECISIONS.md) · [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) · [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)
