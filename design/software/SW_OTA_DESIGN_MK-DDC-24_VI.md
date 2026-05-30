# OTA Update Design (SOM + MCU) — MK-DDC-24
## D-7 — `kinexus-ota`

> **Document ID:** DDD-OTA-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [spec/README](../../spec/README.md)
> **Trace:** `OTA-001..008`, `SW-OTA-001..008`, `FW-OTA-001..005`, `SEC-010..014`
> **Đi kèm:** [FW_BOOTLOADER_OTA](../firmware/FW_BOOTLOADER_OTA_MK-DDC-24_VI.md) (phần MCU)

---

## 1. Mục tiêu
Cập nhật **đồng thời firmware SOM (Debian) + firmware MCU** từ 1 gói, an toàn (verify chữ ký), có **rollback tự động**, downtime ≤ 60s.

## 2. Sơ đồ phân vùng (A/B)
```
eMMC:
  ┌── boot (U-Boot, verified)
  ├── rootfs_A   ◄─ active
  ├── rootfs_B   ◄─ standby (ghi bản mới vào đây)
  ├── /data      (config, log, programs — KHÔNG đụng khi OTA)
  └── env        (cờ active partition, boot_count)
```

## 3. Cấu trúc gói OTA (`.kxpkg` = tar đã ký)
```
update.kxpkg
├── manifest.json     # version, sha256 từng phần, min_version (chống downgrade)
├── rootfs.img        # ảnh hệ thống SOM mới
├── mcu_fw.bin        # firmware MCU mới
└── signature.gpg     # chữ ký GPG của manifest
```
`manifest.json`:
```json
{ "version":"1.1.0", "min_from_version":"1.0.0",
  "rootfs_sha256":"…", "mcu_fw_sha256":"…", "mcu_fw_crc32":"…",
  "build_date":"2026-06-01", "notes":"…" }
```

## 4. Luồng OTA (sequence)
```
[Admin] POST /ota/upload (hoặc kinexus-ota tải HTTPS TLS1.3 từ server)
   │
   ▼
1. VERIFY: kiểm GPG signature(manifest) + sha256(rootfs,mcu) + min_from_version
   │  fail → abort, log E501/E403, giữ nguyên hệ thống
   ▼
2. WRITE: ghi rootfs.img → phân vùng standby (B). /data không đụng.
   ▼
3. (Admin) POST /ota/apply  → bắt đầu cửa sổ downtime
   ▼
4. MCU UPDATE: đưa I/O về safe-state → nạp mcu_fw.bin qua UART bootloader
   │  (xem FW_BOOTLOADER_OTA). verify CRC. fail → giữ FW MCU cũ.
   ▼
5. SWITCH: set env active=B, boot_count=0, "trial boot" flag
   ▼
6. REBOOT (downtime bắt đầu, mục tiêu ≤60s)
   │
   ▼
7. U-Boot verify chữ ký kernel B → boot B
   ▼
8. HEALTH CHECK (sau boot): services READY trong 60s + IOP OK?
   ├─ OK  → commit: active=B cố định, xoá trial flag. E504 success.
   └─ FAIL (hoặc boot fail 2 lần) → U-Boot/loader tự rollback về A. E503. alarm.
```

## 5. Rollback
- `boot_count` tăng mỗi lần thử boot partition mới; **2 lần fail → rollback** về partition trước (SEC-012, OTA-005).
- Health check fail (service không READY, IOP fault kéo dài) cũng kích rollback.
- Sau rollback: ghi log version trước/sau + lý do (OTA-008), gửi alarm.

## 6. Bảo mật (IEC 62443)
- Chữ ký GPG, **private key HSM-protected** (SEC-013) — không nằm trên thiết bị.
- TLS 1.3 + cert validation khi tải; **không** chấp nhận self-signed cho OTA server (SW-OTA-002).
- **Chống downgrade:** từ chối version < `min_from_version` hoặc version có CVE đã fix (SEC-014).
- U-Boot verified boot kernel (SEC-010, E404).

## 7. Timing budget (downtime ≤ 60s)
| Bước | Thời gian |
|------|-----------|
| Verify + write standby | nền, **không** tính downtime (OTA-006) |
| MCU flash + verify | ~5–10s (trong downtime) |
| Reboot SOM → services READY | ~25–35s |
| Health check | ~10s |
| **Tổng downtime** | **≤ 60s** (OTA-007) |

## 8. Triển khai (kinexus-otad)
- Python service chạy `root`, restart on-failure.
- State machine: `idle→downloading→verifying→writing→applying→rebooting→{success|failed|rolledback}` (khớp `/ota/status` ở D-4).
- Phụ thuộc: cờ partition (U-Boot env qua `fw_setenv/fw_printenv`), `kinexus-io-driver` (để safe-state MCU trước khi flash).

## 9. Open issues
| ID | Vấn đề | Owner |
|----|--------|-------|
| SW-Q-005 | OTA server endpoint (cert pinning) | DevOps |
| — | Đường UART nạp MCU: tái dùng IOP hay USART2 | FW |

## 10. Trace REQ
`OTA-001..008`, `SW-OTA-001..008`, `FW-OTA-001..005`, `NFR-007`, `T-SW-090..097`.

---
**Rev** 1.0 | 2026-05-30
