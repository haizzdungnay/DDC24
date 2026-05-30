# FW Developer Guide & Backlog — MK-DDC-24
## Firmware (MCU STM32G0B1) — từ số 0 đến chạy được

> **Document ID:** KX-DDC24-FW-DEVGUIDE-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved · **Owner:** FW Lead
> 📘 [docs/README](../README.md) · Code: [REPO](KX-DDC24-PM-REPO-001_VI.md) · Thiết kế: [FW_DDD](../../design/firmware/FW_DDD_MK-DDC-24_VI.md) · Chuẩn: [FW Coding Standard](../../design/firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md)

> 🎯 Một dev FW mở file này là: cài được đồ nghề → tạo project → chạy được "đèn nháy" → trả lời được 1 frame IOP → rồi đắp dần đủ tính năng theo **backlog cỡ ticket**. Mỗi ticket nói rõ: làm gì, đụng file nào, xong là gì, test gì.

---

## 1. Chuẩn bị (Day 1)
| Việc | Lệnh / ghi chú |
|------|----------------|
| Cài toolchain | `sudo apt install gcc-arm-none-eabi cmake ninja-build` + STM32CubeIDE 1.15 |
| Cài tester | Unity (vendored trong `fw/test/`), cppcheck (`sudo apt install cppcheck`) |
| Phần cứng | board MCU + ST-Link V3; cáp USB-UART (xem log USART2) |
| Đọc trước | [D-1 Pinout](../../design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) (chân), [FW_DDD §3](../../design/firmware/FW_DDD_MK-DDC-24_VI.md) (6 task) |

## 2. Bản đồ file (code ở đâu)
```
fw/
├── Core/main.c              ← CubeMX sinh; gọi app_init() + vTaskStartScheduler()
├── common/iop_protocol.h    ← symlink → ../shared/iop_protocol.h (HỢP ĐỒNG, đừng sửa)
├── common/crc16.c           ← (đã có iop_crc16 inline trong header) tiện ích khác
├── drivers/
│   ├── adc_drv.c            ← ADS131M08 qua SPI3 + DMA
│   ├── dac_drv.c            ← DAC8554 qua SPI1
│   ├── iop_drv.c            ← USART1 DMA + IDLE
│   └── gpio_drv.c           ← DI/DO/mux/AO-mode pins
├── app/
│   ├── io_sample.c          ← task Pri7 1ms   (FW_MOD_IO_SAMPLE)
│   ├── iop_comm.c           ← task Pri6       (FW_MOD_IOP_COMM)  ⭐ xương sống
│   ├── ao_output.c          ← task Pri6       (FW_MOD_AO_DO §A)
│   ├── do_control.c         ← task Pri6       (FW_MOD_AO_DO §B)
│   ├── diagnostics.c        ← task Pri2 1s
│   └── watchdog.c           ← task Pri1       (FW_MOD_DIAG_WDG)
└── test/                    ← Unity: test_crc.c, test_iop_parse.c, test_scale.c (host)
```

## 3. 🚶 Walking skeleton (mốc "chạy được" đầu tiên — làm theo thứ tự)
> Mục tiêu: trong ~1 tuần có MCU **trả lời 1 frame IOP** từ PC test. Có cái này là phần khó nhất đã thông.

```
B1  CubeMX theo D-1 → generate → blink LED PD6 + printf USART2     (T-FW-01)
B2  Thêm FreeRTOS, tạo 6 task RỖNG đúng priority + watchdog kick   (T-FW-02)
B3  iop_protocol.h + iop_crc16: viết test_crc.c, pass 2 vector     (T-FW-03a)
B4  iop_drv: USART1 RX DMA+IDLE → nhận byte; TX DMA                (T-FW-03b)
B5  iop_comm: parse frame, đáp HANDSHAKE → HANDSHAKE_RESP          (T-FW-03c)
✅  PC test gửi HANDSHAKE → nhận RESP đúng CRC = SKELETON SỐNG
```
Sau đó mới đắp đọc ADC, AO/DO, diag...

## 4. 🎫 Backlog (ticket-level — pick lên làm)

> Mỗi ticket: **Mục tiêu · File · Acceptance (xong=gì) · Test · Ước lượng · Trace**. Theo thứ tự phụ thuộc.

### FW-T01 — Bring-up + blink  ` (S1) `
- **Mục tiêu:** project CubeMX đúng D-1, nạp chạy.
- **File:** `Core/*`, `.ioc`.
- **Acceptance:** LED PD6 nháy 1Hz; `printf` ra USART2 115200; clock 64MHz.
- **Test:** quan sát + đo clock.
- **Trace:** D-1, FW-BOOT.

### FW-T02 — Khung FreeRTOS + watchdog ` (S1) `
- **Mục tiêu:** 6 task rỗng + IWDG.
- **File:** `app/*.c` (rỗng), `app/watchdog.c`, `main.c`.
- **Acceptance:** 6 task chạy đúng priority/period (FW_ARCH §2.1); watchdog kick; không reset; in stack high-water-mark.
- **Test:** chạy 10 phút không reset; log stack.
- **Trace:** FW_ARCH §2, FW-WDG.

