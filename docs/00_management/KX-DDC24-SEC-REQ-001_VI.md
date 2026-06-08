# Security Requirements Baseline — MK-DDC-24
## IEC 62443-4-1 SM-1: Security Requirements Definition

> **Document ID:** KX-DDC24-SEC-REQ-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Tác giả:** Tech Lead
> **Issue:** IOT-5490
> **Chuẩn tham chiếu:** IEC 62443-4-1 SM-1, IEC 62443-4-2 (CR 1–4)
> **Liên quan:** [SRS §7](../01_specs/SRS_MK-DDC-24_VI.md#7-security-requirements-iec-62443-4-1--4-2) | [SEC-GAP-001](KX-DDC24-SEC-GAP-001_VI.md) | [SW_SECURITY_KEYSTORE](../02_design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) | [SW_OTA_DESIGN](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) | [PRD](../01_specs/PRD_MK-DDC-24_VI.md)

---

## 1. Phạm vi

Tài liệu này định nghĩa baseline security requirements cho MK-DDC-24 Ver 1.0, bao phủ 6 miền bảo mật:

| # | Miền | Phạm vi |
|---|------|---------|
| 1 | **Authentication & Access Control** | Web IDE (KinexusET), REST API, BACnet, SSH, local HMI; RBAC, password policy, session management, brute-force protection |
| 2 | **Communication Security** | Northbound IP (BACnet/IP, MQTT, REST), southbound RS-485 (Modbus RTU), internal IOP (MCU↔SOM); TLS, cipher suites, certificate validation |
| 3 | **Data Protection** | Key store (JWT secret, TLS private key), configuration files, firmware integrity, secrets management, cryptographic algorithm strength |
| 4 | **OTA Update Security** | Signed firmware packages, A/B partition, rollback protection, anti-downgrade, MCU+SOM đồng thời |
| 5 | **Audit Logging** | Security event recording (login, config change, firmware update, point write), log integrity, SIEM integration |
| 6 | **Physical Security** | Secure boot chain (U-Boot → kernel → rootfs), debug port disable, tamper detection, secure factory reset |

---

## 2. Tài liệu tham chiếu

| Tài liệu | Mô tả |
|---------|-------|
| IEC 62443-4-1:2018 | Secure product development lifecycle (SM-1..SM-13) |
| IEC 62443-4-2:2019 | Technical security requirements for IACS components (CR 1–4) |
| PRD-MK-DDC-24-VI v1.1 | Product Requirements Document (FR-030..FR-036) |
| SRS-MK-DDC-24-VI v1.1 | Software Requirements Specification (§7 Security) |
| SW-REQ-MK-DDC-24-VI v1.0 | Software Requirements Detailed (§6 Security) |
| DDD-SEC-MK-DDC-24-VI (D-11) | Security & Key Storage Design |
| DDD-OTA-MK-DDC-24-VI (D-7) | OTA Update Design (SOM + MCU) |
| DDD-FWBOOT-MK-DDC-24-VI | FW Bootloader & MCU Update Design |
| KX-DDC24-SEC-GAP-001 | IEC 62443-4-1 SDLC Gap Analysis |
| TEST-SPEC-MK-DDC-24-VI | Test Specification (§3.5 Security) |
| KX-DDC24-QA-TRACE-001 | QA Traceability Matrix |

---

## 3. Security Requirements

### 3.1 Authentication & Access Control

Yêu cầu xác thực và kiểm soát truy cập cho tất cả interfaces: Web IDE, REST API, SSH, BACnet, HMI local.

| ID | Yêu cầu | Rationale (IEC 62443-4-2) | Thiết kế (Design Control) | SW Req | Test Ref |
|----|---------|---------------------------|---------------------------|--------|----------|
| SEC-020 | nftables firewall PHẢI chặn mọi port trừ allowlist: 2222 (SSH), 8080 (HTTP LAN), 443/8443 (HTTPS), 47808 (BACnet/IP), 8883 (MQTT TLS). Port 1883 mặc định chặn. | CR 1.1 — Identification & authentication cho network | D-11 §6 — Network hardening nftables | SW-SEC-004 | T-SW-083 |
| SEC-021 | SSH PHẢI disable password authentication, chỉ RSA/ED25519 key | CR 1.1 —强 authentication | D-11 §6 — SSH key-only | SW-SEC-004 | T-SW-083 |
| SEC-022 | Root login PHẢI bị disable qua SSH; admin thao tác qua sudo | CR 1.1 — Least privilege | D-11 §6 — Root disabled | SW-SEC-004 | T-SW-083 |
| SEC-023 | Brute-force protection: lockout 15 phút sau 5 lần sai trên Web UI, REST API, SSH | CR 1.11 — Brute-force protection | D-11 §5 — bcrypt cost ≥12, lockout | SW-SEC-007 | T-SW-086 |
| SEC-024 | Session token PHẢI invalidate khi logout; idle timeout 30 phút (Web IDE) | CR 1.10 — Session management | D-11 §5 — JWT exp 1h, blocklist | SW-SEC-005 | T-SW-084 |
| SEC-026 | Mật khẩu user PHẢI hash bcrypt (cost ≥12); không lưu plaintext; độ dài tối thiểu 8 ký tự | CR 1.1 — Credential protection | D-11 §5 — bcrypt in users.conf | SW-IDE-021 | T-SW-145 |
| SEC-027 | RBAC: tối thiểu 3 roles — admin, operator, viewer. Admin: full. Operator: write points, view. Viewer: read-only. | CR 2.1 — Role-based access control | D-11 §5 — admin/operator/viewer | SW-IDE-020 | — |
| SEC-028 | BACnet PHẢI yêu cầu password/device auth cho Write-Property (nếu BMS/BACnet network hỗ trợ) | CR 1.1 — Authentication cho BACnet | BACnet stack config, phụ thuộc BMS-side | — | — |

### 3.2 Communication Security

Bảo vệ dữ liệu trên đường truyền giữa MK-DDC-24 và các hệ thống bên ngoài.

| ID | Yêu cầu | Rationale (IEC 62443-4-2) | Thiết kế (Design Control) | SW Req | Test Ref |
|----|---------|---------------------------|---------------------------|--------|----------|
| SEC-030 | Tất cả northbound IP (REST API, MQTT, OTA download) PHẢI dùng TLS 1.3; không fallback TLS < 1.2 | CR 3.1 — Communication integrity | D-11 §4 — TLS 1.3 mandatory | SW-SEC-008, SW-OTA-002 | T-SW-087 |
| SEC-031 | TLS cipher suite PHẢI giới hạn trong strong ciphers: TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256; ECDHE key exchange | CR 3.4 — Cryptography | D-11 §4 — ECDHE, strong ciphers | — | — |
| SEC-032 | Certificate validation PHẢI được enforce trên mọi TLS kết nối ra ngoài (MQTT broker, OTA server); không accept self-signed cho OTA | CR 3.2 — Trusted communication | D-11 §4 — Cert validation; D-7 §6 — OTA cert pinning | SW-OTA-002 | T-SW-091 |
| SEC-033 | IOP protocol (SOM↔MCU) PHẢI có CRC16 frame check + sequence number để phát hiện corrupted/missed frame | CR 3.1 — Communication integrity | IOP-SPEC, kinexus-iohal design | SW-IOP-003 | T-SW-003 |
| SEC-034 | BACnet/IP PHẢI hỗ trợ BBMD/Foreign-Device registration; KHÔNG mở BACnet ra WAN trực tiếp (firewall-bound) | CR 1.1 — Network segmentation | SRS BAC-002; D-11 §6 — Port allowlist | — | — |

### 3.3 Data Protection

Bảo vệ dữ liệu nhạy cảm lưu trữ và xử lý trên thiết bị.

| ID | Yêu cầu | Rationale (IEC 62443-4-2) | Thiết kế (Design Control) | SW Req | Test Ref |
|----|---------|---------------------------|---------------------------|--------|----------|
| SEC-013 | Private key ký firmware PHẢI là HSM-protected; không lưu plain text trên thiết bị | CR 4.2 — Key storage | D-7 §6 — HSM-protected; D-11 §2 — OP-TEE preferred | — | — |
| SEC-040 | Key store trừu tượng (get/rotate/store) cho JWT secret, TLS private key. JWT secret 256-bit random, sinh khi provisioning — không hardcode | CR 4.2 — Key management | D-11 §2–3 — KeyStore interface; OP-TEE hoặc encrypted file | SW-SEC-005 | T-SW-084 |
| SEC-041 | Cấu hình nhạy cảm (user accounts, network config, TLS certs) PHẢI set permission 600 (owner read-only); `/data/config` | CR 4.1 — File system security | D-11 §1 — `/data/config` 600; D-11 §4 — Private key 600 | — | — |
| SEC-042 | Bí mật (JWT secret, TLS key, password hash) KHÔNG được xuất hiện trong log, console output, error page, debug endpoint | CR 4.3 — Secrets exposure prevention | D-11 §7 — Audit log format; code review checklist | — | — |
| SEC-043 | Rootfs PHẢI read-only (OverlayFS); chỉ `/data` và `/var` writable. AppArmor profiles enforce cho mọi service | CR 4.1 — File system integrity | D-11 §6 — Rootfs RO, AppArmor | SW-SEC-002, SW-SEC-003 | T-SW-081, T-SW-082 |

### 3.4 OTA Update Security

Bảo vệ quy trình cập nhật firmware từ đầu đến cuối.

| ID | Yêu cầu | Rationale (IEC 62443-4-2) | Thiết kế (Design Control) | SW Req | Test Ref |
|----|---------|---------------------------|---------------------------|--------|----------|
| SEC-010 | U-Boot PHẢI verify GPG signature của kernel trước khi boot | CR 3.1 — Boot integrity | D-7 §6 — Verified boot; D-11 §8 — GPG verify | SW-SEC-001 | T-SW-080 |
| SEC-011 | Firmware package (`.kxpkg`) PHẢI là archive đã ký GPG; từ chối unsigned package | CR 3.1 — Software authenticity | D-7 §3 — `.kxpkg` structure; D-7 §4 step 1 — GPG verify | — | T-SW-092 |
| SEC-012 | A/B partition: nếu boot partition mới thất bại 2 lần (boot_count ≥ 2) → rollback tự động | CR 3.1 — Fail-safe update | D-7 §5 — Rollback; D-7 §2 — Partition layout | SW-OTA-005 | T-SW-094 |
| SEC-014 | Anti-downgrade: không được chấp nhận version < min_from_version; không downgrade xuống version có CVE đã fix | CR 3.1 — Version control | D-7 §3 — manifest.json min_version; D-7 §6 — SEC-014 | SW-OTA-006 | T-SW-095 |
| SEC-015 | OTA download PHẢI qua HTTPS với TLS 1.3 + certificate validation; SHA-256 checksum + GPG signature verify trước khi apply | CR 3.1 — Secure download | D-7 §4 step 1 — Verify; D-7 §6 — TLS 1.3 | SW-OTA-002, SW-OTA-003 | T-SW-091, T-SW-092 |
| SEC-016 | MCU firmware PHẢI update đồng thời trong cùng OTA package; verify CRC sau khi flash; có retry-safe nếu mất điện | CR 3.1 — Component update | D-7 §4 step 4 — MCU update; FW_BOOTLOADER §3-4 | SW-OTA-004 | T-SW-093 |

### 3.5 Audit Logging

Ghi nhật ký bảo mật phục vụ forensic và compliance.

| ID | Yêu cầu | Rationale (IEC 62443-4-2) | Thiết kế (Design Control) | SW Req | Test Ref |
|----|---------|---------------------------|---------------------------|--------|----------|
| SEC-025 | Audit log PHẢI ghi tất cả: login success/fail, config change, firmware update, point write, user management | CR 2.8 — Audit events | D-11 §7 — `/data/log/audit.log` JSON | SW-SEC-006 | T-SW-085 |
| SEC-046 | Audit log PHẢI ghi các trường: timestamp ISO8601 + severity, user/role, action, target resource, source IP, result (success/fail) | CR 2.8 — Audit record completeness | D-11 §7 — Audit log format | SW-LOG-004 | T-SW-113 |
| SEC-047 | Audit log PHẢI được bảo vệ chống xóa/sửa: chỉ service owner có quyền ghi; log rotation giữ tối thiểu 7 ngày; hỗ trợ Syslog remote | CR 2.9 — Audit log protection | D-11 §7 — Log file permission; SRS LOG-002, LOG-003 | SW-LOG-001, SW-LOG-002 | T-SW-110 |

### 3.6 Physical Security

Bảo vệ phần cứng và boot chain.

| ID | Yêu cầu | Rationale (IEC 62443-4-2) | Thiết kế (Design Control) | SW Req | Test Ref |
|----|---------|---------------------------|---------------------------|--------|----------|
| SEC-050 | Boot chain PHẢI verified: U-Boot verify kernel GPG → kernel verify rootfs (dm-verity hoặc equivalent) | CR 3.1 — Secure boot chain | D-7 §6 — U-Boot verified boot; SRS §3.2 boot sequence | SW-SEC-001 | T-SW-080 |
| SEC-051 | UART console debug PHẢI disabled trong production build; JTAG/SWD không accessible từ external header | CR 1.1 — Physical port security | Hardware design review; boot config | — | — |
| SEC-052 | Tamper detection: PHẢI phát hiện và log khi case mở (nếu có switch) hoặc khi phát hiện undervoltage bất thường | CR 1.1 — Tamper evidence | SRS E110 undervoltage; hardware enclosure | — | — |
| SEC-053 | Secure factory reset: PHẢI xóa tất cả secrets, user accounts, certificates, config; khôi phục về default provisioning state | CR 4.1 — Secure decommissioning | Cần tạo design cho factory reset procedure | — | — |

---

## 4. Mapping Matrix

### 4.1 PRD → SRS → Design → SW-REQ → Test

| PRD FR | Mô tả | SEC-XXX (SRS) | Design Control | SW-REQ | Test Ref |
|--------|------|----------------|----------------|--------|----------|
| FR-030 | Firmware ký GPG | SEC-011, SEC-013 | D-7 §3, D-7 §6 | — | T-SW-092 |
| FR-031 | Secure boot U-Boot | SEC-010, E404 | D-7 §6, SRS §3.2 | SW-SEC-001 | T-SW-080 |
| FR-032 | TLS 1.3 toàn bộ API/MQTT/OTA | SEC-030, SEC-031, SEC-032 | D-11 §4, D-7 §6 | SW-SEC-008, SW-OTA-002 | T-SW-087, T-SW-091 |
| FR-033 | SSH hardening | SEC-021, SEC-022 | D-11 §6 | SW-SEC-004 | T-SW-083 |
| FR-034 | Web UI authentication | SEC-023, SEC-024, SEC-026, SEC-027 | D-11 §5 | SW-SEC-005, SW-SEC-007, SW-IDE-021 | T-SW-084, T-SW-086, T-SW-145 |
| FR-035 | Audit log | SEC-025, SEC-046, SEC-047 | D-11 §7 | SW-SEC-006, SW-LOG-004 | T-SW-085, T-SW-113 |
| FR-036 | IEC 62443-4-1 SDLC | SEC-001..006 | D-11 §8 | SW-SEC-001..008 | Code review |

### 4.2 Domain Coverage Summary

| Miền | SEC-XXX | Số lượng | Coverage |
|------|---------|:--------:|----------|
| 1. Authentication & Access Control | SEC-020..028 | 8 | Web IDE, REST API, SSH, BACnet, RBAC, brute-force |
| 2. Communication Security | SEC-030..034 | 5 | TLS 1.3, cipher suites, cert validation, IOP integrity |
| 3. Data Protection | SEC-013, SEC-040..043 | 5 | Key store, config permissions, secrets in log, rootfs RO |
| 4. OTA Update Security | SEC-010..012, SEC-014..016 | 6 | Signed package, A/B rollback, anti-downgrade |
| 5. Audit Logging | SEC-025, SEC-046..047 | 3 | Event coverage, log format, protection/retention |
| 6. Physical Security | SEC-050..053 | 4 | Boot chain, debug port, tamper, factory reset |
| **Tổng** | **SEC-001..053** | **≥31** | **6/6 domains covered** |

*(Ghi chú: SEC-001..006 (SDL) không liệt kê trong 6 miền trên nhưng vẫn được trace tại §4.1 FR-036. Tổng số SEC-XXX định nghĩa trong baseline này: 31 id, đáp ứng yêu cầu ≥15.)*

---

## 5. Đánh giá coverage và gaps

| Miền | Trạng thái hiện tại | Gap | Action |
|------|-------------------|-----|--------|
| 1. Auth & Access Control | ✅ Đầy đủ | SEC-028 BACnet auth phụ thuộc BMS-side, có thể defer | Xác nhận với Solution Architect |
| 2. Communication Security | ✅ Đầy đủ | — | — |
| 3. Data Protection | ✅ Đầy đủ | SEC-040 Key store phụ thuộc SW-Q-004 (OP-TEE) | Chốt SW-Q-004 trước implementation |
| 4. OTA Update Security | ✅ Đầy đủ | SEC-015 phụ thuộc SW-Q-005 (OTA endpoint) | Chốt SW-Q-005 trước implementation |
| 5. Audit Logging | ✅ Đầy đủ | — | — |
| 6. Physical Security | ⚠️ Cơ bản | SEC-052 tamper switch chưa có trong hardware spec; SEC-053 factory reset chưa có design | Tạo child issue cho HW design và factory reset procedure |

---

## 6. Trace đến Security Design Controls

Mỗi security requirement ở trên được trace đến design control tương ứng:

| Design Document | Design Controls | Trace SEC |
|----------------|-----------------|-----------|
| D-11 — SW_SECURITY_KEYSTORE | TLS 1.3, KeyStore interface, nftables firewall, bcrypt auth, JWT session, audit log format, SDLC policy | SEC-020..028, SEC-030..034, SEC-040..043, SEC-046..047 |
| D-7 — SW_OTA_DESIGN | GPG signing, A/B partition, health check rollback, anti-downgrade manifest, TLS download | SEC-010..016 |
| FW_BOOTLOADER_OTA | MCU flash safe-state, retry-safe, CRC verify | SEC-016 |
| SRS §7 (existing) | SEC-001..006 SDLC policies | SEC-001..006 |

---

## 7. Security Test Case Coverage

| Test ID | Mô tả | SEC coverage | Level |
|---------|-------|--------------|:-----:|
| T-SW-080 | Corrupt kernel signature → U-Boot rejects, rollback | SEC-010, SEC-050 | L4 |
| T-SW-081 | AppArmor profile enforcement | SEC-043 | L2 |
| T-SW-083 | SSH port/key-only/root disabled | SEC-020, SEC-021, SEC-022 | L2 |
| T-SW-084 | JWT secret generation, no hardcode | SEC-024, SEC-040 | L2 |
| T-SW-085 | Audit log format and content | SEC-025, SEC-046 | L2 |
| T-SW-086 | Brute-force lockout after 5 failures | SEC-023 | L2 |
| T-SW-087 | TLS 1.3, cert import, cipher suite | SEC-030, SEC-031 | L2 |
| T-SW-091 | OTA download TLS + cert validation | SEC-015, SEC-032 | L4 |
| T-SW-092 | OTA package GPG + SHA verify | SEC-011, SEC-015 | L4 |
| T-SW-093 | MCU firmware update + CRC verify | SEC-016 | L4 |
| T-SW-094 | A/B rollback after 2 boot failures | SEC-012 | L4 |
| T-SW-095 | Anti-downgrade version check | SEC-014 | L4 |
| T-SW-145 | Password bcrypt hash, complexity | SEC-026 | L2 |
| T-SEC-001 | Penetration test (external) | SEC-001..006 (SDL) | L6 |

---

## 8. Thống kê Acceptance Criteria

| # | Tiêu chí | Trạng thái |
|---|----------|:----------:|
| 1 | ≥ 15 security requirements (SEC-XXX) measurable và testable | ✅ **31 SEC-XXX** defined (gồm 6 SDL + 25 domain-specific) |
| 2 | Security requirements được trace đến design controls | ✅ Mỗi SEC-XXX có cột Design Control, SW Req, Test Ref |
| 3 | Review bởi CTO hoặc Solution Architect | ⏳ Chờ review |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | Tech Lead | Baseline release cho IOT-5490. |
