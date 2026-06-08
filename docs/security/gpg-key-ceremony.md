# GPG Key Ceremony Procedure

| Metadata | Value |
|----------|-------|
| Document ID | KX-DDC24-SEC-KEY-CEREMONY-001 |
| Version | 1.0 |
| Status | Draft |
| Author | Developer Team |
| Approver | Tech Lead |

## 1. Purpose and Scope

Quy trình này định nghĩa cách tạo, lưu trữ, sử dụng, backup, và thu hồi GPG key pair dùng để ký firmware package (`.kxpkg`) và kernel image cho sản phẩm MK-DDC-24.

**Scope:** Áp dụng cho toàn bộ vòng đời GPG signing key — từ key generation ceremony đến recovery và rotation.

**References:**
- [SEC-REQ-001](../00_management/KX-DDC24-SEC-REQ-001_VI.md): SEC-010 (U-Boot GPG verify), SEC-011 (Signed `.kxpkg`), SEC-013 (HSM-protected private key)
- [SEC-SUP-001](../00_management/KX-DDC24-SEC-SUP-001_VI.md) §9.4 R7: GPG signing key risk mitigation
- [SW_OTA_DESIGN](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) §6: GPG signing và HSM requirement
- [IOT-5576](../../../../../../IOT/issues/IOT-5576): GPG Signing-Key Governance (parent issue)

## 2. Algorithm Selection: RSA-4096 vs ECC

### 2.1 Comparison

| Tiêu chí | RSA-4096 | ECC (Ed25519/Cv25519) |
|----------|----------|-----------------------|
| Key size | 4096-bit | 256-bit |
| Signature size | 512 bytes | ~64 bytes (512-bit) |
| Sign speed | Chậm | ~10× nhanh hơn RSA |
| Verify speed | Trung bình | ~2× nhanh hơn RSA |
| GPG support | Toàn bộ (GPG 1.x+) | GPG 2.1+ (Ed25519 từ 2.1) |
| U-Boot support | ✅ Phổ biến | ✅ U-Boot v2020+ (efi/fit) |
| Security margin | 128-bit symmetric equivalent | 128-bit symmetric equivalent |
| Post-quantum risk | Vulnerable | Vulnerable (both) |
| Key fingerprint length | 40 hex chars (SHA1) | 40 hex chars (SHA1) |

### 2.2 Recommendation

**Recommendation: ECC (Ed25519/Cv25519) — PRIMARY**

Rationale:

1. **Signature size nhỏ hơn 8×** — quan trọng cho firmware image nhúng (giảm kích thước `.kxpkg`)
2. **Verify nhanh hơn 2×** — tác động trực tiếp đến boot time (SEC-010: U-Boot verify GPG kernel)
3. **Key generation nhanh** — giảm thời gian ceremony, không cần thu thập entropy lâu
4. **Security equivalent** — Ed25519 cung cấp ~128-bit security, tương đương RSA-3072, an toàn cho industrial lifecycle ≥10 năm
5. **Modern standard** — NIST SP 800-186 khuyến nghị Ed25519 cho firmware signing; TLS 1.3 cũng ưu tiên ECC

**Fallback: RSA-4096** — chỉ dùng khi target environment (U-Boot, bootloader) không hỗ trợ Ed25519.

> **Decision:** Dùng Ed25519 (`--key-type ed25519`) cho tất cả GPG signing key mới.
> Verify U-Boot version hỗ trợ Ed25519 trước khi ceremony. Nếu U-Boot chưa hỗ trợ, dùng RSA-4096.

## 3. Air-Gapped Key Generation Procedure

### 3.1 Hardware Requirements

| Item | Specification | Purpose |
|------|---------------|---------|
| Laptop (dedicated) | No WiFi/Bluetooth, or physically disabled | Air-gapped environment |
| USB boot media | Debian 12 Live ISO (GPG-signed, verified) | Boot OS |
| USB storage (×2) | 2× encrypted USB (LUKS, AES-256) | Key export |
| Paper & printer | No network printer | Backup recovery sheet |
| Tamper-evident bags | Sealed before/after ceremony | Storage integrity |
| HSM (optional) | Nitrokey HSM 2 / YubiHSM 2 | Production key storage |

