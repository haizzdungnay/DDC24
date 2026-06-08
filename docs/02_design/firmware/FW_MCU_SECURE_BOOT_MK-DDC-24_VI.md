# MCU Secure Boot Design — MK-DDC-24
## Custom bootloader: ECDSA verify + anti-downgrade + decrypt (P5)

> **Document ID:** DDD-MCU-SECBOOT-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Draft
> **Tác giả:** Tech Lead
> **Trace:** `SEC-010..014`, `SEC-050`, `SEC-051`, `SW-OTA-004`, `FW-OTA-001..005`
> **Liên quan:** [FW_BOOTLOADER_OTA](FW_BOOTLOADER_OTA_MK-DDC-24_VI.md) | [FW_DDD](FW_DDD_MK-DDC-24_VI.md) | [SW_OTA_DESIGN](../software/SW_OTA_DESIGN_MK-DDC-24_VI.md) | [SEC-SUP-001 §9.4](../../00_management/KX-DDC24-SEC-SUP-001_VI.md)

---

## 1. Mục đích & Phạm vi

Thiết kế MCU secure boot cho STM32G0B1RBT6 trên MK-DDC-24 Ver 1.0, bao gồm:

| Thành phần | Mô tả |
|-----------|-------|
| **Custom bootloader** | Second-stage bootloader tại flash sector 0 — xác thực firmware trước khi chạy |
| **Firmware image signing** | ECDSA/secp256r1 signature scheme — sign trên build server, verify trong bootloader |
| **Bootloader verification** | Signature → version (anti-downgrade) → decrypt → jump |
| **Key management** | MCU ECDSA key pair: private trên HSM, public nhúng trong bootloader |
| **RDP Level 1** | Bảo vệ flash khỏi debug port readout (tài liệu riêng) |

**Không bao gồm:** SOM secure boot (U-Boot verified boot — đã có D-7 §6), GPG key ceremony (SEC-013), RDP provisioning procedure (tài liệu riêng).

**Target prototype:** P5 — Prototype 5 (Sprint 3-4).

---

## 2. Kiến trúc tổng thể

### 2.1 Vị trí trong boot chain

```
RESET
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ STM32 ROM Bootloader / Flash entry                  │
│ (BOOT0=0 → 0x08000000; BOOT0=1 → ROM sys bootloader)│
└─────────┬───────────────────────────────────────────┘
          │ (BOOT0=0)
          ▼
┌─────────────────────────────────────────────────────┐
│ Custom Secure Bootloader (0x08000000)                │  ⬅ This design
│ • ECDSA verify firmware signature                    │
│ • Anti-downgrade version check                       │
│ • AES-128-CBC decrypt (optional)                     │
│ • Set VTOR → jump to app                             │
└─────────┬───────────────────────────────────────────┘
          │ (signature OK)
          ▼
┌─────────────────────────────────────────────────────┐
│ FreeRTOS Application (0x08004000)                    │
│ • IOP communication                                  │
│ • ADC sampling, DAC output, DO control               │
│ • Diagnostics, watchdog                               │
└─────────────────────────────────────────────────────┘
```

### 2.2 Nguyên tắc thiết kế

1. **ROM bootloader là bất khả xâm phạm**: STM32 ROM system bootloader không thể đọc/sửa. Nó là first-stage loader tuyệt đối tin cậy — dùng để nạp firmware qua UART (AN3155).
2. **Custom bootloader là trusted**: Được flash tại nhà máy, protected bởi RDP Level 1. Không thể thay đổi sau production (trừ khi mở RDP → erase toàn bộ flash).
3. **Application là untrusted cho đến khi được verify**: Bootloader kiểm tra chữ ký trước mỗi lần boot.

---

## 3. Flash Layout

