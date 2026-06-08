# HSM Evaluation & Recommendation for Firmware Signing — MK-DDC-24

> **Document ID:** HSM-EVAL-MK-DDC-24-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Approved (Owner 2026-06-08)
> **Issue:** [IOT-5580](../../../../../../IOT/issues/IOT-5580)
> **Parent:** [IOT-5576](../../../../../../IOT/issues/IOT-5576)
> **Requirement trace:** SEC-013 (CR 4.2 — Key storage)
> **Tham chiếu:** [SEC-REQ-001 §3.3](../00_management/KX-DDC24-SEC-REQ-001_VI.md) | [MCU Secure Boot Design](../02_design/firmware/FW_MCU_SECURE_BOOT_MK-DDC-24_VI.md) | [SEC-SUP-001 R7](../00_management/KX-DDC24-SEC-SUP-001_VI.md)

---

## 1. Executive Summary

Báo cáo này đánh giá 3 loại HSM (Hardware Security Module) cho việc bảo vệ GPG/ECDSA
firmware signing key của MK-DDC-24, theo yêu cầu **SEC-013**: *"Private key ký firmware
PHẢI là HSM-protected; không lưu plain text trên thiết bị"*.

**Kết luận:** Hardware token (YubiHSM 2) là lựa chọn tối ưu cho MK-DDC-24 — chi phí
thấp, FIPS 140-2 Level 3, dễ tích hợp CI/CD, phù hợp quy mô nhỏ.

| Tiêu chí | Cloud HSM | Hardware Token | Software HSM |
|----------|-----------|----------------|--------------|
| Chi phí 1 năm | ~$26,000 | ~$650 | $0 |
| Chi phí 5 năm | ~$130,000 | ~$1,300 | $0 |
| FIPS 140-2 Level | Level 3 | Level 3 | None |
| CI/CD tích hợp | Tốt | Trung bình | Tốt |
| Key extraction resistance | ✅ Cao nhất | ✅ Cao | ❌ Thấp |
| Operational complexity | Cao | Thấp | Thấp nhất |

---

## 2. Yêu cầu HSM từ thiết kế MK-DDC-24

### 2.1 Keys cần bảo vệ

| Key | Mục đích | Thuật toán | Reference |
|-----|----------|-----------|-----------|
| **GPG signing key** | Ký `.kxpkg` OTA package (SOM firmware) | RSA 4096 hoặc ECC | SEC-011, SW-OTA-003 |
| **ECDSA signing key** | Ký MCU firmware image (STM32G0B1) | ECDSA secp256r1 | FW_MCU_SECURE_BOOT §7 |
| **KEK (Key Encryption Key)** | Mã hóa MCU image (optional) | AES-128 | FW_MCU_SECURE_BOOT §7 |

### 2.2 Signing pipeline

```
Developer push → CI/CD (GitHub Actions)
    → Build SOM firmware (.kxpkg)
    → Build MCU firmware (mcu_fw.bin)
    → [HSM] Sign both artifacts
    → Release signed artifacts
```

HSM phải hỗ trợ:
1. **GPG signing operations** — sign `.kxpkg` manifest
2. **PKCS#11 / OpenSSL engine** — ECDSA sign cho MCU firmware
3. **CI/CD integration** — GitHub Actions runner gọi HSM từ xa (cloud) hoặc local (USB token)
4. **Key backup & rotation** — key ceremony, split-knowledge backup

---

## 3. Option A: Cloud HSM

### 3.1 AWS CloudHSM

| Field | Assessment |
|-------|-----------|
| **Dịch vụ** | AWS CloudHSM (FIPS 140-2 Level 3, tamper-resistant hardware) |
| **Giao diện** | PKCS#11, JCE, Microsoft CNG, OpenSSL engine |
| **GPG support** | Không có GPG native — cần wrapper PKCS#11 → GPG hoặc dùng AWS KMS (CMOS) với signing config |
| **HA** | Yêu cầu tối thiểu 2 HSMs per cluster |
| **Pricing** | $1.63/hr × 2 HSMs × 730h/tháng ≈ **$2,380/tháng** |
| **Annual cost** | ~$28,560/năm (2 HSM cluster) |
| **VPC requirement** | Phải deploy trong AWS VPC, on-prem không có direct access |

