# Security & Key Storage Design — MK-DDC-24
## D-11 — `kinexus-sec` (trong agent)

> **Document ID:** DDD-SEC-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [spec/README](../../spec/README.md)
> **Trace:** `SEC-001..025`, `SW-SEC-001..008` · IEC 62443-4-1/4-2

---

## 1. Tài sản cần bảo vệ (assets)
| Tài sản | Lưu ở | Rủi ro nếu lộ |
|---------|-------|---------------|
| JWT signing secret | key store | giả token, chiếm quyền API |
| TLS private key (REST/MQTT) | `/data/certs/` | MITM |
| GPG public key (verify OTA) | rootfs (read-only) | (chỉ public, không bí mật) |
| Mật khẩu user | `users.conf` (bcrypt) | brute-force |
| Cấu hình nhạy cảm | `/data/config` (600) | rò rỉ thông tin |

## 2. Quyết định key store (SW-Q-004)
Radxa CM3 **không có HSM rời**. Ba phương án:
| Phương án | Bảo vệ | Đánh giá |
|-----------|--------|----------|
| (A) **OP-TEE / ARM TrustZone** | khóa trong TEE, userspace không đọc raw | **ưu tiên** nếu RK3566 TrustZone hoạt động ổn |
| (B) **TPM rời (SPI/I2C)** | chip riêng | thêm BOM + chân; chắc chắn |
| (C) **Encrypted /data + key dẫn xuất từ eMMC CID + device secret** | phần mềm | yếu nhất, fallback |

> **Chốt trong DP-2.** Tài liệu thiết kế theo (A) OP-TEE, có fallback (C). Interface key store trừu tượng để đổi backend.

## 3. Interface key store (trừu tượng)
```python
class KeyStore:
    def get_jwt_secret() -> bytes        # tạo lần đầu (provisioning), không hardcode
    def get_tls_key(name) -> bytes
    def store(name, secret) -> None      # ghi an toàn (TEE/encrypted)
    def rotate(name) -> None
```
- JWT secret **sinh khi provisioning** (random 256-bit), không bao giờ commit/log (SW-SEC-005).

## 4. TLS
- TLS **1.3 bắt buộc**, không fallback 1.2 (MQ-002). Ciphers mạnh, ECDHE.
- Cert mặc định self-signed (sinh khi first boot); cho import cert doanh nghiệp/LetsEncrypt (SW-SEC-008).
- Private key quyền 600, owner service; lưu qua key store nếu TEE sẵn.

## 5. Xác thực & phiên
- Web UI: bcrypt (cost ≥12); **lockout 15' sau 5 lần sai** (SEC-023, E402); session idle 30' (IDE-031).
- REST: JWT HS256, exp 1h; logout → blocklist; verify chữ ký + exp mỗi request.
- Roles: admin/operator/viewer (SW-IDE-020).

## 6. Network hardening (SEC-020..022)
```
nftables: chặn tất cả, chỉ mở:
  2222/tcp  SSH (key-only, root disabled, đổi từ 22 khi provisioning)
  443,8443/tcp  HTTPS (REST + Web IDE redirect)
  8080/tcp  HTTP (CHỈ LAN commissioning VLAN; DMZ chặn)
  47808/udp BACnet/IP
  8883/tcp  MQTT over TLS   (1883 plaintext MẶC ĐỊNH CHẶN)
  (KHÔNG mở 502 — DDC không là Modbus TCP slave; RS-485 là RTU master, không qua IP)
```
- AppArmor profile enforce cho mọi service (SW-SEC-002).
- Rootfs read-only; chỉ `/data`,`/var` ghi (SW-SEC-003).

## 7. Audit log (SEC-025, SW-SEC-006)
Ghi `/data/log/audit.log` (JSON line) mọi: login success/fail, đổi config, ghi point/force I/O, OTA, đổi user.
```json
{"ts":"2026-06-01T10:00:00+07:00","user":"admin","action":"write_point","target":"AO1","value":5.0,"src_ip":"10.0.0.5"}
```

## 8. SDLC bảo mật (SEC-001..006) — CI bắt buộc
- Static analysis (cppcheck/clang-tidy/semgrep), dependency scan (trivy/grype), SBOM mỗi release.
- CVE ≥ 7.0 vá trước ship (NFR-006); 4.0–6.9 trong 30 ngày.
- Pentest trước mỗi major release (SEC-004, T-SEC-001).

## 9. Trace REQ
`SEC-001..025`, `SW-SEC-001..008`, `NFR-006`, `SW-Q-004`.

---
**Rev** 1.0 | 2026-05-30
