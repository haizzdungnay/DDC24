# Service Design — `kinexus-io-driver` (SW)
## IOP Master + scale + shared memory — code-ready

> **Document ID:** DDD-SWSVC-IOD-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [README](../../01_specs/README.md) · **Trace:** `SW-IOP-001..011`, IOP-SPEC, SW_ARCH §2/§4

> Service nền tảng nhất của SOM: nó là **người duy nhất nói chuyện với MCU**. Mọi service khác đọc I/O qua shared memory nó ghi ra.

> ⚠️ **LEGACY / REFERENCE-ONLY (2026-06-11).** Vai trò "io-driver" trong file này đã được
> gộp vào **`mkddc-iobus`** (ADR-005 + Contract Freeze). Khi code Rev A: dùng
> [06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE](../../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md)
> + [`contracts/shm/mkddc_shm.h`](../../../contracts/shm/mkddc_shm.h) + [`contracts/iop/iop_protocol.h`](../../../contracts/iop/iop_protocol.h).
> File này lệch các nguồn đó → nguồn mới thắng (path SHM cũ `/dev/shm/kinexus_io_shm` đã đổi
> thành `/dev/shm/mkddc_io_shm`; struct chuẩn là `kx_io_shm_t`, không phải `kinexus_io_shm_t`).

---

## 1. Nhiệm vụ
- Mở `/dev/ttySx` (UART2 → MCU), chạy **IOP Master**: poll `GET_IO` 100Hz, gửi `SET_AO/SET_DO`.
- **Scale** raw → engineering (CVD, Steinhart-Hart…).
- Ghi `/dev/shm/mkddc_io_shm` (seqlock) cho core/web/HMI đọc theo `shared/mkddc_shm.h`.
- Chạy **SCHED_FIFO 70** (SW-IOP-010).

## 2. Vòng lặp chính (100Hz)
```c
set_sched_fifo(70);
open_uart("/dev/ttyS2", 921600);
iop_handshake();                        // version check
struct timespec next; clock_gettime(CLOCK_MONOTONIC, &next);
for (;;) {
    seq++;
    send_get_io(seq);
    if (recv_frame(&resp, 10ms) && crc_ok(&resp) && resp.seq==seq) {
        parse_io_resp(&resp);           // 8 UI raw, DI, fault, sample_cnt
        scale_all(&eng);                // raw → °C/V/mA (mục 4)
        shm_write(&eng);                // seqlock (mục 5)
        reset_fault_timer();
    } else {
        if (++retry >= 3) { iop_fault(); if (fault>100ms) safe_state(); }
    }
    // nếu PLC đổi AO/DO (đọc từ shm) → gửi SET_AO/SET_DO
    push_outputs_if_changed();
    next += 10ms; clock_nanosleep(ABSTIME, &next);   // nhịp chính xác
}
```

## 3. FSM (SW-IOP-008/009)
```
NORMAL ──(timeout×3)──► IOP_FAULT ──(>100ms)──► SAFE_STATE(gửi RESET_IO, alarm)
   ▲                                                   │
   └──────────────── HANDSHAKE lại (mỗi 5s) ◄──────────┘
```
Phát alarm qua `alarm.sock` (JSON line, SW_ARCH §2.3).

## 4. Scale raw → engineering (SW_ARCH §4 — nguồn-chuẩn)
```python
# minh hoạ; thực tế viết C
def scale(raw_s24, sensor):
    v_adc = raw_s24 / 8388607.0 * 2.44  # ADS131M08 VREF, PGA gain 1
    if sensor=="0-10V":  return v_adc * 9.2645
    if sensor=="2-10V":  return v_adc * 9.2645
    if sensor=="4-20mA": return v_adc / 49.9 * 1000.0
    if sensor in ("PT100","PT1000"): return cvd_invert(R_from_raw(raw_s24))  # IEC 60751
    if sensor in ("NTC10k","NTC20k"): return beta_ntc(R_pullup * v_adc / (Vexc - v_adc))  # B=3950
    if sensor=="dry": return 1.0 if raw_s24>thr else 0.0
```
- Hệ số NTC β=3950: A=1.129e-3, B=2.341e-4, C=8.76e-8 (đồng bộ IO_UI/SW_ARCH).
- Transfer Rev A theo `hardware-design/03_io_subsystem/IO_UI_CIRCUIT.md`:
  - ADS131M08: `V_adc = raw_s24 / 8388607.0 * 2.44`, PGA gain = 1.
  - Voltage UI: divider 100k/12.1k, `V_field = V_adc * 9.2645`.
  - Current UI: shunt 49.9Ω, `I_mA = V_adc / 49.9 * 1000`.
  - NTC: divider `R_ntc = R_pullup * V_adc / (Vexc - V_adc)`; Vexc phải được đo/compensate trong bring-up.
- Calibration hook: mỗi UI channel có 2-point linear calibration `field_cal = raw_field * cal_gain + cal_offset`. Default identity (`cal_gain=1.0`, `cal_offset=0.0`); giá trị production nạp trong HW bring-up qua config/NVM.
- Cấu hình sensor đọc từ `io_config.conf` (D-5).

## 5. Shared memory seqlock (SW_ARCH §2)
```c
// writer (driver)
shm->seq++; __sync_synchronize();        // odd = đang ghi
/* ghi ui_value[], di_mask, ao_setpoint[], fault... */
__sync_synchronize(); shm->seq++;        // even = xong
// reader (PLC/HMI) đọc theo seqlock pattern, KHÔNG block writer
```
Struct chuẩn: `kx_io_shm_t` trong `shared/mkddc_shm.h` (SW_REQ §2.2 là bản phác cũ, đã legacy).

## 6. Output (SET_AO/SET_DO)
- Đọc `ao_setpoint[]/do_mask` từ shm (PLC ghi) → nếu đổi → gửi frame. AO eng→raw (clamp).
- Mode AO gửi `SET_AO_CFG` sau handshake (theo `io_config.conf`).

## 7. Metrics & lỗi
- Đếm `iop_crc_err/iop_timeout/iop_seq_err` → expose qua REST `/system/status` (SW-IOP-011).

## 8. Test
- Concurrent reader không corrupt (seqlock) — T-SW-005.
- Block MCU → retry×3 → fault — T-SW-004. `chrt -p` = FIFO 70 — T-SW-010.

## 9. Trace REQ
`SW-IOP-001..011`, `IOP-SW-001..010`, `T-SW-001..011`.

---
**Rev** 1.0 | 2026-05-30
