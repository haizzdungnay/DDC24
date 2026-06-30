# Service Design — `mkddc-hmi` (SW)
## Local TFT 2.4" Dashboard — JD9852 MIPI DSI / LVGL v9 / dual-input (CTP + 6 nút)

> **Document ID:** DDD-SWSVC-HMI-MK-DDC-24-VI · **Rev** 2.3 | 2026-06-30
> **Trạng thái:** Approved-for-Rev-A — included by the accepted 2026-06-27 [`REVA_SCOPE`](../../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) amendment
> **Owner:** SW Lead
> **Trace:** `SW-HMI-001..008`, `HMI-001..022`, `FAT-011`
> **Phụ thuộc:** [HW_SPEC §11](../../01_specs/HW_SPEC_MK-DDC-24_VI.md) · [SRS §12](../../01_specs/SRS_MK-DDC-24_VI.md) · [SW_REQUIREMENTS §8](../../01_specs/SW_REQUIREMENTS_MK-DDC-24_VI.md) · [KX-DDC24-UX-HMI-001](../../04_uiux/KX-DDC24-UX-HMI-001_VI.md) · [KX-DDC24-UC-HMI-001](../../04_uiux/KX-DDC24-UC-HMI-001_VI.md)

---

## 1. Mục tiêu

`mkddc-hmi` là daemon userspace chạy trên SOM (Radxa CM3 / RK3566) cung cấp **dashboard local không phụ thuộc mạng** trên màn hình TFT 2.4" gắn mặt trước tủ điện. Kỹ thuật viên xem giá trị I/O, danh sách alarm và trạng thái hệ thống bằng 6 nút cứng — không cần laptop hay web browser.

Dữ liệu lấy trực tiếp từ **shared memory** do `mkddc-iobus` và `mkddc-core` ghi ra — không qua HTTP/REST.

---

## 2. Phạm vi Rev A / Rev B

| Hạng mục | Rev A | Rev B+ |
|----------|-------|--------|
| `mkddc-hmi` daemon | ✅ | Harden/extend |
| JD9852 MIPI DSI DRM bring-up | ✅ scope | Production qualification |
| 6 màn LVGL (Home/IO/Alarm/Com/Sys/Svc) | ✅ | Extend |
| 6-nút GPIO navigation | ✅ | Extend |
| Alarm ack từ HMI | ✅ | Extend |
| Localization VI/EN | ✅ | Extend |

---

## 3. Requirements Trace

| SW-HMI | SRS HMI | Mô tả | Loại | Test |
|--------|---------|-------|------|------|
| SW-HMI-001 | HMI-001 | LVGL v9 userspace, render → `/dev/dri/card0` (DRM/KMS, JD9852 MIPI DSI) | MUST | T-SW-100 |
| SW-HMI-002 | HMI-002 | Frame rate ≥ 10 FPS | MUST | T-SW-101 |
| SW-HMI-003 | HMI-005 | Data feed từ shared memory, không HTTP | MUST | T-SW-102 |
| SW-HMI-004 | HMI-006 | Refresh data ≤ 1 giây | MUST | T-SW-103 |
| SW-HMI-005 | HMI-007/008 | Screen saver: dim sau 5' → sáng khi nhấn | SHOULD | T-SW-104 |
| SW-HMI-006 | HMI-010 | 6-nút UP/DOWN/LEFT/RIGHT/ENTER/ESC qua GPIO | MUST | T-SW-105 |
| SW-HMI-007 | HMI-011..015 | 6 màn: Home / I/O Monitor / Alarm / Communication / System / Service | MUST | T-SW-106 |
| SW-HMI-008 | HMI-012 | Alarm list ≥ 10 entry, timestamp + severity, 4-state model | MUST | T-SW-107 |
| — | HMI-003/004 | Home: controller health tiles (no arc gauge, no hardcoded Power/Energy), fault indicator | MUST | T-SW-106 |
| — | HMI-013 | Base SKU: 16 UI + 4 AO + 4 DO; optional DI visible only when capability map confirms it | MUST | T-SW-106 |
| — | HMI-014 | System: FW version, uptime, CPU temp, RAM% | MUST | T-SW-106 |
| — | HMI-015 | Restart cần xác nhận ENTER giữ 3s | MUST | T-SW-106 |
| — | HMI-020..022 | Localization EN/VI, font NotoSans có dấu tiếng Việt | MUST | T-SW-106 |

---

## 4. Kiến trúc Service

### 4.1 Process Model — 2 Thread

