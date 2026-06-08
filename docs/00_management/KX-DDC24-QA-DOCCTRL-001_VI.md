# Document Control & Naming Standard — MK-DDC-24
## Chuẩn Kiểm soát & Đặt tên Tài liệu

> **Document ID:** KX-DDC24-QA-DOCCTRL-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved
> **Chuẩn:** ISO 9001:2015 §7.5 (Documented Information), ISO/IEC/IEEE 12207:2017, ISO/IEC/IEEE 15289 (nội dung tài liệu)
> **Bắt buộc:** mọi tài liệu mới trong dự án PHẢI tuân theo chuẩn này.

---

## 1. Mục đích
Đảm bảo mọi tài liệu **đặt tên nhất quán, có ID duy nhất, có version, có trạng thái, truy vết được, dễ tìm** — để dev/QA/PM đọc là biết đây là gì, phiên bản nào, đã duyệt chưa.

## 2. Document ID — quy tắc đặt mã
```
KX-DDC24-<DISC>-<TYPE>-<NNN>
 │    │      │      │     └── số thứ tự 3 chữ số (001, 002…)
 │    │      │      └──────── loại tài liệu (TYPE)
 │    │      └─────────────── lĩnh vực (DISCIPLINE)
 │    └────────────────────── mã sản phẩm (DDC24)
 └─────────────────────────── tổ chức (Kinexus)
```

### 2.1 DISCIPLINE (lĩnh vực)
| Mã | Nghĩa |
|----|-------|
| PM | Project Management (kế hoạch, lịch) |
| QA | Quality Assurance (doc control, register, traceability) |
| SYS | System (yêu cầu/kiến trúc cấp hệ thống) |
| REQ | Requirements |
| ARC | Architecture |
| DSN | Design (thiết kế chi tiết) |
| FW | Firmware (MCU) |
| SW | Software (chung SOM) |
| BE | Backend (service SOM) |
| FE | Frontend (Web IDE) |
| UX | UI/UX design |
| IF | Interface (ICD) |
| TST | Test / Verification |
| SEC | Security |
| HW | Hardware |
| OPS | Operations / Deployment / OTA |

### 2.2 TYPE (loại tài liệu — ISO 15289)
| Mã | Nghĩa |
|----|-------|
| PLAN | Kế hoạch (plan) |
| STD | Standard / Guideline (chuẩn, quy tắc) |
| SPEC | Specification (đặc tả yêu cầu) |
| ARCH | Architecture Description |
| DDD | Detailed Design Description (IEEE 1016) |
| ICD | Interface Control Document |
| REG | Register / Index |
| MAT | Matrix (vd traceability) |
| RPT | Report |
| LOG | Log / Record (vd changelog, issue log) |
| OVERVIEW | Tổng quan |

### 2.3 Ví dụ
- `KX-DDC24-PM-IMPLPLAN-001` — Implementation Plan.
- `KX-DDC24-FW-DDD-001` — Firmware Detailed Design.
- `KX-DDC24-IF-ICD-002` — Modbus ICD.
- `KX-DDC24-UX-WEBIDE-001` — *(đã gỡ 2026-06-08; UX web Rev A form/JSON → ADR-006)*.

## 3. Tên file
```
<Document-ID>_<LANG>.md         vd: KX-DDC24-PM-IMPLPLAN-001_VI.md
```
- `LANG`: `VI` (tiếng Việt) | `EN`. Bản song ngữ tách 2 file cùng ID.
- Chỉ ASCII, dùng `-` và `_`, không khoảng trắng/dấu tiếng Việt trong tên file.

> **Tài liệu hiện hữu (legacy):** các file dạng `<NAME>_MK-DDC-24_VI.md` ở `spec/`, `design/`, `hardware-design/` **giữ nguyên tên** để không gãy link; chúng được cấp Document ID trong [Master Register](KX-DDC24-QA-REGISTER-001_VI.md). Tài liệu **mới** dùng chuẩn ID ở §2.

## 4. Cấu trúc thư mục chuẩn (ISO 12207 lifecycle)
```
DDC-PROJECT/
├── README.md            (giới thiệu sản phẩm)
├── CHANGELOG.md         (lịch sử toàn dự án)
├── docs/                (Document Hub — cổng ISO)
│   ├── 00_management/   PM, QA, plan, register, traceability
│   ├── 04_uiux/         thiết kế giao diện
│   └── README.md        master index
├── spec/                01_requirements + 02_architecture (yêu cầu, kiến trúc, IOP)
├── design/              03_design + 05_implementation (DDD, ICD, coding std)
└── hardware-design/     07_hardware
```

## 5. Vòng đời trạng thái tài liệu (Status lifecycle)
```
Draft ──► In-Review ──► Approved ──► (Superseded / Obsolete)
```
| Trạng thái | Nghĩa |
|-----------|-------|
| Draft | đang soạn, có thể đổi nhiều |
| In-Review | đang review (gán reviewer) |
| Approved | đã duyệt, là baseline — đổi phải qua change request + bump version |
| Superseded | bị thay bởi version mới hơn |
| Obsolete | không dùng nữa |

## 6. Đánh version (Semantic-ish)
```
MAJOR.MINOR    (vd 1.0, 1.1, 2.0)
```
- **MAJOR**: thay đổi lớn, phá vỡ tương thích / thay đổi baseline đã approved.
- **MINOR**: bổ sung/sửa nhỏ không phá vỡ.
- Tài liệu Draft đầu tiên = `0.1`; khi Approved lần đầu = `1.0`.

## 7. Header bắt buộc (mọi tài liệu)
```markdown
# <Tiêu đề> — MK-DDC-24
> **Document ID:** KX-DDC24-XX-YYY-NNN
> **Phiên bản:** X.Y | YYYY-MM-DD
> **Trạng thái:** Draft | In-Review | Approved
> **Owner:** <team/người>
> **Chuẩn liên quan:** <ISO/IEC…>
> 📘 [docs/README](../README.md)
```

## 8. Footer bắt buộc — Revision History
```markdown
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | … | Phát hành đầu |
```

## 9. Quy tắc thay đổi (Change Control)
1. Tài liệu **Approved** chỉ sửa qua **Change Request** (ghi ở [OPEN_ISSUES](../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md) hoặc issue tracker).
2. Mỗi thay đổi → cập nhật **Revision History** của tài liệu + **[CHANGELOG.md](../../CHANGELOG.md)** toàn dự án.
3. Thay đổi **interface (ICD)** hoặc **baseline** cần qua **Design Review gate** + ký Lead.
4. Cập nhật **[Master Register](KX-DDC24-QA-REGISTER-001_VI.md)** khi thêm/đổi trạng thái tài liệu.

## 10. Vai trò & phê duyệt
| Loại tài liệu | Người duyệt |
|---------------|-------------|
| Requirement/SPEC | System Architect + PO |
| Architecture/DDD | Tech Lead (FW/SW) |
| ICD (interface) | cả FW Lead + SW Lead |
| UI/UX | UX Lead + PO |
| Plan/QA | PM + QA Lead |

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | PMO/QA | Phát hành đầu — thiết lập doc-control, ID scheme, lifecycle |
