# Internal Security Audit Checklist — MK-DDC-24
## SM-10: Internal Security Audit Checklist Template

> **Document ID:** KX-DDC24-SEC-RPT-005
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Draft
> **Owner:** QA + Tech Lead
> **Chuẩn liên quan:** IEC 62443-4-1 SM-10 (Security Review), ISO 19011 (Audit Management), IEC 62443-4-1 §9 (Security Review Process)
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa checklist chuẩn cho **Internal Security Audit** theo từng gate (P0 — Requirements, P5 — Security implementation, P7 — Release) của dự án MK-DDC-24. Mỗi gate có evidence checklist riêng với approver tương ứng. Tuân thủ IEC 62443-4-1 SM-10 — Security Review.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | Security Requirements Baseline | `KX-DDC24-SEC-SPEC-001`, `SRS_MK-DDC-24_VI.md` SEC-xxx |
| 2 | Threat modeling report | `KX-DDC24-SEC-RPT-001` |
| 3 | Design documents (security, OTA, ICD) | `design/software/`, `design/interfaces/` |
| 4 | Implementation & test evidence | CI artifacts, test reports, trace matrix |
| 5 | Previous audit findings (nếu có) | `KX-DDC24-SEC-RPT-005` phiên bản trước |
| 6 | Open issues / known exceptions | `spec/OPEN_ISSUES_MK-DDC-24_VI.md` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Security audit report (file này) | `.md` |
| 2 | Checklist per gate (Pass/Fail/N/A) | Bảng trong report |
| 3 | Finding list với severity và owner | Bảng trong report |
| 4 | Remediation plan cho findings không pass | Issue / task |
| 5 | Audit sign-off | Comment issue / signature |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **QA** | Chủ trì audit session, soạn report, verify evidence, track remediation |
| **Tech Lead** | Cung cấp technical evidence, approve findings, assign remediation |
| **Developer Team** | Thực hiện remediation actions |
| **Solution Architect** | Phê duyệt security design evidence (P5) |
| **CTO** | Phê duyệt release gate (P7), approve exceptions |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| P0 — Requirements | Khi security requirements baseline hoàn tất | Tech Lead + QA | Mọi SEC requirement có trace tới design |
| P5 — Security implementation | Trước implementation phase | QA + Solution Architect | Threat model done, security design reviewed |
| P7 — Release | Trước release | QA + CTO | Checklist đầy đủ, exception được approve, pass gate |
| Quarterly | Mỗi quý | QA + Tech Lead | Process compliance, finding trend, improvement |

## 6. Audit checklist per gate

### 6.1 P0 — Requirements Gate

| # | Checklist item | Evidence | Pass/Fail/N/A | Note |
|---|---------------|----------|:-------------:|------|
| R-01 | Security requirements có owner và review date | Trace matrix | | |
| R-02 | Mọi SEC requirement được traced tới design | Trace matrix | | |
| R-03 | CVE SLA policy defined (Critical ≤7d, High ≤14d) | `SRS_MK-DDC-24_VI.md` | | |
| R-04 | Security requirements bao phủ: TLS, auth, firewall, audit, OTA | `SRS_MK-DDC-24_VI.md` | | |
| R-05 | Open issues SW-Q-004/SW-Q-005 có decision | `OPEN_ISSUES` | | |
| R-06 | Exception được approve bởi CTO | Issue / comment | | |

### 6.2 P5 — Security Implementation Gate

| # | Checklist item | Evidence | Pass/Fail/N/A | Note |
|---|---------------|----------|:-------------:|------|
| D-01 | Threat model done (STRIDE per element) | `SEC-RPT-001` | | |
| D-02 | Data flow diagrams có trust boundaries | `SEC-RPT-001` | | |
| D-03 | Security design review passed (key store, TLS, JWT, firewall) | Design review sign-off | | |
| D-04 | ICD review passed (BACnet, MQTT, REST) | ICD review sign-off | | |
| D-05 | Secure design checklist done (input validation, crypto, secret handling) | Design checklist | | |
| D-06 | Coding standard compliance (cấm hardcode secret, input validation) | Static analysis report | | |
| D-07 | Dependencies scanned (no CVE ≥ High open > SLA) | `security.yml` artifact | | |
| D-08 | Secrets scan pass (gitleaks) | `security.yml` artifact | | |

### 6.3 P7 — Release Gate

| # | Checklist item | Evidence | Pass/Fail/N/A | Note |
|---|---------------|----------|:-------------:|------|
| L-01 | Security tests pass (TLS, auth, OTA, fuzz, negative tests) | Test report | | |
| L-02 | Pentest completed (nếu required) | Pentest report | | |
| L-03 | SBOM generated và reviewed | SBOM artifact | | |
| L-04 | CVE scan — mọi CVE ≥ High fixed hoặc exception approved | `security.yml` + issue | | |
| L-05 | Secure configuration baseline verified (ports, TLS, users, certs) | Checklist evidence | | |
| L-06 | OTA package signed, anti-downgrade verified | OTA test report | | |
| L-07 | Rollback test pass | OTA test report | | |
| L-08 | Release notes có security section | Release note | | |
| L-09 | Open issues / known exceptions reviewed | Issue tracker | | |
| L-10 | CHANGELOG và trace matrix cập nhật | CHANGELOG + trace | | |

### 6.4 Quarterly Process Audit

| # | Checklist item | Evidence | Pass/Fail/N/A | Note |
|---|---------------|----------|:-------------:|------|
| Q-01 | Vulnerability register maintained và up-to-date | Issue tracker | | |
| Q-02 | CVE SLA compliance (metrics: % within SLA) | Issue tracker metrics | | |
| Q-03 | Supplier assessment done cho mọi active supplier | `SEC-RPT-004` | | |
| Q-04 | Security guidelines updated (nếu có architecture change) | `SEC-STD-001` | | |
| Q-05 | Training records up-to-date (IEC 62443, secure coding) | Training matrix | | |
| Q-06 | Previous audit findings closed hoặc tracked | `SEC-RPT-005` cũ | | |

## 7. Finding severity & remediation

| Severity | Definition | Remediation SLA |
|----------|------------|-----------------|
| **Critical** | Direct exploit không auth, ảnh hưởng nhiều device | Fix trước release, không exception |
| **High** | Auth required, ảnh hưởng security boundary | Fix trước release, exception chỉ khi CTO approve |
| **Medium** | Security hardening, defense-in-depth | Fix trong next release, track trong issue |
| **Low** | Best practice, documentation, process | Track trong issue backlog |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-10 — Internal Security Audit Checklist |