```
┌────────────────────────────────────────────────────────────┐
│                    mkddc-hmi (PID)                         │
│                                                            │
│  ┌──────────────────────────┐   ┌─────────────────────┐   │
│  │   LVGL Render Thread     │   │  GPIO Poll Thread   │   │
│  │   (main thread)          │   │  (pthread)          │   │
│  │                          │   │                     │   │
│  │  lv_timer (100ms tick)   │   │  poll() sysfs GPIO  │   │
│  │   ├─ data_refresh (1s)   │   │  debounce 20ms SW   │   │
│  │   ├─ screensaver_check   │   │  push → key_queue   │   │
│  │   └─ alarm_poll          │   │  (lock-free SPSC)   │   │
│  │                          │   │                     │   │
│  │  lv_task_handler()       │   │                     │   │
│  │   → render → /dev/fb0    │   │                     │   │
│  └──────────────────────────┘   └─────────────────────┘   │
│                                                            │
│  Shared (atomic/mutex):                                    │
│   key_queue_t  {lv_key, state}  SPSC ring                  │
│   screensaver_on (atomic bool)                             │
│   alarm_ring[10] (mutex)                                   │
└────────────────────────────────────────────────────────────┘
```

Không dùng `SCHED_FIFO` — HMI là best-effort display, không real-time.

### 4.2 Nguồn Dữ Liệu

| Dữ liệu | Producer | Path | Cơ chế đọc |
|---------|----------|------|------------|
| UI, DI, AO, DO, IOP fault | `mkddc-iobus` | `/dev/shm/mkddc_io_shm` (`kx_io_shm_t`) | Seqlock |
| PLC computed, ext values | `mkddc-core` | `/dev/shm/mkddc_plc_shm` (`kx_plc_shm_t`) | Seqlock |
| Alarm events | `mkddc-iobus` / core | `/run/mkddc/alarm.sock` (SOCK_DGRAM) | Non-blocking recv |
| Ngôn ngữ HMI | config | `/etc/mkddc/hmi.conf` | Đọc start + SIGHUP |
| Network info | kernel | `/sys/class/net/*/` | Đọc mỗi 5s |
| CPU temp | kernel | `/sys/class/thermal/thermal_zone0/temp` | Đọc mỗi 5s |
| RAM% | kernel | `/proc/meminfo` | Đọc mỗi 5s |
| FW version | package | `/etc/mkddc/version` | Đọc lúc start |

### 4.3 Seqlock Read Pattern (SW-HMI-003)

```c
static void read_io_shm(kx_io_shm_t *dst)
{
    const volatile kx_io_shm_t *src = shm_ptr_io;
    uint32_t seq1, seq2;
    do {
        seq1 = __atomic_load_n(&src->seq, __ATOMIC_ACQUIRE);
        if (seq1 & 1) continue;             /* writer đang ghi → lặp lại */
        memcpy(dst, (const void *)src, sizeof(*dst));
        seq2 = __atomic_load_n(&src->seq, __ATOMIC_ACQUIRE);
    } while (seq1 != seq2);                 /* seq thay đổi giữa chừng → lặp lại */
}
```

---

## 5. Hardware Layer

> **Module thực tế: KD024QVFIA073-02-C021B** (Startek) — LCM+CTP tích hợp.
> Spec đầy đủ: `KD024QVFIA073-02-C021B SPEC V1.0.pdf` trong project root.
> Rev 1.0 của doc này ghi sai SPI/ILI9341 — đã sửa tại Rev 2.1.

### 5.1 Display — MIPI DSI / JD9852

| Thông số | Giá trị |
|----------|---------|
| Module | KD024QVFIA073-02-C021B |
| Controller | JD9852 |
| Interface | **MIPI DSI 1 data lane** (DSI Video mode) |
| Tín hiệu | MIPI_CLP/CLN (clock diff) + MIPI_D0P/D0N (data diff) |
| Reset | RESET# GPIO (active-LOW, pin 9 FPC) |
| TE | Tearing Effect output (pin 8 FPC) → GPIO input (vsync) |
| Nhiệt độ | **-20°C ~ +70°C** |

**Kết nối CM3 → JD9852 (qua LCM FPC 20 pin):**
```
Radxa CM3 B2B              LCM FPC (KD024QVFIA073)
─────────────              ───────────────────────────
MIPI_TX_CKP (*) ──[diff]──► MIPI_CLP (pin 14)  — clock+
MIPI_TX_CKN (*) ──[diff]──► MIPI_CLN (pin 15)  — clock-
MIPI_TX_D0P (*) ──[diff]──► MIPI_D0P (pin 17)  — data lane 0+
MIPI_TX_D0N (*) ──[diff]──► MIPI_D0N (pin 18)  — data lane 0-
GPIO        (*) ───────────► RESET#  (pin 9,  active-LOW)
GPIO        (*) ◄──────────  TE      (pin 8,  Tearing Effect out)
LED driver  (*) ───────────► LEDA   (pin 4,  backlight anode)
LED driver  (*) ───────────► LEDK   (pin 2,  backlight cathode)
3V3             ───────────► VCI    (pin 6)
1V8 / 3V3       ───────────► IOVCC  (pin 7)
```
> (*) Pin B2B cụ thể cần xác nhận từ carrier board schematic (RK3566 MIPI DSI output).

