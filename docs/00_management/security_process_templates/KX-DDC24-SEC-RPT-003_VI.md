# Secure Coding Compliance Report — MK-DDC-24
## SM-4: Secure Coding Compliance Report Template

> **Document ID:** KX-DDC24-SEC-RPT-003
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Owner:** Developer Team + Tech Lead
> **Chuẩn liên quan:** IEC 62443-4-1 SM-4, CERT/CWE Top 25, OWASP ASVS, coding standards dự án
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa cấu trúc báo cáo **Secure Coding Compliance** cho mọi pull request / release trong dự án MK-DDC-24. Đảm bảo code thay đổi được kiểm tra bảo mật trước khi merge: không hardcode secret, không lỗi input validation, đúng crypto/TLS usage, và static analysis pass. Tuân thủ IEC 62443-4-1 SM-4 — Secure Implementation.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | Pull request / code change | Git repository |
| 2 | Coding standards | `docs/05_implementation/` |
| 3 | Static analysis results | CI pipeline (SAST, SCA) |
| 4 | Secret scanning results | CI pipeline (gitleaks) |
| 5 | Dependency scan results | CI pipeline (trivy, grype) |
| 6 | PR reviewer comments | GitHub PR |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Secure Coding Compliance Report (file này) | `.md` |
| 2 | PR checklist pass/fail | PR comment |
| 3 | Security review sign-off | PR review approval |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **Developer** | Tự kiểm tra code trước khi push, điền checklist trong PR |
| **Tech Lead** | Review code và checklist, xác nhận compliance |
| **QA** | Kiểm tra CI scan results, verify không có secret leak |
| **DevOps** | Maintain CI security scanning workflows |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Per-PR | Trước merge | Tech Lead + code owner | Checklist pass, static analysis pass, secret scan pass |
| Per-Release | Trước P5/P7 gate | QA + Tech Lead | Tổng hợp report, exception list |
| Exception | Khi có finding không fix được ngay | CTO + Tech Lead | Ghi nhận exception, mitigation plan |

## 6. Checklist

### 6.1 PR Security Checklist (điền trong mỗi PR)

```markdown
## PR Security Checklist — <PR #>
| # | Item | ✅ / ❌ / NA | Evidence |
|---|------|:-----------:|----------|
| SC-01 | Không có hardcode credential/secret/token/key trong code? | | gitleaks pass |
| SC-02 | Input validation được thực hiện (length, type, range, format)? | | code review |
| SC-03 | Output encoding để ngăn injection/XSS? | | code review |
| SC-04 | Crypto chỉ dùng thư viện chuẩn, không tự implement? | | code review |
| SC-05 | TLS config đúng: 1.3 preferred, 1.2 minimum (không SSL)? | | code review |
| SC-06 | Error handling không leak stack trace/internal info? | | code review |
| SC-07 | Logging không ghi secret/sensitive data? | | code review |
| SC-08 | Memory safe patterns (bounds check, không use-after-free)? | | SAST scan |
| SC-09 | Static analysis không có finding high/critical? | | SAST report |
| SC-10 | Dependency scan không có CVE >= 7.0? | | trivy/grype report |
| SC-11 | Secret scan không có finding? | | gitleaks report |
| SC-12 | Code conforms với coding standard của dự án? | | code review |
| SC-13 | Nếu có database schema change: không lưu plaintext secret? | | code review |
| SC-14 | Nếu có API change: authentication/authorization được implement? | | code review |
```

### 6.2 Static Analysis Gate

| Tool | Loại | Threshold | Result |
|------|------|-----------|--------|
| Trivy / Grype | Dependency CVE | 0 critical, 0 high | ✅ Pass / ❌ Fail |
| Gitleaks | Secret scan | 0 finding | ✅ Pass / ❌ Fail |
| SAST (Cppcheck / Sonar / Semgrep) | Static analysis | 0 high-severity | ✅ Pass / ❌ Fail |
| Lint (ESLint / Clang-Tidy) | Code quality | 0 error | ✅ Pass / ❌ Fail |

### 6.3 Exception Log

| # | Finding | Severity | Lý do không fix | Mitigation | Approved by | Target |
|---|---------|:--------:|-----------------|------------|-------------|--------|
| | | | | | | |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-4 — Secure Coding Compliance Report |
