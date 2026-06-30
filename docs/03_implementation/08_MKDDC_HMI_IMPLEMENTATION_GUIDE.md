# 08 — mkddc-hmi Implementation Guide
## MK-DDC-24 | HMI Local Display (LVGL v9 / DRM / KMS)

> **Document ID:** IMPL-HMI-GUIDE-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-27 · **Trạng thái:** Implementation in progress · **Owner:** Dev SOM
> **Trace:** `SW-HMI-001..008`, `HMI-001..022`
> **Spec:** [SW_HMI_DESIGN Rev 2.2](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md) ·
>           [UC Rev 2.1](../04_uiux/KX-DDC24-UC-HMI-001_VI.md) ·
>           [UX Rev 2.0](../04_uiux/KX-DDC24-UX-HMI-001_VI.md)
> **Scope:** `services/hmi/` — KHÔNG bao gồm `fw/` (MCU), `web/`, `services/core/`, `services/iobus/`.
> **Amendment:** REVA_SCOPE Rev 1.2 (2026-06-27) — HMI kéo vào Rev A.

---

## 1. Ràng buộc cứng (không thương lượng)

| Ràng buộc | Giá trị | Nguồn |
|-----------|---------|-------|
| Display driver | DRM/KMS `/dev/dri/card0` — **KHÔNG dùng fbdev/fbtft** | SW-HMI-001 |
| LVGL version | v9.x (không phải v8) | SW-HMI-001 |
| Display controller | JD9852 MIPI DSI 1-lane, 240×320 xoay landscape 320×240 | UX §1 |
| Touch controller | FT5436, I2C 0x38, `ft5x06_ts` → `/dev/input/touchscreen0` | UX §1 |
| Input buttons | 6 GPIO: UP/DOWN/LEFT/RIGHT/ENTER/ESC (20ms debounce) | UX §2 |
| Data feed | `kx_io_shm_t` + `kx_plc_shm_t` (SHM) — **KHÔNG HTTP/REST** | SW-HMI-003 |
| Refresh | ≤ 1s từ SHM; ≥ 10 FPS render | SW-HMI-002/004 |
| Alarm model | 4-state: ACTIVE_UNACK/ACK, CLEARED_UNACK/ACK — ACK ≠ clear | UC §7 |
| BACnet status | Không bao giờ hiển thị "Đang kết nối" — OK/NO_TRAFFIC/TIMEOUT/... | UC §8 |
| Safe state | Per-point từ point database — **không hardcode AO=4mA / DO=OFF** | UC-LOCAL-014 |
| No-hardcode | Tên point, unit, scale từ point database — không embed Room/Fan/AHU | UX §6 |

---

## 2. Cấu trúc thư mục

```
services/hmi/
├── CMakeLists.txt
├── main.cpp                    # entry: drm_init, indev init, lv_timer loop
├── drm/
│   ├── drm_init.cpp/hpp        # HMI-001: DRM/KMS /dev/dri/card0
│   └── lv_drm_display.cpp/hpp  # LVGL display driver callback
├── input/
│   ├── evdev_touch.cpp/hpp     # HMI-002: FT5436 evdev → LV_INDEV_TYPE_POINTER
│   └── gpio_buttons.cpp/hpp    # HMI-002: 6 GPIO → LV_INDEV_TYPE_KEYPAD
├── screens/
│   ├── screen_base.hpp         # tab strip + frame template
│   ├── screen_home.cpp/hpp     # HMI-004: Screen 1 Home / Controller Health
│   ├── screen_io.cpp/hpp       # HMI-005: Screen 2 I/O Monitor
│   ├── screen_alarm.cpp/hpp    # HMI-006: Screen 3 Alarm / Event
│   ├── screen_comm.cpp/hpp     # HMI-007: Screen 4 Communication
│   ├── screen_system.cpp/hpp   # HMI-008: Screen 5 System / Diagnostics
│   └── screen_service.cpp/hpp  # HMI-009: Screen 6 Service / Config
├── data/
│   ├── shm_reader.cpp/hpp      # HMI-010: kx_io_shm + kx_plc_shm 1s timer
│   └── point_db.cpp/hpp        # name/unit/scale từ point database config
├── ui/
│   ├── nav_controller.cpp/hpp  # HMI-003: tab strip + 6-page ring
│   ├── fault_banner.cpp/hpp    # I/O FAULT overlay full-width
│   └── screen_saver.cpp/hpp    # HMI-003: dim 5min + wake on touch/key
├── i18n/
│   └── locale.cpp/hpp          # HMI-011: EN/VI, SIGHUP reload
└── packaging/
    └── mkddc-hmi.service       # HMI-012: systemd unit
```

---

## 3. Danh sách task HMI