**Device Tree (mẫu):**
```dts
/* DRM panel driver cho JD9852 MIPI DSI */
&dsi {
    status = "okay";
    panel@0 {
        compatible  = "startek,kd024qvfia073";  /* hoặc panel-simple nếu có timing */
        reg         = <0>;
        reset-gpios = <&gpio_x RK_Pxx GPIO_ACTIVE_LOW>;
        te-gpios    = <&gpio_y RK_Pyy GPIO_ACTIVE_HIGH>;
        backlight   = <&backlight>;
        /* DSI video mode timing từ spec §7.2 */
    };
};
```

**Sau khi init:** DRM device xuất hiện tại `/dev/dri/card0`. LVGL dùng `lv_drivers/display/drm.c`.

### 5.2 CTP — Capacitive Touch / FT5436 (I2C)

| Thông số | Giá trị |
|----------|---------|
| Controller | FT5436 (Focal Tech) |
| Interface | **I2C, địa chỉ 0x38 (7-bit)** |
| Touch points | 5-point đồng thời + gestures |
| Cấu trúc | G+G optical bonding với TFT |

**Kết nối CM3 → FT5436 (qua CTP FPC 8 pin):**
```
Radxa CM3 B2B              CTP FPC (FT5436)
─────────────              ───────────────────────────
I2C1_SCL (*) ──────────── ► SCL   (pin 4) — 400 kHz
I2C1_SDA (*) ──────────── ► SDA   (pin 5) — bidirectional
GPIO     (*) ◄─────────────  INT   (pin 6) — active-LOW, có touch mới trigger
GPIO     (*) ──────────── ► RST   (pin 7) — active-LOW reset
1V8/3V3      ──────────── ► VDDIO (pin 2)
3V3          ──────────── ► VDD   (pin 3)
```
> (*) Cần xác nhận carrier board schematic.

**Linux kernel driver:** `ft5x06_ts` → tạo `/dev/input/touchscreen0` (input event device).

**LVGL driver:** `lv_drivers/indev/evdev.c` đọc `/dev/input/touchscreen0` → `LV_INDEV_TYPE_POINTER`.

### 5.3 Backlight — LED Driver IC

Backlight không điều khiển trực tiếp từ PWM GPIO — LEDA/LEDK cần **constant current LED driver IC** (ví dụ: TI TPS61165 hoặc SY7201):

```
CM3 PWM output ──► LED Driver IC ──► LEDA (anode, ~20mA/string)
                                 └──► LEDK (cathode)
```

Điều chỉnh độ sáng: PWM duty cycle từ CM3 → LED driver dim input.

```bash
# Điều chỉnh backlight qua sysfs (sau khi backlight driver init)
echo 80 > /sys/class/backlight/backlight0/brightness   # 80% normal
echo 10 > /sys/class/backlight/backlight0/brightness   # 10% screensaver dim
```

### 5.4 6 Nút Nhấn — GPIO (Fallback cho gloved-hand)

| Vị trí | Nhãn | Chức năng | CM3 GPIO | Linux GPIO# |
|--------|------|-----------|----------|------------|
| TOP-LEFT | UP | Scroll Up / Focus Prev | GPIO1_A0 | gpio32 |
| TOP-RIGHT | DOWN | Scroll Down / Focus Next | GPIO1_A1 | gpio33 |
| MID-LEFT | LEFT | Màn trái / Back | GPIO1_A2 | gpio34 |
| MID-RIGHT | RIGHT | Màn phải / Forward | GPIO1_A3 | gpio35 |
| BOT-LEFT | ENTER | Xác nhận / Ack | GPIO1_A4 | gpio36 |
| BOT-RIGHT | ESC | Huỷ / Thoát | GPIO1_A5 | gpio37 |

Pull-up 10kΩ lên 3.3V. Nhấn → LOW. Debounce 20ms SW.

> **Dual-input design:** Touch là primary input (swipe, tap). 6 nút là secondary/fallback khi đeo găng tay hoặc màn hình bị bẩn.

---

## 6. LVGL Architecture

### 6.1 Init Sequence

