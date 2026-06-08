# RDP Level 1 Provisioning Procedure — MK-DDC-24
## STM32G0B1RBT6 production flash protection

> **Document ID:** KX-DDC24-SEC-RDP-PROCEDURE-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Draft
> **Tác giả:** Tech Lead
> **Trace:** `SEC-051`, `SEC-SUP-001 §9.4 §E`, `IOT-5578`
> **Liên quan:** [MCU_SPEC](../../hardware-design/05_mcu_io/MCU_STM32G0_SPEC.md) | [MCU_SECURE_BOOT](../02_design/firmware/FW_MCU_SECURE_BOOT_MK-DDC-24_VI.md) | [SEC-REQ-001](KX-DDC24-SEC-REQ-001_VI.md)

---

## 1. Mục đích

Quy trình này định nghĩa các bước thiết lập **RDP (Read-out Protection) Level 1** cho STM32G0B1RBT6 trong quy trình sản xuất MK-DDC-24.

**RDP Level 1 =** Debug port (SWD/JTAG) bị vô hiệu hóa. Không thể đọc flash qua debugger. Flash vẫn có thể được lập trình qua system bootloader (UART AN3155) cho OTA update.

---

## 2. Yêu cầu

### 2.1 Hardware

| Item | Mô tả |
|------|-------|
| STM32G0B1RBT6 trên PCB MK-DDC-24 | Đã solder, đã nạp firmware bootloader + app |
| ST-Link/V2 hoặc STLINK-V3 | Debugger để set option bytes |
| Jumper wires 1.27mm pitch | Kết nối SWD header (5-pin) lần đầu |

### 2.2 Software

| Tool | Version | Mục đích |
|------|---------|----------|
| STM32CubeProgrammer (STM32CUBEPROG) | ≥2.16 | CLI/GUI để set RDP |
| STM32CubeProgrammer driver | Tương ứng | SWD communication |

### 2.3 Pre-conditions

- [ ] Bootloader đã được flash và verified (tại 0x08000000)
- [ ] Application firmware đã được flash và verified (tại 0x08003000)
- [ ] Device boot OK (HANDSHAKE với SOM)
- [ ] SWD header accessible trên PCB (production jig)

---

## 3. Quy trình — Factory Provisioning

### 3.1 Production Flow

```
┌─────────────────────────────────────────────────────┐
│ Step 1: PCB Assembly                                │
│ Solder STM32G0B1, power-on test                     │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Flash via SWD (ST-Link)                     │
│ • Flash bootloader.bin @0x08000000                  │
│ • Flash mcu_fw_signed.bin @0x08003000               │
│ • Verify CRC-32 flash content                       │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Functional Test (SWD)                       │
│ • Boot test: MCU HANDSHAKE với SOM                  │
│ • I/O loopback test                                 │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Set RDP Level 1 (SWD)                       │
│ • STM32CubeProgrammer CLI set RDP Level 1           │
│ • Power cycle + verify RDP status                   │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Verify SWD locked                           │
│ • Attempt SWD connect → fail expected               │
│ • Boot MCU → verify HANDSHAKE với SOM               │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: Production QA                               │
│ • Record RDP status trong production log            │
│ • QC stamp                                          │
└─────────────────────────────────────────────────────┘
```

### 3.2 STM32CubeProgrammer CLI Commands

#### Kết nối

```bash
STM32_Programmer_CLI -c port=SWD
```

Kết quả mong đợi: `Connection successful`

#### Đọc RDP status hiện tại

```bash
STM32_Programmer_CLI -c port=SWD -rdp
```

Kết quả mong đợi (trước set):
```
RDP: Level 0 (0xAA)
```

#### Set RDP Level 1

```bash
STM32_Programmer_CLI -c port=SWD -ob RDP_LEVEL=0x5A
```

Trong đó:
- `0x5A` = RDP Level 1 (debug port disabled, flash still readable by system bootloader)
- `0xBB` = RDP Level 2 (permanent — không thể revert, không khuyến nghị cho Ver 1)

Kết quả mong đợi:
```
Option Bytes programming: OK
RDP Level 1 set successfully
```

