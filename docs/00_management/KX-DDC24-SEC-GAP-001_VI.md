# IEC 62443-4-1 SDLC Gap Analysis — MK-DDC-24
## Đánh giá SDLC hiện tại theo 13 Security Maturity practices

> **Document ID:** KX-DDC24-SEC-GAP-001  
> **Phiên bản:** 1.0 | 2026-06-02 · **Trạng thái:** Draft · **Owner:** Tech Lead  
> **Issue:** IOT-5486 · **Phạm vi:** IEC 62443-4-1 process alignment, SM-1..SM-13  
> **Ref:** [PM-MARKET-001 §6.2](KX-DDC24-PM-MARKET-001_VI.md), [PM-GOAL-001 OBJ-11](KX-DDC24-PM-GOAL-001_VI.md), [PM-IMPLPLAN-001](KX-DDC24-PM-IMPLPLAN-001_VI.md)

---

## 1. Kết luận điều hành

SDLC hiện tại đã có nền tảng tốt cho secure-by-design: yêu cầu bảo mật được định nghĩa trong `PRD_MK-DDC-24_VI.md` và `SRS_MK-DDC-24_VI.md`, traceability có trong `KX-DDC24-QA-TRACE-001_VI.md`, CI/security gates có trong `KX-DDC24-PM-REPO-001_VI.md`, thiết kế security/OTA có trong `SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md` và `SW_OTA_DESIGN_MK-DDC-24_VI.md`.

Gap chính không nằm ở ý định kỹ thuật mà nằm ở bằng chứng quy trình: chưa có threat model chuẩn, vulnerability disclosure/triage workflow, patch SLA vận hành, supplier security review, security training record, secure decommissioning procedure, và baseline configuration/change-control checklist cho release.

Ưu tiên Month 1-3: chuẩn hóa security requirements + threat model + secure design review trong Month 1; khóa vulnerability/patch/configuration management trong Month 2; hoàn thiện supplier, decommissioning, training, audit evidence trong Month 3.

---

## 2. Evidence baseline

| Evidence | Current signal |
|----------|----------------|
| `docs/00_management/KX-DDC24-PM-GOAL-001_VI.md` | OBJ-10 yêu cầu không CVE CVSS >= 7.0, TLS 1.3, secure boot, firmware signed; OBJ-11 yêu cầu IEC 62443-4-1 SDLC. |
| `PRD_MK-DDC-24_VI.md` | FR-030..035 bao phủ signed firmware, secure boot, TLS 1.3, SSH hardening, auth, audit log. |
| `SRS_MK-DDC-24_VI.md` | SEC-002..025, OTA-001..008, API/MQTT TLS, JWT, firewall, CVE SLA mức high/medium. |
| `docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md` | DoD chung có coding standard, unit test, static analysis, reviewer, trace matrix; P5 Security + OTA gate; P7 release SBOM/dependency scan/pentest. |
| `docs/05_implementation/KX-DDC24-PM-REPO-001_VI.md` | CI workflow dự kiến `security.yml` với trivy/grype, gitleaks, SBOM; PR cần reviewer; trace matrix cập nhật khi đóng task. |
| `docs/00_management/KX-DDC24-QA-TRACE-001_VI.md` | Trace REQ -> design -> task -> test cho security, OTA, REST/MQTT, Web IDE auth. |
| `design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md` | Key store, TLS, JWT, firewall, audit log, static/dependency scan, CVE policy ở mức thiết kế. |
| `spec/OPEN_ISSUES_MK-DDC-24_VI.md` | SW-Q-004 key storage và SW-Q-005 OTA endpoint còn mở, ảnh hưởng secure design/OTA cert pinning. |

---

## 3. Gap matrix SM-1..SM-13