**Pros:**
- FIPS 140-2 Level 3 certified
- Auto-scaling, managed backup
- Audit logs (CloudTrail)
- Key never leaves HSM boundary

**Cons:**
- Chi phí cao nhất — không phù hợp cho dự án nhỏ
- Signing latency (~5-10ms network round trip)
- Phụ thuộc AWS — nếu VPC/region down thì không sign được
- GPG integration cần custom wrapper
- Operational complexity: VPC peering, security group, cluster management

### 3.2 Azure Dedicated HSM

| Field | Assessment |
|-------|-----------|
| **Dịch vụ** | Azure Dedicated HSM (FIPS 140-2 Level 3, Thales Luna SA) |
| **Giao diện** | PKCS#11, JCE, Microsoft CNG |
| **Pricing** | ~$5.15/hr (1 HSM) → ~$3,700/tháng |
| **Annual cost** | ~$44,400/năm |

**Pros/Cons:** Tương tự AWS CloudHSM, chi phí cao hơn.

### 3.3 AWS KMS (Alternative — Cloud HSM lite)

| Field | Assessment |
|-------|-----------|
| **Dịch vụ** | AWS Key Management Service (FIPS 140-2 Level 2 default, Level 3 với Custom Key Store) |
| **Giao diện** | AWS SDK, Sign API (có hỗ trợ RSA/ECDSA signing) |
| **GPG support** | Không native — cần custom script sign bằng AWS KMS Sign API |
| **Pricing** | $1/key/month + $0.03/10,000 signing operations |
| **Annual cost** | ~$12-$120/năm (tùy số lượng signing ops) |
| **Key storage** | Software-backed (Level 2) hoặc CloudHSM-backed (Level 3, chi phí cao hơn) |

**Pros:**
- Chi phí thấp nếu số lượng sign ít
- Tích hợp dễ dàng qua AWS SDK
- Automatic key rotation

**Cons:**
- FIPS 140-2 Level 2 mặc định — không đáp ứng yêu cầu "hardware-protected" strict
- GPG không native — cần custom integration cho `.kxpkg` signing
- Vendor lock-in (AWS)

**Cloud HSM verdict:** ❌ **Không recommend** — chi phí không tương xứng với quy mô
MK-DDC-24 (dự án nhỏ, số lượng signing operations thấp). AWS KMS (Level 2) có thể
dùng tạm trong MVP nhưng không đáp ứng SEC-013 strict.

---

## 4. Option B: Hardware Token

### 4.1 YubiHSM 2