```c
int main(void)
{
    /* 1. Init DRM display (MIPI DSI → /dev/dri/card0) */
    drm_init("/dev/dri/card0");          /* lv_drivers/display/drm.c */

    /* 2. LVGL core init */
    lv_init();
    static lv_color_t buf1[320 * 10];   /* partial draw buffer: 10 dòng */
    static lv_color_t buf2[320 * 10];
    lv_disp_draw_buf_init(&draw_buf, buf1, buf2, 320 * 10);

    lv_disp_drv_init(&disp_drv);
    disp_drv.flush_cb = drm_flush;      /* DRM flush (không phải fbdev) */
    disp_drv.draw_buf = &draw_buf;
    disp_drv.hor_res  = 320;            /* landscape sau khi rotate */
    disp_drv.ver_res  = 240;
    lv_disp_drv_register(&disp_drv);

    /* 3a. Input: CTP touch (primary) — FT5436 qua /dev/input/touchscreen0 */
    evdev_init("/dev/input/touchscreen0");
    lv_indev_drv_init(&touch_drv);
    touch_drv.type    = LV_INDEV_TYPE_POINTER;
    touch_drv.read_cb = evdev_read;
    lv_indev_t *touch_indev = lv_indev_drv_register(&touch_drv);

    /* 3b. Input: 6-nút GPIO (secondary/fallback khi đeo găng) */
    lv_indev_drv_init(&btn_drv);
    btn_drv.type    = LV_INDEV_TYPE_KEYPAD;
    btn_drv.read_cb = button_read_cb;
    lv_indev_t *btn_indev = lv_indev_drv_register(&btn_drv);

    /* 4. Open shared memory (read-only) */
    shm_open_io();    /* KX_SHM_IO_PATH  = /dev/shm/mkddc_io_shm  */
    shm_open_plc();   /* KX_SHM_PLC_PATH = /dev/shm/mkddc_plc_shm */

    /* 5. Subscribe alarm socket */
    alarm_sock_open("/run/mkddc/alarm.sock");

    /* 6. Start GPIO poll thread (cho 6 nút cứng) */
    pthread_create(&gpio_tid, NULL, gpio_poll_thread, NULL);

    /* 7. Build all screens */
    screens_create_all();
    lv_scr_load(screens[SCR_DASHBOARD]);

    /* 8. Create periodic timers */
    lv_timer_create(data_refresh_cb,    1000, NULL);   /* 1s: I/O + alarm */
    lv_timer_create(slow_refresh_cb,    5000, NULL);   /* 5s: net/temp/RAM */
    lv_timer_create(alarm_poll_cb,       100, NULL);   /* 100ms: alarm.sock */
    lv_timer_create(screensaver_cb,      100, NULL);   /* 100ms: idle check */

    /* 9. LVGL main loop */
    while (1) {
        lv_task_handler();
        usleep(5000);    /* 5ms yield */
    }
}
```

### 6.2 Screen Model — 6 Màn

Tất cả 6 màn được tạo sẵn lúc khởi động. Chuyển màn bằng `lv_scr_load_anim` (slide animation).

```
SCR_HOME (0)   SCR_IO (1)   SCR_ALARM (2)   SCR_COMM (3)   SCR_SYSTEM (4)   SCR_SERVICE (5)
     │              │              │               │                │                │
     └──────────────────────── LEFT/RIGHT di chuyển tuần hoàn ─────────────────────┘
```

### 6.3 Navigation FSM

```
[BOOT] → SCR_HOME (mặc định)

SCR_HOME ↔ SCR_IO ↔ SCR_ALARM ↔ SCR_COMM ↔ SCR_SYSTEM ↔ SCR_SERVICE ↔ SCR_HOME (vòng)
```

Bảng hành động theo phím + màn:

| Phím | Home | I/O | Alarm | Communication | System | Service |
|------|------|-----|-------|---------------|--------|---------|
| LEFT | SCR_SERVICE | SCR_HOME | SCR_IO | SCR_ALARM | SCR_COMM | SCR_SYSTEM |
| RIGHT | SCR_IO | SCR_ALARM | SCR_COMM | SCR_SYSTEM | SCR_SERVICE | SCR_HOME |
| UP | — | scroll row lên | alarm trước | scroll lên | focus item lên | focus item lên |
| DOWN | — | scroll row xuống | alarm sau | scroll xuống | focus item xuống | focus item xuống |
| ENTER | — | — | ack alarm đang focus | — | — | unlock PIN / kích hoạt action |
| ESC | — | — | — | — | — | lock / huỷ action |

### 6.4 Widget Inventory

**SCR_HOME:**
```
┌─[Home][I/O][Alm][Com][Sys][Svc]───────────── 10:42:33 ─┐
│ MK-DDC-24-001                          RUNNING           │
│ ALARM  Active: 0    Unacked: 0    Critical: 0            │
│ HEALTH CPU:18%  RAM:312/2048MB  Temp:52.3°C  NORMAL      │
│ I/O    UI:16OK/0BAD  DI:N/A  AO:4OK  DO:4OK/0STALE      │
│ COMM   ETH:OK  BACnet:OK (12s)  Modbus:OK  DISABLED      │
│ CONFIG Profile:GENERIC_DDC  Rev:24  Checksum:OK           │
└───────────────────────────────────────────────────────────┘
```
- Không hardcode tên ứng dụng (Room Temp, Fan, Power, Energy).
- Alarm count `Active: N` không giảm khi chỉ ACK — lỗi vẫn active.
- BACnet hiển thị `(Xs)` = last request age, không phải "Đang kết nối".
- Tất cả dữ liệu từ SHM + `/sys/` + `/proc/` — không HTTP.

**SCR_IO:**
```
┌─[Home][I/O][Alm][Com][Sys][Svc]──────────── 10:42:33 ─┐
│ POINT  NAME   TYPE  VALUE   UNIT  QUALITY   AGE         │
│ UI1    UI1    UI    23.5    °C    GOOD      120ms       │
│ UI2    UI2    UI    7.8     V     GOOD      120ms       │
│ UI4    UI4    UI    ---     ---   BAD       2.3s        │
│ UI9    UI9    UI    5.0     V     GOOD      120ms       │
│ AO1: 50% GOOD  AO2: 4mA GOOD  DO1: ON  DO2: OFF        │
│ Filter: ALL / BAD / STALE              [Page 1/3]       │
└─────────────────────────────────────────────────────────┘
```
- Tên point từ `display_name` trong point DB; nếu chưa có → mã kỹ thuật (UI1...).
- Cột `AGE` = thời gian kể từ lần cập nhật cuối trong SHM entry.
- `STALE` khi age > ngưỡng cấu hình.
- Quality: `GOOD` (xanh) · `UNCERTAIN` (vàng) · `BAD` (đỏ) · `STALE` (xám)

