# Configuration Management Plan — MK-DDC-24
## SM-13: Secure Configuration Management Plan Template

> **Document ID:** KX-DDC24-SEC-PLAN-002
> **Phiên bản:** 0.1 | 2026-06-02
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Owner:** Release + QA
> **Chuẩn liên quan:** IEC 62443-4-1 SM-13 (Configuration Management), ISO 10007, NIST SP 800-128 (Security-Focused Configuration Management)
> 📘 [docs/README](../../README.md)

---

## 1. Mục đích (Purpose)

Template này định nghĩa **Secure Configuration Baseline** và quy trình quản lý cấu hình cho sản phẩm MK-DDC-24. Đảm bảo mọi release artifact có cấu hình bảo mật nhất quán, được kiểm tra, và có audit trail. Tuân thủ IEC 62443-4-1 SM-13 — Configuration Management.

## 2. Đầu vào (Input)

| # | Input | Nguồn |
|---|-------|-------|
| 1 | Product version manifest | `shared/version.h`, `.kxpkg` metadata |
| 2 | Network port & service inventory | `design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md`, firewall config |
| 3 | TLS certificate & JWT key configuration | `design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md` |
| 4 | User account & role configuration | `SRS_MK-DDC-24_VI.md` SEC-xxx, auth design |
| 5 | System image / rootfs build configuration | `infra/debian-image/` |
| 6 | CI/CD pipeline configuration | `infra/ci/` |
| 7 | SBOM (Software Bill of Materials) | `infra/scripts/gen-sbom` |

## 3. Đầu ra (Output)

| # | Output | Định dạng |
|---|--------|-----------|
| 1 | Secure configuration baseline checklist | Bảng checklist (file này) |
| 2 | Configuration audit report (per release) | `.md` / CI artifact |
| 3 | Baseline change log | Phần trong file / CHANGELOG |
| 4 | Configuration drift report (nếu phát hiện) | Issue / alert |
| 5 | Release configuration sign-off | Issue comment / signature |

## 4. Owner

| Role | Trách nhiệm |
|------|------------|
| **Release** | Duy trì baseline checklist, verify config trước release, ghi nhận thay đổi |
| **QA** | Audit config compliance per release, report drift |
| **Tech Lead** | Phê duyệt baseline change, approve exception |
| **DevOps** | Đảm bảo CI/CD pipeline tạo artifact đúng baseline config |
| **Developer Team** | Tuân thủ baseline khi thay đổi service config |
| **CTO** | Phê duyệt release baseline exception |

## 5. Review cycle

| Gate | Thời điểm | Người review | Tiêu chí pass |
|------|-----------|-------------|---------------|
| Baseline establishment | Đầu mỗi release cycle | Tech Lead + Release | Checklist đầy đủ, reflect đúng product config |
| Pre-release audit | Trước P7 (Release gate) | QA | Checklist items pass hoặc exception approved |
| Change review | Khi có config thay đổi | Tech Lead | Change documented, impact assessed, version bumped |
| Post-release | Sau release | QA + Release | Config drift detected, remediation plan |

## 6. Secure configuration baseline checklist

### 6.1 Version & Product Identity

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| V-01 | Product version | SemVer từ `shared/version.h` | `cat shared/version.h` | |
| V-02 | Build timestamp | UTC timestamp trong image | `cat /etc/build-info` | |
| V-03 | Image checksum | SHA-256 checksum published | `sha256sum <image>` | |
| V-04 | SBOM version | Match product version | SBOM report | |
| V-05 | CHANGELOG cập nhật | Mọi change từ version trước reflected | `CHANGELOG.md` | |

### 6.2 Network & Ports

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| N-01 | Services listening list | Chỉ: BACnet/IP (:47808), MQTT (:8883), REST (:443) | `ss -tlnp` | |
| N-02 | SSH port | 22 (disabled by default) hoặc custom port | `systemctl is-enabled ssh` | |
| N-03 | Firewall enabled | Default DROP policy | `iptables -L` | |
| N-04 | Web IDE access | HTTPS only, port 443 | `curl -I https://localhost` | |
| N-05 | MQTT encryption | TLS 1.3 only, port 8883 | `openssl s_client -connect localhost:8883 -tls1_3` | |

