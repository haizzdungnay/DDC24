# Security Guideline for Integrators — MK-DDC-24
## SM-8: Security Guideline for Integrators and Operators Template

> **Document ID:** KX-DDC24-SEC-STD-001
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Draft
> **Owner:** Docs & Release + Tech Lead
> **Chuẩn liên quan:** IEC 62443-4-1 SM-8 (Security Guidelines), IEC 62443-4-2 (Technical Security for IACS Components), NIST SP 800-82 (ICS Security)
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa cấu trúc chuẩn cho **Security Guideline** hướng dẫn người tích hợp (integrator) và người vận hành (operator) triển khai, cấu hình, vận hành và bảo trì thiết bị MK-DDC-24 một cách bảo mật. Tuân thủ IEC 62443-4-1 SM-8 — Security Guidelines.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | System architecture và network topology | `spec/architecture/`, `DS_MK-DDC-24_VI.md` |
| 2 | Interface Control Documents (ICD) | `design/interfaces/` |
| 3 | Security design (key store, TLS, JWT, firewall) | `design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md` |
| 4 | OTA update design | `design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md` |
| 5 | Product deployment guide (hardware, network, power) | `hardware-design/`, deployment checklist |
| 6 | Known security hardening requirements | `SRS_MK-DDC-24_VI.md` SEC-xxx, `KX-DDC24-SEC-GAP-001` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Device hardening checklist (ports, TLS, users, certs) | `.md` / checklist item |
| 2 | Network deployment guide (firewall rules, segmentation) | `.md` / diagram |
| 3 | Certificate import & key management procedure | `.md` |
| 4 | Logging & audit configuration guide | `.md` |
| 5 | Backup & restore procedure | `.md` |
| 6 | OTA update procedure (cho operator) | `.md` |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **Docs & Release** | Soạn và duy trì security guideline, đảm bảo hướng dẫn rõ ràng cho integrator/operator |
| **Tech Lead** | Review nội dung kỹ thuật, xác nhận hardening steps đúng với design |
| **Solution Architect** | Phê duyệt network topology và firewall rules |
| **QA** | Xác nhận guideline khả thi qua test (provisioning, cert import) |
| **CTO** | Phê duyệt release guideline cho product handover |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Draft | Khi tạo mới / architecture change major | Tech Lead | Các hardening steps khả thi, không conflict với operation requirements |
| In-Review | Trước P7 (Release gate) | Solution Architect + CTO | Mọi security requirement có hướng dẫn tương ứng, exception được approve |
| Update | Khi thay đổi port, service, TLS version, OTA flow | Tech Lead + Docs & Release | Cập nhật Revision History, verified trên staging |

## 6. Template structure

### 6.1 Device Hardening Checklist

```markdown
## Device Hardening Checklist
| Hạng mục | Yêu cầu | Mặc định | Kiểm tra |
|----------|---------|----------|----------|
| Firewall | Chỉ mở port cần thiết (BACnet/IP 47808, MQTT 8883, REST 443) | Listed | `nmap -p- <device-ip>` |
| SSH | Disable password auth, dùng key hoặc tắt | Disabled / key-only | `sshd -T \| grep PasswordAuthentication` |
| TLS 1.3 | Enforce TLS 1.3, disable TLS <1.2 | TLS 1.3 only | `openssl s_client -tls1_3` |
| Default credentials | Change default password trên first boot | Forced change | Login test |
| Audit logging | Syslog forward, log retention 90 ngày | Enabled | `journalctl` / remote syslog |
```

### 6.2 Network Deployment Guide

- Mô tả topology khuyến nghị: device trong OT network, REST/MQTT qua DMZ tới cloud.
- Firewall rules: chỉ cho phép BACnet/IP trong OT segment, MQTT/TLS ra cloud, REST/HTTPS từ Web IDE.
- Segmentation: thiết bị nên được cô lập trong VLAN riêng.

### 6.3 Certificate & Key Management

- Hướng dẫn import CA cert cho TLS (thiết bị giao tiếp cloud/Web IDE).
- Hướng dẫn thay thế certificate hết hạn.
- Hướng dẫn import GPG public key cho OTA package verification.

### 6.4 Logging & Audit

- Local log: `journald` với retention 90 ngày.
- Remote syslog: cấu hình địa chỉ syslog server qua Web IDE hoặc config file.
- Audit events: login, logout, config change, firmware update, reboot, alarm.

### 6.5 Backup & Restore

- Backup: configuration, certificates, user database.
- Restore procedure: factory reset → upload config → verify connection.
- Backup file được mã hóa và sign bởi device.

### 6.6 OTA Update Procedure

- Check firmware version hiện tại.
- Upload `.kxpkg` package qua Web IDE hoặc OTA server.
- Monitor update progress (A/B partition).
- Rollback nếu update fail.
- Verify version sau update.

### 6.7 Security Incident Response for Operators

- Phát hiện dấu hiệu bất thường (log cảnh báo, alarm).
- Quy trình thông báo: operator → system admin → Tech Lead.
- Evidence collection: export log, chụp ảnh màn hình, ghi nhận thời gian.

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-8 — Security Guideline for Integrators |