**SCR_ALARM:**
```
┌─[Home][I/O][Alm][Com][Sys][Svc]──────────── 10:42:33 ─┐
│ Active: 2    Unacked: 1    Critical: 1                  │
│ ► ✕ 10:30:05 E302 Modbus slave 1 timeout ACTIVE_UNACK  │
│   ⚠ 09:12:41 E303 Bus error rate > 10%  ACTIVE_ACK     │
│   ✕ 08:55:00 E001 IOP comm fault        CLEARED_ACK    │
│             ... (cuộn UP/DOWN, max 10 entry)            │
│ ENTER: ACK alarm đang chọn    ▲▼: Di chuyển            │
└─────────────────────────────────────────────────────────┘
```
- `lv_list` 10 row, `lv_group` focus. ENTER → ack + gửi JSON lên alarm.sock.
- 4-state model: `ACTIVE_UNACK` / `ACTIVE_ACK` / `CLEARED_UNACK` / `CLEARED_ACK`.
- ACK không xóa alarm active — chỉ đổi UNACK→ACK. `Active: N` không giảm khi ack.
- INFO severity: không có nút ACK.

**SCR_COMM:**
```
┌─[Home][I/O][Alm][Com][Sys][Svc]──────────── 10:42:33 ─┐
│ ETHERNET                                                │
│ Link: UP  IP: 192.168.1.18  MAC: b8:13:32:73:3e:4e     │
│ Mask: 255.255.255.0  GW: 192.168.1.1                    │
│                                                         │
│ BACnet/IP                                               │
│ Enabled: YES  Device ID: 1001  Port: 47808              │
│ Status: OK   Last Request: 12s ago                      │
│                                                         │
│ Modbus RTU-1: OK (9600/NONE, 8 slaves, 0 timeout)       │
│ Modbus RTU-2: DISABLED                                  │
│ Modbus TCP:   OK (port 502)                             │
└─────────────────────────────────────────────────────────┘
```
- Không dùng "Đang kết nối" hay "Connected" cho BACnet/IP (UDP, không có session).
- Status: `OK` / `DISABLED` / `NO_TRAFFIC` / `TIMEOUT` / `CONFIG_ERROR` / `DUPLICATE_ID` / `LINK_DOWN`.

**SCR_SYSTEM:**
```
┌─[Home][I/O][Alm][Com][Sys][Svc]──────────── 10:42:33 ─┐
│ FIRMWARE                                                │
│ SOM FW: v1.4.2-89fb37c   MCU FW: v2.0.0               │
│ Build: 2026.06.26-r24     Config Rev: 24                │
│                                                         │
│ RUNTIME                                                 │
│ Uptime: 3d 14h 22m   Boot: POWER_ON   Last Err: NONE   │
│                                                         │
│ RESOURCE                                                │
│ CPU: 18%  RAM: 312/2048MB  Storage: 12/64GB  Temp:52°C │
│                                                         │
│ PROCESS: core RUNNING  iobus RUNNING  hmi RUNNING       │
│ WATCHDOG: OK   Log: NONE                                │
└─────────────────────────────────────────────────────────┘
```
- Restart đã chuyển sang SCR_SERVICE (cần Service PIN/switch).
- Trang này chỉ read-only diagnostics — không có action nguy hiểm.

**SCR_SERVICE:**
```
┌─[Home][I/O][Alm][Com][Sys][Svc]──────────── 10:42:33 ─┐
│ SERVICE / CONFIG                          LOCKED         │
│ ACCESS: PIN REQUIRED   Service SW: OFF                  │
│                                                         │
│ PROJECT: MK-DDC24-DEMO   Profile: GENERIC_DDC   Rev:24 │
│ POINT DB: 24 points (UI:16 DI:0 AO:4 DO:4)             │
│ SAFE STATE: PER_POINT (per point_db safe_state field)   │
│                                                         │
│ [ Reload Config ]     LOCKED                            │
│ [ Restart Services ]  LOCKED                            │
│ [ Reboot System ]     LOCKED                            │
└─────────────────────────────────────────────────────────┘
```
- Unlock: nhập Service PIN hoặc bật physical service switch.
- Reboot không hardcode safe state — áp dụng `safe_state` per-point từ point DB.
- Reload config: kiểm tra checksum trước; nếu lỗi → từ chối, giữ config cũ.

### 6.5 Status Bar (Chung Tất Cả Màn)