### FW-T03 — IOP handshake + CRC ⭐ ` (S2) `
- **Mục tiêu:** trả lời HANDSHAKE.
- **File:** `common/iop_protocol.h` (symlink), `drivers/iop_drv.c`, `app/iop_comm.c`, `test/test_crc.c`, `test/test_iop_parse.c`.
- **Acceptance:** test_crc pass 2 vector trong header; RX IDLE+DMA nhận frame; verify CRC/SEQ; HANDSHAKE→RESP (version) qua TX DMA.
- **Test:** Unity parse (frame đúng/sai LEN/sai CRC/unknown CMD); PC test handshake thật.
- **Trace:** IOP-FW-001..010, [FW_MOD_IOP_COMM](../../design/firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md).

### FW-T04 — Đọc ADS131M08 + DI ` (S2) `
- **Mục tiêu:** io_sample 1ms.
- **File:** `drivers/adc_drv.c`, `drivers/gpio_drv.c`, `app/io_sample.c`.
- **Acceptance:** chu kỳ ≤1ms (đo CS bằng scope); moving-avg 8; debounce DI 20ms; đổi input → giá trị raw đổi; rút cáp ADC → set IOP_FAULT_ADC.
- **Test:** scope CS toggle; inject tín hiệu.
- **Trace:** FW-IO-001..024, [FW_MOD_IO_SAMPLE](../../design/firmware/FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md).

### FW-T05 — GET_IO → IO_RESP ` (S2) `
- **Mục tiêu:** ghép T03+T04, trả dữ liệu cho SOM.
- **File:** `app/iop_comm.c` (build IO_RESP 34 byte theo header offsets).
- **Acceptance:** BE đọc đúng 8 UI raw + DI; latency GET_IO→TX ≤5ms; không có GET_IO 200ms → safe-state.
- **Test:** đo latency; cắt poll → kiểm safe-state.
- **Trace:** IOP-FW, FW-WDG-005.

### FW-T06 — SET_AO + DAC8554 ` (S3) `
- **File:** `drivers/dac_drv.c`, `app/ao_output.c`.
- **Acceptance:** SET_AO raw 32767 → đo 5.0V ±0.1V; LDAC update đồng bộ; RESET_IO → 0V/4mA theo mode; SET_AO_CFG đổi mode pin.
- **Test:** đo DMM; T-FW-030/033.
- **Trace:** FW-AO-001..009.

### FW-T07 — SET_DO + relay ` (S3) `
- **File:** `app/do_control.c`.
- **Acceptance:** relay đóng/mở + đọc feedback; stuck-detect 20ms; rate-limit 10/s.
- **Test:** chặn coil → RELAY_STUCK (T-FW-042).
- **Trace:** FW-DO-001..006.

### FW-T08 — diagnostics + safe-state FSM ` (S3) `
- **File:** `app/diagnostics.c`, hoàn thiện FSM trong `iop_comm.c`.
- **Acceptance:** MCU temp/VDD; GET_DIAG→DIAG_RESP; FSM INIT→HANDSHAKE→NORMAL→{IOP_FAULT,SAFE_STATE}.
- **Trace:** FW-DIAG, FW_ARCH §7.

### FW-T09 — Bootloader/OTA hook ` (S6) `
- **File:** `app/iop_comm.c` (RESET_IO reason=OTA → safe-state).
- **Acceptance:** nhận lệnh OTA → safe-state; cho SOM kéo BOOT0+reset nạp (xem [FW_BOOTLOADER_OTA](../../design/firmware/FW_BOOTLOADER_OTA_MK-DDC-24_VI.md)).
- **Trace:** FW-OTA-001..005.

## 5. Definition of Done (mọi ticket FW)
- [ ] MISRA C subset 0 lỗi (cppcheck `--addon=misra`); build `-Werror`.
- [ ] Không `malloc` sau khi RTOS chạy.
- [ ] Unit test (Unity) cho logic thuần (CRC, scale, FSM) pass.
- [ ] PR ghi REQ ID + Task ID; FW Lead duyệt nếu đụng IOP/safe-state.
- [ ] Cập nhật Traceability.

## 6. Bẫy hay gặp (đọc kẻo mất ngày)
- Quên nối **MOSI SPI3** → không ghi được config ADS131M08 → đọc rác.
- ISR gọi RTOS API phải dùng `*FromISR` + priority đúng (FW Coding §5).
- CRC sai do quên **truyền HI trước LO** (big-endian) — so test vector.
- LDAC: ghi 4 kênh DAC rồi mới pulse LDAC, đừng pulse từng kênh.
- Safe-state 4-20mA = **4mA (raw 13107)**, KHÔNG phải 0.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | FW Lead | Phát hành đầu — guide + walking skeleton + 9 ticket |