```
Address         Size      Content
─────────────── ───────── ──────────────────────────────────────
0x08000000      8 KB      Custom Secure Bootloader
                           (ECDSA verify + version check +
                            AES decrypt if encrypted image)
0x08002000      4 KB      Reserved / Bootloader data
                           (anti-downgrade version record,
                            boot counter, fault flags in SRAM backup)
0x08003000      256 B     Firmware Image Header
0x08003100      ~114 KB   Firmware Application
                           (FreeRTOS kernel + tasks + drivers)
0x0801F000      4 KB      Firmware Signature Block
                           (ECDSA signature r||s, 64 bytes)
─────────────── ───────── ──────────────────────────────────────
Total Flash: 128 KB
Bootloader:  8 KB  (6.25%)
  App+Header: ~118 KB
  Signature:  4 KB (spare sector)
```

> **Lưu ý:** STM32G0B1 có flash sector 0 = 8 KB (0x08000000–0x08001FFF), sector 1 = 8 KB... Sử dụng sector 0 riêng cho bootloader.

### 3.1 Firmware Image Header (at 0x08003000)

```c
typedef struct __attribute__((packed)) {
    uint32_t magic;              // 0xSECB0001 ('SECB' little-endian)
    uint32_t version;            // 0xMMmmpp (major.minor.patch)
    uint32_t image_size;         // bytes of application firmware
    uint32_t image_crc32;        // CRC-32 of application firmware
    uint32_t min_hw_version;     // minimum HW compat (0xG0B1 = STM32G0B1)
    uint32_t flags;              // bit[0]=encrypted, bit[1]=delta
    uint32_t reserved[8];        // future use
    uint8_t  signature[64];      // ECDSA secp256r1 signature (r||s)
    uint8_t  reserved2[64];      // future use
} fw_header_t;                   // total: 256 bytes
```

### 3.2 Signed Firmware Image Format (build output)

```
mcu_fw_v1.2.3.bin
┌──────────────────────────────┐
│ Firmware Header (256B)       │
│  magic, version, size, crc,  │
│  flags, signature, reserved  │
├──────────────────────────────┤
│ Firmware Body (~N KB)        │
│  FreeRTOS ARM binary         │
│  (optionally AES-128-CBC     │
│   encrypted)                  │
├──────────────────────────────┤
│ Signature Block (256B)       │
│  ECDSA secp256r1 sig         │
│  (64 bytes) + padding        │
└──────────────────────────────┘
```

---

## 4. Bootloader Design

### 4.1 Bootloader Flow

```
Reset (BOOT0=0)
  │
  ▼
[1] SystemInit: clock, IWDG, GPIO (FAULT_OUT=HIGH)
  │
  ▼
[2] Read Image Header at 0x08003000
  ├─ magic == 0xSECB0001? ──► OK
  └─ NO ──► FAULT (blink LED, FAULT_OUT HIGH, halt)
  │
  ▼
[3] Verify ECDSA signature
  ├─ Compute SHA-256 hash của header[0..63] + image body
  │  (bỏ qua signature fields trong header)
  ├─ ECDSA_verify(public_key, hash, signature)
  ├─ PASS ──► tiếp
  └─ FAIL ──► log fault (blink code 3x), halt
  │
  ▼
[4] Anti-downgrade version check
  ├─ Read stored version từ SRAM backup / flash reserved area
  ├─ header.version >= stored_version?
  ├─ YES ──► tiếp
  └─ NO  ──► log fault (blink code 4x), halt
  │
  ▼
[5] Decrypt (if encrypted flag set)
  ├─ Derive AES key từ device unique ID (UDID) + HUK
  ├─ AES-128-CBC decrypt image body (in-place)
  └─ Verify CRC-32 sau decrypt
  │
  ▼
[6] CRC-32 integrity check
  ├─ Compute CRC-32 of image body
  ├─ Match header.image_crc32?
  ├─ YES ──► tiếp
  └─ FAIL ──► log fault (blink code 5x), halt
  │
  ▼
[7] Write anti-downgrade version record
  ├─ Update stored version = header.version
  │  (trong backup SRAM và/hoặc flash reserved sector)
  │
  ▼
[8] Prepare & jump to application
  ├─ Set VTOR = 0x08003000 + offset(vector_table_in_header)
  ├─ Set MSP = application's stack pointer
  ├─ FAULT_OUT = LOW (báo CM3 boot OK)
  └─ Jump to application reset handler
```

### 4.2 Bootloader Components