- Tab strip 6 nút: `[Home][I/O][Alm][Com][Sys][Svc]` — nút đang active highlight.
- Status dot: ● xanh = IOP OK · ● đỏ = `io_shm.iop_status == KX_IOP_FAULT`.
- Đồng hồ: `lv_timer` 1s → `lv_label_set_text_fmt(clock_lbl, "%02d:%02d:%02d", ...)`.
- IOP FAULT banner: overlay đỏ toàn màn "I/O FAULT — Kiểm tra kết nối MCU", backlight 100%.

---

## 7. GPIO Button Driver

### 7.1 GPIO Poll Thread

```c
typedef struct {
    int      gpio_num;
    lv_key_t lv_key;
    bool     pressed;
    uint32_t debounce_ms;
} btn_t;

static btn_t buttons[6] = {
    {32, LV_KEY_UP,    false, 0},
    {33, LV_KEY_DOWN,  false, 0},
    {34, LV_KEY_LEFT,  false, 0},
    {35, LV_KEY_RIGHT, false, 0},
    {36, LV_KEY_ENTER, false, 0},
    {37, LV_KEY_ESC,   false, 0},
};

static void *gpio_poll_thread(void *arg)
{
    struct pollfd fds[6];
    for (int i = 0; i < 6; i++) {
        gpio_export(buttons[i].gpio_num);
        gpio_set_direction(buttons[i].gpio_num, "in");
        gpio_set_edge(buttons[i].gpio_num, "both");
        char path[64];
        snprintf(path, sizeof(path),
                 "/sys/class/gpio/gpio%d/value", buttons[i].gpio_num);
        fds[i].fd     = open(path, O_RDONLY | O_NONBLOCK);
        fds[i].events = POLLPRI | POLLERR;
    }

    char val[4];
    while (g_running) {
        poll(fds, 6, 50);                        /* timeout 50ms */
        uint32_t now_ms = monotonic_ms();
        for (int i = 0; i < 6; i++) {
            if (!(fds[i].revents & POLLPRI)) continue;
            lseek(fds[i].fd, 0, SEEK_SET);
            read(fds[i].fd, val, sizeof(val));
            bool is_pressed = (val[0] == '0');   /* active-LOW */
            if (is_pressed == buttons[i].pressed) continue;
            if (now_ms - buttons[i].debounce_ms < 20) continue;  /* 20ms debounce */
            buttons[i].pressed     = is_pressed;
            buttons[i].debounce_ms = now_ms;
            key_queue_push(buttons[i].lv_key,
                           is_pressed ? LV_INDEV_STATE_PRESSED
                                      : LV_INDEV_STATE_RELEASED);
        }
    }
    for (int i = 0; i < 6; i++) close(fds[i].fd);
    return NULL;
}
```

### 7.2 LVGL Input Callback

```c
static void button_read_cb(lv_indev_drv_t *drv, lv_indev_data_t *data)
{
    key_event_t ev;
    if (key_queue_pop(&ev)) {
        data->key   = ev.key;
        data->state = ev.state;
        if (ev.state == LV_INDEV_STATE_PRESSED)
            screensaver_reset();          /* wake screen saver */
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}
```

---

## 8. Alarm Socket Reader

### 8.1 Protocol

`/run/mkddc/alarm.sock` — UNIX **SOCK_DGRAM**. Mỗi datagram = 1 JSON object:

```json
{
  "ts":       "2026-06-26T10:42:33Z",
  "code":     "E302",
  "severity": "fault",
  "source":   "iobus",
  "msg":      "Modbus slave 1 timeout — E302 triggered"
}
```

`severity`: `"fault"` (✕ đỏ) · `"warn"` (⚠ vàng) · `"info"` (ℹ xám)

### 8.2 Ring Buffer 10 Alarm

```c
#define ALARM_RING_SIZE 10

typedef struct {
    char    ts[24];
    char    code[8];
    char    msg[80];
    uint8_t severity;   /* 0=info, 1=warn, 2=fault */
    bool    acked;
} alarm_entry_t;

static alarm_entry_t  alarm_ring[ALARM_RING_SIZE];
static int            alarm_head  = 0;    /* vị trí ghi tiếp (circular) */
static int            alarm_count = 0;    /* số entry hợp lệ, max 10 */
static pthread_mutex_t alarm_mtx  = PTHREAD_MUTEX_INITIALIZER;
```

Đọc trong `alarm_poll_cb` (timer 100ms) với `recv(..., MSG_DONTWAIT)` — không block LVGL thread.

### 8.3 Gửi Ack

```json
{ "action": "ack", "code": "E302", "ts": "2026-06-26T10:42:33Z" }
```

HMI gửi datagram ngược lên alarm.sock khi người dùng nhấn ENTER trên alarm đang focus.

---

## 9. Screen Saver (HMI-007/008)

| Điều kiện | Hành động |
|-----------|-----------|
| Không nhấn nút ≥ 5 phút | Dim backlight về 10% PWM |
| Nhấn bất kỳ nút khi saver ON | Bật 80%, nuốt phím (không navigate) |
| IOP FAULT bất kỳ lúc nào | Ghi đè: backlight 100% + banner đỏ toàn màn |

