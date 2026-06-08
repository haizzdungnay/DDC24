# STRIDE Threat Modeling Report — MK-DDC-24
## SM-2: STRIDE Threat Modeling Report Template

> **Document ID:** KX-DDC24-SEC-RPT-001
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Draft
> **Owner:** Tech Lead + Solution Architect
> **Chuẩn liên quan:** IEC 62443-4-1 SM-2, STRIDE (Microsoft), ISO/IEC 27005
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa cấu trúc chuẩn cho **STRIDE Threat Modeling Report** của dự án MK-DDC-24. Báo cáo phân tích các thành phần hệ thống (device, cloud/OTA, Web IDE, BACnet/MQTT/REST) để xác định assets, data flows, trust boundaries, threat agents, và các biện pháp giảm thiểu. Tuân thủ IEC 62443-4-1 SM-2 — Threat Modeling.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | System Architecture | `spec/architecture/` |
| 2 | Interface Control Documents (ICD) | `design/interfaces/` |
| 3 | Data flow diagrams | Tạo mới trong quá trình threat model |
| 4 | Security Requirements Baseline | `KX-DDC24-SEC-SPEC-001` |
| 5 | Product/System context | `PRD_MK-DDC-24_VI.md`, `DS_MK-DDC-24_VI.md` |
| 6 | Known open issues | `spec/OPEN_ISSUES_MK-DDC-24_VI.md` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Threat Model Report (file này) | `.md` |
| 2 | Data flow diagrams (DFD) | Diagram (draw.io / PlantUML / hình ảnh) |
| 3 | Threat matrix (STRIDE per element) | Bảng trong report |
| 4 | Mitigation mapping | Bảng threat → mitigation → security requirement |
| 5 | Threat model review sign-off | Comment issue / signature |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **Tech Lead** | Chủ trì threat model session, soạn report |
| **Solution Architect** | Phê duyệt DFD, trust boundaries, mitigations |
| **Developer Team** | Cung cấp thông tin implementation |
| **QA** | Xác nhận mitigation đã được test |
| **CTO** | Phê duyệt threat model cho release gate |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Draft | Khi tạo mới / có thay đổi architecture major | Tech Lead | DFD đầy đủ, threat list có ít nhất 1 threat per STRIDE category |
| In-Review | Trước P5 (Security implementation) | Solution Architect + CTO | Mọi threat High/Critical có mitigation, exception được approve |
| Update | Architecture change, new interface, new attack surface | Tech Lead | Cập nhật DFD, threat list, Revision History |

## 6. Template structure

```markdown
## 6.1 System Context & Data Flow Diagrams
- Mô tả phạm vi: device, cloud/OTA, Web IDE, BACnet/MQTT/REST
- Diagram (đính kèm hình ảnh hoặc link PlantUML)
- Trust boundaries marked

## 6.2 Assets
| Asset | Loại | Confidentiality | Integrity | Availability |
|-------|------|:---------------:|:---------:|:------------:|
| <tên asset> | <data | key | firmware | config> | H/M/L | H/M/L | H/M/L |

## 6.3 Threat Matrix (STRIDE)
| # | Element | STRIDE category | Threat description | Risk (H/M/L) | Mitigation | SR mapping | Status |
|---|---------|-----------------|-------------------|:------------:|------------|------------|--------|
| T-001 | OTA update channel | Tampering | ... | H | Signed package, TLS | SR-001 | Mitigated |
| T-002 | Web IDE login | Spoofing | ... | H | JWT auth, rate limit | SR-003 | Mitigated |
| ... | ... | ... | ... | ... | ... | ... | ... |

## 6.4 Misuse Cases
| Use case | Misuse scenario | Mitigation |
|----------|----------------|------------|
| <người dùng hợp lệ làm việc X> | <kẻ tấn công lợi dụng Y> | <biện pháp> |
```

## 7. Exception process

1. Threat không được mitigation đầy đủ → ghi rõ residual risk và rationale.
2. Exception phải được Solution Architect + CTO phê duyệt.
3. Residual risk được theo dõi trong [OPEN_ISSUES](../../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md).

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-2 — STRIDE Threat Modeling Report |
