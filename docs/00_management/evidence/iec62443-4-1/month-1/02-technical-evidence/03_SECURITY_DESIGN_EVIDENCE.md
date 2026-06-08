# Technical Evidence: Security Design Evidence

> **Document ID:** IEC62443-M1-DESIGN-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Compiled — security design documents reviewed
> **Owner:** Solution Architect + Tech Lead
> **Chuẩn:** IEC 62443-4-1 SM-3

---

## 1. Existing Security Design Documents

Dự án MK-DDC-24 đã có các tài liệu thiết kế bảo mật sau:

| Document | Description | Status | Location |
|----------|-------------|:------:|----------|
| `SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md` | Key store, TLS, JWT, firewall, audit log, CVE policy | ✅ Done | [`design/software/`](../../../../../02_design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) |
| `SW_OTA_DESIGN_MK-DDC-24_VI.md` | OTA A/B, signed package, rollback, anti-downgrade | ✅ Done | [`design/software/`](../../../../../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) |
| `BACNET_PICS_EPICS_MK-DDC-24_VI.md` | BACnet profile, objects, COV | ✅ Done | [`design/interfaces/`](../../../../../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) |
| `SW_AGENT_DESIGN_MK-DDC-24_VI.md` | MQTT agent design | ✅ Done | [`design/software/`](../../../../../02_design/software/SW_AGENT_DESIGN_MK-DDC-24_VI.md) |
| `SW_IODRIVER_DESIGN_MK-DDC-24_VI.md` | IO driver (UART IOP) | ✅ Done | [`design/software/`](../../../../../02_design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md) |

## 2. Secure Design Review Checklist (Initial)

### Authentication & Authorization

| # | Item | Status | Note |
|---|------|:------:|------|
| AUTH-01 | Mọi API/endpoint đều yêu cầu authentication | ✅ Designed | JWT middleware in `SW_SECURITY_KEYSTORE` |
| AUTH-02 | JWT token có expiry, refresh, revocation | ✅ Designed | Token expiry + refresh mechanism |
| AUTH-03 | MQTT client authentication | ✅ Designed | TLS + username/password + certificate |
| AUTH-04 | RBAC phân biệt | ✅ Designed | Admin/operator/viewer roles |
| AUTH-05 | Default credentials bị cấm | ✅ Designed | Forced password change on first boot |
| AUTH-06 | Session management: timeout, secure cookie | ✅ Designed | httpOnly, 30 min idle timeout |

### Cryptography & Key Store

| # | Item | Status | Note |
|---|------|:------:|------|
| CRYPTO-01 | Key store hardware-backed | 🔶 Pending | SW-Q-004 not yet decided (OP-TEE/TPM/encrypted) |
| CRYPTO-02 | Private keys not in plaintext | ✅ Designed | Key store abstraction layer |
| CRYPTO-03 | TLS 1.3 enforced, no fallback <1.2 | ✅ Designed | `SW_SECURITY_KEYSTORE` |
| CRYPTO-04 | Certificate pinning for OTA/cloud | 🔶 Pending | SW-Q-005 not yet decided |
| CRYPTO-05 | Firmware signing key custody | 📋 Planned | Need SOP for GPG key management |
| CRYPTO-06 | CSPRNG used | ✅ Designed | OS random source |

### Data Protection

| # | Item | Status | Note |
|---|------|:------:|------|
| DATA-01 | Sensitive data encrypted at rest | ✅ Designed | Key store design |
| DATA-02 | Audit log no secret/token/password | ✅ Designed | Audit log sanitization |
| DATA-03 | Secure delete (factory reset, key wipe) | 📋 Planned | SM-11, Month 2 |
| DATA-04 | Backup data encrypted | 📋 Planned | Month 2-3 |

### Network & Interface Security

| # | Item | Status | Note |
|---|------|:------:|------|
| NET-01 | Only required ports open | ✅ Designed | Firewall DROP policy, port list defined |
| NET-02 | BACnet/IP isolated/firewalled | ✅ Designed | Network segmentation |
| NET-03 | MQTT topic ACL | ✅ Designed | Topic structure prevents unauthorized access |
| NET-04 | REST API rate limiting + input validation | ✅ Designed | Rate limit 100/s → 429 |
| NET-05 | Modbus RTU not exposed via network | ✅ Designed | RS-485 only (ARCH-R010) |

### OTA & Update

| # | Item | Status | Note |
|---|------|:------:|------|
| OTA-01 | Firmware package signed (`.kxpkg`) | ✅ Designed | GPG signature |
| OTA-02 | Anti-downgrade protection | ✅ Designed | Version check in bootloader |
| OTA-03 | Safe rollback mechanism | ✅ Designed | A/B partition, health check |
| OTA-04 | OTA server endpoint authenticated | 🔶 Pending | SW-Q-005 not yet decided |
| OTA-05 | Package integrity verified before apply | ✅ Designed | SHA-256 + GPG verify |

## 3. Design Review Summary

| Category | Total Items | Pass | Pending | Planned |
|----------|:-----------:|:----:|:-------:|:-------:|
| Authentication & Authorization | 6 | 6 | 0 | 0 |
| Cryptography & Key Store | 6 | 4 | 2 | 1 |
| Data Protection | 4 | 2 | 0 | 2 |
| Network & Interface Security | 5 | 5 | 0 | 0 |
| OTA & Update | 5 | 3 | 1 | 0 |
| **Total** | **26** | **20** | **3** | **3** |

Pending items yêu cầu quyết định từ Solution Architect/CTO:
- SW-Q-004: Key store hardware backing (OP-TEE/TPM/encrypted)
- SW-Q-005: OTA server endpoint + cert pinning

## 4. References

- Design review template: [`KX-DDC24-SEC-RPT-002`](../../../../security_process_templates/KX-DDC24-SEC-RPT-002_VI.md)
- Open issues: [`spec/OPEN_ISSUES_MK-DDC-24_VI.md`](../../../../../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md)