```c
#define SCREENSAVER_TIMEOUT_MS (5 * 60 * 1000u)

static void screensaver_cb(lv_timer_t *t)
{
    uint32_t idle = lv_disp_get_inactive_time(NULL);
    if (!g_screensaver_on && idle > SCREENSAVER_TIMEOUT_MS) {
        g_screensaver_on = true;
        pwm_set_duty_pct(10);
    }
}

void screensaver_reset(void)
{
    if (g_screensaver_on) {
        g_screensaver_on = false;
        pwm_set_duty_pct(80);
    }
    lv_disp_trig_activity(NULL);
}
```

---

## 10. Localization (HMI-020..022)

Config `/etc/mkddc/hmi.conf`:
```ini
[hmi]
language = en    # en | vi
```

Mọi string UI đi qua hàm lookup:
```c
typedef enum { LANG_EN = 0, LANG_VI } hmi_lang_t;
extern hmi_lang_t g_lang;

const char *hmi_str(str_key_t key);
```

String table (mẫu):
```c
static const char *STR_EN[] = {
    "Dashboard", "I/O Status", "Alarms", "Network", "System",
    "Restart", "Hold ENTER 3s to reboot / ESC to cancel", ...
};
static const char *STR_VI[] = {
    "Bảng điều khiển", "Trạng thái I/O", "Cảnh báo", "Mạng", "Hệ thống",
    "Khởi động lại", "Giữ ENTER 3 giây để khởi động / ESC để huỷ", ...
};
```

Font: `lv_font_noto_sans_24` compile từ NotoSansCJK — cover Latin + tiếng Việt có dấu + °%/·.

**Reload không reboot:** `mkddc-web` ghi `/etc/mkddc/hmi.conf` → gửi `SIGHUP` → `mkddc-hmi` reload config → redraw toàn bộ label.

---

## 11. Build System

### 11.1 Cấu Trúc Thư Mục

```
services/hmi/
├── CMakeLists.txt
├── main.c
├── hmi_config.c / .h           — parse /etc/mkddc/hmi.conf
├── hmi_shm.c / .h              — seqlock SHM reader (IO + PLC)
├── hmi_string.c / .h           — localization string table
├── alarm_reader.c / .h         — alarm.sock subscriber + ring buffer
├── drivers/
│   ├── drm.c / .h              — /dev/dri/card0 DRM/KMS LVGL flush driver
│   ├── evdev.c / .h            — /dev/input/touchscreen0 CTP pointer driver
│   ├── gpio_btn.c / .h         — GPIO poll thread + key queue
│   └── pwm_bl.c / .h           — backlight PWM (sysfs)
└── screens/
    ├── screen_common.c / .h    — status bar, tab strip (6 tabs)
    ├── screen_home.c / .h      — controller health tiles (no arc gauge)
    ├── screen_io.c / .h        — scrollable I/O table + quality + age
    ├── screen_alarm.c / .h     — alarm list + 4-state ack
    ├── screen_comm.c / .h      — Ethernet + BACnet + Modbus status
    ├── screen_system.c / .h    — diagnostics read-only
    └── screen_service.c / .h   — service mode (PIN lock + actions)
```

### 11.2 CMakeLists.txt (Mẫu)

```cmake
cmake_minimum_required(VERSION 3.20)
project(mkddc-hmi C)

option(MKDDC_ENABLE_HMI "Build mkddc-hmi local display service" OFF)
if(NOT MKDDC_ENABLE_HMI)
    message(STATUS "HMI: disabled by build option")
    return()
endif()

include(FetchContent)
FetchContent_Declare(lvgl
    GIT_REPOSITORY https://github.com/lvgl/lvgl.git
    GIT_TAG        v9.1.0)
FetchContent_Declare(lv_drivers
    GIT_REPOSITORY https://github.com/lvgl/lv_drivers.git
    GIT_TAG        v9.0.0)
FetchContent_MakeAvailable(lvgl lv_drivers)

file(GLOB_RECURSE HMI_SRCS
    ${CMAKE_CURRENT_SOURCE_DIR}/*.c
    ${CMAKE_CURRENT_SOURCE_DIR}/drivers/*.c
    ${CMAKE_CURRENT_SOURCE_DIR}/screens/*.c)

add_executable(mkddc-hmi ${HMI_SRCS})
target_include_directories(mkddc-hmi PRIVATE
    ${lvgl_SOURCE_DIR}
    ${lv_drivers_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/../../shared)
target_link_libraries(mkddc-hmi PRIVATE lvgl lv_drivers pthread m)
target_compile_definitions(mkddc-hmi PRIVATE
    LV_CONF_INCLUDE_SIMPLE
    LV_HOR_RES_MAX=320
    LV_VER_RES_MAX=240
    LV_MEM_SIZE=262144)     /* 256 KB LVGL heap */

install(TARGETS mkddc-hmi DESTINATION sbin)
```

### 11.3 systemd Unit

