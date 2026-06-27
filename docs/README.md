# MK-DDC-24 — Trung tâm Tài liệu Dự án (Document Hub)
## ISO-aligned Documentation Index

> **Phiên bản:** 1.0 | 2026-05-30
> **Chuẩn áp dụng:** ISO/IEC/IEEE 12207:2017 (vòng đời phần mềm), ISO/IEC/IEEE 15288 (hệ thống), ISO/IEC/IEEE 29148 (yêu cầu), ISO/IEC/IEEE 1016 (thiết kế), ISO/IEC 25010 (chất lượng), ISO 9001:2015 §7.5 (kiểm soát tài liệu), IEC 62443-4-1 (bảo mật), ASHRAE 135 (BACnet). *(IEC 61131-3 = tầm nhìn Rev C, Rev A KHÔNG dùng — xem ADR-004.)*
> **Đối tượng:** PM, Tech Lead, FW/BE/FE Dev, UI/UX, QA, kỹ sư tích hợp. **Người mới đọc mục [§2 Bắt đầu](#2-người-mới-bắt-đầu-từ-đây).**

---

## 1. Bản đồ tài liệu theo vòng đời (V-Model / ISO 12207)

```
        YÊU CẦU ──────────────────────────────────► KIỂM THỬ
   (01_requirements)                              (06_verification)
          │                                              ▲
          ▼                                              │
     KIẾN TRÚC ───────────────────────────────► TÍCH HỢP & V&V
   (02_architecture)                                     ▲
          │                                              │
          ▼                                              │
   THIẾT KẾ CHI TIẾT ──────────────► HIỆN THỰC (CODE) ───┘
   (03_design + 04_uiux)            (05_devguides)
          ▲
          │
   QUẢN LÝ & KIỂM SOÁT (00_management) ── xuyên suốt
```

## 2. Người mới — Bắt đầu từ đây
> 🌟 **Chưa hiểu sản phẩm? Đọc cuốn số 1 trước — nó giải thích TOÀN BỘ hệ thống từ số 0, kể như kể chuyện, có hình vẽ, không cần biết code.**
1. ⭐ [**System Handbook — Hiểu hệ thống từ số 0**](00_management/KX-DDC24-SYS-ARCH-001_VI.md) — cái hộp là gì, "2 bộ não", dữ liệu chạy thế nào, từng khối vì sao cần. **Đọc cái này đầu tiên.**
2. [PROJECT_OVERVIEW](00_management/KX-DDC24-PM-OVERVIEW-001_VI.md) — tóm tắt nhanh 1 trang.
3. [GETTING_STARTED_DEV](02_design/GETTING_STARTED_DEV.md) — cài môi trường, build, "muốn sửa X vào đâu".
4. [IMPLEMENTATION_PLAN](00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md) — **lộ trình code: phase → task → microtask → checklist**.
5. ⭐ **Developer Kit** (gõ code từ đây): [Repo & Build](05_devguides/KX-DDC24-PM-REPO-001_VI.md) · [FW Dev Guide](05_devguides/KX-DDC24-FW-DEVGUIDE-001_VI.md) · [BE Dev Guide](05_devguides/KX-DDC24-BE-DEVGUIDE-001_VI.md) · [FE Dev Guide](05_devguides/KX-DDC24-FE-DEVGUIDE-001_VI.md) · hợp đồng code [`shared/`](../shared/).
6. [DOC_CONTROL_AND_NAMING](00_management/KX-DDC24-QA-DOCCTRL-001_VI.md) — quy tắc đặt tên/sắp xếp/version.

## 3. Cây thư mục chuẩn (ISO-aligned)

| Thư mục | Giai đoạn vòng đời | Nội dung | Vị trí thực tế |
|---------|--------------------|----------|----------------|
| `00_management` | Quản lý (xuyên suốt) | Plan, doc-control, register, changelog, traceability | `docs/00_management/` |
| `01_requirements` | Yêu cầu | PRD, SRS, FW/SW requirements | `../` + `../spec/` |
| `02_architecture` | Kiến trúc | SW/FW arch, IOP interface | `../spec/` |
| `03_design` | Thiết kế chi tiết | DDD, ICD, module/service design, coding std | `../design/` |
| `04_uiux` | Thiết kế giao diện | Design system, Web IDE (FE), HMI | `docs/04_uiux/` |
| `05_devguides` | Hiện thực | Coding standards, build/CI | `../design/*CODING*` |
| `06_verification` | Kiểm thử | Test spec, traceability | `../spec/TEST_SPEC…` |
| `07_hardware` | Phần cứng | Schematic, BOM, EMC | `../hardware-design/` |

> Ghi chú: theo nguyên tắc **không phá vỡ tham chiếu đang có** (repo chưa dùng git), tài liệu yêu cầu/kiến trúc/thiết kế **giữ nguyên vị trí** ở `spec/` và `design/`; `docs/` bổ sung **lớp quản lý + UI/UX + register** và là **cổng điều hướng ISO**. Quy tắc đặt tên mới áp dụng cho tài liệu mới (xem DOC_CONTROL).

## 4. Danh mục tài liệu chính

### 00_management
| ID | Tài liệu |
|----|----------|
| KX-DDC24-PM-OVERVIEW-001 | [Project Overview](00_management/KX-DDC24-PM-OVERVIEW-001_VI.md) |
| KX-DDC24-PM-IMPLPLAN-001 | [Implementation Plan (phase/task/microtask)](00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md) |
| KX-DDC24-QA-DOCCTRL-001 | [Document Control & Naming Standard](00_management/KX-DDC24-QA-DOCCTRL-001_VI.md) |
| KX-DDC24-QA-REGISTER-001 | [Master Document Register](00_management/KX-DDC24-QA-REGISTER-001_VI.md) |
| KX-DDC24-QA-TRACE-001 | [Traceability Matrix](00_management/KX-DDC24-QA-TRACE-001_VI.md) |

### 04_uiux
| ID | Tài liệu |
|----|----------|
| KX-DDC24-UX-SYSTEM-001 | [Design System (tokens, components)](04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) |
| KX-DDC24-UX-WEBIDE-001 | *(đã gỡ 2026-06-08)* — UX web Rev A form/JSON: [ADR-006](adr/ADR-006-rev-a-ui-form-json.md) |
| KX-DDC24-UX-HMI-001 | [HMI TFT UI](04_uiux/KX-DDC24-UX-HMI-001_VI.md) |

### 05_devguides — Developer Kit (gõ code từ đây)
| ID | Tài liệu |
|----|----------|
| KX-DDC24-PM-REPO-001 | [Repository, Build & CI](05_devguides/KX-DDC24-PM-REPO-001_VI.md) |
| KX-DDC24-FW-DEVGUIDE-001 | [FW Developer Guide & Backlog](05_devguides/KX-DDC24-FW-DEVGUIDE-001_VI.md) |
| KX-DDC24-BE-DEVGUIDE-001 | [BE Developer Guide & Backlog](05_devguides/KX-DDC24-BE-DEVGUIDE-001_VI.md) |
| KX-DDC24-FE-DEVGUIDE-001 | [FE Developer Guide & Backlog](05_devguides/KX-DDC24-FE-DEVGUIDE-001_VI.md) |
| (code) | Hợp đồng dùng chung: [`shared/iop_protocol.h`](../shared/iop_protocol.h), [`shared/kinexus_shm.h`](../shared/kinexus_shm.h) |

### Yêu cầu / Kiến trúc / Thiết kế (giữ vị trí cũ)
→ Xem [Master Document Register](00_management/KX-DDC24-QA-REGISTER-001_VI.md) để có danh sách đầy đủ + Document ID + version + owner.
→ Cổng kỹ thuật: [README](01_specs/README.md) · [README](02_design/README.md).

## 5. Thay đổi & lịch sử
→ [CHANGELOG.md](../CHANGELOG.md) (toàn dự án). Mỗi tài liệu có bảng Revision History riêng ở cuối.

---
**Maintainer:** PMO / QA · **Rev** 1.0 | 2026-05-30
