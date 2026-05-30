# Soft PLC Engine Design — MK-DDC-24
## D-6 — `kinexus-plc` (IEC 61131-3 runtime)

> **Document ID:** DDD-PLC-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [spec/README](../../spec/README.md)
> **Trace:** `PLC-001..023`, `SW-PLC-001..022`, `IDE-001..007` · C++17

---

## 1. Quyết định nền (DEC-001)
**Hai lựa chọn** cho engine:
| Phương án | Ưu | Nhược |
|-----------|----|-------|
| (A) Dùng **OpenPLC / MATIEC** (ST→C transpile) | nhanh, có sẵn IEC 61131-3 | license (GPL) cần review cho sản phẩm thương mại; khó nhúng |
| (B) **Tự build** engine FBD/ST tối thiểu | kiểm soát hoàn toàn, license sạch | tốn công, phải tự test conformance |

> **Cần chốt trước DP-2 (DEC-001).** Tài liệu này thiết kế theo hướng **(B) engine nội bộ tối thiểu** (an toàn pháp lý), nhưng interface dữ liệu giống nhau nên đổi được.

## 2. Mô hình thực thi (scan cycle)
```
mỗi chu kỳ scan (mặc định 100ms, cấu hình 50–2000ms):
  1. READ INPUTS:  copy từ kinexus_io_shm → ảnh %IW (AI), %IX (DI)
  2. RUN PROGRAMS: chạy lần lượt ≥16 program (FBD/ST) theo thứ tự
  3. WRITE OUTPUTS: ảnh %QW (AO), %QX (DO) → kinexus_io_shm
                    + cập nhật kinexus_plc_shm (object BACnet AV/BV…)
  4. HOUSEKEEPING: cập nhật timer, retain, watchdog
```
- **SCHED_FIFO 80**, jitter ≤ 5ms (đo p99 trong 1h) — dùng `clock_nanosleep(TIMER_ABSTIME)`.
- "Đọc tất cả input → tính → ghi tất cả output" (mô hình ảnh I/O, tránh đọc giữa chừng).

## 3. Bộ nhớ biến (variable space)
```cpp
struct PlcVarSpace {
  float  reals[512];   // REAL
  bool   bools[512];   // BOOL
  int32_t ints[512];   // INT/DINT
  uint32_t dwords[256];// DWORD
};
// RETAIN: tập con được đánh dấu, ghi /data/plc/retain.dat
```
- ≥ 512 biến global (PLC-021). Ánh xạ I/O vật lý ↔ địa chỉ `%IW/%QW/%IX/%QX`.

## 4. Function Block chuẩn (bắt buộc — PLC-003/004)
`TON, TOF, TP, CTU, CTD, CTUD, RS, SR, F_TRIG, R_TRIG, PID_COMPACT, Hysteresis, Ramp, Avg`.

### 4.1 PID_COMPACT (chi tiết — quan trọng cho HVAC)
```
Input:  SP (setpoint), PV (process value), Kp, Ti, Td, Mode(Auto/Manual), ManVal
Output: OUT (0–100%)
Thuật toán (PID rời rạc, anti-windup):
  e   = SP - PV
  P   = Kp * e
  I  += Kp*(Ts/Ti)*e        # clamp [0,100] (anti-windup)
  D   = Kp*(Td/Ts)*(e - e_prev)
  OUT = clamp(P + I + D, 0, 100)
  bumpless: khi Manual→Auto, set I = OUT_manual - P - D  (PLC-005)
```
- `Ts` = chu kỳ scan. Auto-tuning cơ bản (relay/step) — Ver 1 mức cơ bản (FR-003).

## 5. Chương trình người dùng (FBD/ST)
- Lưu `.kxp` (XML) ở `/data/plc/programs/` (SW-ARCH §5).
- **Compile:** Web IDE compile FBD/ST → bytecode/IR nội bộ → engine nạp. Có compile-time check (IDE-007).
- ≥ 16 program song song (PLC-006); enable/disable từng program qua BACnet (PLC-007).

## 6. Ánh xạ I/O ↔ BACnet/IP (PLC-020)
> Northbound chỉ BACnet/IP (+ MQTT/REST). Điểm mở rộng từ field bus (Modbus RTU master) cũng vào không gian biến PLC như I/O ảo (`%EXT.*`).

| PLC | Vật lý | BACnet object |
|-----|--------|---------------|
| %IW1..8 | UI1–8 | AI1–8 |
| %IX1..8 | DI1–8 | BI1–8 |
| %QW1..4 | AO1–4 | AO1–4 |
| %QX1..4 | DO1–4 | BO1–4 |
| AV/BV/MSV | biến nội | AV/BV/MSV |
| %EXT.* | điểm thiết bị phụ (RTU) | AV/BV/AI bổ sung (cấu hình) |

## 7. Write arbitration (ai được ghi output)
Output có thể bị ghi từ: PLC program, BACnet Write-Property (priority array), REST/MQTT, Force I/O.
- Dùng **BACnet priority 16 mức**: PLC ghi mức 16 (default), BMS mức 8, Force I/O mức 1–2.
- Giá trị cuối = mức ưu tiên cao nhất đang active; không có → `Relinquish_Default`.

## 8. Watchdog & failsafe
- Scan overrun > 3× liên tiếp → output safe-state + log + restart service (PLC-012/013).
- Mất BMS > 30s → standalone (SW-BAC-008); chương trình vẫn chạy bằng input local.

## 9. Test
- Unit: từng FB (TON, PID step response settle ±2% ≤30s — T-SW-022).
- Integration: 16 program đồng thời (T-SW-020); jitter 1h (T-SW-031).

## 10. Trace REQ
`PLC-001..023`, `SW-PLC-001..022`, `FR-001..007`, `DEC-001`.

---
**Rev** 1.0 | 2026-05-30
