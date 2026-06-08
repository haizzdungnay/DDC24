# Secure Design Review Checklist — MK-DDC-24
## SM-3: Secure Design Review Checklist Template

> **Document ID:** KX-DDC24-SEC-RPT-002
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Draft
> **Owner:** Tech Lead + Solution Architect
> **Chuẩn liên quan:** IEC 62443-4-1 SM-3, IEC 62443-4-2 CR, ISO/IEC/IEEE 1016
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này cung cấp checklist chuẩn để thực hiện **Secure Design Review** cho mọi thành phần thiết kế trong dự án MK-DDC-24: firmware, software, backend services, Web IDE, interfaces (BACnet, MQTT, REST), OTA, và key store. Đảm bảo mọi quyết định thiết kế bảo mật được ghi nhận, review, và phê duyệt trước khi implementation. Tuân thủ IEC 62443-4-1 SM-3 — Secure Design Review.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | Design documents (DDD, ICD) | `design/` |
| 2 | Architecture documents | `spec/` |
| 3 | Threat Model | `KX-DDC24-SEC-RPT-001` (SM-2) |
| 4 | Security Requirements Baseline | `KX-DDC24-SEC-SPEC-001` (SM-1) |
| 5 | Open design decisions | `spec/OPEN_ISSUES_MK-DDC-24_VI.md` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Secure Design Review Report (điền checklist) | `.md` |
| 2 | Review sign-off record | Comment issue / signature |
| 3 | Design decision record updates | Cập nhật design doc |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **Tech Lead** | Chủ trì review, điền checklist |
| **Solution Architect** | Phê duyệt design decision |
| **Developer** | Trình bày design, giải trình threat mitigation |
| **QA** | Xác nhận design có test coverage |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Draft | Khi design document hoàn thành | Tech Lead + Solution Architect | Checklist đầy đủ, không có unresolved item |
| In-Review | Trước P5 (Security implementation) | CTO | Mọi threat High được mitigation trong design |
| Update | Khi design thay đổi / có threat model mới | Tech Lead | Cập nhật design decision, Revision History |

## 6. Checklist

### 6.1 Authentication & Authorization

| # | Item | Pass/Fail/NA | Ghi chú |
|---|------|:-----------:|---------|
| AUTH-01 | Mọi API/endpoint đều yêu cầu authentication? | | |
| AUTH-02 | JWT token có expiry, refresh, và revocation? | | |
| AUTH-03 | MQTT client authentication (username/password, certificate)? | | |
| AUTH-04 | Role-based access control (RBAC) được phân biệt? | | |
| AUTH-05 | Default credentials bị cấm, yêu cầu đổi mật khẩu lần đầu? | | |
| AUTH-06 | Session management: timeout, secure cookie, CSRF protection? | | |

### 6.2 Cryptography & Key Store

| # | Item | Pass/Fail/NA | Ghi chú |
|---|------|:-----------:|---------|
| CRYPTO-01 | Key store sử dụng hardware-backed (TPM/secure element)? | | |
| CRYPTO-02 | Private keys không bao giờ ở plaintext trên filesystem? | | |
| CRYPTO-03 | TLS 1.3 được cấu hình đúng, không fallback xuống <1.2? | | |
| CRYPTO-04 | Certificate pinning cho OTA và cloud endpoints? | | |
| CRYPTO-05 | Firmware signing key custody được ghi nhận? | | |
| CRYPTO-06 | Random number generator là CSPRNG? | | |

### 6.3 Data Protection

| # | Item | Pass/Fail/NA | Ghi chú |
|---|------|:-----------:|---------|
| DATA-01 | Dữ liệu nhạy cảm (config, credential) được mã hóa khi lưu trữ? | | |
| DATA-02 | Audit log không ghi secret/token/password? | | |
| DATA-03 | Dữ liệu xóa an toàn (factory reset, key wipe) được design? | | |
| DATA-04 | Backup data được mã hóa? | | |

### 6.4 Network & Interface Security

| # | Item | Pass/Fail/NA | Ghi chú |
|---|------|:-----------:|---------|
| NET-01 | Chỉ mở port cần thiết (minimal attack surface)? | | |
| NET-02 | BACnet/IP có được cô lập / firewall? | | |
| NET-03 | MQTT topic structure ngăn truy cập trái phép? | | |
| NET-04 | REST API rate limiting và input validation? | | |
| NET-05 | Modbus RTU không exposed qua network? | | |

### 6.5 OTA & Update

| # | Item | Pass/Fail/NA | Ghi chú |
|---|------|:-----------:|---------|
| OTA-01 | Firmware package được sign (`.kxpkg`)? | | |
| OTA-02 | Anti-downgrade protection? | | |
| OTA-03 | Rollback mechanism an toàn? | | |
| OTA-04 | OTA server endpoint authenticated? | | |
| OTA-05 | Update package integrity verified trước khi apply? | | |

### 6.6 Security Design Review Summary

| Mục | Kết quả |
|-----|---------|
| Design document | <link> |
| Threat model version | <version> |
| Tổng số checklist items | <count> |
| Pass | <count> |
| Fail (need action) | <count> |
| NA | <count> |
| Review conclusion | ✅ Approved / ❌ Needs rework |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-3 — Secure Design Review Checklist |
