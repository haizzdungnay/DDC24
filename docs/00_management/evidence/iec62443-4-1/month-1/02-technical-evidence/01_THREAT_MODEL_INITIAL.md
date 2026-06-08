# Technical Evidence: Threat Model — Initial Scoping

> **Document ID:** IEC62443-M1-TM-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Initial scoping — template ready, full threat modeling session pending
> **Owner:** Tech Lead + Solution Architect
> **Chuẩn:** IEC 62443-4-1 SM-2 | STRIDE
> **Template:** [KX-DDC24-SEC-RPT-001](../../../../security_process_templates/KX-DDC24-SEC-RPT-001_VI.md)

---

## 1. Phạm vi Threat Model

Threat model áp dụng cho các thành phần sau của hệ thống MK-DDC-24:

| Thành phần | Mô tả | Attack Surface |
|-----------|-------|---------------|
| **Device (MK-DDC-24 hardware)** | MCU (STM32G4) + SOM (Radxa CM3) | Physical ports, debug interface (JTAG/SWD), UART, USB, SD card, power |
| **BACnet/IP interface** | BACnet/IP trên port 47808 (Ethernet/WiFi) | BACnet scan, service abuse, write-property, device discovery |
| **MQTT agent** | MQTT/TLS tới cloud broker port 8883 | Unauthorized subscribe/publish, topic enumeration, replay |
| **REST API** | FastAPI trên port 443 (HTTPS) | Injection, auth bypass, rate limiting, brute force |
| **Web IDE** | Svelte SPA frontend | XSS, CSRF, session hijacking, clickjacking |
| **OTA update** | A/B partition + `.kxpkg` signed package | Package manipulation, replay, downgrade, MITM |
| **Cloud/OTA server** | OTA server + CDN (future) | Server compromise, supply chain, CDN hijack |
| **Firmware** | MCU firmware + SOM Debian image | Binary analysis, backdoor, hardcoded key, reverse engineering |

## 2. Data Flow Context (sơ bộ)

```
[Internet/Cloud]
    |
    ├── OTA Server ──TLS──► Device (SOM)
    ├── MQTT Broker ──TLS──► Device (SOM)
    └── Web IDE Browser ──HTTPS──► Device (SOM)
                                      |
[Operator] ──WiFi/Ethernet──► Device (SOM) ──BACnet/IP──► [BMS]
                                      |
                               [MCU] ──UART IOP── [I/O Board]
                                      |
                               [Sensors/Actuators]
```

**Trust boundaries:**
- Boundary 1: Internet ─ TLS ─ Device
- Boundary 2: SOM ─ UART ─ MCU
- Boundary 3: Device ─ BACnet/IP ─ BMS network
- Boundary 4: Physical device boundary (ports, debug)

## 3. Assets

| Asset | Type | Confidentiality | Integrity | Availability |
|-------|------|:---------------:|:---------:|:------------:|
| Firmware image | Data / Code | H | H | M |
| Configuration | Data | M | H | H |
| TLS private keys | Key | H | H | M |
| JWT signing key | Key | H | H | H |
| User credentials | Data | H | H | M |
| Audit log | Data | M | H | M |
| I/O data | Data | L | H | H |
| PLC program | Data / Code | M | H | H |
| OTA update package | Code | L | H | H |
| Customer data (BMS) | Data | M | H | M |

## 4. Threat Matrix (STRIDE — Initial)

| # | Element | STRIDE | Threat Description | Risk | Mitigation | SR |
|---|---------|--------|-------------------|:---:|------------|:--:|
| T-001 | OTA update channel | Tampering | Attacker modifies `.kxpkg` in transit | H | Signed package (GPG), TLS 1.3, integrity verification before apply | SR-001 |
| T-002 | OTA update | DoS | Malformed package causes device brick | H | A/B partition, health check, rollback after 2 failures | SR-007 |
| T-003 | OTA update | Elevation | Malicious package gains persistence | H | Signed package, verified boot, anti-downgrade | SR-001 |
| T-004 | Web IDE login | Spoofing | Attacker brute-forces or steals JWT | H | JWT expiry, rate limit, bcrypt password, lockout | SR-003 |
| T-005 | Web IDE session | Tampering | Session hijacking via XSS/CSRF | H | httpOnly cookies, CSRF token, Content-Security-Policy | SR-003 |
| T-006 | REST API | Spoofing | API request without valid auth | H | JWT required, API key, rate limiting | SR-003, SR-010 |
| T-007 | REST API | Information Disclosure | Error message leaks stack trace/internal info | M | Error handling: generic message, log detail internally | SR-010 |
| T-008 | MQTT | Tampering | Attacker publishes malicious data to topic | H | TLS 1.3, client certificate auth, topic ACL | SR-009 |
| T-009 | MQTT | DoS | Unauthorized client floods broker connection | M | Rate limit, connection limit per client | SR-009 |
| T-010 | BACnet/IP | Spoofing | Unauthorized BACnet device discovers and writes | H | BACnet password, network segmentation, firewall | SR-011 |
| T-011 | BACnet/IP | DoS | BACnet scan/service abuse causes device overload | M | Rate limiting, BACnet COV throttle | SR-011 |
| T-012 | Physical | Tampering | Attacker connects to debug UART/JTAG | H | Disable debug in production, secure boot, encrypted storage | SR-004 |
| T-013 | Physical | Information Disclosure | Attacker reads flash via debug interface | H | Flash read protection, secure boot, key store | SR-008 |
| T-014 | Device | Elevation | Privilege escalation via OS vulnerability | H | OverlayFS read-only rootfs, AppArmor, minimal services | SR-005 |
| T-015 | Dependency | Tampering | Compromised OSS library introduced | H | SBOM tracking, CVE scan (trivy/grype), dependency review | SR-014 |

## 5. Mitigation Status

| Mitigation | Status | Owner |
|-----------|:------:|-------|
| Signed firmware + secure boot | ✅ Designed | Solution Architect |
| TLS 1.3 enforced | ✅ Designed | Solution Architect |
| JWT auth + RBAC | ✅ Designed | Solution Architect |
| Key store design | 🔶 In design (SW-Q-004 pending) | Solution Architect |
| OTA A/B + rollback | ✅ Designed | Solution Architect |
| OTA server endpoint | 🔶 In design (SW-Q-005 pending) | Solution Architect |
| Firewall default DROP | ✅ Designed | Solution Architect |
| BACnet/IP network segmentation | 📋 Planned | Tech Lead |
| Audit logging | ✅ Designed | Solution Architect |
| Debug interface disabled (prod) | 📋 Planned | Tech Lead |
| AppArmor / SELinux | 📋 Planned | Tech Lead |
| Read-only rootfs | ✅ Designed | Solution Architect |
| CVE scanning pipeline | ✅ Designed | DevOps |

## 6. Next Steps

1. Tổ chức threat modeling session với Tech Lead + Solution Architect (Month 1-2)
2. Hoàn thiện DFD diagrams (PlantUML)
3. Phê duyệt threat model trước P5 gate (Security implementation)
4. Cập nhật SR mapping khi threat model hoàn chỉnh

## References

- STRIDE template: [`KX-DDC24-SEC-RPT-001`](../../../../security_process_templates/KX-DDC24-SEC-RPT-001_VI.md)
- Gap analysis: [`KX-DDC24-SEC-GAP-001`](../../../../KX-DDC24-SEC-GAP-001_VI.md) (SM-2 section)
- Open issues: [`SW-Q-004`, `SW-Q-005`](../../../../../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md)