### 3.2 OS Environment

- **OS:** Debian 12 Live ISO (verified GPG signature từ Debian)
- **Boot mode:** No network — `systemctl disable NetworkManager` (or remove NIC driver)
- **Tools:** `gpg` (GnuPG 2.2.x), `pinentry` (loopback mode)
- **Entropy:** Kernel entropy pool (no rng-tools external); wait for `熵` > 256 (check `/proc/sys/kernel/random/entropy_avail`)

### 3.3 Step-by-Step Procedure

**Preparation:**

```bash
# Boot from Debian 12 Live USB
# Verify no network:
ip link           # Confirm only lo is UP
rfkill list       # Confirm WiFi/BT blocked

# Set GPG version requirement:
gpg --version | head -1    # Must be >= 2.2.0 for Ed25519
```

**Key Generation:**

```bash
# Step 1: Create batch config
cat > /tmp/gpg-batch.conf << 'BATCH'
%echo Generating DDC-24 firmware signing key
Key-Type: ed25519
Key-Usage: sign
Name-Real: MK-DDC-24 Firmware Signing Key
Name-Email: firmware@ddc24.kinexus.io
Expire-Date: 2y
%no-protection
%commit
%echo Done
BATCH

# Step 2: Generate primary signing key
gpg --batch --gen-key /tmp/gpg-batch.conf

# Step 3: Generate encryption subkey (for backup encryption)
gpg --quick-add-key <KEY-FP> cv25519 encr 2y

# Step 4: Verify
gpg --list-keys --keyid-format LONG
gpg --list-secret-keys --keyid-format LONG
```

**Key Fingerprint Recording:**

```bash
gpg --fingerprint --keyid-format LONG <KEY-FP>
# Output example:
# pub   ed25519/AAAAAAAAAAAAAAAA 2026-06-02
#       Key fingerprint = AAAA AAAA AAAA AAAA AAAA  BBBB BBBB BBBB BBBB
# uid          [ultimate] MK-DDC-24 Firmware Signing Key
```

All witnesses MUST record the full 40-character fingerprint on the ceremony log.

**Export:**

```bash
# Step 5: Export public key (for verification)
gpg --armor --export <KEY-FP> > ddc24-firmware-signing-pub.asc

# Step 6: Export private key (encrypted backup)
gpg --armor --export-secret-keys <KEY-FP> > ddc24-firmware-signing-priv.asc

# Step 7: Export subkeys separately
gpg --armor --export-secret-subkeys <KEY-FP> > ddc24-firmware-signing-subkeys.asc

# Step 8: Copy to encrypted USB
sudo cryptsetup luksFormat /dev/sdX1   # AES-256
sudo cryptsetup open /dev/sdX1 usbkey
sudo mount /dev/mapper/usbkey /mnt
cp ddc24-firmware-signing-*.asc /mnt/
sudo umount /mnt
sudo cryptsetup close usbkey
```

**Shred Temporary Files:**

```bash
shred -vfz /tmp/gpg-batch.conf
shred -vfz ddc24-firmware-signing-priv.asc
# Power off immediately after
shutdown -h now
```

### 3.4 HSM Integration (Production)

Production signing key SHOULD be stored on HSM (Nitrokey HSM 2 / YubiHSM 2):

```bash
# Generate key directly on HSM (key never leaves device)
gpg --card-edit
gpg> admin
gpg> generate
gpg> key-attr    # Set to Ed25519
```

Alternatively, import generated key into HSM:

```bash
gpg --edit-key <KEY-FP>
gpg> keytocard    # Move private key to HSM
gpg> quit
```

HSM-protected key satisfies SEC-013 requirement ("private key HSM-protected; không lưu plain text trên thiết bị").

## 4. Witness Requirements

### 4.1 Minimum Witness Count