```ini
# /etc/systemd/system/mkddc-hmi.service
[Unit]
Description=MK-DDC-24 Local HMI Dashboard (TFT 2.4")
After=mkddc-iobus.service mkddc-core.service
Requires=mkddc-iobus.service

[Service]
Type=simple
ExecStart=/usr/sbin/mkddc-hmi
Restart=on-failure
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

---

## 12. Memory Budget

| Vùng nhớ | Kích thước | Ghi chú |
|----------|-----------|---------|
| Framebuffer `/dev/dri/card0` | 320×240×2 = 150 KB | Kernel DMA (DRM) — không chiếm user heap |
| LVGL draw buffer (×2) | 320×10×2×2 = 12.8 KB | User heap (partial flush) |
| LVGL object heap | 256 KB | `LV_MEM_SIZE` — screens + widgets |
| NotoSans font bitmap | ~300 KB | `.rodata` — read-only |
| String tables (VI+EN) | < 10 KB | `.rodata` |
| Alarm ring buffer | 10×~120B = 1.2 KB | static |
| SHM mappings (2 SHM) | ~13 KB mapped | Shared pages — không chiếm RSS |
| **Tổng heap estimate** | **~640 KB** | RK3566 2 GB RAM → OK |

> **SW-Q-003 (Open Issue):** Đo `lv_mem_monitor()` trong T-SW-100 bring-up để xác nhận không leak qua 1000 refresh cycle.

---

## 13. Test Plan

| Test ID | Mô tả | Điều kiện Pass | Loại test |
|---------|-------|----------------|-----------|
| T-SW-100 | LVGL v9 init + DRM flush (ASM-005) | Pixel xuất hiện trên TFT thật qua `/dev/dri/card0`, không crash trong 60s | Bring-up / Manual |
| T-SW-101 | Frame rate | ≥ 10 FPS liên tục 30s trên hardware thật | Perf / Manual |
| T-SW-102 | Data từ SHM | UI1 trên Dashboard khớp `shm_dump_io` trong ±0.1 đơn vị | Functional |
| T-SW-103 | Refresh latency | Thay đổi UI1 trong SHM → hiện trên màn ≤ 1.2s | Timing |
| T-SW-104 | Screen saver | 5' idle → dim; nhấn nút → sáng lại; phím không navigate khi wake | Functional |
| T-SW-105 | 6-nút GPIO | Nhấn mỗi nút → đúng hành động navigate/scroll/confirm; debounce không false-trigger | Functional |
| T-SW-106 | 6 màn đầy đủ | Mọi label/value hiển thị đúng; I/O có quality+age; alarm 4-state; BACnet status kỹ thuật; Service locked by default | Functional |
| T-SW-107 | Alarm list | ≥ 10 entry; icon severity đúng màu; ENTER ack được | Functional |
| FAT-011 | HMI Acceptance | T-SW-100..107 PASS + peer review UX với [KX-DDC24-UX-HMI-001] | Manual FAT |

---

## 14. Open Issues

| ID | Mức | Mô tả | Resolve khi |
|----|-----|-------|------------|
| SW-Q-003 | P2 | LVGL v9 heap usage chưa đo production | T-SW-100 bring-up |
| ASM-005 | P1 | LVGL v9 port DRM/KMS JD9852 MIPI DSI kernel 6.1 chưa xác nhận stable | T-SW-100 hardware bring-up |
| — | P2 | GPIO sysfs interface có thể thay bằng libgpiod (kernel ≥ 5.10) | Rev B bring-up decision |

---

## Revision History

| Rev | Ngày | Người | Thay đổi |
|-----|------|-------|---------|
| 1.0 | 2026-05-30 | SW Lead | Phát hành đầu — overview 5 màn, stack LVGL |
| 2.0 | 2026-06-26 | SW Lead | Redesign toàn diện: architecture 2-thread, seqlock pattern, GPIO poll driver với debounce, widget inventory đầy đủ, alarm ring buffer + ack protocol, screen saver, localization table, build CMake, memory budget, test plan 8 case, open issues |
| 2.1 | 2026-06-26 | SW Lead | Sửa erratum giao tiếp màn hình: SPI/ILI9341 → MIPI DSI/JD9852 (KD024QVFIA073-02-C021B); thêm CTP FT5436 I2C; backlight → LED driver IC; LVGL display driver fbdev → DRM/KMS; thêm dual-input (touch primary + GPIO button fallback) |
| 2.2 | 2026-06-26 | SW Lead | Cập nhật theo UC Rev 2.1: 5→6 màn (thêm SCR_SERVICE); bỏ arc gauge → text tile trên SCR_HOME; alarm 4-state model (ACTIVE_UNACK/ACK, CLEARED_UNACK/ACK); BACnet status kỹ thuật (không "Kết nối", có Last Request age); safe state per-point (không hardcode); thêm I/O quality+age; restart chuyển sang SCR_SERVICE với PIN/switch lock; no-hardcode tên ứng dụng |
| 2.3 | 2026-06-30 | SW Lead/QA | Aligned local-HMI scope and I/O inventory with REVA amendment and ADR-010. |