### HMI-001: CMake skeleton + LVGL v9 + DRM/KMS init

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — build LVGL v9 + libdrm RGB565, double buffer, xoay framebuffer portrait→landscape; còn T-SW-100/101 trên TFT thật.

```
File: services/hmi/CMakeLists.txt, drm/drm_init.cpp/hpp, main.cpp
Dependency: liblvgl (v9), libdrm, libinput
Output:
  - lv_init() + lv_display_create() gắn DRM buffer
  - drm_init("/dev/dri/card0"): open DRM, create FB, set mode
  - Render 10 FPS tối thiểu; blank screen trước khi load page
Build: MKDDC_ENABLE_HMI cmake option (tương tự MKDDC_ENABLE_MODBUS)
Done khi: build xanh; màn hình bật lên hiển thị màu nền; FPS ≥ 10
```

### HMI-002: Input drivers

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — evdev ABS calibration/rotation, GPIO SPSC + debounce và wake-event suppression; còn xác nhận FT5436/GPIO trên board.

```
File: input/evdev_touch.cpp/hpp, input/gpio_buttons.cpp/hpp
Output:
  - evdev_touch: open /dev/input/touchscreen0, map event → lv_indev_data_t POINTER
  - gpio_buttons: poll 6 GPIO (20ms debounce) → lv_indev_data_t KEYPAD
    Keys: UP/DOWN/LEFT/RIGHT/ENTER/ESC
  - Wake screen saver: any touch / any key nuốt gesture (không navigate)
Done khi: tap/swipe điều hướng được; button UP/DOWN cuộn; ENTER chọn; ESC thoát
```

### HMI-003: Tab strip + 6-page ring + screen saver + I/O FAULT banner

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — đủ ring 6 page, tab/touch/button, dim/wake và global FAULT overlay; còn UC-LOCAL-002/T-SW-104 manual.

```
File: ui/nav_controller.cpp/hpp, ui/screen_saver.cpp/hpp, ui/fault_banner.cpp/hpp
Output:
  - Tab strip trên cùng: Home|I/O|Alarm|Comm|Sys|Svc + đồng hồ HH:MM:SS
  - Ring navigation: vuốt LEFT/RIGHT = chuyển page vòng tròn
  - Tap tab = nhảy page trực tiếp
  - Screen saver: dim sau 5min idle; tap/key bất kỳ = wake (nuốt gesture)
  - I/O FAULT banner: overlay đỏ full-width khi iop_status=FAULT,
    không tắt được cho đến khi fault clear
Done khi: vòng từ Home→Svc→Home bằng cả swipe và tap tab; FAULT banner test
```

### HMI-004: Screen 1 — Home / Controller Health

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — đủ 6 block, alarm count 4-state, I/O count theo point DB và proc/sys health; còn UC-LOCAL-001/003 trên panel và telemetry communication thật.

```
File: screens/screen_home.cpp/hpp
Layout: (ref UX §5)
  - Controller ID + RUNNING/FAULT status
  - Timestamp
  - ALARM block: Active: N  Unacked: N  Critical: N
  - CONTROLLER HEALTH: CPU%, RAM MB/total, Storage GB/total, Temp, Uptime, Health
  - I/O HEALTH: UI/DI/AO/DO: N OK / N BAD / N STALE
  - COMMUNICATION: Ethernet link/IP, BACnet OK + "Last req: Xs ago", Modbus status
  - CONFIG: Profile, Config Rev, Checksum
Quy tắc:
  - Không hardcode "Room Temp" / "Fan" / "Power" / "Energy"
  - BACnet: "Last req: Xs ago" — không bao giờ "Đang kết nối"
  - Active alarm count không giảm khi chỉ ACK
Done khi: UC-LOCAL-001 (30s glance) pass; BACnet status đúng format
```

### HMI-005: Screen 2 — I/O Monitor

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — bảng point DB động, VALUE/UNIT/QUALITY/AGE, BAD/STALE filter và không trình bày giá trị BAD/STALE như GOOD; còn UC-LOCAL-004..006 manual.

```
File: screens/screen_io.cpp/hpp
Layout: (ref UX §6)
  - Table: POINT | NAME | TYPE | VALUE | UNIT | QUALITY | AGE
  - Paginated: Page 1 = UI1-8+DI1-8; Page 2 = AO1-4+DO1-4; Page 3 = filter view
  - Filter: ALL / BAD / STALE (tap hoặc ENTER để toggle)
  - AGE: tính từ SHM last_update_ts; vàng khi STALE
  - NAME từ point database display_name; fallback → mã kỹ thuật (UI1, DI1...)
Done khi: UC-LOCAL-004/005/006 pass; AGE cập nhật 1s; BAD/STALE highlight đúng
```

### HMI-006: Screen 3 — Alarm / Event

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — subscriber alarm.sock, ring 10, severity mapping và 4-state ACK có unit test; còn chốt contract ACK upstream vì publisher hiện không có endpoint nhận ACK.

