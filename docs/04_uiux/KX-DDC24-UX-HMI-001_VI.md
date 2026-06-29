# HMI TFT UI — MK-DDC-24
## Thiết kế giao diện màn hình tại chỗ (2.4" TFT)

> **Document ID:** KX-DDC24-UX-HMI-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved (Owner 2026-06-08) · **Owner:** UX Lead
> 📘 [docs/README](../README.md) · Theo [Design System](KX-DDC24-UX-SYSTEM-001_VI.md) · Triển khai [SW_HMI_DESIGN](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md)
> **Trace:** `HMI-001..022`, `SW-HMI-001..008`

> 🎯 Màn hình 320×240 (landscape), điều khiển bằng **6 nút cứng** (UP/DOWN/LEFT/RIGHT/ENTER/ESC), **không chạm**. Thiết kế cho kỹ thuật viên xem nhanh tại tủ điện, không cần laptop.

---

## 1. Ràng buộc phần cứng
- ILI9341 240×320 → xoay landscape **320×240**, SPI0.
- 6 nút GPIO; không touch. Font NotoSans (hỗ trợ tiếng Việt).
- ≥10 FPS; refresh dữ liệu ≤1s (đọc shared memory, không mạng).

## 2. Mô hình điều hướng
```
LEFT/RIGHT: chuyển màn   UP/DOWN: chọn item/cuộn   ENTER: vào/chọn   ESC: ra/huỷ
[Dashboard] ↔ [I/O] ↔ [Alarms] ↔ [Network] ↔ [System]
```
Thanh tab trên cùng cho biết đang ở màn nào.

## 3. Khung chung
```
┌────────────────────────────────────────────┐
│ Dash  I/O  Alarm  Net  Sys      🟢 10:42   │  ← tab + status + giờ
├────────────────────────────────────────────┤
│                                            │
│            [ Nội dung màn ]                 │
│                                            │
├────────────────────────────────────────────┤
│ ◄ ►: màn   ▲▼: chọn   ⏎: OK   ⎋: thoát     │  ← gợi ý phím
└────────────────────────────────────────────┘
```

## 4. Các màn

> Note (2026-06-23): Web Engineering UI bổ sung thêm Inputs Page (/eng/inputs), Controller Diagram (/eng/diagram), và Aux Functions (/eng/aux) với mô hình config wizard + Advanced pattern. Diagram sử dụng SVG responsive, là view read-only commissioning, không phải graph editor. Màu trạng thái áp dụng theo chuẩn ISA-101 Level B hybrid.

### 4.1 Dashboard
```
┌ Dash  I/O  Alarm  Net  Sys        🟢 10:42 ┐
│   ╭─────╮   ╭─────╮   ╭─────╮              │
│   │23.5 │   │ 45% │   │ 1.2 │              │  3 arc gauge
│   │ °C  │   │ RH  │   │ kW  │              │
│   ╰─────╯   ╰─────╯   ╰─────╯              │
│ IOP ✓  BACnet ✓  Alarms ⚠2                 │  hàng trạng thái
└────────────────────────────────────────────┘
```

### 4.2 I/O Status (cuộn UP/DOWN)
```
┌ ... I/O ... ┐
│ UI1 23.5°C ✓   UI5  7.8V  ✓                │
│ UI2 45%RH  ✓   UI6  12mA  ⚠                │
│ DI1 ●  DI2 ○  DI3 ●  DI4 ○                  │
│ AO1 50% ✓  AO2 4mA ✓   DO1 ON  DO2 OFF      │
└────────────────────────────────────────────┘
✓ good (xanh) · ⚠ uncertain (vàng) · ✕ fault (đỏ) · 🔒 forced (tím)
```

### 4.3 Alarm List
```
┌ ... Alarm ... ┐
│ ✕ 10:30 UI3 over-range        [active] │
│ ⚠ 09:12 IOP timeout           [ack]    │
│ ▲▼ chọn · ⏎ xem chi tiết               │
└────────────────────────────────────────┘
```
- ENTER → chi tiết alarm (mã, mô tả, thời gian). Ack từ HMI (nếu cho phép).

### 4.4 Network Info
IP, subnet, gateway, hostname, MAC, BACnet Device ID, trạng thái BMS.

### 4.5 System Info
Firmware version (SOM+MCU), uptime, CPU/board temp, RAM%, [Restart] (cần xác nhận ENTER giữ 3s).

## 5. Phản hồi & an toàn
- Mất IOP → banner đỏ "I/O FAULT" trên mọi màn.
- Hành động Restart: màn xác nhận "Giữ ENTER 3s để khởi động lại / ESC huỷ".
- Screen saver: giảm sáng sau 5' không nhấn; nhấn phím sáng lại.

## 6. Localization
EN (mặc định) + VI; đổi ở System hoặc qua Web UI (không reboot).

## 7. Handoff (LVGL)
- Mỗi màn = 1 `lv_obj` screen; chuyển màn = `lv_scr_load_anim` (slide).
- Map nút GPIO → LVGL group/encoder navigation.
- Data binding: timer 1s đọc `kinexus_io_shm` cập nhật label/gauge.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | UX Lead | Phát hành đầu — 5 màn HMI + điều hướng 6 nút |
