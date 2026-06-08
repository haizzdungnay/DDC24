# Vulnerability & Patch Management Procedure — MK-DDC-24
## SM-6/7: Vulnerability and Patch Management Procedure Template

> **Document ID:** KX-DDC24-SEC-PLAN-001
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Draft
> **Owner:** DevOps + Tech Lead
> **Chuẩn liên quan:** IEC 62443-4-1 SM-6 (Vulnerability Management), SM-7 (Patch Management), ISO/IEC 30111, NIST SP 800-40
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa quy trình chuẩn cho **vulnerability intake, triage, disclosure, patch release, và verification** của dự án MK-DDC-24. Áp dụng cho firmware (MCU), backend services (SOM), hệ điều hành (Debian), dependencies (OSS libraries), và OTA update packages. Tuân thủ IEC 62443-4-1 SM-6 — Vulnerability Management và SM-7 — Patch Management.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | CVE / vulnerability report từ CI scan (trivy/grype) | `infra/ci/security.yml`, `infra/scripts/gen-sbom` |
| 2 | External vulnerability disclosure (email, PSIRT, public advisory) | Security contact / vendor channel |
| 3 | SBOM (Software Bill of Materials) | `infra/scripts/gen-sbom` — CycloneDX format |
| 4 | CVE severity rubric & SLA policy | `SRS_MK-DDC-24_VI.md` SEC-xxx, `KX-DDC24-SEC-GAP-001` |
| 5 | Product version manifest | `shared/version.h`, OTA package `.kxpkg` |
| 6 | Known open issues affecting security | `spec/OPEN_ISSUES_MK-DDC-24_VI.md` |
| 7 | OTA A/B update design | `design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Vulnerability register — intake → triage → fix → verification | Issue tracker (có field: severity, SLA, owner, source, fix version, verification evidence) |
| 2 | Patch release checklist — signing, anti-downgrade, rollback, customer notification | Checklist trong issue / release note |
| 3 | Security advisory (internal / customer-facing nếu cần) | `.md` / email template |
| 4 | Verified fix evidence — scan report, test result, trace update | CI artifact + issue comment |
| 5 | Post-mortem report cho Critical vulnerabilities | Issue / `SEC-RPT` |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **DevOps** | Duy trì vulnerability scan pipeline (trivy/grype/gitleaks), SBOM generation, CVE monitoring |
| **Tech Lead** | Triage severity, gán owner, approve fix plan, quyết định emergency patch |
| **Developer Team** | Phân tích root cause, tạo fix, unit test, cập nhật trace matrix |
| **QA** | Verify fix, regression test, xác nhận scan pass, update evidence |
| **CTO** | Phê duyệt security advisory, emergency patch release, customer notification |
| **PM** | Theo dõi SLA, thông báo khách hàng theo contract |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Triage | Trong SLA (Critical: 24h, High: 72h, Medium: 7d, Low: 30d) | Tech Lead | Severity đúng rubric, owner assigned, fix deadline set |
| Fix verification | Khi fix PR merged | QA | Scan hết CVE cũ, không gây CVE mới, test pass |
| Patch release | Trước khi ship `.kxpkg` | Tech Lead + CTO | Signing, anti-downgrade, rollback verified, customer notified nếu cần |
| Quarterly review | Mỗi quý | Tech Lead + DevOps | Register đầy đủ, SLA metrics, process improvement |

## 6. Procedure

### 6.1 Vulnerability Intake

| Source | Method | Priority |
|--------|--------|----------|
| CI scan (`security.yml`) | Tự động tạo issue | Theo severity |
| External disclosure (email / PSIRT) | Manual triage trong 1 ngày làm việc | Critical/High ưu tiên |
| Dependency scan (SBOM + CVE DB) | Hàng tuần | Theo severity |
| Pentest / security research | Manual review trong 3 ngày | Theo severity |

### 6.2 Severity Rubric

| Severity | CVSS 3.x | SLA (fix + release) | Ví dụ |
|----------|----------|---------------------|-------|
| Critical | 9.0–10.0 | 7 ngày | RCE không auth, remote code execution |
| High | 7.0–8.9 | 14 ngày | Auth bypass, privilege escalation |
| Medium | 4.0–6.9 | 30 ngày | Information disclosure (không critical) |
| Low | 0.1–3.9 | 90 ngày | Non-exploitable in product context |

### 6.3 Patch Release Flow

```
CVE triage → Fix branch → Code review + static analysis
    → Build signed `.kxpkg` → Staging OTA test → Rollback test
    → SBOM update → Release approval (Tech Lead + CTO)
    → OTA push (staged rollout) → Customer notification
    → Verification evidence → Issue close
```

### 6.4 Emergency Patch

1. Critical CVE ảnh hưởng deployment production → emergency patch trigger.
2. CTO phê duyệt emergency window, Tech Lead điều phối fix.
3. QA test rút gọn: security scan + smoke test + rollback test → release.
4. Post-mortem trong 5 ngày sau patch.

### 6.5 Disclosure & Customer Notification

- Customer không nhận được advisory cho fix đã deploy mà không ảnh hưởng vận hành.
- Critical/High CVE ảnh hưởng customer → email notification trong 48h sau fix plan approved.
- Security advisory published tại `docs/00_management/security_advisories/`.

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-6/7 — Vulnerability & Patch Management Procedure |