```
File: screens/screen_alarm.cpp/hpp
Layout: (ref UX §7)
  - SUMMARY: Active: N  Unacked: N  Critical: N
  - Table: TIME | CODE | SEV | POINT | MESSAGE | STATE
  - STATE column: ACTIVE_UNACK / ACTIVE_ACK / CLEARED_UNACK / CLEARED_ACK
  - [Ack Selected]: đổi UNACK → ACK, không xóa alarm
  - Filter: Active / All / Unacked
  - SEV color: FAULT=đỏ, WARN=vàng, INFO=xám; INFO không có nút ACK
Quy tắc:
  - ACK không xóa — state chỉ đổi từ UNACK → ACK
  - Active count không giảm khi ACK alarm còn active
Done khi: UC-LOCAL-007/008 pass; 4-state model đúng
```

### HMI-007: Screen 4 — Communication

**Trạng thái triển khai:** ĐÃ làm một phần 2026-06-27 — Ethernet lấy từ kernel và UI chỉ dùng status kỹ thuật; CHƯA đóng UC-LOCAL-010 vì SHM hiện không chứa Device ID, BACnet last-request hay Modbus counters/config.

```
File: screens/screen_comm.cpp/hpp
Layout: (ref UX §8)
  Sections: ETHERNET / BACnet/IP / Modbus RTU-1 / Modbus RTU-2 / Modbus TCP
  - Ethernet: Link UP/DOWN, IP, Mask, Gateway, MAC
  - BACnet: Enabled, Device ID, Port, Status (OK/NO_TRAFFIC/TIMEOUT/CONFIG_ERROR/DUPLICATE_ID), Last Request Xs ago
  - Modbus RTU: Port, Baudrate, Parity, Slaves, Status, Timeouts
  - Modbus TCP: Enabled, Port, Status
Quy tắc:
  - BACnet status KHÔNG bao giờ dùng "Đang kết nối"
  - "Last req: Xs ago" bắt buộc cho BACnet
Done khi: UC-LOCAL-009/010 pass; status codes đúng theo UX §8
```

### HMI-008: Screen 5 — System / Diagnostics

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — read-only FW/runtime/resource/process/watchdog/log từ proc/sys/package; còn UC-LOCAL-011 manual trên target.

```
File: screens/screen_system.cpp/hpp
Layout: (ref UX §9)
  Sections: FIRMWARE / RUNTIME / RESOURCE / PROCESS / WATCHDOG / LOG
  - FW: SOM FW version + git short hash, MCU FW, Build ID, Config Rev
  - Runtime: Uptime, Boot Reason, Last Error
  - Resource: CPU%, RAM, Storage, CPU Temp
  - Process: core/iobus/hmi/bacnet/modbus — RUNNING/STOPPED
  - Watchdog: Status, Last Reset
  - Log: Last Warn, Last Fault
Read-only: không có action button trên màn này (restart → Screen 6)
Done khi: UC-LOCAL-011 pass; dữ liệu từ SHM đúng
```

### HMI-009: Screen 6 — Service / Config

**Trạng thái triển khai:** ĐÃ làm một phần 2026-06-27 — LOCKED default, PIN/switch/role, revoke policy, hold 3s và safe-state per-point qua core IPC; CHƯA đóng UC-LOCAL-013 do spec chưa định nghĩa thuật toán/canonical payload checksum và role Web không map trực tiếp sang role HMI.

```
File: screens/screen_service.cpp/hpp
Layout: (ref UX §10)
  - Header: SERVICE / CONFIG  [LOCKED / UNLOCKED]
  - ACCESS block: Mode, Role, Service SW
  - PROJECT block: Project ID, Profile, Config Rev, Checksum
  - POINT DATABASE block: Total Points, per-type count
  - SAFE STATE POLICY block: DO/AO PER_POINT, UI/DI READ_ONLY
  - ACTIONS (disabled khi LOCKED):
    [ Reload Config ]   [ Restart Services ]   [ Reboot System ]
    [ Backup Config ]   [ Restore Config ]

Unlock: PIN nhập đúng OR physical service switch ON OR Engineer role
Reboot confirmation: hold 3 giây; áp per-point safe_state trước khi tắt

Done khi: UC-LOCAL-012/013/014 pass; LOCKED default; unlock 3 điều kiện; reboot 3s hold
```

### HMI-010: SHM data binding

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — mmap read-only, magic+seqlock, late attach, AGE/STALE và point DB transactional validation có unit test; còn T-SW-102/103 với producer thật.