| Field | Assessment |
|-------|-----------|
| **Model** | YubiHSM 2 (Yubico) |
| **FIPS** | FIPS 140-2 Level 3 (certificate #3482) |
| **Giao diện** | PKCS#11, YubiHSM CLI, REST API (yubihsm-connector) |
| **Key types** | RSA 2048/4096, ECDSA P-256/P-384, AES (wrap/unwrap) |
| **GPG support** | ✅ GPG smartcard mode — có thể dùng `gpg --card-status` |
| **CI/CD integration** | ✅ USB-attached hoặc yubihsm-connector network mode |
| **Max keys** | 48 slots (standard), expandable |
| **Signing rate** | ~30-50 operations/sec (ECDSA P-256) |
| **Pricing** | **~$650** (one-time) |
| **Backup** | YubiHSM 2 backup device (cùng loại) + AEAD key wrap |
| **Accessory** | USB Y-cable (cần nguồn phụ), extension cable |

**Pros:**
- Chi phí một lần thấp — không recurring fee
- FIPS 140-2 Level 3 — đáp ứng SEC-013 requirement
- Kích thước nhỏ (USB form factor) — dễ mang theo / gắn build server
- Native GPG support qua smartcard interface
- PKCS#11 cho ECDSA signing (MCU firmware)
- yubihsm-connector cho network-remote signing (CI/CD)
- Key ceremony hỗ trợ: backup, wrap, split-knowledge

**Cons:**
- Một physical device — risk mất/hư hỏng (có backup key)
- Signing rate thấp hơn cloud HSM (không vấn đề với số lượng sign ít)
- Cần USB port trên build server (CI runner)
- Phải tự quản lý backup key và key ceremony

### 4.2 Nitrokey HSM

| Field | Assessment |
|-------|-----------|
| **Model** | Nitrokey HSM 2 |
| **FIPS** | FIPS 140-2 Level 3 (certified) |
| **Giao diện** | PKCS#11 (OpenSC) |
| **Key types** | RSA 2048/4096, ECDSA P-256/P-384 |
| **GPG support** | ⚠️ GPG smartcard — tương thích nhưng cần cấu hình |
| **CI/CD integration** | USB-attached |
| **Pricing** | **~$250-$400** (tùy nơi bán) |
| **Backup** | SmartCard-HSM backup card (cùng key material) |

**Pros:**
- Giá thấp hơn YubiHSM 2
- FIPS 140-2 Level 3
- OpenSC PKCS#11 — tiêu chuẩn mở

**Cons:**
- GPG integration phức tạp hơn YubiHSM — không có GPG native mode
- Cộng đồng nhỏ hơn, documentation ít hơn
- Build quality thấp hơn Yubico
- Thời gian giao hàng lâu hơn

### 4.3 SmartCard-HSM (Card + Reader)

| Field | Assessment |
|-------|-----------|
| **Model** | SmartCard-HSM (CardContact) + USB reader (e.g., ACS ACR39) |
| **FIPS** | FIPS 140-2 Level 3 (certified) |
| **Giao diện** | PKCS#11 (OpenSC), JavaCard applet |
| **Key types** | RSA up to 4096, ECDSA P-256/P-384 |
| **GPG support** | ✅ GPG smartcard — `gpg --card-status` |
| **CI/CD integration** | USB reader attached |
| **Pricing** | **~$150-$300** (card + reader combo) |
| **Backup** | Backup card (clone key material) |

**Pros:**
- Giá thấp nhất trong hardware token class
- FIPS 140-2 Level 3
- JavaCard applet — có thể tùy chỉnh

**Cons:**
- Cần USB reader riêng
- Signing rate thấp (JavaCard overhead)
- Độ bền thấp hơn YubiHSM
- Quản lý phức tạp (card + reader 2 thiết bị)

### 4.4 Hardware Token Comparison

| Tiêu chí | YubiHSM 2 | Nitrokey HSM | SmartCard-HSM |
|----------|:----------:|:------------:|:--------------:|
| Giá (USD) | $650 | $250-$400 | $150-$300 |
| FIPS Level | Level 3 | Level 3 | Level 3 |
| GPG native | ✅ Tốt | ⚠️ Trung bình | ✅ Tốt |
| CI/CD ease | ✅ Tốt (network) | ⚠️ USB-only | ⚠️ USB-only |
| PKCS#11 | ✅ | ✅ | ✅ |
| Backup mechanism | ✅ AEAD wrap | ✅ Backup card | ✅ Backup card |
| Vendor stability | ✅ Yubico (large) | ⚠️ Nitrokey (small) | ⚠️ CardContact (small) |
| Community/docs | ✅ Extensive | ⚠️ Limited | ⚠️ Limited |

**Hardware token verdict:** ✅ **YubiHSM 2 là lựa chọn recommend** — GPG native support,
FIPS 140-2 Level 3, vendor uy tín, chi phí một lần, dễ tích hợp CI/CD qua
`yubihsm-connector` network mode.

---

## 5. Option C: Software HSM

### 5.1 SoftHSM2 (OpenDNSSEC)

| Field | Assessment |
|-------|-----------|
| **Mô tả** | Software implementation of PKCS#11 — key stored in encrypted file |
| **FIPS** | ❌ Không FIPS certified (mặc dù uses OpenSSL FIPS module) |
| **Giao diện** | PKCS#11 |
| **Key types** | RSA, ECDSA — tùy thuộc OpenSSL backend |
| **GPG support** | ⚠️ Cần custom `gpg-agent` configuration |
| **Pricing** | **Free** (open source, BSD license) |
| **Key storage** | Encrypted SQLite file (`/var/lib/softhsm/tokens/`) |

**Pros:**
- Miễn phí, open source
- PKCS#11 API — dễ tích hợp
- Có thể dùng trong CI/CD (ephemeral container)
- Key backup = copy token directory

**Cons:**
- ❌ **Không FIPS certified** — không đáp ứng SEC-013 requirement "HSM-protected"
- Key decrypts vào process memory — vulnerable to memory dump
- Software-only — không có physical tamper protection
- Không có audit log cấp hardware

### 5.2 GnuPG with smartcard emulation (gpg-agent)

| Field | Assessment |
|-------|-----------|
| **Mô tả** | Dùng `gpg-agent` với `scdaemon` fake smartcard |
| **FIPS** | ❌ Không |
| **GPG support** | ✅ Native (chính là GPG ecosystem) |
| **Pricing** | **Free** |
| **Key storage** | `~/.gnupg/private-keys-v1.d/` (encrypted với passphrase) |

**Pros:**
- GPG native — không cần custom integration
- Dễ dùng cho `.kxpkg` signing workflow
- Key backup = copy `~/.gnupg/`

**Cons:**
- ❌ **Không đáp ứng SEC-013** — key trong filesystem, không hardware-protected
- Private key file có passphrase — vẫn có nguy cơ bị copy
- Không phù hợp production

### 5.3 Software HSM Verdict

❌ **Không recommend** — Software HSM không đáp ứng requirement **SEC-013**
("HSM-protected; không lưu plain text"). Chỉ dùng cho development environment
hoặc CI/CD test signing (với key khác, không phải production key).

---

## 6. CI/CD Integration

### 6.1 YubiHSM 2 with GitHub Actions

```
┌─────────────────────┐
│  GitHub Actions      │
│  Self-hosted runner  │  USB or network
│  ┌───────────────┐   │  ┌────────────┐
│  │ yubihsm-conn  │───┼─→│ YubiHSM 2  │
│  │ ectore        │   │  │ (USB HSM)  │
│  └───────────────┘   │  └────────────┘
└─────────────────────┘
```

**Integration options:**

| Option | Mô tả |
|--------|-------|
| **USB direct** | Self-hosted runner with YubiHSM 2 USB-attached. Simple, secure. |
| **Network HSM** | `yubihsm-connector` listens on network — build machines connect remotely. |
| **Docker mount** | Mount `/dev/ttyACM0` hoặc `/dev/hsm` vào container build. |

**GPG signing workflow:**
```bash
# 1. Load GPG key from YubiHSM 2 (one-time setup)
ykushsm gpg import --key 0x1234 --id "MK-DDC-24 Firmware Signing Key"

# 2. Sign .kxpkg in CI (requires YubiHSM 2 USB access)
gpg --homedir /run/gpg-hsm --sign --detach-sign \
  --local-user "MK-DDC-24 Firmware Signing Key" \
  --output manifest.sig manifest.json
```

**ECDSA signing workflow (MCU firmware):**
```bash
# PKCS#11 via OpenSSL engine
pkcs11-tool --module /usr/lib/yubihsm/pkcs11.so \
  --sign --mechanism ECDSA \
  --slot 0 --id $KEY_ID \
  --input firmware.bin.hash --output firmware.bin.sig
```

### 6.2 Required CI/CD changes

- Provision **self-hosted runner** (hoặc runner với USB device passthrough)
- Install `yubihsm-connector`, `yubihsm-shell`, `pkcs11-tool`
- Configure GPG homedir với smartcard mode
- Signing job chỉ chạy trên tagged release (không sign mỗi commit)
- Key ceremony cho initial key generation + backup

---

## 7. Cost Analysis (5-Year)

| Component | Option A (Cloud HSM) | Option B (YubiHSM 2) | Option C (SoftHSM) |
|-----------|:--------------------:|:--------------------:|:------------------:|
| Hardware/Setup | $0 | $650 | $0 |
| AWS CloudHSM (2 HSMs) | $28,560/yr | $0 | $0 |
| Azure Dedicated HSM | $44,400/yr | $0 | $0 |
| Maintenance | $0 | $100 (cable, backup card) | $0 |
| Operational labor | $5,000/yr | $500/yr | $200/yr |
| **Year 1 total** | **~$33,560** | **~$1,250** | **~$200** |
| **5-year total** | **~$168,000** | **~$3,650** | **~$1,000** |
| FIPS 140-2 | ✅ Level 3 | ✅ Level 3 | ❌ None |
| SEC-013 compliant | ✅ | ✅ | ❌ |

---

## 8. Key Ceremony & Operational Considerations

### 8.1 Key generation (recommended flow)

1. **Admin A** + **Admin B** present (split-knowledge required)
2. Generate GPG key directly on YubiHSM 2 (key never leaves HSM):
   ```bash
   yubihsm-shell > generate asymmetric 0 0 "sign decrypt" 0x1234 "MK-DDC-24-signing-key" "ec" "secp256r1"
   ```
3. Create AEAD backup wrap (encrypted backup blob):
   ```bash
   yubihsm-shell > put wrapkey 0 1 "wrap-key" 1 "wrap" "aes256-ccm" && \
                   wrap 0x1234 0x4321 "mkddc24-backup-20260602.yhw"
   ```
4. Store backup blob in company vault + safe deposit (offline)
5. Export GPG public key → nhúng vào `kinexus-otad` và U-Boot source

### 8.2 Key rotation policy

| Event | Trigger | Action |
|-------|---------|--------|
| Periodic | Every 2 years | Generate new key, sign new public key with old key, OTA update devices |
| Compromise | Detected or suspected | Revoke old key via CRL, push emergency OTA with new public key |
| Device EOL | Product discontinuation | Archive key, notarize final firmware hash |

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|:------:|------------|
| YubiHSM 2 physical theft | Thấp | Cao | Store in locked server room; backup key in vault |
| YubiHSM 2 hardware failure | Thấp | Cao | Backup key on second YubiHSM 2 + AEAD recovery |
| USB disconnection during signing | Trung bình | Trung bình | CI retry logic; `yubihsm-connector` health check |
| Loss of backup key | Thấp | Rất cao | Multi-location backup (vault + safe deposit + encrypted cloud) |
| GPG/CVE trong yubihsm-pkcs11 | Rất thấp | Cao | Monitor Yubico security advisories; update firmware |

---

## 10. Recommendation

✅ **YubiHSM 2 — Recommend cho MK-DDC-24**

**Rationale:**

| Tiêu chí | Đánh giá |
|----------|----------|
| **Chi phí** | $650 one-time — phù hợp budget dự án nhỏ, không recurring |
| **Bảo mật** | FIPS 140-2 Level 3 — đáp ứng đầy đủ SEC-013 requirement |
| **GPG integration** | Native GPG smartcard — không cần custom wrapper cho `.kxpkg` signing |
| **CI/CD** | `yubihsm-connector` network mode — build server có thể sign từ xa |
| **Backup** | AEAD key wrap + second device — key ceremony hoàn chỉnh |
| **Vendor** | Yubico — vendor lớn, tài liệu đầy đủ, community rộng |
| **Operational complexity** | Thấp — cắm USB + cấu hình một lần |

**Phương án dự phòng:** SmartCard-HSM (card + reader) nếu budget < $300 — FIPS 140-2
Level 3, GPG smartcard, chi phí thấp nhất. Trade-off: operational complexity cao hơn
và signing rate thấp hơn YubiHSM.

**Phương án dev/test:** SoftHSM2 — dùng key riêng (không trùng production key),
cho CI/CD test signing. Không dùng cho production signing.

**Budget request:**
- 1× YubiHSM 2 (primary, production signing): **$650**
- 1× YubiHSM 2 (backup, key ceremony): **$650**
- Accessories (USB Y-cable, extension): **$50**
- **Total one-time: ~$1,350**
- Operational per year: ~$200

---

## 11. Action Items

| # | Action | Owner | Timeline |
|---|--------|-------|----------|
| 1 | Approve HSM recommendation (YubiHSM 2) | TechLead | Sprint 1 |
| 2 | Purchase YubiHSM 2 (primary + backup) | Procurement | Sprint 1 |
| 3 | Perform key ceremony (generate + backup) | CTO + TechLead | Sprint 2 |
| 4 | Configure CI/CD signing pipeline | DeveloperTeam | Sprint 2 |
| 5 | Document GPG key ceremony procedure | TechLead | Sprint 2 |
| 6 | Verify signing pipeline end-to-end | QA | Sprint 2 |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | DeveloperTeam | Baseline — HSM evaluation cho IOT-5580. Chờ TechLead review. |
