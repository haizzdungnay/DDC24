# Training Evidence: IEC 62443-4-1 Training Materials

> **Document ID:** IEC62443-M1-TRAIN-002
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Initial training materials
> **Owner:** DeveloperTeam

---

# IEC 62443-4-1 Overview — SDLC Security Process

## What is IEC 62443-4-1?

IEC 62443-4-1 là tiêu chuẩn quốc tế về **Secure Product Development Lifecycle (SDLC)** cho Industrial Automation and Control Systems (IACS).

- **4-1** = Process requirements (cách làm)
- **4-2** = Technical requirements (làm gì — ngoài scope v1.0)

Mục tiêu: đảm bảo sản phẩm được phát triển với bảo mật tích hợp từ đầu, không phải "thêm vào" sau.

## 13 Security Maturity Practices (SM)

| SM | Practice | Ý chính | Cần cho ai |
|:--:|----------|---------|-----------|
| 1 | Security Requirements | Xác định yêu cầu bảo mật từ đầu | Tech Lead, Solution Architect |
| 2 | Threat Modeling | Phân tích threat trước khi implement | Tech Lead, Solution Architect |
| 3 | Secure Design | Thiết kế có review bảo mật | Solution Architect, Developer |
| 4 | Secure Implementation | Code an toàn, static analysis | Developer |
| 5 | Security Testing | Test bảo mật có kế hoạch | QA, Developer |
| 6 | Vulnerability Management | Quản lý CVE có quy trình | DevOps, Tech Lead |
| 7 | Patch Management | Patch an toàn, có rollback | DevOps, Release |
| 8 | Security Guidelines | Hướng dẫn cho integrator/operator | Docs, Tech Lead |
| 9 | Supplier Management | Đánh giá bảo mật nhà cung cấp | Procurement, Tech Lead |
| 10 | Security Review | Review bảo mật theo gate | QA, Tech Lead |
| 11 | Secure Decommissioning | Xóa dữ liệu an toàn khi thu hồi | QA, Tech Lead |
| 12 | Security Training | Đào tạo bảo mật theo role | PMO, Tech Lead |
| 13 | Configuration Management | Baseline cấu hình bảo mật | Release, QA |

## Project Context: MK-DDC-24

- Product: Programmable DDC Controller cho HVAC
- Standards: IEC 62443-4-1 (process), BACnet BTL, EMC, RoHS
- Timeline: Month 1 — Setup & evidence collection

## Key Month 1 Deliverables

1. **Gap Analysis** — Đánh giá SDLC hiện tại theo 13 SM
2. **Process Templates** — Tạo 10 security process templates
3. **Security Requirements Baseline** — Tổng hợp yêu cầu từ PRD/SRS
4. **Threat Model Initial** — Scoping + initial threat matrix
5. **Training** — Brief team về IEC 62443-4-1

## Key References

| Document | Location |
|----------|----------|
| IEC 62443-4-1:2018 Standard | (external) |
| Project Gap Analysis | `docs/00_management/KX-DDC24-SEC-GAP-001_VI.md` |
| Security Templates | `docs/00_management/security_process_templates/` |
| PRD Security Requirements | `PRD_MK-DDC-24_VI.md` FR-030..035 |
| SRS Security Requirements | `SRS_MK-DDC-24_VI.md` SEC-002..025 |
| Project Goals (OBJ-11) | `docs/00_management/KX-DDC24-PM-GOAL-001_VI.md` |
| Internal Audit Requirement | `docs/00_management/KX-DDC24-PM-MARKET-001_VI.md` §6.2 |

---

*Tài liệu training nội bộ cho Month 1 IEC 62443-4-1 briefing.*
