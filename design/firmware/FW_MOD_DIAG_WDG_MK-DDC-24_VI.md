# Module Design — `diagnostics` + `watchdog` (FW)
## Giám sát + Watchdog — code-ready

> **Document ID:** DDD-FWMOD-DIAGWDG-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [spec/README](../../spec/README.md) · **Trace:** `FW-DIAG-001..006`, `FW-WDG-001..006`

---

## A. `diagnostics_task` (Pri 2, 1000ms)
```
mỗi 1s:
  - đo MCU die temp (ADC nội) → mcu_temp_x10; cập nhật mcu_temp_max
    if >85°C → FAULT_FLAGS.MCU_OVERTEMP + giảm ADC sampling xuống 100ms  [FW-DIAG-002]
  - đo VDD (internal ref); if <3.0V hoặc >3.6V → fault + NGỪNG AO  [FW-DIAG-004]
  - cập nhật counters: iop_rx_cnt, iop_crc_err, iop_seq_err, wdg_reset_cnt
    (lưu SRAM backup — survive soft reset)  [FW-DIAG-005/006]
```
Các giá trị này trả về SOM khi nhận `GET_DIAG` (DIAG_RESP 20 byte, IOP-SPEC §4.8).

## B. `watchdog_task` (Pri 1, 500ms) — IWDG + health check
```
mỗi 500ms:
  health = io_sample_alive && iop_comm_alive   (cờ heartbeat mỗi task set)
  if health:  HAL_IWDG_Refresh()      // kick (timeout 1s)
  else:       KHÔNG kick → IWDG reset MCU sau 1s   [FW-WDG-003]
```
- IWDG timeout **1s** (FW-WDG-001/002).
- WWDG (window) cho `iop_comm` — kick quá sớm cũng fault (FW-WDG-004, SHOULD).
- **IOP watchdog** (trong iop_comm): không nhận GET_IO 200ms → safe-state (FW-WDG-005).

## C. Sau reset
```
boot: đọc RCC_CSR → xác định nguyên nhân (IWDG/WWDG/power/soft)
  lưu vào SRAM backup + FAULT_FLAGS.MCU_WATCHDOG_RESET (sticky)  [FW-WDG-006]
  clear flag chỉ khi SOM đọc xong (IOP-SPEC §4.3.1)
```

## D. Self-test khi boot (FW-BOOT-004/005)
```
- đọc internal reference → verify ±5%; fail → KHÔNG xuất AO/DO, báo fault qua IOP
- thứ tự init: Clocks/GPIO → UART DMA → SPI ADC+DAC → FreeRTOS start
- sẵn sàng trả IO_RESP ≤ 500ms sau POR  [FW-BOOT-001]
```

## E. FSM tổng (FW_ARCH §7)
```
INIT → HANDSHAKE → NORMAL → {IOP_FAULT, SAFE_STATE}
PERMANENT_FAULT (VDD/ADC init fail): không kick IWDG → HW reset → boot lại
```

## F. Test
- Suspend watchdog_task → MCU reset ≤1s (T-FW-050).
- Gây watchdog reset → MCU_WATCHDOG_RESET=1 sau boot (T-FW-055).

## G. Trace REQ
`FW-DIAG-001..006`, `FW-WDG-001..006`, `FW-BOOT-001..005`, `T-FW-050..074`.

---
**Rev** 1.0 | 2026-05-30