| Phase | Minimum Witnesses | Role Requirements |
|-------|------------------:|-------------------|
| Key generation | **2** (1 Tech Lead + 1 CTO/QE) | Independent, not both from same team |
| Key backup | **2** (same or different) | Witness continuity recommended |
| Key recovery | **2** (1 must be CTO/CEO) | Escalated approval |
| Key revocation | **2** (1 must be CTO/CEO) | Escalated approval |
| Key rotation | **2** (Tech Lead + QE) | Standard ceremony |

### 4.2 Witness Responsibilities

- **Observe** toàn bộ quy trình (không rời phòng)
- **Verify** không có network connectivity
- **Record** key fingerprint trên ceremony log (handwritten + photo)
- **Sign** ceremony log after completion
- **Receive** one copy of encrypted backup (if backup ceremony)
- **Report** bất kỳ deviation hoặc anomaly

### 4.3 Prohibited Actions During Ceremony

- ❌ No phone calls
- ❌ No network connectivity (tested before start)
- ❌ No USB devices except designated media
- ❌ No screenshots/photos of private key material
- ❌ No leaving the room unattended while key material is in memory

## 5. Ceremony Log Template

```
======================================================================
            GPG KEY CEREMONY LOG — MK-DDC-24 FIRMWARE SIGNING
======================================================================

Ceremony ID:       KX-CER-{YYYY}-{NNN}
Date:              {YYYY-MM-DD}
Time (start/end):  {HH:MM} / {HH:MM} UTC+7
Location:          {Room number, site}
Purpose:           [ ] Key Generation  [ ] Key Backup
                   [ ] Key Recovery    [ ] Key Rotation
                   [ ] Key Revocation

----------------------------------------------------------------------
PARTICIPANTS
----------------------------------------------------------------------

Ceremony Lead:     {Name, Role}
Witness 1:         {Name, Role}
Witness 2:         {Name, Role}
Additional:        {Name, Role}  (if any)

----------------------------------------------------------------------
HARDWARE VERIFICATION
----------------------------------------------------------------------

Laptop model:      {Make, Model, Serial}
MAC addresses:     {eth0, wlan0 MACs — confirm no connectivity}
USB boot media:    {Debian 12 Live ISO SHA256 hash}
USB storage 1:     {Make, Serial, LUKS header hash}
USB storage 2:     {Make, Serial, LUKS header hash}

Network test:      [ ] ip link = only lo  [ ] rfkill list = all blocked
Entropy avail:     {>/proc/sys/kernel/random/entropy_avail}

----------------------------------------------------------------------
KEY GENERATION (if applicable)
----------------------------------------------------------------------

Algorithm:         [ ] Ed25519  [ ] RSA-4096
Key ID:            {Full 40-char fingerprint}
Key Usage:         Sign
Expiration:        {YYYY-MM-DD}

Generation command:
  {gpg --batch --gen-key ... or equivalent}

----------------------------------------------------------------------
BACKUP (if applicable)
----------------------------------------------------------------------

Backup format:     [ ] Encrypted USB (LUKS AES-256)  [ ] Paper backup
Number of copies:  2 (Witness 1 kept, Witness 2 kept)
Backup locations:
  Copy 1: {Sealed envelope #1, stored by: Name, Location}
  Copy 2: {Sealed envelope #2, stored by: Name, Location}
Seal numbers:      {Tamper-evident seal IDs}

----------------------------------------------------------------------
PUBLIC KEY DISTRIBUTION
----------------------------------------------------------------------

Public key published:
  [ ] Git repository: docs/security/ddc24-firmware-signing-pub.asc
  [ ] Key server:     {keyserver.ubuntu.com or equivalent}
  [ ] Internal wiki:  {URL}

Public key fingerprint verified by witnesses: [ ]

----------------------------------------------------------------------
SIGNATURES
----------------------------------------------------------------------

Ceremony Lead:     ___________________  Date: __________
Witness 1:         ___________________  Date: __________
Witness 2:         ___________________  Date: __________

----------------------------------------------------------------------
--- END OF CEREMONY LOG ---
```

## 6. Key Custody

### 6.1 Role Designation

