# Supplier Security Assessment Report — MK-DDC-24
## SM-9: Supplier Security Assessment Checklist & Report Template

> **Document ID:** KX-DDC24-SEC-RPT-004
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Owner:** Tech Lead + Procurement
> **Chuẩn liên quan:** IEC 62443-4-1 SM-9 (Supplier Management), ISO 28000, NIST SP 800-161 (Supply Chain Risk Management)
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa quy trình và checklist chuẩn cho **Supplier Security Assessment** của dự án MK-DDC-24. Áp dụng cho tất cả nhà cung cấp phần cứng (Radxa, TI), phần mềm (Debian packages, OSS libraries), dịch vụ cloud (OTA hosting, CDN), và công cụ CI/CD. Tuân thủ IEC 62443-4-1 SM-9 — Supplier Cybersecurity Management.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | Supplier list & BOM (Bill of Materials) | Procurement / `spec/architecture/` |
| 2 | SBOM (Software Bill of Materials) | `infra/scripts/gen-sbom` |
| 3 | Supplier cybersecurity questionnaire | Template từ procurement team |
| 4 | Component lifecycle / EOL information | Vendor datasheet, manufacturer website |
| 5 | Known CVE history cho component / dependency | NVD / GitHub Advisory / vendor PSIRT |
| 6 | License & provenance information | OSS license scan (scancode / license-checker) |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Supplier security assessment report (file này) | `.md` |
| 2 | Supplier risk rating (H/M/L) và rationale | Bảng trong report |
| 3 | CVE tracking per component (SBOM-based) | Issue tracker / SBOM tool |
| 4 | Exception / risk acceptance cho supplier không đạt | Issue + CTO approval |
| 5 | Review schedule cho recurring assessment | Calendar / PM plan |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **Tech Lead** | Đánh giá kỹ thuật, soạn report, theo dõi CVE |
| **Procurement** | Cung cấp supplier contact, contract terms, RFQ security clauses |
| **DevOps** | Duy trì SBOM, CVE scan, dependency tracking |
| **QA** | Xác nhận vendor security claims qua test (vd: secure boot, signed firmware) |
| **CTO** | Phê duyệt risk acceptance cho supplier không đạt threshold |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Initial assessment | Supplier selection / onboarding | Tech Lead + Procurement | Checklist đầy đủ, risk rating assigned |
| Re-assessment | Hàng năm hoặc khi có major change | Tech Lead | CVE history review, supplier status update |
| Exception review | Khi supplier không đạt checklist | CTO | Risk acceptance rationale rõ ràng, residual risk tracked |
| EOL trigger | Khi component EOL announced | Tech Lead + Procurement | Migration plan trong 6 tháng trước EOL |

## 6. Assessment checklist

### 6.1 Supplier Information

| Field | Giá trị |
|-------|---------|
| Supplier name | |
| Component / service | |
| Version / revision | |
| Contact person | |
| Assessment date | |
| Risk rating | ☐ Low ☐ Medium ☐ High |

### 6.2 Hardware Supplier Criteria

| # | Criterion | Weight | Pass/Fail/N/A | Evidence |
|---|-----------|--------|---------------|----------|
| 1 | Secure boot capability | High | | Datasheet, app note |
| 2 | Signed firmware support | High | | Datasheet, app note |
| 3 | Hardware security module / secure element | Medium | | Datasheet |
| 4 | Lifecycle commitment (min 5yr) | High | | Supplier letter |
| 5 | EOL notification policy (min 12mo) | Medium | | Supplier policy |
| 6 | CVE disclosure / PSIRT channel | Medium | | Supplier webpage |
| 7 | Known CVEs on component (at assessment) | High | | NVD search |

### 6.3 Software / OSS Dependency Criteria

| # | Criterion | Weight | Pass/Fail/N/A | Evidence |
|---|-----------|--------|---------------|----------|
| 1 | SBOM có sẵn hoặc có thể generate | High | | SBOM report |
| 2 | License compliance (OSI-approved / commercial) | High | | License scan |
| 3 | Active maintenance (commit trong 6 tháng) | Medium | | Git history |
| 4 | CVE history — không có open CVE ≥ High quá 30 ngày | High | | CVE scan |
| 5 | Provenance rõ ràng (trusted source, signed tags) | Medium | | Repo url, PGP |
| 6 | Dependency tree không có unmaintained library | Medium | | Dependency scan |

### 6.4 Cloud / Service Provider Criteria

| # | Criterion | Weight | Pass/Fail/N/A | Evidence |
|---|-----------|--------|---------------|----------|
| 1 | TLS 1.3 support | High | | SSL test |
| 2 | Data center region & compliance | Medium | | Provider SOC2 / ISO |
| 3 | SLA uptime (min 99.9%) | Medium | | Contract |
| 4 | Security incident notification SLA | High | | Contract |
| 5 | Data encryption at rest | Medium | | Provider docs |

### 6.5 Overall Risk Rating

| Rating | Criteria | Action |
|--------|----------|--------|
| **Low** | Mọi High-weight criteria pass | Standard monitoring |
| **Medium** | 1–2 High-weight criteria fail hoặc không có evidence | Exception + mitigation plan required |
| **High** | ≥3 High-weight criteria fail hoặc có Critical CVE không fix | CTO phê duyệt risk acceptance hoặc tìm supplier thay thế |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-9 — Supplier Security Assessment Report |
