# 14 — Bring-up Guide
## MK-DDC-24 — Dựng board lần đầu, theo đúng thứ tự

> **Document ID:** IMPL-BRINGUP-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Trạng thái:** Active
> **Đối tượng:** kỹ sư bring-up (HW + FW + SW). Làm theo ĐÚNG thứ tự, không nhảy bước.

> ⚠️ Quy tắc an toàn: bước nào fail thì DỪNG, không qua bước sau. Mỗi bước có "✅ Đạt khi".

---

## Chuẩn bị

```
- Board MK-DDC-24 Rev A.
- ST-Link V3 + cáp SWD (PA13/PA14).
- USB-UART để xem debug console MCU (USART2, PA2/PA3, 115200 8N1).
- PC dev: arm-none-eabi-gcc/CubeIDE; ssh client.
- Đồng hồ vạn năng; nguồn 0-10V + 4-20mA; hộp công tắc DI; tải relay + đèn.
- Firmware .elf đã build; image SOM (Debian) đã có 3 service mkddc-*.
```

---

## 1. Kiểm tra nguồn (HW — trước khi cấp cho chip)

```
- Đo 24VAC/VDC đầu vào đúng cực.
- Đo các rail: 5V, 3.3V (SOM), 3.3V (MCU side, sau isolation).
- Kiểm 2 GND tách biệt (GND1 MCU / GND2 SOM) — KHÔNG nối trực tiếp tại ADUM1201.
✅ Đạt khi: các rail đúng ±5%, không chập, không nóng bất thường.
```

## 2. Flash MCU

```
- Kết nối ST-Link SWD.
- Nạp firmware .elf.
- Kiểm BOOT0 pull-down (chạy app, không vào bootloader).
✅ Đạt khi: nạp thành công, MCU_LED PD6 nhấp nháy 1Hz.
```

## 3. Mở debug console

```
- USB-UART vào USART2 (PA2/PA3), 115200 8N1.
- Xem log boot MCU.
✅ Đạt khi: thấy log "boot", FreeRTOS task khởi động, không fault liên tục.
```

## 4. Test DI (TC-1-01)

```
- Đóng/mở từng DI1..DI8 bằng hộp công tắc.
- Xác nhận base SKU không có DI_MASK và `BOARD_CAP_MAP=0x000D`; optional DI chỉ kiểm tra trên đúng SKU/module.
✅ Đạt khi: 8/8 kênh đổi đúng bit, debounce mượt.
```

## 5. Test DO (TC-1-02)

```
- Console bật/tắt từng DO1..DO4.
- Quan sát relay + đèn + feedback.
✅ Đạt khi: 4/4 relay đóng/mở thật, feedback khớp.
```

## 6. Test UI raw (TC-1-04)

```
- Cấp 0/5/10V (và 4/12/20mA) vào UI.
- Xem raw + sample_cnt.
✅ Đạt khi: raw tỉ lệ đúng (<1%), sample_cnt tăng đều.
```

## 7. Test AO (TC-1-03)

```
- Console set AO raw 0/32768/65535.
- Đo bằng đồng hồ.
- Test SET_AO_CFG đổi 4-20mA → đo dòng.
✅ Đạt khi: ~0/5/10V (hoặc 4/12/20mA), sai số <2%, safe-state 0V/4mA.
```

> ⏸ Đến đây MCU standalone (Phase 1) coi như chạy. Mới sang phần SOM.

## 8. Boot SOM

```
- Cấp nguồn SOM, chờ Debian boot.

Board chính (Foxlinx SOM-DDC-24, có MCU thật):
  SSH: ssh SOM-DDC-24-foxlinx    (root@mekong-fac.ddns.net:2223, password: admin123)

Board lab (Orange Pi 5B, fake MCU):
  SSH: ssh SOM-DDC-24             (orangepi@mekong-fac.ddns.net:2222, key-only)

✅ Đạt khi: ssh vào được, df/free bình thường, /dev/ttyS2 tồn tại (board chính).
```


## 9. Start mkddc-iobus

```
- systemctl start mkddc-iobus
- journalctl -u mkddc-iobus -f
✅ Đạt khi: service Active(running), mở /dev/ttyS2 OK, không lỗi liên tục.
```

## 10. Check UART handshake (TC-2-02)

```
- Xem log iobus: HANDSHAKE gửi → HANDSHAKE_RESP STATUS=0x00.
- Xem MCU console: nhận HANDSHAKE.
- Đọc shm: ./shm_dump_io (tool chuẩn — 06 §11, decode field + fault bit; fallback thô: xxd /dev/shm/mkddc_io_shm | head, magic LE = 01 44 58 4b).
✅ Đạt khi: handshake OK, iop_status=NORMAL, GET_IO poll chạy, DI/UI lên shm.
```

> Nếu fail: kiểm baud 921600 2 phía, đấu TX/RX (chéo qua ADUM1201), CRC vector (TC-2-01).

## 11. Start mkddc-core

```
- systemctl start mkddc-core
- Kiểm sd_notify READY=1; scan_count tăng.
✅ Đạt khi: core Active, point_table phản ánh IO thật, quality good.
```

## 12. Start mkddc-web

```
- systemctl start mkddc-web
- Mở http://<ip>:8080 (prod → https:8443).
✅ Đạt khi: trang login lên.
```

## 13. Test web point list (TC-5-02)

```
- Login → Point list.
✅ Đạt khi: thấy 24 IO với value/unit/quality.
```

## 14. Test DO từ web (TC-E2E-01)

```
- Web bật DO1 ON.
✅ Đạt khi: relay THẬT đóng, đèn sáng, web confirm ON (feedback), audit log có.
```

## 15. Test AO từ web (TC-E2E-04)

```
- Web đặt AO2 = 7.5V.
✅ Đạt khi: đo ~7.5V.
```

## 16. Test fault (TC-E2E-05/06)

```
- Rút cáp UART → web báo "Mất kết nối MCU", IO safe-state.
- Cắm lại / reset MCU → recover, alarm clear.
✅ Đạt khi: báo lỗi + safe-state + recover tự động.
```

---

## Bảng xử lý sự cố bring-up

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|-------------|------------------------|-------|
| MCU LED không nháy | nạp fail / clock HSE | kiểm SWD, crystal PF0/PF1, BOOT0 |
| Console không log | sai pin/baud USART2 | 115200, PA2/PA3 |
| DI không đổi | opto/pull-up; active-LOW | kiểm PC817, pull-up 10k, logic đảo |
| AO sai V | ao_mode / LDAC | kiểm SET_AO_CFG, pulse LDAC PB0 |
| Handshake fail | baud / TX-RX / CRC | 921600 2 phía, đấu chéo, CRC vector |
| shm trống | iobus chưa ghi / sai path | journalctl iobus; chạy shm_dump_io (exit 2 = chưa init, 1 = FAULT/SAFE) |
| web bật DO không chạy | thiếu core / bypass | core running? web→core IPC? priority? |
| web báo lỗi khi chưa rút | timeout ngưỡng / nhiễu | kiểm iop_timeout, CRC error rate |

---
**Rev** 1.0 | 2026-06-10 · Test chi tiết: [12_INTEGRATION_TEST_PLAN](12_INTEGRATION_TEST_PLAN.md)