### 6.3 TLS & Certificates

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| T-01 | TLS version | Min TLS 1.2, prefer TLS 1.3 | `openssl s_client -tls1_2` | |
| T-02 | TLS ciphers | IANA recommended: ECDHE + AEAD | `openssl ciphers -v 'ECDHE+AESGCM'` | |
| T-03 | Certificate expiration | ≥ 30 ngày còn hạn | `openssl x509 -checkend 2592000` | |
| T-04 | Certificate chain đầy đủ | End-entity + intermediate + root | `openssl verify -CAfile ca.pem cert.pem` | |
| T-05 | Private key permission | 600, owner root | `stat -c %a <key>` | |
| T-06 | JWT signing key | RSA 2048 hoặc EC P-256, rotated theo policy | Key store audit | |

### 6.4 User Accounts & Authentication

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| U-01 | Default admin password | Forced change on first boot | Auth test | |
| U-02 | No hardcoded credentials | No plaintext password trong image | gitleaks / secret scan | |
| U-03 | Password policy | Min 8 chars, complexity | Config file | |
| U-04 | Session timeout | Web IDE: 30 min idle | Test | |
| U-05 | Failed login lockout | 5 attempts → 5 min lock | Test | |
| U-06 | SSH key only (password auth disabled) | `PasswordAuthentication no` | `sshd -T` | |

### 6.5 System Hardening

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| S-01 | Root filesystem | Read-only (squashfs / overlay) | `mount \| grep " / "` | |
| S-02 | Unnecessary packages removed | Minimal image, no compiler/ dev tools | `dpkg -l` review | |
| S-03 | ASLR enabled | `kernel.randomize_va_space = 2` | `sysctl kernel.randomize_va_space` | |
| S-04 | Core dumps disabled | `ulimit -c 0` | `ulimit -c` | |
| S-05 | auditd running | Enabled và logging | `systemctl status auditd` | |
| S-06 | System time synchronized | NTP config valid | `timedatectl status` | |

### 6.6 OTA & Update

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| O-01 | OTA package signed | GPG signature present | `gpg --verify <package>` | |
| O-02 | Anti-downgrade enabled | Version check before install | OTA test | |
| O-03 | Rollback partition healthy | Both A/B partitions valid | OTA status check | |
| O-04 | Update server URL | HTTPS, valid cert | Config file | |

### 6.7 CI/CD & Artifact Integrity

| # | Item | Baseline value / rule | Verification | Pass/Fail |
|---|------|---------------------|:------------:|:---------:|
| C-01 | CI pipeline passes (fw/be/fe/security) | All required checks green | GitHub Actions status | |
| C-02 | Artifact checksum published | SHA-256 trong release note | Release note | |
| C-03 | SBOM generated | CycloneDX format | SBOM artifact | |
| C-04 | Source tag signed | Git tag GPG-signed | `git tag --verify <tag>` | |
| C-05 | Dependency scan no new CVE ≥ High | Compare với baseline | `security.yml` artifact | |

## 7. Baseline change process

1. Mọi thay đổi baseline (port, service, TLS version, user policy) → ghi nhận trong phần này.
2. Change cần Tech Lead phê duyệt, cập nhật version baseline.
3. Baseline change → cập nhật CHANGELOG + trace matrix.
4. Exception chỉ được CTO approve, ghi rõ rationale và expiration date.

### 7.1 Baseline change log

| Version | Ngày | Người | Thay đổi | Approved by |
|---------|------|-------|----------|-------------|
| 0.1 | 2026-06-02 | DeveloperTeam | Baseline initial | Tech Lead |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 0.1 | 2026-06-02 | DeveloperTeam | Tạo template SM-13 — Secure Configuration Management Plan |