```
File: data/shm_reader.cpp/hpp, data/point_db.cpp/hpp
Output:
  - Mmap kx_io_shm_t (PROT_READ) → đọc UI/DI/AO/DO value + quality
  - Mmap kx_plc_shm_t (PROT_READ) → đọc alarm count, ext snapshot
  - lv_timer 1s: refresh tất cả widgets; tính AGE = now - last_update_ts
  - point_db: load display_name/unit/scale từ /data/config/point_db.json
  - STALE nếu AGE > configured threshold (default 5s)
Done khi: SHM update → widget cập nhật ≤ 1s; AGE tăng đều; STALE highlight đúng
```

### HMI-011: Localization EN/VI

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — bảng EN/VI UTF-8, NotoSans FreeType và SIGHUP reload; UTF-8/parser unit test pass, còn visual test dấu tiếng Việt trên TFT.

```
File: i18n/locale.cpp/hpp
Output:
  - Chuỗi UI lưu trong bảng locale (EN mặc định + VI)
  - SIGHUP: reload locale từ config không reboot
  - NotoSans font hỗ trợ UTF-8 tiếng Việt đầy đủ dấu
Done khi: SIGHUP đổi VI → EN và ngược lại; không restart service
```

### HMI-012: systemd packaging

**Trạng thái triển khai:** ĐÃ làm 2026-06-27 — unit Type=notify/watchdog, device groups, CAP_SYS_BOOT, CMake install và root installer; còn systemctl/reboot acceptance trên Orange Pi.

```
File: packaging/mkddc-hmi.service
[Unit]
Description=MK-DDC-24 HMI Local Display
After=mkddc-core.service mkddc-iobus.service
Requires=mkddc-core.service

[Service]
ExecStart=/usr/sbin/mkddc-hmi
Restart=always
RestartSec=3
User=mkddc
Environment=DISPLAY= XDG_RUNTIME_DIR=/run/user/1000

[Install]
WantedBy=multi-user.target

Done khi: systemd start/stop/restart hoạt động; journalctl log đủ debug
```

---

## 4. Thứ tự làm

```
HMI-001 (DRM build) → HMI-002 (input) → HMI-003 (nav) → HMI-010 (SHM)
  → HMI-004..009 (6 screens song song sau khi nav + SHM xong)
  → HMI-011 (i18n) → HMI-012 (packaging)
```

HMI-004..009 có thể làm song song sau khi HMI-001/002/003/010 done.

---

## 5. Dependencies

| Dep | Version | Ghi chú |
|-----|---------|---------|
| LVGL | v9.x | submodule hoặc system package |
| libdrm | ≥ 2.4.100 | `apt install libdrm-dev` |
| libinput | ≥ 1.19 | cho evdev touch |
| libc | glibc | POSIX shm, mmap |
| NotoSans | TTF | hỗ trợ VI có dấu |

Build flag: `MKDDC_ENABLE_HMI=ON` (cmake option) — tương tự pattern MODBUS/BACNET.

---

## 6. Test matrix

| UC | Test | Màn |
|----|------|-----|
| UC-LOCAL-001 | 30s glance — nhìn biết OK/FAULT | Home |
| UC-LOCAL-002 | Navigation 6 màn — swipe + tap tab + button | All |
| UC-LOCAL-003 | Controller resource: CPU/RAM/Temp đúng | Home |
| UC-LOCAL-004 | I/O health overview 24 points | Home + I/O |
| UC-LOCAL-005 | Chi tiết 24 point — VALUE/UNIT/QUALITY/AGE | I/O |
| UC-LOCAL-006 | Filter BAD/STALE | I/O |
| UC-LOCAL-007 | Xem alarm active — 4-state | Alarm |
| UC-LOCAL-008 | ACK alarm — UNACK→ACK, không xóa | Alarm |
| UC-LOCAL-009 | Ethernet/IP check | Comm |
| UC-LOCAL-010 | BACnet/Modbus check — status codes đúng | Comm |
| UC-LOCAL-011 | System diagnostics — read-only | Sys |
| UC-LOCAL-012 | Enter Service Mode (PIN/switch) | Svc |
| UC-LOCAL-013 | Reload config (checksum, rollback) | Svc |
| UC-LOCAL-014 | Safe reboot (3s hold, per-point safe state) | Svc |

---

**Rev** 1.1 | 2026-06-27 (Cập nhật implementation source, automated tests và hardware/integration gates còn mở; ghi rõ gap checksum, communication telemetry và Web-role mapping) ·
**Rev** 1.0 | 2026-06-27 (Tạo mới — HMI kéo vào Rev A per REVA_SCOPE amendment; 12 task HMI-001..012; spec từ SW_HMI_DESIGN Rev 2.2 + UC Rev 2.1 + UX Rev 2.0) ·
DoD: [13_DEFINITION_OF_DONE](13_DEFINITION_OF_DONE.md) · Phase: [03_PHASE_PLAN §5.5](03_PHASE_PLAN.md)
