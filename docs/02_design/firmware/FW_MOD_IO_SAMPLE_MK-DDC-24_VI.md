# Module Design — `io_sample` (FW)
## Đọc 2× ADC cho UI1-UI16 — code-ready

> **Document ID:** DDD-FWMOD-IOSMP-MK-DDC-24-VI · **Rev** 2.0 | 2026-06-30
> 📘 [README](../../01_specs/README.md) · **Trace:** `FW-IO-001..024` · Pinout [D-1](FW_PINOUT_MASTER_MK-DDC-24_VI.md)

---

## 1. Nhiệm vụ
Task Pri 7, **chu kỳ 1 ms** (cao nhất). Đọc 16 kênh từ 2× ADS131M08 (SPI3 DMA, CS/DRDY độc lập), lọc, ghi `io_data_buf`. Base SKU không có DI GPIO/DI_MASK.

## 2. Trigger & luồng
```
TIM (1ms) ISR → xTaskNotifyFromISR(io_sample_task)
io_sample_task:
  1. đọc ADS #1 (UI1-UI8) và ADS #2 (UI9-UI16) qua SPI3 DMA
  2. sign-extend từng s24 sang int32; cập nhật moving-average/status per ADC
  3. lock xIoDataMutex (ngắn): ghi ui_raw[16], adc1_stat, adc2_stat, sample_cnt++
  4. nếu một ADC không có mẫu hợp lệ 100ms → set ADC1_FAULT/ADC2_FAULT, thử reinit mỗi 1s
```

## 3. ADS131M08 (SPI3, Mode 1, 4MHz)
```c
// init: ODR=1kSPS, gain=1, PGA bypass (FW_ARCH §6.1)
// mỗi ADC: 1 frame = status + 8×data 24b; CS riêng cho từng chip
// raw s24 BE → sign-extend và lưu int32
```
- DRDY (PA8) có thể dùng interrupt thay timer (FW-Q-004, tối ưu sau).
- Cần MOSI (SDI) để ghi config register (đừng quên — D-1).

## 4. Bộ lọc
- **Moving average 8 mẫu** (FW-IO-002) — đủ mượt cho HVAC.
- **Spike reject**: mẫu lệch > ±10% range bị bỏ (FW-IO-003, SHOULD).

## 5. UI mode and dry-contact handling

Mode is configured per channel and latched outside the hot sampling path. Auxiliary dry-contact
uses the UI front-end and firmware debounce; it is non-isolated and must not be exposed as base-SKU DI.
PT100/PT1000 and unverified sensor auto-detection are not Rev A requirements.

## 7. Dữ liệu xuất (`io_data_buf`, FW_ARCH §4.1)
`ui_raw[16] (int32 signed), adc1_stat, adc2_stat, do_fb_mask, mcu_temp_x10, fault_flags, sample_cnt, timestamp_ms`.

## 8. Budget
Stack 512B; thời gian < 200µs/chu kỳ; SPI dùng DMA (FW-IO-007).

## 9. Test
- Đo chu kỳ thực bằng oscilloscope CS toggle ≤1ms (T-FW-001).
- Inject noise → average mượt (T-FW-002). Ngắt riêng từng ADC → đúng ADC1_FAULT/ADC2_FAULT sau 100ms no-valid-sample threshold (T-FW-006).

## 10. Trace REQ
`FW-IO-001..024`, `T-FW-001..012`.

---
**Rev** 2.0 | 2026-06-30 (ADR-010: 2× ADS131M08, 16 signed UI, no base DI)