| SM | Practice | Current state | Target state | Gap severity | Action đóng gap |
|----|----------|---------------|--------------|--------------|-----------------|
| SM-1 | Security requirements | Có yêu cầu trong PRD/SRS: FR-030..035, SEC-002..025, OTA-001..008; trace có nhóm Bảo mật và OTA. | Security requirements baseline có owner, review gate, threat-derived requirements, trace tới test và release evidence. | Medium | Tạo `SEC-REQ-BASELINE` checklist và update trace cho mọi SEC/OTA/API/MQTT requirement trước P5. |
| SM-2 | Threat modeling | Chưa thấy threat model riêng; chỉ có security design và open issue SW-Q-004/SW-Q-005. | Threat model cho device, cloud/OTA, local Web IDE, BACnet/MQTT/REST, supply-chain update path. | High | Tạo threat model asset/data-flow/trust-boundary + misuse cases, bắt buộc review trước security implementation. |
| SM-3 | Secure design | Có `SW_SECURITY_KEYSTORE`, `SW_OTA_DESIGN`, `FW_BOOTLOADER_OTA`, port/firewall/TLS/JWT decisions; SW-Q-004 còn chưa chốt. | Secure design decision record đầy đủ, key-store decision chốt, interface/security design được review trước code. | High | Chốt SW-Q-004 với Solution Architect/CTO; thêm security design review checklist cho D-7/D-11/API/MQTT. |
| SM-4 | Secure implementation | Có coding standards, cấm hardcode secret, static analysis, PR reviewer, CI lint/test/security scan dự kiến. | Secure coding checklist bắt buộc trong PR, secret handling, input validation, crypto/TLS checks, code owner cho security/interface. | Medium | Bổ sung PR template security checklist và CODEOWNERS security review cho `services/agent`, `services/ota`, `infra/ci`, `design/interfaces`. |
| SM-5 | Security testing | Có test IDs T-SEC, TLS, auth, OTA, pentest gate, `security.yml` trivy/grype/gitleaks/SBOM; chưa có test plan threat-based. | Test plan gồm SAST/SCA/secrets/SBOM, authz, TLS, fuzz/API negative tests, pentest scope, release blocking criteria. | Medium | Tạo security test plan map threat -> test; đưa CVE>=7, gitleaks, TLS, authz, OTA rollback vào release evidence. |
| SM-6 | Vulnerability management | SRS nêu CVE>=7 vá trước ship, CVE 4.0-6.9 trong 30 ngày; chưa có intake/triage/disclosure workflow. | Vulnerability register có intake, severity rubric, owner, SLA, fix verification, release advisory path. | High | Tạo vulnerability management SOP + register fields; liên kết CI findings và external reports vào issue workflow. |
| SM-7 | Patch management | OTA A/B, signed package, anti-downgrade, rollback có thiết kế; OTA server endpoint SW-Q-005 chưa xác định. | Patch lifecycle có release approval, signing custody, rollback criteria, customer notification, OTA server ownership. | High | Chốt SW-Q-005; tạo patch/release SOP cho `.kxpkg`, GPG key custody, emergency patch SLA. |
| SM-8 | Security guidelines | Có dev guides, coding standards, repo guide, security design; chưa có operator/security hardening guide. | Developer + integrator + operator security guidelines gồm provisioning, cert import, SSH, firewall, backup, logging. | Medium | Tạo security guideline document cho dev/operator; link từ `docs/README.md` và release handover. |
| SM-9 | Supplier management | BOM/supply risk có research; chưa có supplier cybersecurity criteria cho Radxa, TI, libraries, OTA hosting. | Supplier review có SBOM/component provenance, vendor CVE tracking, source trust, lifecycle/EOL, RFQ security clauses. | High | Tạo supplier security checklist cho hardware vendors, Debian packages, OSS libs, OTA/CDN provider. |
| SM-10 | Security review | Có design readiness review và PR reviewer; chưa có first-class security review gate theo phase. | Security review ở requirements/design/code/test/release gates với evidence checklist và approver. | Medium | Thêm security review checklist cho P0/P5/P7 gates; Tech Lead review dev deliverables, QA verify evidence. |
| SM-11 | Secure decommissioning | Chưa thấy yêu cầu/procedure xóa secret, config, certificate, logs, customer data khi thu hồi thiết bị. | Decommissioning procedure có factory reset, key wipe, cert revoke, log export/delete, asset disposal record. | High | Tạo secure decommissioning requirements + operator procedure + test case. |
| SM-12 | Security training | Chưa thấy training plan/record cho IEC 62443, secure coding, threat modeling, vulnerability response. | Training matrix theo role, completion evidence, refresh cadence, onboarding requirement. | Medium | Tạo Month 1 training plan cho Dev/QA/Tech Lead: IEC 62443-4-1 basics, secure coding, threat modeling, CVE triage. |
| SM-13 | Configuration management | Có repo guide, SemVer, trace matrix, CHANGELOG, config schema, branch/PR rules; chưa có secure baseline + config audit. | Secure configuration baseline cho production image, CI/release artifacts, config schema, change approval, audit trail. | Medium | Tạo configuration baseline checklist: ports, TLS, users, certs, rootfs RO, SBOM, version, changelog, trace state. |