| Component | Vai trò | Nguồn |
|-----------|---------|-------|
| **SHA-256** | Hash image để verify signature | STM32 HW crypto (nếu có) hoặc TinyCrypt SW |
| **ECDSA verify** | secp256r1 verify (>1KB flash, ~500ms @64MHz) | TinyCrypt / Micro-Ecc |
| **AES-128-CBC decrypt** | Decrypt image (nếu encrypted) | STM32 AES peripheral hoặc TinyCrypt |
| **CRC-32** | Integrity check sau decrypt | STM32 CRC unit (HW) |
| **VTOR** | Vector Table Offset Register | Cortex-M0+ system control |

> **Lựa chọn thư viện crypto:** TinyCrypt (ưu tiên — footprint nhỏ, Apache 2.0) hoặc micro-ecc (bởi Kenneth MacKay — public domain, chỉ ECDSA). Cả hai đều chạy trên Cortex-M0+. STM32 HAL không có sẵn ECDSA verify.

### 4.3 Bootloader Constraints

| Constraint | Giá trị | Lý do |
|-----------|---------|-------|
| Max bootloader flash | 8 KB (sector 0) | STM32G0B1 flash sector size |
| Max boot time | < 2s tại 64MHz | Toàn bộ verify < 2s, application start ≤ 5s |
| RAM usage | < 4 KB | Dùng chung SRAM, trả lại cho app sau boot |
| Crypto lib flash | ~3-4 KB | TinyCrypt ECDSA verify + SHA-256 |
| Bootloader stack | 256 bytes | Tối thiểu — không có FreeRTOS |
| IWDG timeout | 4s | Cho phép boot hoàn tất (2s) + margin |

---

## 5. Key Management

### 5.1 Key Hierarchy

```
Build Server / HSM
  │
  ├── MCU Signing Private Key (ECDSA secp256r1)
  │   ├── Dùng: ký firmware image tại build time
  │   ├── Lưu: HSM (YubiHSM / Nitrokey / GPG smartcard)
  │   └── Backup: Offline, split-knowledge, key ceremony
  │
  └── MCU Key Encryption Key (KEK)
      ├── Dùng: mã hóa AES key cho image encryption
      └── Lưu: HSM (cùng HSM với signing key)
```

### 5.2 Public Key in Bootloader

```
MCU Verify Public Key (ECDSA secp256r1, 64 bytes uncompress)
  ├── Nhúng TRỰC TIẾP trong bootloader binary (constants array)
  ├── Signed tại build time (bootloader image cũng được ký GPG
  │   trong quy trình build tổng thể)
  └── KHÔNG thể thay đổi sau production (RDP Level 1 locked)
```

### 5.3 Device-Unique Keys (cho image encryption)

```
Device UDID (96 bit, đọc từ STM32 unique ID registers)
  │
  └── HUK (Hardware Unique Key)
      ├── Dẫn xuất: HMAC-SHA256(key=UDID, "mk-ddc-24-huk")
      └── Lưu: thuật toán (không lưu — tính lại mỗi boot)
```

### 5.4 Signing Flow

```
Build Server:
  1. Build mcu_fw.bin (FreeRTOS application)
  2. Compute SHA-256 hash của image body
  3. HSM signs hash → ECDSA signature (r||s)
  4. Build firmware header (magic, version, size, CRC, signature)
  5. [Optional] Encrypt image body with AES-128-CBC
  6. Package: header || body || signature → mcu_fw_v1.2.3.bin
  7. Include in .kxpkg OTA package (SW_OTA_DESIGN §3)
```

---

## 6. OTA Update Flow

### 6.1 Sequence

