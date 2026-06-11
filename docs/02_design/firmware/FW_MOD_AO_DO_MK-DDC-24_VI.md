# Module Design — `ao_output` + `do_control` (FW)
## Xuất Analog Output + điều khiển Relay — code-ready

> **Document ID:** DDD-FWMOD-AODO-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [README](../../01_specs/README.md) · **Trace:** `FW-AO-001..009`, `FW-DO-001..006`

---

## A. `ao_output_task` (Pri 6, 10ms) — DAC8554 qua SPI1

### A.1 Luồng
```
nhận ao_cmd_t từ xAoQueue (không chờ nếu rỗng):
  if safe_state: ghi giá trị safe (mode 0-10V→0V; 4-20mA→4mA. Protocol raw=0 cho cả 2 mode
  — SWFW §6.3; 13107 chỉ là DAC count nội bộ nếu tầng vật lý 0–20mA)
  else:
    validate mỗi raw ∈ [0,65535]  (ngoài → NACK + log)  [FW-AO-006]
    ghi 4 kênh DAC8554 (SPI1 DMA), rồi pulse LDAC (PB0) update đồng bộ
  nếu DAC không phản hồi (SPI timeout) → FAULT_FLAGS.DAC_FAULT  [FW-AO-003]
```
- **Hold-last** khi mất IOP: không tự về 0 trừ khi nhận RESET_IO (FW-AO-005).
- Ghi DAC ≤ 5ms sau SET_AO (FW-AO-001).

### A.2 DAC8554 (SPI1, Mode 1, 8MHz)
```c
// 24-bit/kênh: [8-bit control][16-bit data]; LDAC pulse để latch đồng bộ 4 kênh
// VREF=2.5V (REF3025) → DAC 0..5V → op-amp ×2 → 0..10V
```

### A.3 AO mode (phần mềm — SET_AO_CFG)
- Nhận `0x13 SET_AO_CFG` (bitmask) → set chân AO_MODE PD1..PD4 (relay/analog-switch chọn đường 0–10V vs 4–20mA).
- Mặc định boot: tất cả 0–10V (FW-AO-008).
- Safe-state phụ thuộc mode: 0V hoặc 4mA (FW-AO-009).

## B. `do_control_task` (Pri 6, 10ms) — relay qua ULN2003

### B.1 Luồng
```
nhận do_cmd_t {mask, value} từ xDoQueue:
  for ch in 0..3:
    if mask & (1<<ch): set PC[ch] = (value>>ch)&1   (active HIGH → ULN2003 → relay)
  đọc feedback GPIO → cập nhật do_fb_mask
  nếu fb != lệnh sau 20ms → FAULT_FLAGS.RELAY_STUCK  [FW-DO-003]
  rate-limit: ≤10 đóng/mở/giây/kênh  [FW-DO-005]
  lifetime switch counter mỗi kênh  [FW-DO-006]
safe_state → tất cả relay OPEN (de-energized)  [FW-DO-004]
```
- Điều khiển ≤ 5ms sau SET_DO (FW-DO-001).

## C. Safe-state (chung)
| Output | Safe value |
|--------|-----------|
| AO 0–10V | 0V (raw 0) |
| AO 4–20mA | 4mA (protocol raw 0x0000 — SWFW §6.3; DAC count nội bộ ≈13107 nếu span 0–20mA) |
| DO relay | OPEN |
Kích hoạt khi: RESET_IO, IOP timeout 200ms, watchdog, VDD/ADC fault.

## D. Test
- SET_AO raw=32767 → đo 5.0V ±0.1V (T-FW-030).
- RESET_IO → AO=0V ≤5ms (T-FW-033). SET_DO → relay đóng + feedback (T-FW-040). Chặn coil → RELAY_STUCK (T-FW-042).

## E. Trace REQ
`FW-AO-001..009`, `FW-DO-001..006`, `T-FW-030..045`.

---
**Rev** 1.0 | 2026-05-30