| Role | Designee | Responsibilities |
|------|----------|------------------|
| **Primary Keyholder** | Tech Lead | Sign firmware releases; maintain key availability |
| **Backup Keyholder** | CTO / QE Lead | Stand-in when primary unavailable; hold one backup copy |
| **Key Custodian** | QE Lead | Maintain custody log; track key location and status |
| **Revocation Authority** | CTO / CEO | Authorize key revocation in case of compromise |

### 6.2 Custody Rules

- Primary và Backup Keyholder MUST be different individuals
- Backup Keyholder KHÔNG được dùng key trừ khi Primary unavailable và có written authorization từ Revocation Authority
- Custody log được cập nhật mỗi khi key được truy xuất hoặc chuyển giao
- Key transfer giữa các keyholder phải có witness và log entry

### 6.3 Custody Log

```csv
date,action,keyholder,witness,notes
2026-06-02,initial custody,Tech Lead,CTO,Key generated per KX-CER-2026-001
{date},transfer to backup,{Backup Keyholder},{Witness},{Reason}
```

## 7. Secure Storage Requirements

### 7.1 Primary Key Storage (HSM)

| Requirement | Specification |
|-------------|---------------|
| Device | Nitrokey HSM 2 / YubiHSM 2 |
| PIN protection | PIN ≥ 8 characters; 3-attempt lockout |
| Physical location | Office safe (keyholder's controlled access area) |
| Tamper evidence | Tamper-evident seal number recorded in custody log |
| Backup | Not applicable (key is non-exportable on HSM) |

### 7.2 Backup Key Storage (Offline Encrypted USB)

| Requirement | Specification |
|-------------|---------------|
| Encryption | LUKS2 + AES-256 XTS |
| Passphrase | ≥ 20 characters; generated from diceware |
| Passphrase storage | Sealed envelope, separate from USB |
| Number of copies | **2 copies minimum** (geographically separate if possible) |
| Storage | Fireproof safe (Primary: office; Backup: bank safe deposit or equivalent) |
| Container | Tamper-evident bag, seal ID recorded |
| Verification | Quarterly check: verify seal integrity, no attempted access |
| Rotation | New backup after each key rotation; old backup destroyed |

### 7.3 Paper Backup (Optional)

- Dùng `paperkey` để export private key material dưới dạng hex dump
- Two-piece split: mỗi keyholder giữ một phần
- Lưu trong tamper-evident envelope riêng biệt

```bash
gpg --export-secret-key <KEY-FP> | paperkey --output-type raw > ddc24-key-paperbackup.txt
# Split: head -n 10 ddc24-key-paperbackup.txt > part1.txt
# Split: tail -n +11 ddc24-key-paperbackup.txt > part2.txt
```

### 7.4 Storage Locations Summary

| Copy | Format | Location | Custodian | Seal ID |
|------|--------|----------|-----------|---------|
| Primary | HSM (live) | Office safe | Tech Lead | — |
| Backup 1 | LUKS USB | Office safe (different safe) | Tech Lead | TE-{NNN} |
| Backup 2 | LUKS USB | Offsite (bank safety box) | CTO | TE-{NNN} |
| Paper (opt) | Split hex | Separate envelopes | Keyholders | TE-{NNN} |

## 8. Key Recovery Procedure

### 8.1 When Recovery Is Needed

- Primary HSM lost or damaged
- Primary keyholder unavailable và cần signing
- PIN/Passphrase lost
- Natural disaster affecting primary storage

### 8.2 Recovery Steps

**Prerequisites:**
1. Revocation Authority (CTO/CEO) approves recovery in writing
2. Two witnesses are present (1 must be CTO/CEO)
3. Incident report filed (SEC-INCIDENT-{NNN})

**Procedure:**

```bash
# Step 1: Retrieve backup USB from secure location
# Step 2: Verify tamper-evident seal integrity
#     - Seal intact? → Continue
#     - Seal broken? → ABORT. Assume key compromised. Go to revocation (§9).

# Step 3: Boot air-gapped environment (same as §3)
# Step 4: Decrypt and mount USB
sudo cryptsetup open /dev/sdX1 usbkey
sudo mount /dev/mapper/usbkey /mnt

# Step 5: Import private key
gpg --import /mnt/ddc24-firmware-signing-priv.asc

# Step 6: Verify imported key
gpg --list-secret-keys --keyid-format LONG

# Step 7: If restoring to HSM:
gpg --edit-key <KEY-FP>
gpg> keytocard
gpg> quit

# Step 8: Sign a test artifact to verify
echo "test" | gpg --detach-sign --armor > /tmp/test.sig
gpg --verify /tmp/test.sig /tmp/test
echo "Recovery verification: $(gpg --status /tmp/test.sig | grep GOODSIG)"

# Step 9: Log recovery in ceremony log
# Step 10: Replace backup media after recovery (new USB, new seal)
```

### 8.3 Post-Recovery Actions

- Create new backup copies (old backup considered compromised)
- Update custody log
- File post-incident review within 5 business days

## 9. Key Revocation Procedure

### 9.1 Revocation Triggers

| Trigger | Response Time |
|---------|---------------|
| Key compromise (confirmed) | Immediate — revoke within 4 hours |
| Key compromise (suspected) | Within 24 hours |
| Keyholder termination | Within 7 days |
| Algorithm deprecation | Per deprecation schedule |
| Key rotation (planned) | After new key activated |

### 9.2 Revocation Steps

```bash
# Step 1: Generate revocation certificate (done at creation time)
gpg --output ddc24-revocation.asc --gen-revoke <KEY-FP>

# Step 2: Distribute revocation
gpg --keyserver keyserver.ubuntu.com --send-keys <KEY-FP>
gpg --import ddc24-revocation.asc

# Step 3: Update firmware verification pipeline to reject old key
# (Replace public key in U-Boot and OTA verification)

# Step 4: Log in ceremony log
# Step 5: Notify all stakeholders (Tech Lead, CTO, QA, DevOps)
```

### 9.3 Revocation Certificate Storage

- Revocation certificate MUST be generated at key creation time
- Stored with backup key (encrypted USB + tamper-evident envelope)
- If revocation certificate is lost or key is inaccessible, use `gpg --gen-revoke` on air-gapped machine with backup private key

## 10. Key Rotation Policy

| Parameter | Value |
|-----------|-------|
| Rotation interval | **2 years** (matches key expiration) |
| Overlap period | 30 days (new + old key both valid) |
| Notice period | 90 days before rotation |
| Responsible | Tech Lead + DevOps |

**Procedure:**

1. Generate new key pair per §3
2. Add new public key to firmware verification pipeline
3. Sign future firmware with new key
4. Maintain old public key for 30-day overlap (verify old firmware updates)
5. After overlap: remove old key from pipeline, archive old backup
6. Update all references (CI/CD, docs, key servers)

## 11. CI/CD Integration

After ceremony, public key MUST be committed to repository:

```
docs/security/ddc24-firmware-signing-pub.asc
```

CI/CD pipeline uses this key for:

- **OTA package signing:** `gpg --detach-sign --armor manifest.json`
- **U-Boot kernel signing:** `gpg --detach-sign kernel-fit.itb`

DevOps đảm bảo pipeline access đến HSM (production) hoặc subkey (CI worker). Private key NEVER appears in CI logs, environment variables, or artifacts.

## 12. References

| Document | Link |
|----------|------|
| SEC-REQ-001 | [KX-DDC24-SEC-REQ-001_VI.md](../00_management/KX-DDC24-SEC-REQ-001_VI.md) |
| SEC-SUP-001 | [KX-DDC24-SEC-SUP-001_VI.md](../00_management/KX-DDC24-SEC-SUP-001_VI.md) |
| SW OTA Design | [SW_OTA_DESIGN_MK-DDC-24_VI.md](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) |
| Parent Issue | [IOT-5576](../../../../../../IOT/issues/IOT-5576) |
| NIST SP 800-57 | Key Management Recommendation |
| NIST SP 800-186 | Recommendations for Discrete Logarithm-based Cryptography (Ed25519) |
| Debian CD Verification | https://www.debian.org/CD/verify |

---

*Document version 1.0 — Draft for Tech Lead review*