---

## 4. Prioritized action list Month 1-3

| Priority | Month | Owner | Action | Done criteria |
|----------|-------|-------|--------|---------------|
| P0 | Month 1 | Tech Lead + Solution Architect | Tạo threat model cho device/OTA/Web IDE/BACnet/MQTT/REST. | Threat model có assets, data flows, trust boundaries, threats, mitigations, review sign-off. |
| P0 | Month 1 | CTO + Solution Architect | Chốt SW-Q-004 key store và SW-Q-005 OTA endpoint/cert pinning. | `spec/OPEN_ISSUES_MK-DDC-24_VI.md` có quyết định DEC, owner, date; D-7/D-11 cập nhật. |
| P0 | Month 1 | Tech Lead + QA | Tạo security requirements baseline + trace review. | Mọi SEC/OTA/API/MQTT security requirement có design/task/test/evidence field. |
| P1 | Month 1 | Tech Lead | Thêm secure design review checklist cho D-7/D-11/API/MQTT. | Checklist được dùng trước khi giao implementation security. |
| P1 | Month 2 | DevOps + Tech Lead | Tạo vulnerability management SOP/register. | Register có severity, SLA, owner, source, fix version, verification evidence. |
| P1 | Month 2 | DevOps + Release | Tạo patch management SOP cho `.kxpkg`. | SOP bao phủ signing, anti-downgrade, rollback, customer notification, emergency patch SLA. |
| P1 | Month 2 | QA + Tech Lead | Tạo security test plan threat-based. | Mỗi threat/security requirement có test method hoặc accepted rationale. |
| P2 | Month 2 | Tech Lead + Procurement | Tạo supplier security checklist. | Radxa/TI/OSS/Debian/OTA provider review fields có owner và review date. |
| P2 | Month 3 | Docs & Release + Tech Lead | Tạo operator security guideline. | Hướng dẫn provisioning, cert, SSH, firewall, backup/logs, OTA, account roles. |
| P2 | Month 3 | QA + Tech Lead | Tạo secure decommissioning procedure + test. | Procedure xóa secret/config/cert/log; test factory reset/key wipe pass. |
| P2 | Month 3 | PMO + Tech Lead | Tạo security training matrix. | Training record theo role có completion evidence và refresh cadence. |
| P2 | Month 3 | Release + QA | Tạo secure configuration baseline checklist. | P7 release không pass nếu thiếu SBOM, scan, version, port/TLS/user/cert baseline. |

---

## 5. Kết luận và khuyến nghị

MK-DDC-24 có nền tảng SDLC và technical security tốt hơn mức khởi đầu thông thường: yêu cầu, trace, CI/security scan, OTA, key store, TLS/JWT và release gates đều đã có trong tài liệu. Tuy nhiên IEC 62443-4-1 yêu cầu bằng chứng quy trình lặp lại được, không chỉ thiết kế kỹ thuật.

Khuyến nghị không bắt đầu implementation security P5 trước khi hoàn tất 4 việc Month 1: threat model, security requirements baseline, secure design review checklist, và quyết định SW-Q-004/SW-Q-005. Đây là các gap High có thể tạo rework lớn nếu để đến cuối P5/P7.

Các action Month 2-3 nên được tạo thành child issues riêng cho đúng owner: DeveloperTeam chỉ nhận việc implementation sau khi decision/checklist rõ; QAReviewer nhận security test/decommission/config evidence verification; Docs & Release nhận operator guideline và release handover.

---

## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | Tech Lead | Phát hành gap analysis SM-1..SM-13 cho IOT-5486. |