```
[1] Admin uploads .kxpkg → SOM kinexus-otad
    │
[2] SOM verifies GPG signature of .kxpkg (existing, D-7 §4 step 1)
    │
[3] SOM extracts mcu_fw.bin
    │
[4] SOM: safe-state MCU (RESET_IO via IOP)
    │
[5] SOM: BOOT0=HIGH → pulse nRESET → MCU vào ROM bootloader
    │
[6] SOM flashes mcu_fw.bin qua UART (AN3155)
    ├─ Extended Erase sector 1+ (giữ sector 0 = bootloader)
    └─ Write Memory: header @0x08003000, body @0x08003100, sig @0x0801F000
    │
[7] SOM verify CRC-32 của flash ghi (existing, FW_BOOTLOADER_OTA §3 step 6)
    ├─ OK ──► tiếp
    └─ FAIL ──► retry, nếu fail 3 lần → keep old, alarm
    │
[8] SOM: BOOT0=LOW → pulse nRESET → MCU boot từ 0x08000000
    │
[9] MCU custom bootloader runs:
    ├─ ECDSA verify signature → FAIL → halt (FAULT_OUT=HIGH → SOM alarm)
    ├─ Anti-downgrade → FAIL → halt (version quá cũ)
    ├─ CRC check → FAIL → halt
    └─ ALL PASS → jump to app
    │
[10] MCU HANDSHAKE with SOM (existing, FW_BOOTLOADER_OTA §3 step 8)
```

### 6.2 Fallback Strategy

| Failure Mode | Detection | Action |
|-------------|-----------|--------|
| Signature invalid | Bootloader ECDSA verify fail | Halt MCU (FAULT_OUT HIGH). SOM detects no handshake → alarm, retry OTA |
| Anti-downgrade | Version < stored | Halt MCU. SOM alarm: version too old. Admin must force-update (special flag) |
| CRC fail | Bootloader CRC check | Halt MCU. SOM detect no handshake → alarm, retry OTA |
| AN3155 flash fail | SOM verify CRC fail | Retry 3×. All fail → keep old firmware, alarm |
| Power loss mid-flash | MCU has no valid image | BOOT0=1 → ROM bootloader still alive. SOM can retry flash |

> **Tính bất khả tử (brick-safe):** ROM bootloader luôn sẵn sàng. Nếu custom bootloader bị hỏng (lỗi power khi flash sector 0), vẫn có thể nạp lại qua BOOT0=HIGH + UART AN3155. Trường hợp này yêu cầu can thiệp physical hoặc CM3 kéo BOOT0.

### 6.3 Force Update / Recovery

Khi signature verify fail (do key rotation hoặc firmware corrupt):
1. SOM kéo BOOT0=HIGH → MCU vào ROM bootloader (bỏ qua custom bootloader)
2. SOM flash signed firmware mới qua AN3155
3. BOOT0=LOW → reset → custom bootloader verify → OK

Đây là backdoor duy nhất và yêu cầu physical access hoặc CM3 GPIO control.

---

## 7. Anti-Downgrade Design

### 7.1 Stored Version Record

```
Vị trí: Flash reserved area (0x08002000–0x08002FFF)
  ┌── Version Record (16 bytes):
  │   uint32_t version_stored;    // version hiện tại (0xMMmmpp)
  │   uint32_t version_min;       // minimum allowed
  │   uint32_t magic;             // 0: uninitialized → 0xVERS
  │   uint32_t reserved;
```

### 7.2 Rules

| Điều kiện | Kết quả |
|-----------|---------|
| `header.version > stored_version` | OK — upgrade |
| `header.version == stored_version` | OK — re-flash cùng version |
| `header.version < stored_version` | REJECT — downgrade attempt |
| `header.version < min_version` | REJECT — quá cũ (có CVE đã fix) |
| `stored_version.magic == 0` | First boot — accept any version ≥ 1.0.0 |

### 7.3 Key Rotation Consideration

Khi cần rotate MCU signing key (do compromise hoặc policy):
1. Build firmware mới ký với key mới
2. SOM flash qua ROM bootloader (bỏ qua custom bootloader verify)
3. Bootloader update public key từ image header hoặc từ SOM command
4. **Rủi ro:** Nếu key compromise xảy ra, attacker có thể ký firmware giả mạo

**Mitigation:** Key rotation là procedure exception — yêu cầu physical presence hoặc authenticated admin command. Không hỗ trợ remote key rotation tự động.

---

## 8. Bootloader Development Plan

### 8.1 Components (P5 Implementation)

