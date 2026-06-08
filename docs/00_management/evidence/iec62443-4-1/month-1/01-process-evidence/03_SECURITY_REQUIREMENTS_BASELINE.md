# Process Evidence: Security Requirements Baseline

> **Document ID:** IEC62443-M1-SRB-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Draft — sẵn sàng cho review
> **Owner:** Tech Lead + Solution Architect
> **Chuẩn:** IEC 62443-4-1 SM-1 | IEC 62443-4-2 CR 1.1–4.3
> **Template:** [KX-DDC24-SEC-SPEC-001](../../../../security_process_templates/KX-DDC24-SEC-SPEC-001_VI.md)

---

## 1. Tổng quan

Security Requirements Baseline này tổng hợp các yêu cầu bảo mật từ PRD, SRS, và threat analysis. Mỗi requirement được gán ID, nguồn gốc, tham chiếu IEC 62443-4-2, priority, design document, test method, và verification evidence.

## 2. Baseline

| ID | Yêu cầu | Nguồn | 62443-4-2 | Pri | Design Doc | Test Method | Evidence |
|----|---------|-------|-----------|:---:|------------|-------------|----------|
| SR-001 | Signed firmware, secure boot, anti-downgrade | PRD FR-030, SRS SEC-002 | CR 3.4, CR 4.1 | P0 | `SW_OTA_DESIGN` | Integration — OTA test harness | CI attestation, OTA test report |
| SR-002 | TLS 1.3 enforced cho mọi API/MQTT, không fallback | PRD FR-032, SRS SEC-005 | CR 3.1, CR 3.4 | P0 | `SW_SECURITY_KEYSTORE` | Integration — openssl s_client | Pentest report, CI test |
| SR-003 | JWT authentication + RBAC cho Web IDE | PRD FR-034, SRS SEC-010 | CR 1.1, CR 2.1 | P1 | `SW_SECURITY_KEYSTORE` | Integration — pytest | Auth test report |
| SR-004 | SSH hardening — key-only auth, disable password | PRD FR-033, SRS SEC-015 | CR 1.1, CR 2.1 | P1 | `SW_SECURITY_KEYSTORE` | Integration — sshd -T | Hardening checklist |
| SR-005 | Firewall — default DROP, chỉ mở port cần thiết | SRS SEC-020 | CR 3.2, CR 3.3 | P1 | `SW_SECURITY_KEYSTORE` | Integration — nmap + iptables -L | Hardening checklist |
| SR-006 | Audit log — login/logout, config change, alarm | PRD FR-035, SRS SEC-025 | CR 2.8, CR 2.9 | P1 | `SW_SECURITY_KEYSTORE` | Integration — log review | Audit log evidence |
| SR-007 | OTA A/B partition, signed package, rollback | SRS OTA-001..008 | CR 3.4, CR 4.1 | P0 | `SW_OTA_DESIGN` | Integration — OTA test harness | OTA test report |
| SR-008 | Key store — secret không ở plaintext trên filesystem | PRD FR-031, SRS SEC-004 | CR 4.3, CR 4.4 | P1 | `SW_SECURITY_KEYSTORE` | Review + integration | Key store audit |
| SR-009 | MQTT TLS 1.3, LWT, reconnect backoff | SRS SEC-012 | CR 3.1, CR 3.4 | P1 | `SW_AGENT_DESIGN` | Integration — MQTT test | MQTT test report |
| SR-010 | REST API rate limiting + input validation | SRS SEC-022 | CR 2.5, CR 2.6 | P1 | REST API spec | Integration — fuzz test | API test report |
| SR-011 | BACnet/IP only — MS/TP removed | ARCH-R010 | CR 3.2 | P2 | `BACNET_PICS_EPICS` | Integration — BACnet scan | BACnet test report |
| SR-012 | CVE severity SLA: Critical 7d, High 14d, Medium 30d, Low 90d | SRS SEC-007 | — | P1 | Vulnerability Mgmt SOP | Review | Issue tracker metrics |
| SR-013 | No hardcoded secret/credential/token trong code | Coding standard | CR 4.3 | P0 | Coding standard | SAST — gitleaks | CI artifact |
| SR-014 | Dependency scan — 0 Critical/High CVE trước release | SRS SEC-008 | — | P1 | CI/CD design | SCA — trivy/grype | CI artifact |
| SR-015 | Input validation mọi API endpoint | SRS SEC-022 | CR 2.5 | P1 | API design standard | SAST + integration | CI artifact |

## 3. Coverage theo IEC 62443-4-2

| CR # | Requirement | SR Mapping | Status |
|:----:|-------------|:----------:|:------:|
| CR 1.1 | Human user identification and authentication | SR-003, SR-004 | Covered |
| CR 1.2 | Software process identification and authentication | — | Not yet mapped |
| CR 1.3 | Account management | — | Not yet mapped |
| CR 2.1 | Authentication for web/API access | SR-003 | Covered |
| CR 2.5 | Input validation | SR-010, SR-015 | Covered |
| CR 2.6 | Deterministic output | — | Not yet mapped |
| CR 2.8 | Audit log | SR-006 | Covered |
| CR 2.9 | Audit log protection | SR-006 | Covered |
| CR 3.1 | Communication integrity | SR-002, SR-009 | Covered |
| CR 3.2 | Communication confidentiality | SR-005, SR-011 | Covered |
| CR 3.3 | Network segmentation | SR-005 | Covered |
| CR 3.4 | Software integrity | SR-001, SR-002, SR-007 | Covered |
| CR 4.1 | Information confidentiality | SR-001 | Covered |
| CR 4.2 | Information persistence | — | Not yet mapped |
| CR 4.3 | Use of cryptography | SR-008, SR-013 | Covered |
| CR 4.4 | Key store | SR-008 | Covered |

## 4. Trace Matrix Update

Security requirements baseline này cần được trace vào `KX-DDC24-QA-TRACE-001_VI.md` trong Month 2. Hiện tại trace có sẵn cho nhóm Bảo mật và OTA.

## 5. Review History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | DeveloperTeam | Baseline initial từ PRD/SRS |
