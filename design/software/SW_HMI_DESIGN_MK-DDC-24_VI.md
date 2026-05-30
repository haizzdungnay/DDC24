# Service Design — `kinexus-hmi` (SW)
## Màn hình TFT 2.4" (LVGL) — code-ready

> **Document ID:** DDD-SWSVC-HMI-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [spec/README](../../spec/README.md) · **Trace:** `SW-HMI-001..008`, `HMI-001..022` · C/LVGL v9

---

## 1. Nhiệm vụ
Dashboard local trên TFT 2.4" (ILI9341, 240×320, SPI0), điều hướng bằng 6 nút, **không phụ thuộc mạng**. Dữ liệu lấy từ `kinexus_io_shm` (shared memory).

## 2. Stack & init
```bash
# fbtft ILI9341 → /dev/fb0 (device tree overlay SPI0)
modprobe fbtft_device name=adafruit22a rotate=270 speed=24000000 fps=20
ls /dev/fb0
```
```c
// LVGL v9 userspace render vào /dev/fb0
lv_init();
fbdev_init("/dev/fb0");           // lv_drivers fbdev
// data feed: đọc kinexus_io_shm (seqlock) mỗi ≤1s
```

## 3. Màn hình (HMI-011)
| Màn | Nội dung |
|-----|----------|
| Dashboard | ≥3 arc gauge (temp/pressure/power), network status, fault indicator |
| I/O Status | 8 UI + 8 DI + 4 AO + 4 DO giá trị thực |
| Alarm List | ≥10 alarm gần nhất (timestamp + severity), từ `alarm.sock` |
| Network Info | IP, BACnet connected, MAC |
| System Info | firmware version, uptime, CPU temp, RAM% |

## 4. Điều hướng (6 nút GPIO — HMI-010)
UP/DOWN/LEFT/RIGHT/ENTER/ESC qua CM3 GPIO1_A0..A5 (interrupt, debounce 20ms SW).
- Restart từ HMI cần màn xác nhận ENTER/ESC (HMI-015).

## 5. Hiệu năng & nguồn dữ liệu
- ≥10 FPS (HMI-002); refresh data ≤1s (HMI-006).
- Đọc **shared memory** (SW-HMI-003), KHÔNG polling network.
- Screen saver: dim backlight sau 5' không nhấn (HMI-007); sáng lại khi nhấn (HMI-008).

## 6. Localization (HMI-020..022)
- EN (mặc định) + VI (UTF-8). Font có dấu tiếng Việt (NotoSans). Đổi ngôn ngữ qua Web UI, không reboot (SHOULD).

## 7. Test
Tất cả màn + nút (FAT-011); giá trị khớp BACnet; render ≥10 FPS (T-SW-100..107).

## 8. Trace REQ
`SW-HMI-001..008`, `HMI-001..022`, `FR-017(HMI)`.

---
**Rev** 1.0 | 2026-05-30