| Module | File | Chức năng | Flash |
|--------|------|-----------|:-----:|
| `boot_main.c` | `bootloader/src/` | Reset handler, flow control | ~0.5 KB |
| `boot_verify.c` | `bootloader/src/` | ECDSA verify, SHA-256 | ~3 KB |
| `boot_crypto.c` | `bootloader/src/` | AES decrypt (optional), CRC-32 | ~1 KB |
| `boot_version.c` | `bootloader/src/` | Anti-downgrade version check | ~0.5 KB |
| `boot_hal.c` | `bootloader/src/` | Clock, IWDG, GPIO init | ~1 KB |
| `lib/tinycrypt/` | `bootloader/lib/` | TinyCrypt ECDSA + SHA-256 | ~2 KB |
| **Total** | | | **~8 KB** |

### 8.2 Build Integration

```
CMakeLists.txt (bootloader/)
  ├── arm-none-eabi-gcc -mcpu=cortex-m0plus -mthumb
  ├── Linker: STM32G0B1RBTx_FLASH.ld (origin 0x08000000, length 8KB)
  ├── Linker symbol: __app_start = 0x08003000
  └── Output: bootloader.bin
```

Build quy trình:
1. Compile bootloader → `bootloader.bin`
2. Compile application với linker script (origin 0x08003000) → `mcu_fw.bin`
3. Sign `mcu_fw.bin` → `mcu_fw_signed.bin`
4. Combine vào `.kxpkg` OTA package

### 8.3 Verification

| Test | Method | Pass Criteria |
|------|--------|--------------|
| Bootloader jump | SWD single-step | VTOR set correctly, app runs |
| ECDSA verify valid | Flash signed image | Boot OK |
| ECDSA verify invalid | Corrupt 1 byte in image | Bootloader halt, FAULT_OUT HIGH |
| Anti-downgrade | Flash older version | Bootloader reject |
| CRC check | Corrupt image body | Bootloader halt |
| Boot time | GPIO toggle + scope | < 2s @64MHz |

---

## 9. Open Issues

| ID | Vấn đề | Owner | Hạn |
|----|--------|-------|-----|
| MCU-SEC-001 | Chọn thư viện crypto: TinyCrypt vs micro-ecc. TinyCrypt footprint ~4KB, micro-ecc ~2KB (chỉ ECDSA). | FW Lead | Sprint 3 |
| MCU-SEC-002 | AES-128-CBC decrypt có cần trong Ver 1? Nếu chưa có encrypted image, có thể defer. | Tech Lead + FW | Sprint 3 |
| MCU-SEC-003 | Xác nhận STM32G0B1 HW CRC unit có thể dùng cho CRC-32 (AN5156). STM32G0 có CRC unit. | FW Lead | Sprint 3 |
| MCU-SEC-004 | Boot counter: cần unified boot counter cho cả MCU lẫn SOM rollback? | Tech Lead | Sprint 3 |

---

## 10. Trace Requirements

| Requirement | Thiết kế | Verification |
|-------------|----------|-------------|
| SEC-010 — U-Boot verified (SOM) | N/A (SOM-side, D-7 §6) | T-SW-080 |
| SEC-011 — Signed firmware package | §6 OTA flow: GPG verify ở SOM + ECDSA verify ở MCU | T-SW-092 |
| SEC-012 — A/B rollback | §6.2: ROM bootloader fallback (MCU) + D-7 §5 (SOM) | T-SW-094 |
| SEC-014 — Anti-downgrade | §7: version check trong bootloader | T-SW-095 |
| SEC-050 — Boot chain verified | §2.1: Boot chain STM32 ROM → custom bootloader → verify → app | T-SW-080 |
| SEC-051 — Debug port disabled | RDP Level 1 (tài liệu riêng) + SWD header removal in production | — |
| FW-OTA-001 | SOM nạp MCU firmware qua UART bootloader | T-FW-080 |
| FW-OTA-004 | CRC verify sau flash | §6.1 step 7 |
| FW-OTA-005 | Keep old firmware if CRC fail | §6.2 |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | Tech Lead | Initial release cho IOT-5578 |
