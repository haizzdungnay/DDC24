# FW Bootloader & MCU Update — MK-DDC-24
## D-7 (phần MCU) — nạp firmware STM32 từ SOM

> **Document ID:** DDD-FWBOOT-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [README](../../01_specs/README.md)
> **Trace:** `FW-OTA-001..005`, `MCU_SPEC §7` · Đi kèm [SW_OTA_DESIGN](../software/SW_OTA_DESIGN_MK-DDC-24_VI.md)

---

## 1. Yêu cầu cốt lõi
**Ver 1 BẮT BUỘC:** SOM (CM3) nạp được firmware MCU **không cần ST-Link** (FW-OTA-001). Dùng **ROM system bootloader của STM32** (giao thức ST **AN3155** qua UART).

## 2. Phần cứng cần (đã có trong D-1 Pinout)
| Tín hiệu | Pin MCU | Điều khiển bởi |
|----------|---------|----------------|
| BOOT0 | BOOT0 (pull-down) | CM3 GPIO kéo HIGH để vào bootloader |
| nRESET | NRST | CM3 GPIO0_A4 |
| UART nạp | USART1 (IOP) hoặc USART2 | CM3 |

> ROM bootloader STM32G0 hỗ trợ USART. Chọn 1 UART (xem Open issue). BOOT0=1 + reset → vào bootloader.

## 3. Quy trình nạp (SOM thực hiện)
```
1. SOM gửi RESET_IO (IOP) → MCU đưa AO=0/4mA, DO=open (safe-state)  [FW-OTA-002]
2. SOM: GPIO BOOT0 = HIGH
3. SOM: pulse nRESET (LOW→HIGH)  → MCU vào ROM bootloader (AN3155)
4. SOM mở UART 115200 8E1 (parity EVEN theo AN3155), gửi 0x7F (auto-baud)
5. Lệnh AN3155:
     - Get/GetID  (xác nhận chip)
     - Extended Erase (xoá vùng app)
     - Write Memory (ghi mcu_fw.bin theo block 256 byte, có checksum)
     - (đọc lại verify nếu cần)
6. SOM verify CRC ảnh đã ghi  [FW-OTA-004]
   ├─ OK   → Go (jump app) hoặc reset
   └─ FAIL → KHÔNG để app hỏng; giữ lại / thử lại  [FW-OTA-005]
7. SOM: BOOT0 = LOW, pulse nRESET → MCU chạy firmware mới
8. MCU khởi động ≤ 5s, HANDSHAKE lại với SOM  [FW-OTA-003]
```

## 4. An toàn
- Trong lúc flash, output **đã ở safe-state** từ bước 1 (relay mở, van đóng).
- Nếu mất điện giữa chừng: app cũ có thể hỏng → lần boot sau MCU không HANDSHAKE → SOM phát hiện, **thử nạp lại** (idempotent). Vì vậy bước flash phải **retry-safe**.
- Bản chống brick: giữ ROM bootloader (luôn còn) → luôn nạp lại được qua UART.

## 5. Firmware app — yêu cầu liên quan
- App đặt vector table tại địa chỉ app (sau vùng bootloader hook nếu có).
- App lắng nghe lệnh IOP `RESET_IO` reason=0x04 (OTA reboot) để vào safe-state trước khi SOM kéo BOOT0.
- CRC ảnh app: tính khi build, SOM verify sau ghi.

## 6. Pseudo-code phía SOM (kinexus-ota)
```python
def flash_mcu(fw_bin: bytes):
    iop.send_reset_io(reason=0x04)          # safe-state
    gpio_boot0.set(1); pulse(gpio_nreset)   # vào bootloader
    bl = Stm32Bootloader(uart="/dev/ttySX", baud=115200, parity="E")
    bl.connect()                            # 0x7F auto-baud
    assert bl.get_id() == STM32G0B1_ID
    bl.extended_erase(app_pages)
    bl.write_memory(APP_ADDR, fw_bin, block=256)
    assert crc32(bl.read_memory(APP_ADDR, len(fw_bin))) == expected_crc
    gpio_boot0.set(0); pulse(gpio_nreset)   # chạy app mới
    assert iop.wait_handshake(timeout=5)
```

## 7. Open issues
| ID | Vấn đề | Owner |
|----|--------|-------|
| — | Chọn UART nạp (IOP USART1 vs USART2 debug) | FW |
| — | Có cần custom bootloader thay ROM không (nếu cần dual-bank) | FW |

## 8. Trace REQ
`FW-OTA-001..005`, `OTA-004`, `T-FW-080..084`.

---
**Rev** 1.0 | 2026-05-30
