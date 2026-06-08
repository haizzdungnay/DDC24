# Security Test Plan — MK-DDC-24
## SM-5: Security Test Plan Template

> **Document ID:** KX-DDC24-TST-PLAN-001
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Draft
> **Owner:** QA + Tech Lead
> **Chuẩn liên quan:** IEC 62443-4-1 SM-5, OWASP Testing Guide, NIST SP 800-115, ISO/IEC 29119
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa cấu trúc chuẩn cho **Security Test Plan** của dự án MK-DDC-24. Đảm bảo mọi threat và security requirement được kiểm tra bằng phương pháp phù hợp (SAST, DAST, penetration test, fuzz test, integration test), và kết quả được ghi nhận làm bằng chứng cho release gate. Tuân thủ IEC 62443-4-1 SM-5 — Security Testing.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | Security Requirements Baseline | `KX-DDC24-SEC-SPEC-001` (SM-1) |
| 2 | Threat Model | `KX-DDC24-SEC-RPT-001` (SM-2) |
| 3 | Secure Design Review | `KX-DDC24-SEC-RPT-002` (SM-3) |
| 4 | System architecture & interface docs | `design/`, `spec/` |
| 5 | CI pipeline capabilities | `KX-DDC24-PM-REPO-001` |
| 6 | Test specification hiện có | `spec/TEST_SPEC_MK-DDC-24_VI.md` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Security Test Plan (file này) | `.md` |
| 2 | Test case list (threat → test method) | Bảng |
| 3 | Pentest scope & methodology | Đoạn văn |
| 4 | Release blocking criteria | Checklist |
| 5 | Test evidence archive | CI artifact / report file |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **QA** | Soạn test plan, thực hiện test, ghi nhận kết quả |
| **Tech Lead** | Phê duyệt test scope, review kết quả |
| **Developer** | Fix lỗi, hỗ trợ test environment |
| **Pentester (nếu có)** | Thực hiện penetration test theo scope |
| **CTO** | Phê duyệt release dựa trên test results |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Draft | Khi tạo mới / cập nhật test plan | Tech Lead + QA Lead | Mọi threat High/Critical có test case hoặc rationale exception |
| In-Review | Trước P5 (Security implementation) | CTO + Tech Lead | Test environment ready, pentest scope defined |
| Approved | Trước P7 (Release gate) | CTO + QA Lead | Mọi blocking test pass hoặc exception approved |
| Update | Khi có threat/thay đổi architecture | QA + Tech Lead | Test cases cập nhật theo threat thay đổi |

## 6. Test Methodology

| Phương pháp | Mô tả | Frequency |
|-------------|-------|-----------|
| **SAST** | Static analysis trên mã nguồn (CI) | Mỗi PR |
| **SCA** | Dependency vulnerability scan (CI) | Mỗi PR + hàng tuần |
| **Secret scan** | Gitleaks / truffleHog | Mỗi PR |
| **Integration test** | Auth, TLS, API security test | Mỗi build |
| **Fuzz test** | Input validation, protocol fuzzing | Hàng tháng |
| **Penetration test** | Manual pentest bởi chuyên gia | Trước major release |
| **SBOM generation** | CycloneDX SBOM | Mỗi release |

## 7. Test Case Matrix (Threat → Test)

| ID | Threat/SR | Test method | Test case | Expected result | Tool | Frequency |
|----|-----------|-------------|-----------|-----------------|------|-----------|
| T-TLS-01 | TLS 1.3 required, không fallback (SR-002) | Integration | Kết nối với TLS 1.2/1.0/SSL → reject | Kết nối bị từ chối | openssl s_client | Per build |
| T-AUTH-01 | JWT token giả mạo (SR-003) | Integration | Gửi request với token hết hạn/tự tạo → 401 | 401 Unauthorized | pytest / Postman | Per build |
| T-AUTH-02 | Brute force login | Integration | 10+ login fail liên tiếp → lockout/tạm dừng | Tài khoản bị tạm khóa | custom script | Per build |
| T-OTA-01 | Firmware package không đúng chữ ký (SR-001) | Integration | Apply package với signature sai → reject | Rollback, log cảnh báo | firmware test harness | Per build |
| T-OTA-02 | Anti-downgrade (SR-001) | Integration | Flash firmware version cũ hơn → reject | Version bị từ chối | firmware test harness | Per build |
| T-API-01 | API input injection | Fuzz | Gửi payload SQL injection / command injection | 400 Bad Request, không execute | Burp Suite / custom | Monthly |
| T-NET-01 | Port scanning | Penetration | Scan port trên device | Chỉ port cần thiết mở | nmap | Pre-release |
| T-DEP-01 | Dependency CVE (SR-001) | SCA | Scan dependencies với CVE DB | 0 critical, 0 high CVE | Trivy, Grype | Per PR |
| T-SEC-01 | Hardcoded secret | Secret scan | Scan codebase | 0 finding | Gitleaks | Per PR |
| ... | ... | ... | ... | ... | ... | ... |

## 8. Release Blocking Criteria

| # | Criterion | Gate |
|---|-----------|------|
| 1 | 0 critical/high CVE chưa vá | P7 |
| 2 | 0 hardcoded secret trong codebase | P7 |
| 3 | TLS 1.3 enforced, không fallback | P7 |
| 4 | Authentication tested: JWT, MQTT, API | P7 |
| 5 | OTA signed package + anti-downgrade verified | P7 |
| 6 | SBOM generated và reviewed | P7 |
| 7 | Pentest report có sẵn, 0 critical finding open | P7 |
| 8 | Exception list được CTO phê duyệt | P7 |

## 9. Pentest Scope (định kỳ)

| Thành phần | Scope | Method |
|------------|-------|--------|
| Web IDE | XSS, CSRF, auth bypass, session management | Manual + automated |
| REST API | Injection, auth bypass, rate limiting | Manual + automated |
| MQTT | Unauthorized subscribe/publish, topic enumeration | Manual |
| BACnet/IP | BACnet scan, service abuse | Manual |
| OTA update | Package manipulation, replay, downgrade | Manual |
| Device | Physical port, debug interface, JTAG/SWD | Manual |
| Firmware | Binary analysis, backdoor, hardcoded key | Manual |

## 10. Test Environment

| Environment | Mô tả | Dùng cho |
|-------------|-------|----------|
| CI (GitHub Actions) | Automated scan + integration test | SAST, SCA, secret scan, integration |
| Lab device | 1× MK-DDC-24 device + network | Fuzz, penetration, OTA test |
| Cloud staging | OTA server, Web IDE staging | Auth, API, MQTT test |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-5 — Security Test Plan |
