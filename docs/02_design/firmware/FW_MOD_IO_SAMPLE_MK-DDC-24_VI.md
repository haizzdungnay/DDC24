# Module Design — `io_sample` (FW)
## Đọc ADC (UI) + Digital Input — code-ready

> **Document ID:** DDD-FWMOD-IOSMP-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [README](../../01_specs/README.md) · **Trace:** `FW-IO-001..024` · Pinout [D-1](FW_PINOUT_MASTER_MK-DDC-24_VI.md)

---

## 1. Nhiệm vụ
Task Pri 7, **chu kỳ 1 ms** (cao nhất). Đọc 8 kênh ADS131M08 (SPI3 DMA) + 8 DI, lọc, ghi `io_data_buf`. Đây là hot-path — phải nhanh, không blocking.

## 2. Trigger & luồng
```
TIM (1ms) ISR → xTaskNotifyFromISR(io_sample_task)
io_sample_task:
  1. start SPI3 DMA đọc 24 byte (8×24-bit) từ ADS131M08
  2. (DMA TC ISR) → có dữ liệu → moving-average 8 mẫu/kênh, spike reject ±10%
  3. đọc 8 GPIO DI (PB4..PB11) → debounce 20ms (state ổn định liên tục)
  4. lock xIoDataMutex (ngắn): ghi ui_raw[8], di_mask, sample_cnt++
  5. nếu ADS131M08 không phản hồi 5ms → FAULT_FLAGS.ADC_FAULT, thử reinit mỗi 1s
```

## 3. ADS131M08 (SPI3, Mode 1, 4MHz)
```c
// init: ODR=1kSPS, gain=1, PGA bypass (FW_ARCH §6.1)
// đọc: 1 frame = (status 24b) + 8×(data 24b) ; CS xuống suốt 8 kênh
// raw uint24 BE → lưu uint32 (bù 0 byte cao)
```
- DRDY (PA8) có thể dùng interrupt thay timer (FW-Q-004, tối ưu sau).
- Cần MOSI (SDI) để ghi config register (đừng quên — D-1).

## 4. Bộ lọc
- **Moving average 8 mẫu** (FW-IO-002) — đủ mượt cho HVAC.
- **Spike reject**: mẫu lệch > ±10% range bị bỏ (FW-IO-003, SHOULD).

## 5. Debounce DI
```
mỗi DI: đếm số tick trạng thái ổn định; chỉ đổi state khi ổn định ≥ debounce_ms (mặc định 20ms, 5–100ms cấu hình)
đếm cạnh (R_TRIG/F_TRIG) → counter uint16 mỗi kênh (FW-IO-023)
```
> Logic active-LOW sau opto: `DI_ON = !gpio_read` (IO_DI §2).

## 6. Auto-detect sensor (khi boot, chưa có config) — FW-IO-010..012
```
đo điện trở/điện áp → tra Bảng 2.2.1 (FW_REQ):
  <200Ω→dry; 200Ω–2k→PT100; 2k–4k→PT1000; 8k–12k→NTC10k; 16k–24k→NTC20k;
  có áp 0–10V→0-10V; có loop→4-20mA; >100k→hở
→ báo gợi ý lên SOM; user xác nhận qua Web UI
```

## 7. Dữ liệu xuất (`io_data_buf`, FW_ARCH §4.1)
`ui_raw[8] (uint32), di_mask, do_fb_mask, mcu_temp_x10, fault_flags, sample_cnt, timestamp_ms`.

## 8. Budget
Stack 512B; thời gian < 200µs/chu kỳ; SPI dùng DMA (FW-IO-007).

## 9. Test
- Đo chu kỳ thực bằng oscilloscope CS toggle ≤1ms (T-FW-001).
- Inject noise → average mượt (T-FW-002). Ngắt ADC → ADC_FAULT ≤5ms (T-FW-006).

## 10. Trace REQ
`FW-IO-001..024`, `T-FW-001..012`.

---
**Rev** 1.0 | 2026-05-30