#### Power cycle (bắt buộc sau khi set option bytes)

```bash
STM32_Programmer_CLI -c port=SWD -ob displ
```

Hoặc power cycle manually: tắt nguồn → bật lại.

#### Verify RDP Level 1

```bash
STM32_Programmer_CLI -c port=SWD -rdp
```

Kết quả mong đợi:
```
RDP: Level 1 (0x5A)
```

#### Xác nhận SWD đã bị khóa

```bash
STM32_Programmer_CLI -c port=SWD -el ReadUnprotect
```

Kết quả mong đợi: `Error: SWD access denied (RDP Level 1)`

Hoặc đơn giản: thử đọc flash → `Error: Read protection enabled`

---

## 4. Verify RDP Level 1

Sau khi set RDP Level 1, cần verify:

| Check | Method | Pass |
|-------|--------|------|
| SWD debug bị khóa | STM32CubeProgrammer connect SWD | Connection rejected |
| MCU boot OK | BOOT0=0, power cycle, IOP HANDSHAKE | SOM nhận HANDSHAKE trong 5s |
| IOP communication OK | SOM gửi GET_IO | IO_RESP trong 10ms |
| OTA flash vẫn hoạt động | BOOT0=1 → AN3155 flash | Flash OK, verify CRC |

> **Lưu ý quan trọng:** RDP Level 1 KHÔNG ngăn system bootloader (UART AN3155) flash firmware. OTA update vẫn hoạt động bình thường.

---

## 5. Revert RDP (Chỉ dùng cho RMA / Debug)

Khi cần revert RDP Level 1 về Level 0 (ví dụ: RMA, failure analysis):

```bash
# Mass erase + revert RDP về Level 0
STM32_Programmer_CLI -c port=SWD -ob RDP_LEVEL=0xAA
```

**Hậu quả:**
- Toàn bộ flash bị xóa (mass erase)
- Dữ liệu firmware và cấu hình mất hoàn toàn
- Cần nạp lại firmware từ đầu

Chỉ thực hiện tại factory hoặc RMA center. Không hỗ trợ revert tại field.

---

## 6. Production Checklist

| # | Bước | Tool | Verified |
|---|------|------|:--------:|
| 1 | Flash bootloader.bin @0x08000000 | ST-Link / STM32CubeProg | ☐ |
| 2 | Flash mcu_fw.bin @0x08003000 | ST-Link / STM32CubeProg | ☐ |
| 3 | Verify boot OK (HANDSHAKE) | SOM log | ☐ |
| 4 | Set RDP Level 1 (0x5A) | STM32CubeProgrammer CLI | ☐ |
| 5 | Power cycle | Manual | ☐ |
| 6 | Verify SWD locked | STM32CubeProgrammer CLI | ☐ |
| 7 | Verify MCU boot OK sau RDP | SOM log / IOP test | ☐ |
| 8 | Record RDP status in production log | Production DB | ☐ |
| 9 | QC visual stamp | QC inspector | ☐ |

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| SWD connect fail ngay cả trước RDP | Solder issue, missing VDD | Check SWD header, power |
| RDP set fail: "Option Bytes programming failed" | Flash locked, wrong level code | Check option byte value (0x5A) |
| MCU không boot sau RDP | Bootloader corrupt, wrong VTOR | Revert RDP → reflash → retry |
| OTA flash fail sau RDP | UART AN3155 baud mismatch | Verify 115200 8E1 parity EVEN |

---

## 8. References

- STM32G0B1 Reference Manual (RM0444) §17 — Read-Out Protection
- ST AN5156 — Secure Boot on STM32G0
- STM32CubeProgrammer User Manual (UM2237)
- [MCU Secure Boot Design](../02_design/firmware/FW_MCU_SECURE_BOOT_MK-DDC-24_VI.md)
- [SEC-SUP-001 §9.4 §E](KX-DDC24-SEC-SUP-001_VI.md)
- [SEC-REQ-001 §3.6](KX-DDC24-SEC-REQ-001_VI.md)

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | Tech Lead | Initial release for IOT-5578 RDP Level 1 provisioning |
