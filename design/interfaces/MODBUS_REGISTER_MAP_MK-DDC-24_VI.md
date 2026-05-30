# Modbus Register Map — MK-DDC-24
## Interface Control Document — D-2

> **Document ID:** ICD-MODBUS-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30
> **Trạng thái:** Draft — chờ SW Lead ký (DR-2)
> 📘 [spec/README](../../spec/README.md) · Nguồn gốc: `DS §4.1`, `SRS §6.2`, `SW-REQ §10`

> ⭐ **NGUỒN-CHUẨN cho Modbus.** Modbus **TCP (port 502)** và **RTU (RS-485)** dùng **chung** map này. Định dạng: **INT16 scaled (×100), 1 register/điểm** (chốt IOP-Q-R009). Big-endian (Modbus chuẩn).

---

## 1. Tổng quan vùng địa chỉ

| Vùng | Function Code | Quyền | Nội dung |
|------|---------------|-------|----------|
| **Coils (0x)** | FC01 đọc / FC05, FC15 ghi | R/W | DO1–DO4 |
| **Discrete Inputs (1x)** | FC02 | R | DI1–DI8 |
| **Input Registers (3x)** | FC04 | R | AI1–AI8, DI counter, system status |
| **Holding Registers (4x)** | FC03 đọc / FC06, FC16 ghi | R/W | AO1–AO4, AV1–AV32, BV1–BV16 |

> Địa chỉ trong bảng là **0-based** (protocol address). Một số HMI hiển thị 1-based (cộng 1) hoặc kèm prefix (4x → 40001).

---

## 2. Coils (0x) — DO, read/write

| Addr | Tên | Mô tả | Ghi |
|:----:|-----|-------|-----|
| 0 | DO1 | Relay DO1 | 0=mở, 1=đóng |
| 1 | DO2 | Relay DO2 | |
| 2 | DO3 | Relay DO3 | |
| 3 | DO4 | Relay DO4 | |

## 3. Discrete Inputs (1x) — DI, read-only

| Addr | Tên | Mô tả |
|:----:|-----|-------|
| 0–7 | DI1…DI8 | 1=ON (contact đóng, đã debounce) |

## 4. Input Registers (3x, FC04) — read-only

| Addr | Tên | Kiểu | Scale | Đơn vị/ý nghĩa |
|:----:|-----|------|-------|----------------|
| 0–7 | AI1…AI8 | INT16 | **giá trị × 100** | vd 23.5°C → 2350; 7.80V → 780 |
| 8 | AI_FAULT_MASK | UINT16 | bitmask | bit0=AI1 lỗi … bit7=AI8 lỗi |
| 100–107 | DI1…DI8 counter | UINT16 | đếm cạnh (wrap 65535) | flow/pulse |
| 200 | UPTIME_S_LO | UINT16 | giây (low word) | |
| 201 | UPTIME_S_HI | UINT16 | giây (high word) | uptime 32-bit |
| 202 | FAULT_CODE | UINT16 | mã | fault hiện hành (xem SRS §13) |
| 203 | FW_VERSION | UINT16 | hi=major, lo=minor | firmware SOM |
| 204 | MCU_TEMP | INT16 | ×10 °C | nhiệt độ MCU |
| 205 | CPU_TEMP | INT16 | ×10 °C | nhiệt độ SOM |
| 206 | IOP_STATUS | UINT16 | 0=normal,1=fault,2=safe | trạng thái IOP |
| 207–209 | reserved | — | 0 | |

## 5. Holding Registers (4x) — AO/AV/BV, read/write

| Addr | Tên | Kiểu | Scale | Ghi chú |
|:----:|-----|------|-------|---------|
| 0–3 | AO1…AO4 | INT16 | **0–10V → 0–10000; 0–20mA → 0–20000** | commandable |
| 100–131 | AV1…AV32 | INT16 | giá trị × 100 | biến nội bộ PLC (setpoint…) |
| 200–215 | BV1…BV16 | UINT16 | 0=FALSE, 1=TRUE | biến boolean PLC |

> Ghi AO/AV/BV qua Modbus đi qua cùng "write arbitration" của PLC như BACnet Write-Property (xem `SW_ARCH §3.2`): giá trị vào shared memory, PLC scan kế tiếp áp dụng. AO mode (V/mA) cấu hình ngoài Modbus (Web UI / SET_AO_CFG).

---

## 6. Quy ước scale (chi tiết)

| Loại điểm | Engineering | Register | Công thức |
|-----------|-------------|----------|-----------|
| AI nhiệt độ | °C | INT16 | `reg = round(°C × 100)` (vd −5.25°C → −525) |
| AI điện áp | V | INT16 | `reg = round(V × 100)` |
| AI dòng | mA | INT16 | `reg = round(mA × 100)` |
| AO 0–10V | V | INT16 | `reg = round(V × 1000)` → 0..10000 |
| AO 4–20mA | mA | INT16 | `reg = round((mA) × 1000)` → 4000..20000 |
| AV | số thực | INT16 | `reg = round(val × 100)`, kẹp [−32768, 32767] |

> ⚠ INT16 ×100 → dải ±327.67 và độ phân giải 0.01. Đủ cho HVAC (nhiệt độ/áp/%). Giá trị vượt dải → kẹp + set quality "uncertain".

---

## 7. Exception Responses (Modbus chuẩn)

| Code | Tên | Khi nào |
|:----:|-----|---------|
| 0x01 | Illegal Function | FC không hỗ trợ (chỉ FC01,02,03,04,05,06,15,16) |
| 0x02 | Illegal Data Address | địa chỉ ngoài map |
| 0x03 | Illegal Data Value | ghi giá trị ngoài dải hợp lệ |
| 0x04 | Slave Device Failure | lỗi nội bộ (IOP fault…) |

## 8. Tham số kết nối

| Tham số | TCP | RTU |
|---------|-----|-----|
| Cổng/giao tiếp | TCP 502 | RS-485 (chung BACnet MS/TP, chọn mode qua Web UI) |
| Đồng thời | ≥ 5 client | 1 master |
| Unit ID | bất kỳ (TCP) | 1–247, mặc định = DeviceID mod 247 |
| Khung | 8N1, 9.6k–115.2k (RTU) | |
| Timeout | 30s idle → đóng socket (TCP) | |
| Latency | response ≤ 100 ms |

## 9. Ví dụ

**Đọc AI1–AI8 (FC04, addr 0, qty 8):**
`req:  <MBAP> 04 0000 0008` → `resp: 04 10 <16 byte: 8×INT16>`
Nếu AI1=23.50°C → bytes `09 2E` (2350).

**Ghi AO1 = 5.00V (FC06, addr 0):**
`req: 06 0000 1388` (5000) → DDC xuất 5.00V (mode 0–10V).

**Đóng DO1 (FC05, addr 0):** `req: 05 0000 FF00`.

---

## 10. Trace REQ
`MB-001..010`, `SW-MOD-001..010`, `RTU-001..006`, `FR-024`, `FR-025`, `PRD UC-06`.

---
**Rev** 1.0 | 2026-05-30 · Ký: SW Lead ___
